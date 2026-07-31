"""테스트용 가짜 사례관리 문서를 만든다. (실제 개인정보 아님)"""

from __future__ import annotations

import struct
import zipfile
import zlib
from pathlib import Path

SAMPLES = {
    "홍길동": [
        ("2024초기상담지_홍길동.txt",
         "성명: 홍길동\n생년월일: 1955-03-02\n초기상담 일자: 2024-01-15\n"
         "주요 욕구: 경제적 어려움, 만성질환(당뇨) 관리 필요.\n"
         "기초생활수급 신청을 희망하며 월세 체납이 3개월째 이어지고 있음.\n"
         "독거 어르신으로 사회적고립이 우려되어 안부확인이 필요함.\n"
         "행복동 행정복지센터와 연계하여 긴급복지 지원을 검토함."),
        ("2024_욕구사정지_홍길동.txt",
         "욕구사정\n대상자: 홍길동\n사정일: 2024-02-03\n"
         "경제 영역: 생계비 부족, 공과금 체납. 기초생활수급 신청 진행 중.\n"
         "건강 영역: 당뇨 및 고혈압으로 복약 관리 필요, 통원 어려움.\n"
         "주거 영역: 반지하 거주, 곰팡이 심함. 집수리 지원 검토.\n"
         "정서 영역: 우울감 호소, 정서지원 및 상담 필요."),
        ("서비스제공계획서_홍길동.txt",
         "서비스제공계획\n이용인 홍길동\n계획수립일 2024-02-10\n"
         "목표1. 기초생활수급 책정으로 소득 안정 (담당: 김사회복지사)\n"
         "목표2. 보건소 연계 복약 관리 및 통원 이동지원\n"
         "목표3. 주 1회 가정방문을 통한 정서지원과 안부확인\n"
         "자원연계: 푸드뱅크 밑반찬 지원, 자원봉사 연계"),
        ("상담일지_2024-05_홍길동.txt",
         "상담일지\n일시: 2024-05-08 가정방문\n대상자: 홍길동\n"
         "수급 책정 완료되어 생계급여 수령 시작함. 표정이 밝아짐.\n"
         "당뇨 수치는 여전히 높아 보건소 방문 동행 예정.\n"
         "모니터링 결과 주거환경 개선(도배·장판)이 추가로 필요함."),
        ("종결보고서_홍길동.txt",
         "종결보고\n대상자: 홍길동\n종결일: 2024-11-20\n"
         "기초생활수급 책정 및 건강 관리 체계화로 목표 달성.\n"
         "사후관리 3개월간 전화상담으로 안부확인 예정."),
    ],
    "김영희": [
        ("초기상담_김영희_2024.txt",
         "성명: 김영희\n초기면접 2024-03-05\n"
         "한부모 가정으로 초등학생 자녀 2명 양육 중.\n"
         "실직 후 구직활동 중이며 월세 보증금 마련이 어려움.\n"
         "아동의 학업 지원과 방과후 돌봄 연계가 필요함.\n"
         "가정폭력 이력이 있어 안전 확인이 필요하며 위기개입을 검토함."),
        ("사례관리록_김영희.txt",
         "사례관리록\n이용인: 김영희\n"
         "2024-04-11 전화상담: 자활근로 참여 의사 확인. 직업훈련 안내함.\n"
         "2024-06-02 가정방문: 아동 방과후 돌봄 연계 완료. 지역아동센터 이용 시작.\n"
         "2024-08-19 모니터링: 취업 성공(계약직). 소득 발생으로 수급 조정 필요.\n"
         "정서적지지 지속 제공, 자존감 향상 확인됨."),
        ("김영희_모니터링_점검표.txt",
         "모니터링 점검표\n대상자 김영희\n점검일 2024-09-30\n"
         "목표 이행도: 취업 달성, 아동 돌봄 안정화.\n"
         "추가 욕구: 주거급여 신청, 부채 상담 연계 필요."),
    ],
    "기타": [
        ("2024년_사례관리_대상자_명단.txt",
         "연번\t성명\t생년\t구분\t담당자\n"
         "1\t홍길동\t1955\t집중관리\t김사회복지사\n"
         "2\t김영희\t1988\t일반관리\t이사회복지사\n"
         "3\t박철수\t1972\t집중관리\t김사회복지사\n"),
        ("사례회의록_2024-07.txt",
         "통합사례회의록\n일시: 2024-07-15\n"
         "안건1. 홍길동 어르신 주거환경 개선 방안 - 집수리 사업 연계 결정.\n"
         "안건2. 김영희 세대 아동 돌봄 - 지역아동센터 협력 확인.\n"
         "슈퍼비전: 위기 사례 우선순위 재점검 필요."),
        ("개인정보수집이용동의서_홍길동.txt",
         "개인정보 수집·이용 동의서\n성명: 홍길동\n"
         "수집목적: 사례관리 서비스 제공\n동의일자: 2024-01-15"),
    ],
}


def _write_docx(path: Path, paragraphs: list[str]) -> None:
    doc_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body>"
        + "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
        + "</w:body></w:document>"
    )
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
            'relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/word/document.xml" ContentType="application/vnd.'
          'openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", doc_xml)


def _write_xlsx(path: Path, rows: list[list[str]]) -> None:
    strings: list[str] = []
    index: dict[str, int] = {}
    for row in rows:
        for cell in row:
            if cell not in index:
                index[cell] = len(strings)
                strings.append(cell)
    sst = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
           f'count="{len(strings)}" uniqueCount="{len(strings)}">'
           + "".join(f"<si><t>{s}</t></si>" for s in strings) + "</sst>")
    body = []
    for r, row in enumerate(rows, 1):
        cells = "".join(
            f'<c r="{chr(64+c)}{r}" t="s"><v>{index[val]}</v></c>'
            for c, val in enumerate(row, 1)
        )
        body.append(f'<row r="{r}">{cells}</row>')
    sheet = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             "<sheetData>" + "".join(body) + "</sheetData></worksheet>")
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="xml" ContentType="application/xml"/></Types>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("xl/sharedStrings.xml", sst)
        z.writestr("xl/worksheets/sheet1.xml", sheet)


def _write_hwpx(path: Path, paragraphs: list[str]) -> None:
    section = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" '
        'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">'
        + "".join(f"<hp:p><hp:run><hp:t>{p}</hp:t></hp:run></hp:p>" for p in paragraphs)
        + "</hs:sec>"
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("mimetype", "application/hwp+zip")
        z.writestr("Contents/section0.xml", section)


# --------------------------------------------------------------------------
# 최소 형태의 .hwp(HWP 5.0) 파일 생성 — CFB 리더/HWP 파서 검증용
# --------------------------------------------------------------------------

def _make_cfb(tree: dict) -> bytes:
    """CFB(복합문서) 파일을 만든다. 실제 한글 파일과 같은 구조를 흉내낸다.

    tree: {"이름": bytes}  또는  {"저장소이름": {"하위이름": bytes}}
    규격대로 4096바이트 미만 스트림은 미니 스트림에 넣는다.
    """
    SECTOR, MINI = 512, 64
    CUTOFF = 4096
    ENDOFCHAIN, FREESECT, FATSECT = 0xFFFFFFFE, 0xFFFFFFFF, 0xFFFFFFFD
    NOSTREAM = 0xFFFFFFFF

    # 1) 디렉터리 항목 평탄화 (0번은 Root Entry)
    entries: list[dict] = [{"name": "Root Entry", "kind": 5, "data": None,
                            "children": [], "child": NOSTREAM, "right": NOSTREAM}]

    def add(container_idx: int, items: dict) -> None:
        idx_list = []
        for name, value in items.items():
            idx = len(entries)
            if isinstance(value, dict):
                entries.append({"name": name, "kind": 1, "data": None,
                                "children": [], "child": NOSTREAM, "right": NOSTREAM})
                idx_list.append(idx)
                add(idx, value)
            else:
                entries.append({"name": name, "kind": 2, "data": value,
                                "children": [], "child": NOSTREAM, "right": NOSTREAM})
                idx_list.append(idx)
        if idx_list:
            entries[container_idx]["child"] = idx_list[0]
            for a, b in zip(idx_list, idx_list[1:]):
                entries[a]["right"] = b

    add(0, tree)

    # 2) 미니 스트림 구성 (작은 스트림들)
    mini_blob = bytearray()
    for e in entries:
        if e["kind"] != 2 or e["data"] is None:
            continue
        data = e["data"]
        if len(data) < CUTOFF:
            e["mini"] = True
            e["start"] = len(mini_blob) // MINI
            mini_blob += data + b"\x00" * ((-len(data)) % MINI)
        else:
            e["mini"] = False

    # 3) 큰 섹터 할당: 큰 스트림 → 미니 스트림 본체 → 디렉터리 → 미니FAT → FAT
    sectors: list[bytes] = []

    def alloc(blob: bytes) -> tuple[int, int]:
        if not blob:
            return ENDOFCHAIN, 0
        start = len(sectors)
        padded = blob + b"\x00" * ((-len(blob)) % SECTOR)
        for i in range(0, len(padded), SECTOR):
            sectors.append(padded[i: i + SECTOR])
        return start, len(padded) // SECTOR

    chains: list[tuple[int, int]] = []      # (시작섹터, 섹터수)
    for e in entries:
        if e["kind"] == 2 and e["data"] is not None and not e["mini"]:
            start, count = alloc(e["data"])
            e["start"] = start
            chains.append((start, count))

    mini_start, mini_count = alloc(bytes(mini_blob))
    if mini_count:
        chains.append((mini_start, mini_count))

    # 디렉터리 항목 직렬화
    def entry_bytes(e: dict) -> bytes:
        b = bytearray(128)
        nm = e["name"].encode("utf-16-le") + b"\x00\x00"
        b[: len(nm)] = nm
        struct.pack_into("<H", b, 0x40, len(nm))
        b[0x42] = e["kind"]
        b[0x43] = 1
        struct.pack_into("<III", b, 0x44, NOSTREAM, e["right"], e["child"])
        struct.pack_into("<I", b, 0x74, e.get("start", ENDOFCHAIN))
        size = len(e["data"]) if e.get("data") else 0
        struct.pack_into("<Q", b, 0x78, size)
        return bytes(b)

    entries[0]["start"] = mini_start if mini_count else ENDOFCHAIN
    entries[0]["data"] = bytes(mini_blob) if mini_count else None

    dir_blob = b"".join(entry_bytes(e) for e in entries)
    dir_blob += b"\x00" * ((-len(dir_blob)) % SECTOR)
    dir_start, dir_count = alloc(dir_blob)
    chains.append((dir_start, dir_count))

    # 미니 FAT
    n_mini = len(mini_blob) // MINI
    minifat = [FREESECT] * (SECTOR // 4)
    for e in entries:
        if e.get("mini") and e["kind"] == 2:
            count = max(1, -(-len(e["data"]) // MINI))
            s = e["start"]
            for k in range(count):
                minifat[s + k] = s + k + 1 if k < count - 1 else ENDOFCHAIN
    minifat_blob = struct.pack(f"<{SECTOR // 4}I", *minifat)
    minifat_start, minifat_count = (alloc(minifat_blob) if n_mini else (ENDOFCHAIN, 0))
    if minifat_count:
        chains.append((minifat_start, minifat_count))

    # FAT (섹터 1개면 충분한 크기의 파일만 만든다)
    fat_sector_id = len(sectors)
    fat = [FREESECT] * (SECTOR // 4)
    for start, count in chains:
        for k in range(count):
            fat[start + k] = start + k + 1 if k < count - 1 else ENDOFCHAIN
    fat[fat_sector_id] = FATSECT
    sectors.append(struct.pack(f"<{SECTOR // 4}I", *fat))
    assert len(sectors) <= SECTOR // 4, "테스트 파일이 너무 큽니다"

    header = bytearray(512)
    header[0:8] = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
    struct.pack_into("<H", header, 0x18, 0x003E)
    struct.pack_into("<H", header, 0x1A, 0x0003)
    struct.pack_into("<H", header, 0x1C, 0xFFFE)
    struct.pack_into("<H", header, 0x1E, 9)
    struct.pack_into("<H", header, 0x20, 6)
    struct.pack_into("<I", header, 0x2C, 1)
    struct.pack_into("<I", header, 0x30, dir_start)
    struct.pack_into("<I", header, 0x38, CUTOFF)
    struct.pack_into("<I", header, 0x3C, minifat_start)
    struct.pack_into("<I", header, 0x40, minifat_count)
    struct.pack_into("<I", header, 0x44, ENDOFCHAIN)
    struct.pack_into("<I", header, 0x48, 0)
    struct.pack_into("<I", header, 0x4C, fat_sector_id)
    for i in range(1, 109):
        struct.pack_into("<I", header, 0x4C + i * 4, FREESECT)

    return bytes(header) + b"".join(sectors)


def _hwp_records(paragraphs: list[str]) -> bytes:
    """PARA_TEXT 레코드들로 이루어진 BodyText 섹션을 만든다."""
    HWPTAG_PARA_TEXT = 0x10 + 51
    HWPTAG_PARA_HEADER = 0x10 + 50
    out = bytearray()
    for para in paragraphs:
        out += struct.pack("<I", (HWPTAG_PARA_HEADER & 0x3FF) | (22 << 20))
        out += b"\x00" * 22                      # 실제 파일과 비슷하게 헤더를 끼워 넣는다
        payload = para.encode("utf-16-le")
        header = (HWPTAG_PARA_TEXT & 0x3FF) | (0 << 10) | (min(len(payload), 0xFFE) << 20)
        if len(payload) >= 0xFFF:
            header = (HWPTAG_PARA_TEXT & 0x3FF) | (0xFFF << 20)
            out += struct.pack("<II", header, len(payload))
        else:
            out += struct.pack("<I", header)
        out += payload
    return bytes(out)


def _write_hwp(path: Path, paragraphs: list[str]) -> None:
    file_header = bytearray(256)
    file_header[0:17] = b"HWP Document File"
    struct.pack_into("<I", file_header, 32, 0x05000000)
    struct.pack_into("<I", file_header, 36, 0x01)          # 압축 사용
    body = zlib.compress(_hwp_records(paragraphs))[2:-4]   # raw deflate
    data = _make_cfb({
        "FileHeader": bytes(file_header),
        "DocInfo": b"\x00" * 32,
        "BodyText": {"Section0": body},
        "PrvText": "미리보기".encode("utf-16-le"),
    })
    path.write_bytes(data)


def _biff_record(rtype: int, payload: bytes) -> bytes:
    return struct.pack("<HH", rtype, len(payload)) + payload


def _write_xls(path: Path, strings: list[str]) -> None:
    """엑셀 97-2003(.xls) 최소 파일 — 공유 문자열 테이블(SST)만 담는다."""
    sst = struct.pack("<II", len(strings), len(strings))
    for s in strings:
        sst += struct.pack("<HB", len(s), 0x01) + s.encode("utf-16-le")
    stream = (_biff_record(0x0809, b"\x00" * 16)      # BOF
              + _biff_record(0x00FC, sst)             # SST
              + _biff_record(0x000A, b""))            # EOF
    path.write_bytes(_make_cfb({"Workbook": stream}))


def _write_doc(path: Path, paragraphs: list[str]) -> None:
    """워드 97-2003(.doc) 최소 파일 — 조각표(piece table) 한 조각."""
    text = "\r".join(paragraphs) + "\r"
    encoded = text.encode("utf-16-le")
    text_off = 0x0400

    plcpcd = struct.pack("<II", 0, len(text))           # 문자 위치 배열(CP)
    plcpcd += struct.pack("<HIH", 0, text_off, 0)       # 조각 서술자(PCD)
    clx = b"\x02" + struct.pack("<I", len(plcpcd)) + plcpcd

    fib = bytearray(text_off)
    struct.pack_into("<H", fib, 0x00, 0xA5EC)           # wIdent
    struct.pack_into("<H", fib, 0x02, 193)              # nFib (Word 97)
    struct.pack_into("<H", fib, 0x0A, 0x0200)           # 표는 1Table 스트림에
    struct.pack_into("<I", fib, 0x18, text_off)         # fcMin
    struct.pack_into("<I", fib, 0x1C, text_off + len(encoded))
    struct.pack_into("<I", fib, 0x01A2, 0)              # fcClx
    struct.pack_into("<I", fib, 0x01A6, len(clx))       # lcbClx

    path.write_bytes(_make_cfb({
        "WordDocument": bytes(fib) + encoded,
        "1Table": clx,
    }))


def build(dest: str) -> Path:
    root = Path(dest)
    for person, files in SAMPLES.items():
        folder = root / ("사례관리" if person != "기타" else "공통문서") / person
        folder.mkdir(parents=True, exist_ok=True)
        for name, text in files:
            (folder / name).write_text(text, encoding="utf-8")

    # 인코딩이 다른 파일(CP949)
    cp = root / "사례관리" / "홍길동" / "구형메모_홍길동.txt"
    cp.write_bytes("홍길동 어르신 방문 메모: 겨울철 난방비 지원 문의함.".encode("cp949"))

    other = root / "서식"
    other.mkdir(parents=True, exist_ok=True)
    _write_docx(other / "가정방문일지_홍길동.docx", [
        "가정방문일지", "대상자: 홍길동", "방문일: 2024-05-08",
        "특이사항: 주거환경 개선 필요, 도배 및 장판 교체 요청.",
        "다음 방문 시 보건소 연계 결과 확인 예정.",
    ])
    _write_xlsx(other / "이용인_관리대장.xlsx", [
        ["연번", "성명", "구분", "담당자", "비고"],
        ["1", "홍길동", "집중관리", "김사회복지사", "기초생활수급 신청"],
        ["2", "김영희", "일반관리", "이사회복지사", "한부모 아동 돌봄"],
        ["3", "박철수", "집중관리", "김사회복지사", "알코올 중독 상담"],
    ])
    _write_hwpx(other / "슈퍼비전일지_2024.hwpx", [
        "슈퍼비전 일지", "일시: 2024-07-20",
        "홍길동 사례의 종결 시점에 대한 논의 진행.",
        "김영희 사례는 취업 후 모니터링 강화 필요.",
    ])
    _write_doc(other / "구형_상담일지_김영희.doc", [
        "상담일지 (구형 워드)",
        "대상자: 김영희",
        "2024-10-15 전화상담: 취업 유지 확인, 아동 돌봄 지속 연계.",
    ])
    _write_xls(other / "구형_대상자명단.xls", [
        "성명", "구분", "담당자",
        "홍길동", "집중관리", "김사회복지사",
        "박철수", "집중관리", "알코올 중독 상담",
    ])
    _write_hwp(other / "초기상담지_박철수.hwp", [
        "초기상담지",
        "성명: 박철수",
        "상담일: 2024-04-02",
        "알코올 문제로 인한 가족관계 갈등. 중독 관리 통합지원센터 연계 검토.",
        "실직 상태로 자활근로 참여를 희망함.",
    ])
    return root


if __name__ == "__main__":
    import sys
    dest = sys.argv[1] if len(sys.argv) > 1 else "./_samples"
    print("샘플 생성:", build(dest))
