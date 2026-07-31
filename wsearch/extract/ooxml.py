"""MS 오피스 문서(.docx/.xlsx/.pptx) 본문 추출. ZIP + XML."""

from __future__ import annotations

import re
import zipfile
from xml.etree import ElementTree as ET

from .xmlutil import xml_text, _local, _BytesReader

SHEET_RE = re.compile(r"^xl/worksheets/sheet\d+\.xml$", re.IGNORECASE)
SLIDE_RE = re.compile(r"^ppt/slides/slide\d+\.xml$", re.IGNORECASE)
DOCX_PARTS = (
    "word/document.xml",
    "word/footnotes.xml",
    "word/endnotes.xml",
    "word/comments.xml",
)


def extract_docx(path: str) -> str:
    parts: list[str] = []
    with zipfile.ZipFile(path) as zf:
        names = set(zf.namelist())
        targets = [p for p in DOCX_PARTS if p in names]
        targets += sorted(n for n in names
                          if re.match(r"^word/(header|footer)\d+\.xml$", n))
        for name in targets:
            parts.append(xml_text(
                zf.read(name),
                text_tags={"t"},
                break_tags={"p", "br", "tr"},
                tab_tags={"tab"},
            ))
    return "\n".join(p for p in parts if p.strip())


def extract_pptx(path: str) -> str:
    parts: list[str] = []
    with zipfile.ZipFile(path) as zf:
        names = sorted((n for n in zf.namelist() if SLIDE_RE.match(n)),
                       key=lambda n: int("".join(c for c in n if c.isdigit()) or 0))
        names += sorted(n for n in zf.namelist()
                        if n.startswith("ppt/notesSlides/notesSlide"))
        for i, name in enumerate(names, 1):
            body = xml_text(zf.read(name), text_tags={"t"}, break_tags={"p"})
            if body.strip():
                parts.append(f"[슬라이드 {i}]\n{body}")
    return "\n".join(parts)


def _shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    out: list[str] = []
    buf: list[str] = []
    try:
        for event, elem in ET.iterparse(_BytesReader(zf.read("xl/sharedStrings.xml")),
                                        events=("end",)):
            name = _local(elem.tag)
            if name == "t" and elem.text:
                buf.append(elem.text)
            elif name == "si":
                out.append("".join(buf))
                buf = []
                elem.clear()
    except ET.ParseError:
        return out
    return out


def extract_xlsx(path: str) -> str:
    """셀 값을 행 단위(탭 구분)로 뽑는다. 명단·관리대장 파일에 특히 중요."""
    lines: list[str] = []
    with zipfile.ZipFile(path) as zf:
        shared = _shared_strings(zf)
        sheets = sorted((n for n in zf.namelist() if SHEET_RE.match(n)),
                        key=lambda n: int("".join(c for c in n if c.isdigit()) or 0))
        for sheet in sheets:
            try:
                root = ET.fromstring(zf.read(sheet))
            except ET.ParseError:
                continue
            for row in root.iter():
                if _local(row.tag) != "row":
                    continue
                cells: list[str] = []
                for cell in row:
                    if _local(cell.tag) != "c":
                        continue
                    ctype = cell.get("t", "n")
                    value = ""
                    for child in cell:
                        tag = _local(child.tag)
                        if tag == "v":
                            value = child.text or ""
                        elif tag == "is":
                            value = "".join(t.text or "" for t in child.iter()
                                            if _local(t.tag) == "t")
                    if ctype == "s" and value.isdigit():
                        idx = int(value)
                        value = shared[idx] if idx < len(shared) else ""
                    cells.append(value)
                line = "\t".join(cells).strip()
                if line:
                    lines.append(line)
    return "\n".join(lines)
