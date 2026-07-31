"""내 컴퓨터에서만 도는 작은 웹 서버.

브라우저 화면을 쓰기 위한 것일 뿐, 외부에서는 접속할 수 없다.
 - 127.0.0.1(내 PC)에만 연결을 받는다.
 - 실행할 때마다 일회용 접속 토큰을 만들어 확인한다.
"""

from __future__ import annotations

import csv
import io
import json
import mimetypes
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import APP_NAME, __version__, analyze, db, search as search_mod
from .config import Config
from .extract import SUPPORTED
from .indexer import Indexer

WEBUI_DIR = Path(__file__).parent / "webui"


class AppState:
    """설정·색인기·데이터베이스 연결을 들고 있는 공용 상태."""

    def __init__(self, config: Config):
        self.config = config
        self.indexer = Indexer(config)
        self.token = secrets.token_urlsafe(24)
        self._local = threading.local()

    def conn(self):
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = db.connect(self.config.db_path)
            self._local.conn = conn
        return conn

    def reset_conn(self):
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
            self._local.conn = None


def open_in_explorer(path: str, folder_only: bool = False) -> tuple[bool, str]:
    """파일 또는 파일이 든 폴더를 운영체제 기본 프로그램으로 연다."""
    target = os.path.dirname(path) if folder_only else path
    if not os.path.exists(target):
        return False, "파일을 찾을 수 없습니다. 옮겨졌거나 삭제된 것 같습니다."
    try:
        if sys.platform.startswith("win"):
            if folder_only and os.path.exists(path):
                subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
            else:
                os.startfile(target)          # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            args = ["open", "-R", path] if folder_only else ["open", target]
            subprocess.Popen(args)
        else:
            subprocess.Popen(["xdg-open", target])
        return True, ""
    except Exception as exc:
        return False, f"열 수 없습니다: {exc}"


class Handler(BaseHTTPRequestHandler):
    server_version = f"WelfareSearch/{__version__}"
    state: AppState                      # 서버 기동 시 주입

    # ---------- 공통 ----------

    def log_message(self, fmt, *args):   # 콘솔을 조용하게
        pass

    def _authorized(self, params: dict) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost", "[::1]", "::1"):
            return False
        token = self.headers.get("X-Token") or (params.get("t", [""])[0])
        return secrets.compare_digest(token or "", self.state.token)

    def _send(self, code: int, body: bytes, ctype: str = "application/json; charset=utf-8",
              extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, data, code: int = 200) -> None:
        self._send(code, json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def _error(self, message: str, code: int = 400) -> None:
        self._json({"error": message}, code)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except ValueError:
            return {}

    # ---------- 라우팅 ----------

    def do_GET(self):                                  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        path = parsed.path

        if path in ("/", "/index.html"):
            return self._serve_page()
        if path == "/favicon.ico":
            icon = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
                    '<text y="26" font-size="26">🔎</text></svg>')
            return self._send(200, icon.encode("utf-8"), "image/svg+xml")
        if path.startswith("/static/"):
            return self._serve_static(path[len("/static/"):])

        if not self._authorized(params):
            return self._error("접근 권한이 없습니다. 프로그램을 다시 실행해 주세요.", 403)

        try:
            return self._api_get(path, params)
        except Exception as exc:
            return self._error(f"오류가 발생했습니다: {type(exc).__name__}: {exc}", 500)

    def do_POST(self):                                 # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        if not self._authorized(params):
            return self._error("접근 권한이 없습니다. 프로그램을 다시 실행해 주세요.", 403)
        try:
            return self._api_post(parsed.path, self._body())
        except Exception as exc:
            return self._error(f"오류가 발생했습니다: {type(exc).__name__}: {exc}", 500)

    # ---------- 정적 파일 ----------

    def _serve_page(self) -> None:
        html = (WEBUI_DIR / "index.html").read_text(encoding="utf-8")
        html = html.replace("__TOKEN__", self.state.token).replace("__VERSION__", __version__)
        self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")

    def _serve_static(self, rel: str) -> None:
        safe = os.path.normpath(rel).lstrip("./\\")
        target = WEBUI_DIR / safe
        if not target.is_file() or WEBUI_DIR not in target.resolve().parents:
            return self._send(404, b"not found", "text/plain")
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self._send(200, target.read_bytes(), ctype)

    # ---------- API (조회) ----------

    def _api_get(self, path: str, params: dict) -> None:
        st = self.state
        one = lambda k, d="": params.get(k, [d])[0]          # noqa: E731

        if path == "/api/state":
            conn = st.conn()
            return self._json({
                "app": APP_NAME,
                "version": __version__,
                "config": {
                    "roots": st.config.roots,
                    "extensions": st.config.extensions,
                    "exclude_dirs": st.config.exclude_dirs,
                    "max_file_mb": st.config.max_file_mb,
                    "db_path": st.config.db_path,
                },
                "supported": SUPPORTED,
                "stats": db.stats(conn),
                "progress": st.indexer.progress.as_dict(),
                "home": str(Path.home()),
                "sep": os.sep,
                "pdf_ok": _pdf_available(),
            })

        if path == "/api/index/status":
            return self._json(st.indexer.progress.as_dict())

        if path == "/api/search":
            result = search_mod.search(
                st.conn(), one("q"),
                limit=int(one("limit", "100") or 100),
                offset=int(one("offset", "0") or 0),
                ext=one("ext"), doc_type=one("doc_type"), folder=one("folder"),
                since=one("since"), until=one("until"), sort=one("sort", "score"),
            )
            return self._json(result)

        if path == "/api/file":
            data = search_mod.get_file(st.conn(), int(one("id", "0") or 0), one("q"))
            return self._json(data or {"error": "문서를 찾을 수 없습니다."})

        if path == "/api/profile":
            return self._json(analyze.profile(st.conn(), one("q")))

        if path == "/api/compare":
            return self._json(analyze.compare(st.conn(), one("a"), one("b")))

        if path == "/api/overview":
            return self._json(analyze.overview(st.conn()))

        if path == "/api/cooccur":
            return self._json(analyze.cooccurrence(st.conn(), one("term")))

        if path == "/api/trend":
            terms = [t for t in one("terms").split(",") if t.strip()]
            return self._json(analyze.keyword_trend(st.conn(), one("q"), terms))

        if path == "/api/browse":
            return self._json(_browse(one("path") or str(Path.home())))

        if path == "/api/export":
            return self._export(one("q"), one("kind", "search"))

        return self._error("없는 주소입니다.", 404)

    # ---------- API (변경) ----------

    def _api_post(self, path: str, body: dict) -> None:
        st = self.state

        if path == "/api/config":
            cfg = st.config
            if "roots" in body:
                cfg.roots = [str(r) for r in body["roots"] if str(r).strip()]
            if "extensions" in body:
                cfg.extensions = [str(e).lower().lstrip(".") for e in body["extensions"]]
            if "exclude_dirs" in body:
                cfg.exclude_dirs = [str(d) for d in body["exclude_dirs"]]
            if "max_file_mb" in body:
                try:
                    cfg.max_file_mb = max(1, int(body["max_file_mb"]))
                except (TypeError, ValueError):
                    pass
            cfg.save()
            st.indexer.config = cfg
            return self._json({"ok": True, "config": {
                "roots": cfg.roots, "extensions": cfg.extensions,
                "exclude_dirs": cfg.exclude_dirs, "max_file_mb": cfg.max_file_mb,
            }})

        if path == "/api/index/start":
            if not st.config.normalized_roots():
                return self._error("먼저 검색할 폴더를 추가해 주세요.")
            started = st.indexer.start(full=bool(body.get("full")))
            return self._json({"ok": started,
                               "message": "" if started else "이미 색인이 진행 중입니다."})

        if path == "/api/index/stop":
            st.indexer.stop()
            return self._json({"ok": True})

        if path == "/api/index/reset":
            if st.indexer.is_running():
                return self._error("색인이 진행 중입니다. 먼저 중지해 주세요.")
            st.reset_conn()
            db.reset(st.config.db_path)
            return self._json({"ok": True})

        if path == "/api/open":
            ok, msg = open_in_explorer(str(body.get("path", "")),
                                       bool(body.get("folder")))
            return self._json({"ok": ok, "message": msg})

        return self._error("없는 주소입니다.", 404)

    # ---------- 내보내기 ----------

    def _export(self, query: str, kind: str) -> None:
        buf = io.StringIO()
        writer = csv.writer(buf)
        conn = self.state.conn()
        if kind == "profile":
            data = analyze.profile(conn, query)
            writer.writerow(["구분", "항목", "값"])
            writer.writerow(["요약", "검색어", query])
            writer.writerow(["요약", "문서 수", data.get("doc_count", 0)])
            writer.writerow(["요약", "기간", f"{data.get('first_date','')} ~ {data.get('last_date','')}"])
            for k in data.get("keywords", []):
                writer.writerow(["주요 키워드", k["term"], k["count"]])
            for c in data.get("categories", []):
                writer.writerow(["영역", c[0], c[1]])
            for c in data.get("checklist", []):
                writer.writerow(["서식 점검", c["form"], "있음" if c["ok"] else "없음"])
            for d in data.get("documents", []):
                writer.writerow(["문서", d["name"], d["path"]])
            filename = "프로필.csv"
        else:
            res = search_mod.search(conn, query, limit=5000)
            writer.writerow(["파일명", "서식유형", "수정일", "일치횟수", "폴더", "전체경로"])
            for r in res["results"]:
                writer.writerow([r["name"], r["doc_type"], r["mtime_text"],
                                 r["hits"], r["folder"], r["path"]])
            filename = "검색결과.csv"

        # 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다.
        data = "﻿" + buf.getvalue()
        quoted = urllib.parse.quote(filename)
        self._send(200, data.encode("utf-8"), "text/csv; charset=utf-8",
                   {"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"})


def _pdf_available() -> bool:
    try:
        import pypdf  # noqa: F401
        return True
    except ImportError:
        try:
            import PyPDF2  # noqa: F401
            return True
        except ImportError:
            return False


def _browse(path: str) -> dict:
    """폴더 고르기용 목록."""
    p = Path(path).expanduser()
    try:
        p = p.resolve()
    except OSError:
        p = Path.home()
    if not p.is_dir():
        p = Path.home()
    items = []
    try:
        for child in sorted(p.iterdir(), key=lambda c: c.name.lower()):
            if child.name.startswith("."):
                continue
            try:
                if child.is_dir():
                    items.append({"name": child.name, "path": str(child)})
            except OSError:
                continue
    except PermissionError:
        return {"path": str(p), "parent": str(p.parent), "items": [],
                "error": "이 폴더는 열 권한이 없습니다."}
    drives = []
    if sys.platform.startswith("win"):
        for letter in "CDEFGHIJKLMNOPQRSTUVWXYZ":
            d = f"{letter}:\\"
            if os.path.exists(d):
                drives.append(d)
    return {"path": str(p), "parent": str(p.parent), "items": items[:500],
            "drives": drives, "home": str(Path.home())}


def find_free_port(preferred: int = 8760) -> int:
    for port in range(preferred, preferred + 40):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve(config: Config, *, port: int = 0, open_browser: bool = True) -> None:
    state = AppState(config)
    Handler.state = state
    port = port or find_free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/?t={state.token}"

    print("=" * 62)
    print(f"  {APP_NAME}  v{__version__}")
    print("=" * 62)
    print(f"  브라우저에서 아래 주소가 열립니다:\n    {url}")
    print("  * 이 주소는 내 컴퓨터에서만 열 수 있습니다.")
    print("  * 프로그램을 끄려면 이 창에서 Ctrl+C 를 누르세요.")
    print("=" * 62)

    if open_browser:
        def _open():
            time.sleep(0.6)
            try:
                import webbrowser
                webbrowser.open(url)
            except Exception:
                pass
        threading.Thread(target=_open, daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n종료합니다.")
    finally:
        httpd.server_close()
