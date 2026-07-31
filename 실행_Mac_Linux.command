#!/bin/bash
# 복지사례 문서검색 실행 (맥·리눅스)
cd "$(dirname "$0")" || exit 1

echo
echo "  복지사례 문서검색을 시작합니다..."
echo

if command -v python3 > /dev/null 2>&1; then
    python3 main.py "$@"
elif command -v python > /dev/null 2>&1; then
    python main.py "$@"
else
    echo "  [안내] 파이썬(Python 3)이 설치되어 있지 않습니다."
    echo "  https://www.python.org/downloads/ 에서 설치한 뒤 다시 실행해 주세요."
    read -r -p "  엔터를 누르면 닫힙니다..."
fi
