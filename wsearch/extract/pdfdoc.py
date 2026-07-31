"""PDF 본문 추출.

pypdf(또는 PyPDF2)가 설치돼 있으면 사용한다. 없으면 안내 메시지를 남기고
파일명만 색인한다(`pip install pypdf`).
스캔본(이미지) PDF는 글자 정보가 없으므로 추출되지 않는다.
"""

from __future__ import annotations


class PDFUnavailable(Exception):
    pass


def _reader():
    try:
        from pypdf import PdfReader  # type: ignore
        return PdfReader
    except ImportError:
        pass
    try:
        from PyPDF2 import PdfReader  # type: ignore
        return PdfReader
    except ImportError as exc:
        raise PDFUnavailable(
            "PDF 본문을 읽으려면 pypdf가 필요합니다. 명령창에서 "
            "`pip install pypdf` 를 실행해 주세요."
        ) from exc


def extract(path: str, max_pages: int = 300) -> str:
    PdfReader = _reader()
    reader = PdfReader(path)
    if getattr(reader, "is_encrypted", False):
        try:
            reader.decrypt("")
        except Exception as exc:  # 암호가 걸린 파일
            raise ValueError(f"암호가 설정된 PDF입니다: {exc}") from exc
    parts: list[str] = []
    for i, page in enumerate(reader.pages):
        if i >= max_pages:
            break
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            continue
    text = "\n".join(parts)
    if not text.strip():
        raise ValueError("글자 정보가 없는 PDF입니다(스캔 이미지일 수 있음).")
    return text
