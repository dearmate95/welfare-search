#!/usr/bin/env python3
"""복지사례 문서검색 — 실행 파일.

  python main.py            브라우저 화면 열기
  python main.py --help     명령줄 사용법 보기
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

if sys.version_info < (3, 9):
    print("Python 3.9 이상이 필요합니다. python.org 에서 최신 버전을 설치해 주세요.")
    raise SystemExit(1)

from wsearch.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
