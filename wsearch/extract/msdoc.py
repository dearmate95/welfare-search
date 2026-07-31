"""구형 MS 오피스(.doc, .xls) 본문 추출.

Word 97-2003(.doc)은 조각표(piece table)를 따라가고,
Excel 97-2003(.xls)은 공유 문자열 테이블(SST)에서 글자를 꺼낸다.
구조 해석이 실패하면 유니코드 한글 구간을 훑는 방식으로 최대한 살린다.
"""

from __future__ import annotations

import re
import struct

from .cfb import CompoundFile, CFBError

HANGUL_RE = re.compile(r"[가-힣]")


# ---------------------------------------------------------------------------
# 공통 fallback: 스트림에서 읽을 수 있는 글자 구간만 긁어온다.
# ---------------------------------------------------------------------------

READABLE = r"가-힣A-Za-z0-9 ()\-_.,:/%~·"


def _salvage(data: bytes, min_run: int = 4) -> str:
    """UTF-16LE / CP949 로 된 한글·영문 구간을 찾아 이어붙인다."""
    parts: list[str] = []

    # UTF-16LE 구간. 시작 위치가 홀수일 수도 있어 두 정렬을 모두 본다.
    run_re = re.compile(f"[{READABLE}\\n\\t]{{{min_run},}}")
    for offset in (0, 1):
        text16 = data[offset:].decode("utf-16-le", "ignore")
        for run in run_re.findall(text16):
            if HANGUL_RE.search(run) or len(run) >= 12:
                parts.append(run)

    # CP949 구간 (구형 파일에 흔함)
    text8 = data.decode("cp949", "ignore")
    for run in re.findall(f"[가-힣]{{2,}}[{READABLE}]*", text8):
        parts.append(run)

    seen: set[str] = set()
    out: list[str] = []
    for p in parts:
        key = p.strip()
        if len(key) >= 2 and key not in seen:
            seen.add(key)
            out.append(key)
    return "\n".join(out)


# ---------------------------------------------------------------------------
# .doc (Word 97-2003)
# ---------------------------------------------------------------------------

def extract_doc(path: str) -> str:
    with open(path, "rb") as fh:
        data = fh.read()
    try:
        cf = CompoundFile(data)
        wd = cf.read("WordDocument")
    except CFBError as exc:
        raise ValueError(f"워드 문서를 열 수 없습니다: {exc}") from exc

    text = ""
    try:
        text = _doc_piece_table(cf, wd)
    except (CFBError, ValueError, struct.error, IndexError):
        text = ""
    if not text.strip():
        text = _salvage(wd)
    if not text.strip():
        raise ValueError("본문 텍스트를 찾지 못했습니다.")
    return text


def _doc_piece_table(cf: CompoundFile, wd: bytes) -> str:
    (flags,) = struct.unpack_from("<H", wd, 0x0A)
    table_name = "1Table" if flags & 0x0200 else "0Table"
    if not cf.exists(table_name):
        table_name = "1Table" if cf.exists("1Table") else "0Table"
    table = cf.read(table_name)

    fc_clx, lcb_clx = struct.unpack_from("<II", wd, 0x01A2)
    clx = table[fc_clx: fc_clx + lcb_clx]
    if not clx:
        return ""

    # CLX = [Prc]* Pcdt
    pos = 0
    pcdt = b""
    while pos < len(clx):
        kind = clx[pos]
        if kind == 0x01:                      # Prc: 건너뛴다
            (size,) = struct.unpack_from("<H", clx, pos + 1)
            pos += 3 + size
        elif kind == 0x02:                    # Pcdt: 조각표 본체
            (size,) = struct.unpack_from("<I", clx, pos + 1)
            pcdt = clx[pos + 5: pos + 5 + size]
            break
        else:
            break
    if not pcdt:
        return ""

    n = (len(pcdt) - 4) // 12
    if n <= 0:
        return ""
    cps = struct.unpack_from(f"<{n + 1}I", pcdt, 0)
    pieces_off = (n + 1) * 4

    out: list[str] = []
    for i in range(n):
        base = pieces_off + i * 8
        (fc,) = struct.unpack_from("<I", pcdt, base + 2)
        length = cps[i + 1] - cps[i]
        if length <= 0:
            continue
        if fc & 0x40000000:                   # 1바이트(CP1252/CP949) 저장
            start = (fc & ~0x40000000) >> 1
            chunk = wd[start: start + length]
            piece = chunk.decode("cp949", "ignore")
        else:                                 # UTF-16LE 저장
            chunk = wd[fc: fc + length * 2]
            piece = chunk.decode("utf-16-le", "ignore")
        out.append(piece)

    text = "".join(out)
    text = text.replace("\r", "\n").replace("\x07", "\t").replace("\x0b", "\n")
    text = re.sub(r"[\x00-\x08\x0e-\x1f]", "", text)
    return text


# ---------------------------------------------------------------------------
# .xls (Excel 97-2003)
# ---------------------------------------------------------------------------

RT_SST = 0x00FC
RT_CONTINUE = 0x003C
RT_LABEL = 0x0204
RT_RSTRING = 0x00D6
RT_EOF = 0x000A


def extract_xls(path: str) -> str:
    with open(path, "rb") as fh:
        data = fh.read()
    try:
        cf = CompoundFile(data)
    except CFBError as exc:
        raise ValueError(f"엑셀 문서를 열 수 없습니다: {exc}") from exc

    stream = b""
    for name in ("Workbook", "Book"):
        if cf.exists(name):
            stream = cf.read(name)
            break
    if not stream:
        raise ValueError("Workbook 스트림이 없습니다.")

    strings = _xls_strings(stream)
    text = "\n".join(strings)
    if not text.strip():
        text = _salvage(stream)
    if not text.strip():
        raise ValueError("본문 텍스트를 찾지 못했습니다.")
    return text


def _records(stream: bytes):
    pos = 0
    size = len(stream)
    while pos + 4 <= size:
        rtype, rlen = struct.unpack_from("<HH", stream, pos)
        pos += 4
        if pos + rlen > size:
            rlen = size - pos
        yield rtype, stream[pos: pos + rlen]
        pos += rlen


def _xls_strings(stream: bytes) -> list[str]:
    out: list[str] = []
    sst_chunks: list[bytes] = []
    collecting = False

    for rtype, payload in _records(stream):
        if rtype == RT_SST:
            sst_chunks = [payload]
            collecting = True
        elif rtype == RT_CONTINUE and collecting:
            sst_chunks.append(payload)
        else:
            if collecting:
                out.extend(_parse_sst(sst_chunks))
                sst_chunks, collecting = [], False
            if rtype in (RT_LABEL, RT_RSTRING) and len(payload) > 8:
                s = _read_unicode_string(payload[6:], 0, two_byte_len=True)[0]
                if s:
                    out.append(s)
    if collecting:
        out.extend(_parse_sst(sst_chunks))
    return [s for s in out if s.strip()]


def _read_unicode_string(buf: bytes, pos: int, two_byte_len: bool = True):
    """BIFF8 XLUnicodeString 하나를 읽어 (문자열, 다음위치)를 돌려준다."""
    if two_byte_len:
        if pos + 3 > len(buf):
            return "", len(buf)
        (cch,) = struct.unpack_from("<H", buf, pos)
        pos += 2
    else:
        if pos + 2 > len(buf):
            return "", len(buf)
        cch = buf[pos]
        pos += 1
    grbit = buf[pos]
    pos += 1
    high = grbit & 0x01
    width = 2 if high else 1
    end = pos + cch * width
    raw = buf[pos:end]
    text = raw.decode("utf-16-le", "ignore") if high else raw.decode("cp949", "ignore")
    return text, end


def _parse_sst(chunks: list[bytes]) -> list[str]:
    """SST + CONTINUE 조각들에서 문자열 목록을 뽑는다.

    CONTINUE 경계에서 문자 폭(1/2바이트)이 바뀔 수 있어 조각 경계를 추적한다.
    """
    if not chunks:
        return []
    buf = b"".join(chunks)
    # 각 조각의 시작 위치(첫 조각 제외)에는 폭 플래그 1바이트가 새로 붙는다.
    bounds: set[int] = set()
    acc = len(chunks[0])
    for c in chunks[1:]:
        bounds.add(acc)
        acc += len(c)

    if len(buf) < 8:
        return []
    (_total, unique) = struct.unpack_from("<II", buf, 0)
    pos = 8
    out: list[str] = []
    for _ in range(min(unique, 1_000_000)):
        if pos + 3 > len(buf):
            break
        (cch,) = struct.unpack_from("<H", buf, pos)
        pos += 2
        grbit = buf[pos]
        pos += 1
        high = grbit & 0x01
        rich = grbit & 0x08
        ext = grbit & 0x04
        cruns = 0
        cb_ext = 0
        if rich:
            if pos + 2 > len(buf):
                break
            (cruns,) = struct.unpack_from("<H", buf, pos)
            pos += 2
        if ext:
            if pos + 4 > len(buf):
                break
            (cb_ext,) = struct.unpack_from("<I", buf, pos)
            pos += 4

        chars: list[str] = []
        remaining = cch
        while remaining > 0 and pos < len(buf):
            if pos in bounds:                 # 새 CONTINUE 조각 시작
                high = buf[pos] & 0x01
                pos += 1
                bounds.discard(pos - 1)
            width = 2 if high else 1
            # 이번 조각 안에서 읽을 수 있는 만큼만 읽는다.
            next_bound = min((b for b in bounds if b > pos), default=len(buf))
            avail = max(0, (min(next_bound, len(buf)) - pos) // width)
            take = min(remaining, avail) if avail else remaining
            if take <= 0:
                break
            raw = buf[pos: pos + take * width]
            chars.append(raw.decode("utf-16-le", "ignore") if width == 2
                         else raw.decode("cp949", "ignore"))
            pos += take * width
            remaining -= take
        pos += cruns * 4 + cb_ext
        s = "".join(chars)
        if s.strip():
            out.append(s)
    return out
