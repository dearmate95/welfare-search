"""XML에서 사람이 읽는 텍스트만 뽑아내는 도우미."""

from __future__ import annotations

import re
from xml.etree import ElementTree as ET

TAG_RE = re.compile(r"<[^>]+>")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def xml_text(
    data: bytes,
    *,
    text_tags: set[str],
    break_tags: set[str] | None = None,
    tab_tags: set[str] | None = None,
) -> str:
    """지정한 태그의 텍스트만 모은다. 네임스페이스는 무시한다.

    XML이 깨져 있으면 태그를 제거하는 방식으로 최대한 살려낸다.
    """
    break_tags = break_tags or set()
    tab_tags = tab_tags or set()
    out: list[str] = []
    try:
        for event, elem in ET.iterparse(_BytesReader(data), events=("start", "end")):
            name = _local(elem.tag)
            if event == "end":
                if name in text_tags and elem.text:
                    out.append(elem.text)
                elif name in tab_tags:
                    out.append("\t")
                if name in break_tags:
                    out.append("\n")
                elem.clear()
    except ET.ParseError:
        text = data.decode("utf-8", "ignore")
        return TAG_RE.sub(" ", text)
    return "".join(out)


class _BytesReader:
    """iterparse가 파일류 객체를 요구하므로 bytes를 감싼다."""

    def __init__(self, data: bytes):
        self._data = data
        self._pos = 0

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            chunk = self._data[self._pos:]
            self._pos = len(self._data)
            return chunk
        chunk = self._data[self._pos: self._pos + size]
        self._pos += len(chunk)
        return chunk
