@echo off
chcp 65001 > nul
title 복지사례 문서검색
cd /d "%~dp0"

echo.
echo   복지사례 문서검색을 시작합니다...
echo.

where py > nul 2>&1
if %errorlevel%==0 (
    py -3 main.py %*
    goto :end
)

where python > nul 2>&1
if %errorlevel%==0 (
    python main.py %*
    goto :end
)

echo   [안내] 파이썬(Python)이 설치되어 있지 않습니다.
echo.
echo   1) https://www.python.org/downloads/ 에서 최신 버전을 내려받으세요.
echo   2) 설치 화면 맨 아래 "Add Python to PATH" 를 반드시 체크하세요.
echo   3) 설치가 끝나면 이 파일을 다시 실행하세요.
echo.

:end
echo.
pause
