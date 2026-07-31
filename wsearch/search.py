"""검색 엔진.

검색어 문법
  홍길동 상담          → 두 단어가 모두 들어간 문서 (AND)
  "초기 상담"          → 따옴표 안은 붙여서 그대로 (구문 검색)
  홍길동 -종결         → '종결'이 들어간 문서는 제외
  홍길동 | 김철수      → 둘 중 하나라도 (OR)

한글은 조사가 붙어도 걸리도록 '부분일치'로 찾는다.
3글자 이상 검색어는 FTS5 trigram 색인으로 빠르게 후보를 좁히고,
마지막에는 항상 본문을 직접 대조해 정확도를 보장한다.
"""

from __future__ import annotations

import os
import re
import sqlite3
import time
from dataclasses import dataclass, field

from . import db, korean

TOKEN_SPLIT_RE = re.compile(r'"[^"]*"|\S+')
SNIPPET_PAD = 45
MAX_SNIPPETS = 3


@dataclass
class Query:
    include: list[str] = field(default_factory=list)      # 모두 포함
    exclude: list[str] = field(default_factory=list)      # 제외
    any_of: list[str] = field(default_factory=list)       # 하나라도 포함
    raw: str = ""

    @property
    def terms(self) -> list[str]:
        return self.include + self.any_of

    def is_empty(self) -> bool:
        return not (self.include or self.any_of)


def parse_query(text: str) -> Query:
    q = Query(raw=text or "")
    text = korean.normalize(text or "").strip()
    if not text:
        return q
    # 'A | B' 형태는 OR 로 본다.
    if "|" in text:
        for part in text.split("|"):
            part = part.strip().strip('"')
            if part:
                q.any_of.append(part)
        return q
    for tok in TOKEN_SPLIT_RE.findall(text):
        if tok.startswith('"') and tok.endswith('"') and len(tok) > 2:
            q.include.append(tok[1:-1].strip())
        elif tok.startswith("-") and len(tok) > 1:
            q.exclude.append(tok[1:].strip().strip('"'))
        elif tok:
            q.include.append(tok)
    q.include = [t for t in q.include if t]
    return q


def _fts_expr(term: str) -> str:
    """trigram 색인용 구문. 특수문자는 이스케이프한다."""
    return '"' + term.replace('"', '""') + '"'


def _candidates(conn: sqlite3.Connection, terms: list[str], mode: str,
                limit: int) -> set[int] | None:
    """검색어별 후보 file id 집합. None이면 '전체 대상'."""
    use_fts = db.has_fts(conn)
    result: set[int] | None = None

    for term in terms:
        ids: set[int] = set()
        forms = korean.variants(term)
        for form in forms:
            if use_fts and len(form) >= 3:
                try:
                    rows = conn.execute(
                        "SELECT rowid FROM ftsdoc WHERE ftsdoc MATCH ? LIMIT ?",
                        (_fts_expr(form), limit),
                    ).fetchall()
                    ids.update(r[0] for r in rows)
                    continue
                except sqlite3.Error:
                    pass                       # 색인 문제 시 아래 방식으로 대체
            like = f"%{form}%"
            rows = conn.execute(
                """SELECT f.id FROM files f
                   LEFT JOIN contents c ON c.file_id = f.id
                   WHERE f.name LIKE ? ESCAPE '\\' OR c.body LIKE ? ESCAPE '\\'
                   LIMIT ?""",
                (like.replace("_", "\\_"), like.replace("_", "\\_"), limit),
            ).fetchall()
            ids.update(r[0] for r in rows)

        if mode == "and":
            result = ids if result is None else (result & ids)
            if not result:
                return set()
        else:
            result = ids if result is None else (result | ids)
    return result


def _count_hits(haystack: str, needle: str) -> int:
    if not needle:
        return 0
    return haystack.count(needle)


def _make_snippets(body: str, terms: list[str]) -> list[list]:
    """검색어 주변 문맥을 잘라낸다. [[문자열, 강조여부], ...] 형태."""
    if not body:
        return []
    positions: list[tuple[int, int]] = []
    low = body.lower()
    for term in terms:
        t = term.lower()
        if not t:
            continue
        start = 0
        found = 0
        while found < MAX_SNIPPETS:
            i = low.find(t, start)
            if i < 0:
                break
            positions.append((i, len(t)))
            start = i + len(t)
            found += 1
    if not positions:
        return []
    positions.sort()

    windows: list[tuple[int, int]] = []
    for pos, length in positions:
        s, e = max(0, pos - SNIPPET_PAD), min(len(body), pos + length + SNIPPET_PAD)
        if windows and s <= windows[-1][1] + 10:
            windows[-1] = (windows[-1][0], max(windows[-1][1], e))
        else:
            windows.append((s, e))
        if len(windows) >= MAX_SNIPPETS:
            break

    snippets: list[list] = []
    for s, e in windows:
        chunk = body[s:e].replace("\n", " ").replace("\t", " ")
        chunk = re.sub(r" {2,}", " ", chunk)
        parts: list[list] = []
        rest = chunk
        # 검색어 위치를 표시하며 잘라 넣는다.
        pattern = re.compile("|".join(re.escape(t) for t in terms if t), re.I)
        idx = 0
        for m in pattern.finditer(rest):
            if m.start() > idx:
                parts.append([rest[idx:m.start()], False])
            parts.append([m.group(0), True])
            idx = m.end()
        if idx < len(rest):
            parts.append([rest[idx:], False])
        prefix = "…" if s > 0 else ""
        suffix = "…" if e < len(body) else ""
        if prefix:
            parts.insert(0, [prefix, False])
        if suffix:
            parts.append([suffix, False])
        snippets.append(parts)
    return snippets


def search(
    conn: sqlite3.Connection,
    query: str,
    *,
    limit: int = 200,
    offset: int = 0,
    ext: str = "",
    doc_type: str = "",
    folder: str = "",
    since: str = "",
    until: str = "",
    sort: str = "score",
    candidate_limit: int = 20000,
) -> dict:
    """검색 실행. 결과와 요약 정보를 함께 돌려준다."""
    started = time.time()
    q = parse_query(query)
    if q.is_empty():
        return {"query": query, "total": 0, "results": [], "elapsed": 0,
                "message": "검색어를 입력해 주세요."}

    ids_and = _candidates(conn, q.include, "and", candidate_limit) if q.include else None
    ids_or = _candidates(conn, q.any_of, "or", candidate_limit) if q.any_of else None
    if ids_and is not None and ids_or is not None:
        cand = ids_and & ids_or
    elif ids_and is not None:
        cand = ids_and
    else:
        cand = ids_or or set()

    if not cand:
        return {"query": query, "total": 0, "results": [],
                "elapsed": round(time.time() - started, 3),
                "message": "일치하는 문서가 없습니다."}

    terms = q.terms
    rows = _fetch_rows(conn, cand, ext=ext, doc_type=doc_type, folder=folder,
                       since=since, until=until)

    scored: list[dict] = []
    now = time.time()
    for row in rows:
        name = row["name"]
        body = row["body"] or ""
        hay_name = name.lower()
        hay_body = body.lower()

        if any(x.lower() in hay_name or x.lower() in hay_body
               for x in q.exclude if x):
            continue

        # 모든 필수어가 실제로 들어있는지 최종 확인 (띄어쓰기 변형 허용)
        ok = True
        name_hits = content_hits = 0
        per_term: dict[str, int] = {}
        for term in q.include:
            best = 0
            n_hit = 0
            for form in korean.variants(term):
                f = form.lower()
                b = _count_hits(hay_body, f)
                n = _count_hits(hay_name, f)
                best = max(best, b + n)
                n_hit = max(n_hit, n)
            if best == 0:
                ok = False
                break
            per_term[term] = best
            content_hits += best
            name_hits += n_hit
        if not ok:
            continue
        if q.any_of:
            any_hit = 0
            for term in q.any_of:
                for form in korean.variants(term):
                    f = form.lower()
                    c = _count_hits(hay_body, f) + _count_hits(hay_name, f)
                    if c:
                        per_term[term] = per_term.get(term, 0) + c
                        any_hit += c
                        content_hits += c
                        name_hits += _count_hits(hay_name, f)
            if not any_hit:
                continue

        age_days = max(0.0, (now - (row["mtime"] or now)) / 86400)
        recency = 1.0 / (1.0 + age_days / 365)
        score = name_hits * 12 + min(content_hits, 60) * 1.5 + recency * 6
        if row["doc_type"] and row["doc_type"] != "기타":
            score += 1.0

        scored.append({
            "id": row["id"],
            "path": row["path"],
            "folder": row["folder"],
            "name": name,
            "ext": row["ext"],
            "size": row["size"],
            "mtime": row["mtime"],
            "mtime_text": time.strftime("%Y-%m-%d", time.localtime(row["mtime"] or 0)),
            "doc_type": row["doc_type"] or "",
            "status": row["status"],
            "note": row["note"] or "",
            "hits": content_hits,
            "name_hits": name_hits,
            "per_term": per_term,
            "score": round(score, 2),
            "snippets": _make_snippets(body, terms),
        })

    if sort == "date":
        scored.sort(key=lambda r: r["mtime"] or 0, reverse=True)
    elif sort == "name":
        scored.sort(key=lambda r: r["name"])
    elif sort == "hits":
        scored.sort(key=lambda r: r["hits"], reverse=True)
    else:
        scored.sort(key=lambda r: r["score"], reverse=True)

    total = len(scored)
    page = scored[offset: offset + limit]
    return {
        "query": query,
        "terms": terms,
        "total": total,
        "returned": len(page),
        "offset": offset,
        "results": page,
        "facets": _facets(scored),
        "elapsed": round(time.time() - started, 3),
        "message": "" if total else "일치하는 문서가 없습니다.",
    }


def _fetch_rows(conn, ids: set[int], *, ext="", doc_type="", folder="",
                since="", until=""):
    """후보 id들의 상세 정보를 가져온다(필터 적용)."""
    out = []
    ids_list = list(ids)
    where, params = [], []
    if ext:
        exts = [e.strip().lower().lstrip(".") for e in ext.split(",") if e.strip()]
        if exts:
            where.append(f"f.ext IN ({','.join('?' * len(exts))})")
            params.extend(exts)
    if doc_type:
        where.append("f.doc_type = ?")
        params.append(doc_type)
    if folder:
        where.append("f.path LIKE ?")
        params.append(f"{folder}%")
    if since:
        where.append("f.mtime >= ?")
        params.append(_to_epoch(since))
    if until:
        where.append("f.mtime <= ?")
        params.append(_to_epoch(until, end_of_day=True))
    extra = (" AND " + " AND ".join(where)) if where else ""

    for i in range(0, len(ids_list), 800):
        chunk = ids_list[i: i + 800]
        marks = ",".join("?" * len(chunk))
        sql = (
            "SELECT f.id, f.path, f.folder, f.name, f.ext, f.size, f.mtime, "
            "       f.status, f.note, f.doc_type, c.body "
            "FROM files f LEFT JOIN contents c ON c.file_id = f.id "
            f"WHERE f.id IN ({marks}){extra}"
        )
        out.extend(conn.execute(sql, (*chunk, *params)).fetchall())
    return out


def _to_epoch(datestr: str, end_of_day: bool = False) -> float:
    try:
        t = time.strptime(datestr[:10], "%Y-%m-%d")
        base = time.mktime(t)
        return base + (86399 if end_of_day else 0)
    except (ValueError, TypeError):
        return 0 if not end_of_day else time.time() + 86400


def _facets(results: list[dict]) -> dict:
    """결과를 확장자·서식유형·폴더·연도별로 묶은 요약."""
    from collections import Counter
    ext_c: Counter = Counter()
    type_c: Counter = Counter()
    year_c: Counter = Counter()
    folder_c: Counter = Counter()
    for r in results:
        ext_c[r["ext"] or "?"] += 1
        type_c[r["doc_type"] or "기타"] += 1
        year_c[(r["mtime_text"] or "")[:4]] += 1
        folder_c[os.path.basename(r["folder"]) or r["folder"]] += 1
    return {
        "ext": ext_c.most_common(12),
        "doc_type": type_c.most_common(12),
        "year": sorted(year_c.items(), reverse=True)[:12],
        "folder": folder_c.most_common(12),
    }


def get_file(conn: sqlite3.Connection, file_id: int, query: str = "") -> dict | None:
    row = conn.execute(
        """SELECT f.*, c.body FROM files f
           LEFT JOIN contents c ON c.file_id = f.id WHERE f.id = ?""",
        (file_id,),
    ).fetchone()
    if not row:
        return None
    body = row["body"] or ""
    q = parse_query(query)
    return {
        "id": row["id"],
        "path": row["path"],
        "name": row["name"],
        "ext": row["ext"],
        "size": row["size"],
        "mtime_text": time.strftime("%Y-%m-%d %H:%M", time.localtime(row["mtime"] or 0)),
        "doc_type": row["doc_type"] or "",
        "status": row["status"],
        "note": row["note"] or "",
        "dates": (row["dates"] or "").split(",") if row["dates"] else [],
        "body": body[:200_000],
        "terms": q.terms,
        "exists": os.path.exists(row["path"]),
    }
