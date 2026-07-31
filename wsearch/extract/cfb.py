"""OLE2 복합 문서(CFB) 최소 리더.

한글(.hwp) 5.x 파일은 MS 복합문서 형식이라 내부 스트림을 꺼내려면
OLE 파서가 필요하다. olefile 패키지가 설치돼 있지 않아도 동작하도록
필요한 기능만 표준 라이브러리로 구현했다.

참고: MS-CFB (Compound File Binary File Format)
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

MAXREGSECT = 0xFFFFFFFA
DIFSECT = 0xFFFFFFFC
FATSECT = 0xFFFFFFFD
ENDOFCHAIN = 0xFFFFFFFE
FREESECT = 0xFFFFFFFF

ENTRY_EMPTY, ENTRY_STORAGE, ENTRY_STREAM, ENTRY_ROOT = 0, 1, 2, 5
NOSTREAM = 0xFFFFFFFF


class CFBError(Exception):
    """복합 문서 구조를 해석할 수 없을 때."""


@dataclass
class DirEntry:
    index: int
    name: str
    kind: int
    left: int
    right: int
    child: int
    start: int
    size: int


class CompoundFile:
    """복합 문서에서 스트림을 이름으로 읽어온다."""

    def __init__(self, data: bytes):
        if len(data) < 512 or data[:8] != SIGNATURE:
            raise CFBError("OLE 복합 문서가 아닙니다.")
        self.data = data

        self.sector_size = 1 << struct.unpack_from("<H", data, 0x1E)[0]
        self.mini_sector_size = 1 << struct.unpack_from("<H", data, 0x20)[0]
        if self.sector_size not in (512, 4096) or self.mini_sector_size != 64:
            raise CFBError("지원하지 않는 섹터 크기입니다.")

        self.num_fat_sectors = struct.unpack_from("<I", data, 0x2C)[0]
        self.first_dir_sector = struct.unpack_from("<I", data, 0x30)[0]
        self.mini_cutoff = struct.unpack_from("<I", data, 0x38)[0]
        self.first_minifat = struct.unpack_from("<I", data, 0x3C)[0]
        self.num_minifat = struct.unpack_from("<I", data, 0x40)[0]
        self.first_difat = struct.unpack_from("<I", data, 0x44)[0]
        self.num_difat = struct.unpack_from("<I", data, 0x48)[0]

        self.max_sector = max(0, (len(data) - self.sector_size) // self.sector_size)

        self._load_fat()
        self._load_directory()
        self._load_minifat()

    # ---------- 저수준 ----------

    def _sector_bytes(self, sid: int) -> bytes:
        if sid < 0 or sid > MAXREGSECT:
            raise CFBError(f"잘못된 섹터 번호: {sid}")
        off = (sid + 1) * self.sector_size
        chunk = self.data[off: off + self.sector_size]
        if len(chunk) < self.sector_size:
            # 파일 끝이 잘린 경우 0으로 채워 최대한 살린다.
            chunk = chunk + b"\x00" * (self.sector_size - len(chunk))
        return chunk

    def _chain(self, start: int, fat: list[int], limit: int | None = None) -> list[int]:
        """FAT 체인을 따라가며 섹터 번호 목록을 만든다(순환 방지 포함)."""
        out: list[int] = []
        seen: set[int] = set()
        sid = start
        cap = limit or (len(fat) + 8)
        while sid != ENDOFCHAIN and sid != FREESECT and len(out) < cap:
            if sid > MAXREGSECT or sid in seen or sid >= len(fat):
                break
            seen.add(sid)
            out.append(sid)
            sid = fat[sid]
        return out

    # ---------- 구조 로딩 ----------

    def _load_fat(self) -> None:
        per_sector = self.sector_size // 4

        # DIFAT: 헤더에 109개 + 추가 DIFAT 섹터들
        fat_sectors: list[int] = []
        for i in range(109):
            sid = struct.unpack_from("<I", self.data, 0x4C + i * 4)[0]
            if sid <= MAXREGSECT:
                fat_sectors.append(sid)

        sid = self.first_difat
        seen: set[int] = set()
        while sid != ENDOFCHAIN and sid != FREESECT and sid <= MAXREGSECT and sid not in seen:
            seen.add(sid)
            block = self._sector_bytes(sid)
            for i in range(per_sector - 1):
                v = struct.unpack_from("<I", block, i * 4)[0]
                if v <= MAXREGSECT:
                    fat_sectors.append(v)
            sid = struct.unpack_from("<I", block, (per_sector - 1) * 4)[0]

        fat: list[int] = []
        for s in fat_sectors:
            block = self._sector_bytes(s)
            fat.extend(struct.unpack_from(f"<{per_sector}I", block, 0))
        if not fat:
            raise CFBError("FAT을 읽을 수 없습니다.")
        self.fat = fat

    def _load_directory(self) -> None:
        chain = self._chain(self.first_dir_sector, self.fat)
        raw = b"".join(self._sector_bytes(s) for s in chain)
        entries: list[DirEntry] = []
        for i in range(len(raw) // 128):
            b = raw[i * 128: (i + 1) * 128]
            name_len = struct.unpack_from("<H", b, 0x40)[0]
            kind = b[0x42]
            if kind not in (ENTRY_STORAGE, ENTRY_STREAM, ENTRY_ROOT):
                continue
            name = ""
            if 2 <= name_len <= 64:
                name = b[: name_len - 2].decode("utf-16-le", "ignore")
            left, right, child = struct.unpack_from("<III", b, 0x44)
            start = struct.unpack_from("<I", b, 0x74)[0]
            size = struct.unpack_from("<Q", b, 0x78)[0]
            if self.sector_size == 512:
                size &= 0xFFFFFFFF     # v3에서는 상위 4바이트가 의미 없음
            entries.append(DirEntry(i, name, kind, left, right, child, start, size))
        if not entries:
            raise CFBError("디렉터리 항목이 없습니다.")
        self.entries = {e.index: e for e in entries}
        self.root = next((e for e in entries if e.kind == ENTRY_ROOT), entries[0])
        self._paths = self._walk_paths()

    def _walk_paths(self) -> dict[str, DirEntry]:
        """'BodyText/Section0' 형태의 경로 -> 항목 맵을 만든다."""
        paths: dict[str, DirEntry] = {}
        visited: set[int] = set()

        def walk_siblings(idx: int, prefix: str) -> None:
            stack = [idx]
            while stack:
                i = stack.pop()
                if i == NOSTREAM or i in visited or i not in self.entries:
                    continue
                visited.add(i)
                e = self.entries[i]
                path = f"{prefix}{e.name}" if prefix else e.name
                if e.kind == ENTRY_STREAM:
                    paths[path] = e
                elif e.kind == ENTRY_STORAGE:
                    paths[path] = e
                    walk_siblings(e.child, path + "/")
                if e.left != NOSTREAM:
                    stack.append(e.left)
                if e.right != NOSTREAM:
                    stack.append(e.right)

        walk_siblings(self.root.child, "")
        return paths

    def _load_minifat(self) -> None:
        chain = self._chain(self.first_minifat, self.fat, limit=self.num_minifat + 8)
        raw = b"".join(self._sector_bytes(s) for s in chain)
        per = len(raw) // 4
        self.minifat = list(struct.unpack_from(f"<{per}I", raw, 0)) if per else []
        # 미니 스트림 본체는 루트 항목이 들고 있다.
        if self.root.size and self.root.start <= MAXREGSECT:
            mchain = self._chain(self.root.start, self.fat)
            self.ministream = b"".join(self._sector_bytes(s) for s in mchain)
        else:
            self.ministream = b""

    # ---------- 공개 API ----------

    def exists(self, path: str) -> bool:
        return path in self._paths

    def listdir(self) -> list[str]:
        return sorted(self._paths)

    def read(self, path: str) -> bytes:
        entry = self._paths.get(path)
        if entry is None or entry.kind != ENTRY_STREAM:
            raise CFBError(f"스트림을 찾을 수 없습니다: {path}")
        if entry.size < self.mini_cutoff:
            need = -(-entry.size // self.mini_sector_size)
            chain = self._chain(entry.start, self.minifat, limit=need + 8)
            buf = bytearray()
            for sid in chain:
                off = sid * self.mini_sector_size
                buf += self.ministream[off: off + self.mini_sector_size]
            return bytes(buf[: entry.size])
        need = -(-entry.size // self.sector_size)
        chain = self._chain(entry.start, self.fat, limit=need + 8)
        buf = bytearray()
        for sid in chain:
            buf += self._sector_bytes(sid)
        return bytes(buf[: entry.size])


def open_bytes(data: bytes) -> CompoundFile:
    """olefile이 설치돼 있으면 그것을 쓰고, 없으면 내장 리더를 쓴다."""
    return CompoundFile(data)
