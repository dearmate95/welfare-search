"""텍스트 계열 파일 읽기. 한국어 파일은 UTF-8 외에 CP949(EUC-KR)가 흔하다."""

from __future__ import annotations

import re

ENCODINGS = ("utf-8-sig", "utf-8", "cp949", "euc-kr", "utf-16", "latin-1")
TAG_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.S | re.I)
ANY_TAG_RE = re.compile(r"<[^>]+>")
ENTITY = {"&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'"}


def decode(data: bytes) -> str:
    for enc in ENCODINGS:
        try:
            text = data.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
        # 한글이 깨져 물음표/치환문자로 도배되면 다음 인코딩을 시도
        if text.count("�") > max(3, len(text) // 200):
            continue
        return text
    return data.decode("utf-8", "replace")


def extract(path: str) -> str:
    with open(path, "rb") as fh:
        return decode(fh.read())


def extract_html(path: str) -> str:
    text = extract(path)
    text = TAG_RE.sub(" ", text)
    text = ANY_TAG_RE.sub(" ", text)
    for k, v in ENTITY.items():
        text = text.replace(k, v)
    return re.sub(r"[ \t]{2,}", " ", text)
