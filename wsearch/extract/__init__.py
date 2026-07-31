"""파일 종류에 맞춰 본문 텍스트를 뽑아주는 창구."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

from . import hwp, hwpx, ooxml, plain, rtf, msdoc, pdfdoc

# 확장자별 지원 여부 안내(설정 화면 표시용)
SUPPORTED = {
    "hwp": "한글 문서", "hwpx": "한글 문서(최신)",
    "doc": "워드 97-2003", "docx": "워드",
    "xls": "엑셀 97-2003", "xlsx": "엑셀", "xlsm": "엑셀(매크로)",
    "ppt": "파워포인트 97-2003", "pptx": "파워포인트",
    "pdf": "PDF (pypdf 설치 시)",
    "txt": "텍스트", "md": "텍스트", "csv": "표", "tsv": "표",
    "log": "로그", "rtf": "서식 텍스트", "json": "데이터", "xml": "데이터",
    "html": "웹문서", "htm": "웹문서",
}

WS_RE = re.compile(r"[ \t ]{2,}")
NL_RE = re.compile(r"\n{3,}")


@dataclass
class Extracted:
    text: str
    status: str          # ok | empty | unsupported | error
    note: str = ""


def _clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\x00", "")
    text = WS_RE.sub(" ", text)
    return NL_RE.sub("\n\n", text).strip()


def extract_text(path: str, max_chars: int = 2_000_000) -> Extracted:
    """파일에서 본문 텍스트를 뽑는다. 실패해도 예외를 던지지 않는다."""
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    try:
        if ext == "hwp":
            text = hwp.extract(path)
        elif ext == "hwpx":
            text = hwpx.extract(path)
        elif ext == "docx":
            text = ooxml.extract_docx(path)
        elif ext in ("xlsx", "xlsm"):
            text = ooxml.extract_xlsx(path)
        elif ext == "pptx":
            text = ooxml.extract_pptx(path)
        elif ext == "doc":
            text = msdoc.extract_doc(path)
        elif ext in ("xls", "ppt"):
            text = msdoc.extract_xls(path) if ext == "xls" else msdoc._salvage(
                open(path, "rb").read())
        elif ext == "pdf":
            text = pdfdoc.extract(path)
        elif ext == "rtf":
            text = rtf.extract(path)
        elif ext in ("html", "htm", "xml"):
            text = plain.extract_html(path)
        else:
            text = plain.extract(path)
    except pdfdoc.PDFUnavailable as exc:
        return Extracted("", "unsupported", str(exc))
    except (OSError, ValueError, hwp.HWPError) as exc:
        return Extracted("", "error", str(exc))
    except Exception as exc:  # 손상된 파일 등 예기치 못한 경우도 색인은 계속한다
        return Extracted("", "error", f"{type(exc).__name__}: {exc}")

    text = _clean(text or "")
    if not text:
        return Extracted("", "empty", "본문에서 글자를 찾지 못했습니다.")
    if len(text) > max_chars:
        text = text[:max_chars]
    return Extracted(text, "ok")
