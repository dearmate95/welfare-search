"""폴더를 훑어 문서 본문을 색인한다.

- 이미 색인된 파일은 크기·수정시각이 그대로면 건너뛴다(증분 색인).
- 본문 추출은 여러 스레드로, 데이터베이스 쓰기는 한 곳에서만 한다.
"""

from __future__ import annotations

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict

from . import db, korean
from .config import Config, SKIP_PREFIXES
from .extract import extract_text


@dataclass
class Progress:
    running: bool = False
    phase: str = "대기"          # 대기 | 파일 목록 확인 | 본문 읽는 중 | 정리 | 완료 | 중단됨 | 오류
    total: int = 0
    done: int = 0
    added: int = 0
    updated: int = 0
    skipped: int = 0
    failed: int = 0
    removed: int = 0
    current: str = ""
    started_at: float = 0.0
    finished_at: float = 0.0
    error: str = ""
    recent_errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        d = asdict(self)
        elapsed = (self.finished_at or time.time()) - self.started_at if self.started_at else 0
        d["elapsed"] = round(elapsed, 1)
        d["percent"] = round(100 * self.done / self.total, 1) if self.total else 0
        return d


class Indexer:
    """색인 작업 실행기. 웹 UI에서 진행 상황을 조회할 수 있게 상태를 들고 있다."""

    def __init__(self, config: Config):
        self.config = config
        self.progress = Progress()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    # ---------- 제어 ----------

    def start(self, *, full: bool = False) -> bool:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return False
            self._stop.clear()
            self.progress = Progress(running=True, phase="파일 목록 확인",
                                     started_at=time.time())
            self._thread = threading.Thread(target=self._run, args=(full,), daemon=True)
            self._thread.start()
            return True

    def stop(self) -> None:
        self._stop.set()

    def is_running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def join(self, timeout: float | None = None) -> None:
        if self._thread:
            self._thread.join(timeout)

    # ---------- 실행 ----------

    def _run(self, full: bool) -> None:
        p = self.progress
        conn = None
        try:
            conn = db.connect(self.config.db_path)
            roots = self.config.normalized_roots()
            if not roots:
                p.phase = "오류"
                p.error = "검색할 폴더를 먼저 지정해 주세요."
                return

            if full:
                conn.execute("DELETE FROM contents")
                if db.has_fts(conn):
                    conn.execute("DELETE FROM ftsdoc")
                conn.execute("DELETE FROM files")
                conn.commit()

            known = {
                r["path"]: (r["size"], r["mtime"])
                for r in conn.execute("SELECT path, size, mtime FROM files")
            }

            targets: list[tuple[str, int, float, bool]] = []   # path, size, mtime, is_new
            for path, size, mtime in self._walk(roots):
                if self._stop.is_set():
                    break
                prev = known.get(path)
                if prev and abs(prev[1] - mtime) < 1e-6 and prev[0] == size:
                    p.skipped += 1
                    continue
                targets.append((path, size, mtime, prev is None))
            p.total = len(targets)
            p.phase = "본문 읽는 중"

            max_chars = self.config.max_text_chars
            max_bytes = self.config.max_file_bytes
            workers = min(8, max(2, (os.cpu_count() or 2)))

            # 메모리를 아끼려고 한 번에 batch 개씩만 작업을 띄운다.
            batch = 400
            with ThreadPoolExecutor(max_workers=workers) as pool:
                for start in range(0, len(targets), batch):
                    if self._stop.is_set():
                        break
                    chunk = targets[start: start + batch]
                    futures = {
                        pool.submit(self._read_one, item, max_bytes, max_chars): item
                        for item in chunk
                    }
                    for fut in as_completed(futures):
                        item = futures[fut]
                        try:
                            info, body = fut.result()
                        except Exception as exc:            # 개별 파일 실패는 넘어간다
                            p.failed += 1
                            self._note_error(f"{os.path.basename(item[0])}: {exc}")
                            info, body = None, ""
                        if info is not None:
                            try:
                                db.upsert_file(conn, info, body)
                                if info["status"] == "ok":
                                    if item[3]:
                                        p.added += 1
                                    else:
                                        p.updated += 1
                                else:
                                    p.failed += 1
                                    if info.get("note"):
                                        self._note_error(f"{info['name']}: {info['note']}")
                            except Exception as exc:
                                p.failed += 1
                                self._note_error(f"{info['name']}: 저장 실패 {exc}")
                        p.done += 1
                        p.current = os.path.basename(item[0])
                        if p.done % 50 == 0:
                            conn.commit()
                        if self._stop.is_set():
                            for f in futures:       # 아직 시작 안 한 작업은 취소
                                f.cancel()
                    conn.commit()

            conn.commit()

            p.phase = "정리"
            if not self._stop.is_set():
                p.removed = db.delete_missing(conn, roots)
            conn.commit()
            p.phase = "중단됨" if self._stop.is_set() else "완료"
        except Exception as exc:
            p.phase = "오류"
            p.error = f"{type(exc).__name__}: {exc}"
        finally:
            if conn is not None:
                try:
                    conn.commit()
                    conn.close()
                except Exception:
                    pass
            p.running = False
            p.finished_at = time.time()
            p.current = ""

    def _note_error(self, msg: str) -> None:
        errs = self.progress.recent_errors
        errs.append(msg[:300])
        if len(errs) > 50:
            del errs[:-50]

    # ---------- 파일 훑기 ----------

    def _walk(self, roots: list[str]):
        exclude = self.config.exclude_set
        exts = self.config.ext_set
        follow = self.config.follow_symlinks
        seen: set[str] = set()
        for root in roots:
            for dirpath, dirnames, filenames in os.walk(root, followlinks=follow):
                if self._stop.is_set():
                    return
                dirnames[:] = [d for d in dirnames
                               if d not in exclude and not d.startswith(".")]
                self.progress.current = dirpath
                for fn in filenames:
                    if fn.startswith(SKIP_PREFIXES):
                        continue
                    ext = os.path.splitext(fn)[1].lower().lstrip(".")
                    if ext not in exts:
                        continue
                    path = os.path.join(dirpath, fn)
                    if path in seen:
                        continue
                    seen.add(path)
                    try:
                        st = os.stat(path)
                    except OSError:
                        continue
                    yield path, st.st_size, st.st_mtime

    # ---------- 파일 하나 처리 ----------

    @staticmethod
    def _read_one(item, max_bytes: int, max_chars: int):
        path, size, mtime, _is_new = item
        name = os.path.basename(path)
        info = {
            "path": path,
            "folder": os.path.dirname(path),
            "name": name,
            "ext": os.path.splitext(name)[1].lower().lstrip("."),
            "size": size,
            "mtime": mtime,
            "indexed_at": time.time(),
            "status": "ok",
            "note": "",
            "doc_type": "",
            "dates": "",
        }
        if size > max_bytes:
            info["status"] = "skipped"
            info["note"] = f"파일이 너무 큽니다({size // (1024*1024)}MB). 파일명만 색인합니다."
            return info, ""

        result = extract_text(path, max_chars=max_chars)
        info["status"] = result.status
        info["note"] = result.note
        body = result.text
        info["doc_type"] = korean.guess_doc_type(name, body)
        if body:
            months = sorted(set(korean.find_dates(body)))[:40]
            info["dates"] = ",".join(months)
        return info, body


def index_once(config: Config, *, full: bool = False, quiet: bool = False) -> Progress:
    """명령줄용: 색인이 끝날 때까지 기다린다."""
    idx = Indexer(config)
    idx.start(full=full)
    last = -1
    while idx.is_running():
        time.sleep(0.3)
        p = idx.progress
        if not quiet and p.total and p.done != last:
            last = p.done
            pct = 100 * p.done / p.total
            print(f"\r  {p.phase}: {p.done}/{p.total} ({pct:.0f}%) {p.current[:40]:<40}",
                  end="", flush=True)
    idx.join()
    if not quiet:
        print()
    return idx.progress
