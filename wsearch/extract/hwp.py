"""한글 문서(.hwp, HWP 5.x) 본문 추출.

구조: OLE 복합문서 → BodyText/Section0..N (보통 zlib raw deflate 압축)
      → 레코드 스트림 → HWPTAG_PARA_TEXT 레코드의 UTF-16LE 텍스트
"""

from __future__ import annotations

import struct
import zlib

from .cfb import CFBError, CompoundFile

HWPTAG_BEGIN = 0x10
HWPTAG_PARA_TEXT = HWPTAG_BEGIN + 51      # 67
HWPTAG_PARA_HEADER = HWPTAG_BEGIN + 50    # 66

# 본문 텍스트 안에 섞여 있는 제어문자 분류 (한글 문서 규격)
CHAR_CONTROLS = {0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31}          # 1글자
INLINE_CONTROLS = {4, 5, 6, 7, 8, 9, 19, 20}                          # 8글자 차지
EXTENDED_CONTROLS = {1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23}  # 8글자 차지


class HWPError(Exception):
    pass


def _decompress(raw: bytes, compressed: bool) -> bytes:
    if not compressed:
        return raw
    for wbits in (-15, 15, 47):
        try:
            return zlib.decompress(raw, wbits)
        except zlib.error:
            continue
    # 잘린 파일이라도 앞부분은 살려본다.
    try:
        d = zlib.decompressobj(-15)
        return d.decompress(raw)
    except zlib.error as exc:
        raise HWPError(f"압축 해제 실패: {exc}") from exc


def _iter_records(stream: bytes):
    """(tag_id, level, payload) 레코드를 차례로 내보낸다."""
    pos, size = 0, len(stream)
    while pos + 4 <= size:
        (header,) = struct.unpack_from("<I", stream, pos)
        pos += 4
        tag_id = header & 0x3FF
        level = (header >> 10) & 0x3FF
        length = (header >> 20) & 0xFFF
        if length == 0xFFF:
            if pos + 4 > size:
                break
            (length,) = struct.unpack_from("<I", stream, pos)
            pos += 4
        if length > size - pos:
            length = size - pos
        yield tag_id, level, stream[pos: pos + length]
        pos += length


def _decode_para_text(payload: bytes) -> str:
    """PARA_TEXT 레코드(UTF-16LE + 제어문자)를 사람이 읽을 문자열로."""
    n = len(payload) // 2
    if n == 0:
        return ""
    codes = struct.unpack_from(f"<{n}H", payload, 0)
    out: list[str] = []
    i = 0
    while i < n:
        c = codes[i]
        if c in INLINE_CONTROLS or c in EXTENDED_CONTROLS:
            i += 8                       # 표/그림 등 개체 제어문자는 통째로 건너뛴다
            continue
        if c in CHAR_CONTROLS:
            if c in (10, 13):
                out.append("\n")
            elif c == 9:
                out.append("\t")
            i += 1
            continue
        if 0xD800 <= c <= 0xDBFF and i + 1 < n and 0xDC00 <= codes[i + 1] <= 0xDFFF:
            out.append(chr(0x10000 + ((c - 0xD800) << 10) + (codes[i + 1] - 0xDC00)))
            i += 2
            continue
        out.append(chr(c))
        i += 1
    return "".join(out)


def extract_bytes(data: bytes) -> str:
    """.hwp 바이트에서 본문 텍스트를 뽑는다."""
    try:
        cf = CompoundFile(data)
    except CFBError as exc:
        if data[:17] == b"HWP Document File":
            raise HWPError("HWP 3.0 이하 형식은 지원하지 않습니다. 한글에서 최신 형식으로 저장해 주세요.") from exc
        raise HWPError(str(exc)) from exc

    compressed = True
    if cf.exists("FileHeader"):
        header = cf.read("FileHeader")
        if header[:17] != b"HWP Document File":
            raise HWPError("한글 문서(HWP 5.0) 서명이 없습니다.")
        if len(header) >= 40:
            (flags,) = struct.unpack_from("<I", header, 36)
            compressed = bool(flags & 0x01)
            if flags & 0x02:
                raise HWPError("암호가 설정된 문서입니다. 암호를 풀고 다시 저장해 주세요.")

    sections = sorted(
        (p for p in cf.listdir() if p.startswith("BodyText/Section")),
        key=lambda p: int("".join(ch for ch in p.rsplit("Section", 1)[-1] if ch.isdigit()) or 0),
    )

    parts: list[str] = []
    for name in sections:
        try:
            body = _decompress(cf.read(name), compressed)
        except (HWPError, CFBError):
            continue
        buf: list[str] = []
        for tag_id, _level, payload in _iter_records(body):
            if tag_id == HWPTAG_PARA_TEXT:
                # 레코드 하나가 문단 하나에 대응한다.
                buf.append(_decode_para_text(payload))
                buf.append("\n")
        parts.append("".join(buf))

    text = "\n".join(p for p in parts if p.strip())

    # 본문 파싱이 실패하면 미리보기 텍스트라도 쓴다.
    if not text.strip() and cf.exists("PrvText"):
        try:
            text = cf.read("PrvText").decode("utf-16-le", "ignore")
        except (CFBError, UnicodeDecodeError):
            pass

    if not text.strip():
        raise HWPError("본문 텍스트를 찾지 못했습니다.")
    return text


def extract(path: str) -> str:
    with open(path, "rb") as fh:
        return extract_bytes(fh.read())
