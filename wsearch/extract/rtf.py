"""RTF 본문 추출(제어어 제거)."""

from __future__ import annotations

import re

from .plain import decode

CONTROL_RE = re.compile(r"\\([a-zA-Z]+)(-?\d+)?[ ]?|\\(['\\{}])|([{}])|[\r\n]")
DROP_GROUPS = {"fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "themedata"}


def extract(path: str) -> str:
    with open(path, "rb") as fh:
        raw = decode(fh.read())

    out: list[str] = []
    pos = 0
    skip_depth = 0
    depth = 0
    for m in CONTROL_RE.finditer(raw):
        if skip_depth == 0:
            out.append(raw[pos:m.start()])
        pos = m.end()
        word, arg, esc, brace = m.group(1), m.group(2), m.group(3), m.group(4)
        if brace == "{":
            depth += 1
        elif brace == "}":
            if skip_depth and depth <= skip_depth:
                skip_depth = 0
            depth -= 1
        elif word:
            if word in DROP_GROUPS and not skip_depth:
                skip_depth = depth
            elif word == "u" and arg:
                code = int(arg)
                if code < 0:
                    code += 65536
                if skip_depth == 0:
                    out.append(chr(code))
            elif word in ("par", "line", "cell", "row"):
                out.append("\n")
            elif word == "tab":
                out.append("\t")
        elif esc:
            if skip_depth == 0 and esc not in "{}":
                out.append(esc)
    if skip_depth == 0:
        out.append(raw[pos:])
    text = "".join(out)
    return re.sub(r"\n{3,}", "\n\n", text)
