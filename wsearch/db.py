"""색인 데이터베이스(SQLite).

한글은 조사가 붙어 단어 경계가 흐리므로, 부분일치가 잘 되는
FTS5 trigram 토크나이저를 쓴다(3글자 이상 검색어에 사용).
2글자 이하 검색어는 본문 직접 대조로 처리한다.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

SCHEMA_VERSION = 2

_local = threading.local()


def _fts_available(conn: sqlite3.Connection) -> bool:
    try:
        conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS _fts_probe USING fts5(x, tokenize='trigram')")
        conn.execute("DROP TABLE IF EXISTS _fts_probe")
        return True
    except sqlite3.Error:
        return False


def connect(db_path: str) -> sqlite3.Connection:
    """스레드별 커넥션을 만들고 스키마를 보장한다."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA busy_timeout=30000")
    init_schema(conn)
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS files (
            id        INTEGER PRIMARY KEY,
            path      TEXT UNIQUE NOT NULL,
            folder    TEXT NOT NULL,
            name      TEXT NOT NULL,
            ext       TEXT,
            size      INTEGER,
            mtime     REAL,
            indexed_at REAL,
            status    TEXT,          -- ok | empty | unsupported | error | skipped
            note      TEXT,
            text_len  INTEGER DEFAULT 0,
            doc_type  TEXT,
            dates     TEXT           -- 본문에서 찾은 연-월, 쉼표 구분
        );
        CREATE INDEX IF NOT EXISTS idx_files_mtime  ON files(mtime);
        CREATE INDEX IF NOT EXISTS idx_files_ext    ON files(ext);
        CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder);
        CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);

        CREATE TABLE IF NOT EXISTS contents (
            file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
            body    TEXT NOT NULL
        );
        """
    )
    if _fts_available(conn):
        # content='' (contentless) 방식은 행 삭제를 지원하지 않아, 파일이 지워졌을 때
        # 색인을 정리할 수 없다. 그래서 일반 FTS5 테이블을 쓴다.
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='ftsdoc'"
        ).fetchone()
        if row and "content=" in (row["sql"] or ""):
            conn.executescript("DROP TABLE IF EXISTS ftsdoc;")
            row = None
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS ftsdoc "
            "USING fts5(name, body, tokenize='trigram')"
        )
        if row is None:
            _rebuild_fts(conn)
        conn.execute("INSERT OR REPLACE INTO meta VALUES ('fts','trigram')")
    else:
        conn.execute("INSERT OR REPLACE INTO meta VALUES ('fts','none')")
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('schema', ?)", (str(SCHEMA_VERSION),))
    conn.commit()


def _rebuild_fts(conn: sqlite3.Connection) -> None:
    """이미 저장된 본문으로 검색 색인을 다시 채운다."""
    rows = conn.execute(
        """SELECT f.id, f.name, c.body FROM files f
           JOIN contents c ON c.file_id = f.id"""
    ).fetchall()
    if not rows:
        return
    conn.executemany(
        "INSERT INTO ftsdoc (rowid, name, body) VALUES (?,?,?)",
        [(r["id"], r["name"], r["body"]) for r in rows],
    )
    conn.commit()


def has_fts(conn: sqlite3.Connection) -> bool:
    row = conn.execute("SELECT value FROM meta WHERE key='fts'").fetchone()
    return bool(row and row["value"] == "trigram")


# ---------------------------------------------------------------------------
# 파일 레코드 저장
# ---------------------------------------------------------------------------

def upsert_file(conn: sqlite3.Connection, info: dict, body: str) -> int:
    """파일 정보와 본문을 저장(있으면 갱신)하고 file id를 돌려준다."""
    cur = conn.execute("SELECT id FROM files WHERE path = ?", (info["path"],))
    row = cur.fetchone()
    fields = (
        info["folder"], info["name"], info["ext"], info["size"], info["mtime"],
        info["indexed_at"], info["status"], info.get("note", ""),
        len(body), info.get("doc_type", ""), info.get("dates", ""),
    )
    if row:
        file_id = row["id"]
        conn.execute(
            """UPDATE files SET folder=?, name=?, ext=?, size=?, mtime=?,
                   indexed_at=?, status=?, note=?, text_len=?, doc_type=?, dates=?
               WHERE id=?""",
            (*fields, file_id),
        )
        conn.execute("DELETE FROM contents WHERE file_id=?", (file_id,))
        if has_fts(conn):
            conn.execute("DELETE FROM ftsdoc WHERE rowid=?", (file_id,))
    else:
        cur = conn.execute(
            """INSERT INTO files (path, folder, name, ext, size, mtime,
                   indexed_at, status, note, text_len, doc_type, dates)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (info["path"], *fields),
        )
        file_id = cur.lastrowid

    conn.execute("INSERT INTO contents (file_id, body) VALUES (?,?)", (file_id, body))
    if has_fts(conn):
        conn.execute(
            "INSERT INTO ftsdoc (rowid, name, body) VALUES (?,?,?)",
            (file_id, info["name"], body),
        )
    return file_id


def delete_missing(conn: sqlite3.Connection, roots: list[str]) -> int:
    """색인에는 있지만 실제로는 사라진 파일 정리."""
    removed = 0
    rows = conn.execute("SELECT id, path FROM files").fetchall()
    for row in rows:
        path = row["path"]
        inside = not roots or any(
            path == r or path.startswith(r + os.sep) for r in roots
        )
        if not inside or not os.path.exists(path):
            conn.execute("DELETE FROM contents WHERE file_id=?", (row["id"],))
            if has_fts(conn):
                conn.execute("DELETE FROM ftsdoc WHERE rowid=?", (row["id"],))
            conn.execute("DELETE FROM files WHERE id=?", (row["id"],))
            removed += 1
    conn.commit()
    return removed


def stats(conn: sqlite3.Connection) -> dict:
    row = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) AS ok,
                  SUM(text_len) AS chars,
                  MAX(indexed_at) AS last_indexed
           FROM files"""
    ).fetchone()
    by_ext = conn.execute(
        "SELECT ext, COUNT(*) c FROM files GROUP BY ext ORDER BY c DESC LIMIT 20"
    ).fetchall()
    problems = conn.execute(
        """SELECT status, COUNT(*) c FROM files
           WHERE status NOT IN ('ok') GROUP BY status ORDER BY c DESC"""
    ).fetchall()
    return {
        "total": row["total"] or 0,
        "ok": row["ok"] or 0,
        "chars": row["chars"] or 0,
        "last_indexed": row["last_indexed"],
        "by_ext": [dict(r) for r in by_ext],
        "problems": [dict(r) for r in problems],
    }


def reset(db_path: str) -> None:
    """색인을 완전히 지운다."""
    for suffix in ("", "-wal", "-shm"):
        p = Path(db_path + suffix)
        if p.exists():
            p.unlink()
