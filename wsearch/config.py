"""설정 파일 읽기/쓰기.

설정과 색인 데이터베이스는 사용자 홈 폴더 아래 `.welfare_search/` 에 저장된다.
민감한 개인정보(사례관리 기록)를 다루므로 외부로 전송하지 않는다.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from pathlib import Path

APP_DIR = Path(os.environ.get("WSEARCH_HOME") or (Path.home() / ".welfare_search"))
CONFIG_PATH = APP_DIR / "config.json"

# 색인 대상 확장자 (소문자, 점 없음)
DEFAULT_EXTENSIONS = [
    "hwp", "hwpx",           # 한글
    "doc", "docx",           # 워드
    "xls", "xlsx", "xlsm",   # 엑셀
    "ppt", "pptx",           # 파워포인트
    "pdf",
    "txt", "md", "csv", "tsv", "log", "rtf", "json", "xml", "html", "htm",
]

# 건너뛸 폴더 이름 (경로 어디에 있든 이 이름이면 통째로 제외)
DEFAULT_EXCLUDE_DIRS = [
    ".git", ".svn", "__pycache__", "node_modules", "venv", ".venv",
    "site-packages", ".cache", ".Trash", "$RECYCLE.BIN",
    "System Volume Information", "Windows", "Program Files",
    "Program Files (x86)", "ProgramData", "AppData", "Library",
    "OneDriveTemp", ".welfare_search",
]

# 임시/잠금 파일 패턴
SKIP_PREFIXES = ("~$", "._", ".~")


@dataclass
class Config:
    """사용자 설정."""

    roots: list[str] = field(default_factory=list)          # 검색할 폴더들
    extensions: list[str] = field(default_factory=lambda: list(DEFAULT_EXTENSIONS))
    exclude_dirs: list[str] = field(default_factory=lambda: list(DEFAULT_EXCLUDE_DIRS))
    max_file_mb: int = 40           # 이보다 큰 파일은 본문을 읽지 않고 파일명만 색인
    max_text_chars: int = 2_000_000  # 파일 하나에서 보관할 최대 글자 수
    db_path: str = str(APP_DIR / "index.db")
    follow_symlinks: bool = False

    # ---------- 저장/불러오기 ----------

    @classmethod
    def load(cls) -> "Config":
        if CONFIG_PATH.exists():
            try:
                data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                data = {}
            known = {f for f in cls.__dataclass_fields__}
            return cls(**{k: v for k, v in data.items() if k in known})
        return cls()

    def save(self) -> None:
        APP_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(
            json.dumps(asdict(self), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ---------- 도우미 ----------

    @property
    def ext_set(self) -> set[str]:
        return {e.lower().lstrip(".") for e in self.extensions if e.strip()}

    @property
    def exclude_set(self) -> set[str]:
        return {d.strip() for d in self.exclude_dirs if d.strip()}

    @property
    def max_file_bytes(self) -> int:
        return max(1, self.max_file_mb) * 1024 * 1024

    def normalized_roots(self) -> list[str]:
        """존재하는 폴더만, 중복·하위폴더 중복 제거해서 반환."""
        out: list[str] = []
        for r in self.roots:
            try:
                p = Path(r).expanduser().resolve()
            except OSError:
                continue
            if not p.is_dir():
                continue
            s = str(p)
            if any(s == o or s.startswith(o + os.sep) for o in out):
                continue  # 이미 상위 폴더가 포함됨
            out = [o for o in out if not o.startswith(s + os.sep)]
            out.append(s)
        return out
