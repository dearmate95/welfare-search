"""한글 문서(.hwpx) 본문 추출. ZIP + XML 구조라 표준 라이브러리로 충분하다."""

from __future__ import annotations

import re
import zipfile

from .xmlutil import xml_text

SECTION_RE = re.compile(r"^Contents/section\d+\.xml$", re.IGNORECASE)


def extract(path: str) -> str:
    parts: list[str] = []
    with zipfile.ZipFile(path) as zf:
        names = [n for n in zf.namelist() if SECTION_RE.match(n)]
        names.sort(key=lambda n: int("".join(c for c in n if c.isdigit()) or 0))
        if not names:
            names = [n for n in zf.namelist() if n.lower().endswith(".xml")
                     and "section" in n.lower()]
        for name in names:
            try:
                parts.append(xml_text(zf.read(name), text_tags={"t"}, break_tags={"p", "linesegarray"}))
            except (KeyError, zipfile.BadZipFile):
                continue
    return "\n".join(p for p in parts if p.strip())
