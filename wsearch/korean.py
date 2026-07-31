"""한국어 텍스트 처리.

형태소 분석기(konlpy 등)를 설치하지 않아도 쓸 수 있도록,
조사·어미 제거 규칙과 사회복지 사례관리 용어 사전을 이용한
가벼운 키워드 추출기를 제공한다.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter

# ---------------------------------------------------------------------------
# 토큰 분리
# ---------------------------------------------------------------------------

# 한글 덩어리 / 영문(약어 포함) / 숫자
TOKEN_RE = re.compile(r"[가-힣]+|[A-Za-z][A-Za-z0-9]*|\d+(?:[.,]\d+)*")
HANGUL_RE = re.compile(r"[가-힣]")

# 조사·어미: 긴 것부터 잘라야 하므로 길이 내림차순으로 사용한다.
PARTICLES = [
    "으로부터", "에게서는", "이라고는", "에서부터",
    "으로써", "으로서", "에게서", "이라고", "라고는", "에서는", "에게는",
    "께서는", "이라는", "라는", "만으로", "까지는", "부터는",
    "으로", "로서", "로써", "에서", "에게", "께서", "한테", "부터", "까지",
    "마다", "처럼", "보다", "만큼", "이나", "나마", "이라", "하고", "와의",
    "과의", "에의", "로의", "이며", "이고", "이란", "이든", "든지",
    "의", "이", "가", "은", "는", "을", "를", "에", "와", "과", "도", "만",
    "로", "께", "야", "아", "랑", "든", "나",
]
PARTICLES.sort(key=len, reverse=True)

# 서술형 어미 (명사 뒤에 붙어 동사/형용사가 되는 꼬리)
VERB_TAILS = [
    "하였습니다", "되었습니다", "이었습니다", "하겠습니다", "드렸습니다",
    "합니다", "됩니다", "입니다", "했습니다", "됐습니다", "드립니다",
    "하였고", "하였음", "하였다", "되었음", "되었다", "하였으며", "되었으며",
    "하고자", "하기로", "하도록", "되도록", "하면서", "되면서",
    "했음", "했다", "함", "됨", "한다", "된다", "하며", "되며", "하여", "되어",
    "하는", "되는", "한", "된", "할", "될", "해", "돼",
]
VERB_TAILS.sort(key=len, reverse=True)

# 키워드에서 제외할 일반어
STOPWORDS = {
    "그리고", "그러나", "하지만", "또한", "그래서", "따라서", "때문", "대한", "대하여",
    "위한", "위하여", "관련", "경우", "내용", "결과", "확인", "진행", "실시", "예정",
    "이후", "이전", "현재", "당시", "오늘", "내일", "어제", "지난", "다음", "이번",
    "본인", "자신", "우리", "저희", "여기", "거기", "저기", "이것", "그것", "저것",
    "무엇", "누구", "언제", "어디", "어떻게", "얼마", "정도", "가지", "부분", "전체",
    "사항", "관계", "상태", "상황", "필요", "가능", "불가", "여부", "이상", "이하",
    "매우", "아주", "조금", "많이", "함께", "통해", "통하여", "및", "등", "등등",
    "있음", "없음", "있는", "없는", "같은", "다른", "여러", "모든", "일부",
    "년", "월", "일", "시", "분", "초", "회", "명", "건", "개", "차", "차수",
    "기타", "해당", "각각", "실제", "대상", "방법", "내역", "관하여",
}

# ---------------------------------------------------------------------------
# 사회복지 사례관리 용어 사전
#   - 검색·분석 결과에서 우선순위를 높이고, 영역별로 묶어 보여주는 데 쓴다.
# ---------------------------------------------------------------------------

DOMAIN_TERMS: dict[str, list[str]] = {
    "사례관리단계": [
        "초기상담", "접수", "인테이크", "초기면접", "욕구사정", "사정", "재사정",
        "서비스제공계획", "계획수립", "개입", "직접서비스", "간접서비스",
        "점검", "모니터링", "평가", "종결", "사후관리", "재개입",
        "사례회의", "통합사례회의", "솔루션회의", "슈퍼비전", "사례관리", "통합사례관리",
    ],
    "경제": [
        "기초생활수급", "수급자", "차상위", "긴급복지", "긴급지원", "생계급여",
        "주거급여", "의료급여", "교육급여", "생계비", "후원금", "후원", "결연",
        "체납", "채무", "부채", "파산", "실직", "구직", "소득", "재산", "압류",
        "카드빚", "사채", "공과금", "월세지원",
    ],
    "건강": [
        "질병", "만성질환", "당뇨", "고혈압", "암", "투석", "복약", "투약",
        "입원", "통원", "퇴원", "수술", "재활", "정신건강", "우울", "불안",
        "자살", "자해", "조현병", "알코올", "중독", "치매", "인지저하",
        "장애", "장애등록", "거동불편", "와상", "건강보험", "요양", "장기요양",
    ],
    "주거": [
        "주거환경", "임대주택", "영구임대", "매입임대", "전세", "월세", "보증금",
        "고시원", "쪽방", "반지하", "옥탑", "노숙", "퇴거", "강제집행",
        "주거지원", "집수리", "도배", "장판", "곰팡이", "단수", "단전", "쓰레기",
    ],
    "안전": [
        "학대", "아동학대", "노인학대", "방임", "유기", "폭력", "가정폭력",
        "성폭력", "위기", "위기개입", "응급", "실종", "가출", "안전확인",
        "고독사", "고립", "자살위험", "보호조치", "분리조치", "신고",
    ],
    "가족": [
        "가족관계", "가계도", "생태도", "이혼", "별거", "재혼", "사별",
        "한부모", "조손", "다문화", "양육", "부양", "부양의무자", "친권",
        "면접교섭", "형제", "자매", "배우자", "동거", "독거",
    ],
    "교육고용": [
        "학업", "학업중단", "진학", "학교", "담임", "결석", "무단결석",
        "학습지원", "방과후", "돌봄", "취업", "직업훈련", "자활", "자활근로",
        "공공근로", "일자리", "근로능력", "구직활동",
    ],
    "자원연계": [
        "자원연계", "연계", "의뢰", "의뢰서", "협력기관", "지역사회", "민관협력",
        "복지관", "주민센터", "행정복지센터", "보건소", "정신건강복지센터",
        "드림스타트", "희망복지지원단", "자원봉사", "푸드뱅크", "밑반찬",
        "무료급식", "이동지원", "동행지원", "후원처",
    ],
    "정서지원": [
        "정서지원", "상담", "심리상담", "집단상담", "전화상담", "내방상담",
        "가정방문", "방문상담", "안부확인", "정서적지지", "라포", "동기부여",
        "자존감", "사회적고립", "관계형성", "임파워먼트",
    ],
}

# 용어 -> 영역
TERM_CATEGORY: dict[str, str] = {
    term: cat for cat, terms in DOMAIN_TERMS.items() for term in terms
}
DOMAIN_VOCAB: set[str] = set(TERM_CATEGORY)

# 문서(서식) 유형 판별용 키워드. 파일명 + 본문 앞부분에서 찾는다.
DOC_TYPES: list[tuple[str, list[str]]] = [
    ("초기상담지", ["초기상담", "초기면접", "인테이크", "접수상담", "접수지"]),
    ("욕구사정", ["욕구사정", "사정지", "사정서", "종합사정", "위기도조사", "초기사정"]),
    ("서비스제공계획서", ["서비스제공계획", "계획서", "개입계획", "목표설정"]),
    ("상담일지", ["상담일지", "상담기록", "면담일지", "면담기록"]),
    ("사례관리록", ["사례관리록", "사례관리기록", "사례기록", "과정기록"]),
    ("모니터링", ["모니터링", "점검표", "중간점검", "이행점검"]),
    ("가정방문일지", ["가정방문", "방문일지", "방문기록", "현장방문"]),
    ("사례회의록", ["사례회의", "회의록", "솔루션회의", "통합사례회의"]),
    ("슈퍼비전", ["슈퍼비전", "수퍼비전", "지도감독"]),
    ("종결보고서", ["종결", "종결보고", "종결평가", "사후관리"]),
    ("동의서", ["동의서", "개인정보", "제공동의", "서약서"]),
    ("명단·대장", ["명단", "대장", "현황", "목록", "리스트", "관리대장"]),
    ("공문·계획", ["공문", "사업계획", "결과보고", "품의", "기안"]),
]

# 흔한 성(姓). 표 머리글("성명/생년/구분")이 이름으로 잘못 잡히는 것을 막는다.
SURNAMES = set(
    "김이박최정강조윤장임한오서신권황안송전홍유고문양손배백허남심노하곽성차주우구"
    "라마방위표명기반왕금옥육인맹제모탁국여어편용선설석지진채원천민엄현함변염추도"
    "소석연봉사공피대풍순형"
)

# 이름을 명시하는 표현들
#   "성명: 홍길동"  처럼 콜론이 있는 형태
#   "이용인 홍길동" 처럼 이름이 따라오는 게 자연스러운 라벨
NAME_COLON_RE = re.compile(
    r"(?:성\s*명|이\s*름|대상자|이용인|이용자|클라이언트|내담자|세대주|신청인|아동명|환자명)"
    r"\s*[:：]\s*([가-힣]{2,4})(?![가-힣])"
)
NAME_SPACE_RE = re.compile(
    r"(?:대상자|이용인|이용자|클라이언트|내담자|세대주|신청인)"
    r"[ \t]{1,3}([가-힣]{2,4})(?![가-힣])"
)
# 이름으로 오인되기 쉬운 표 머리글·일반어
NOT_NAME = {
    "성명", "생년", "구분", "연번", "담당", "담당자", "비고", "주소", "전화",
    "연락처", "나이", "성별", "직업", "관계", "가구", "세대", "본인", "부모",
    "방문", "상담", "확인", "미상", "해당", "없음", "동일", "기타", "정보",
    "수집", "이용", "동의", "목적", "일자", "내용", "결과", "특이", "사항",
}

# 날짜 표현
DATE_RES = [
    re.compile(r"(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})"),
    re.compile(r"(20\d{2})[.\-/년]\s*(\d{1,2})\s*월"),
]


# ---------------------------------------------------------------------------
# 정규화 / 토큰화
# ---------------------------------------------------------------------------

def normalize(text: str) -> str:
    """유니코드 정규화(NFC) + 공백 정리. 자모 분리된 한글을 합쳐준다."""
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    return text.replace("​", "").replace("\xa0", " ")


def strip_particle(word: str) -> str:
    """명사 뒤 조사/어미를 잘라낸다. 잘라서 2글자 미만이 되면 그대로 둔다."""
    if not HANGUL_RE.search(word):
        return word
    if word in DOMAIN_VOCAB:
        return word
    for tail in VERB_TAILS:
        if len(word) > len(tail) + 1 and word.endswith(tail):
            stem = word[: -len(tail)]
            if len(stem) >= 2:
                return stem
    for p in PARTICLES:
        if len(word) > len(p) + 1 and word.endswith(p):
            stem = word[: -len(p)]
            if len(stem) >= 2 and stem not in STOPWORDS:
                return stem
    return word


def tokenize(text: str, *, min_len: int = 2) -> list[str]:
    """키워드 후보 목록. 조사를 떼고 불용어를 걸러낸다."""
    text = normalize(text)
    out: list[str] = []
    for raw in TOKEN_RE.findall(text):
        if raw.isdigit():
            continue
        word = strip_particle(raw)
        if len(word) < min_len:
            continue
        if word in STOPWORDS:
            continue
        if word.isascii() and len(word) < 3:
            continue
        out.append(word)
    return out


def compound_terms(text: str) -> list[str]:
    """본문에 실제로 등장한 사회복지 전문용어(복합명사)를 찾아낸다.

    조사 때문에 토큰이 깨져도 잡히도록 원문에서 직접 부분일치로 확인한다.
    """
    text = normalize(text)
    found: list[str] = []
    for term in DOMAIN_VOCAB:
        cnt = text.count(term)
        if cnt:
            found.extend([term] * cnt)
    return found


def keyword_counts(text: str, *, domain_weight: int = 3) -> Counter:
    """키워드 빈도. 사회복지 용어에는 가중치를 준다."""
    counts = Counter(tokenize(text))
    for term, n in Counter(compound_terms(text)).items():
        counts[term] = counts.get(term, 0) + n * domain_weight
    return counts


def category_counts(text: str) -> Counter:
    """영역(경제/건강/주거/안전 …)별 등장 횟수."""
    counts: Counter = Counter()
    text = normalize(text)
    for term, cat in TERM_CATEGORY.items():
        n = text.count(term)
        if n:
            counts[cat] += n
    return counts


def guess_doc_type(filename: str, text: str = "") -> str:
    """파일명과 본문 앞부분으로 서식 유형을 추정한다."""
    head = normalize(filename) + "\n" + normalize(text[:1500])
    best, best_score = "", 0
    for label, keys in DOC_TYPES:
        score = 0
        for k in keys:
            if k in filename:
                score += 3          # 파일명에 있으면 강한 근거
            elif k in head:
                score += 1
        if score > best_score:
            best, best_score = label, score
    return best or "기타"


def is_name_like(word: str) -> bool:
    """사람 이름처럼 보이는지 판정한다(성씨로 시작 + 일반어 제외)."""
    if not (2 <= len(word) <= 4):
        return False
    if word in NOT_NAME or word in STOPWORDS or word in DOMAIN_VOCAB:
        return False
    if not all("가" <= ch <= "힣" for ch in word):
        return False
    return word[0] in SURNAMES


def find_person_names(text: str, limit: int = 30) -> list[str]:
    """'성명: 홍길동', '이용인 홍길동' 형태로 라벨이 붙은 이름 후보를 뽑는다."""
    seen: Counter = Counter()
    text = normalize(text)
    for pattern in (NAME_COLON_RE, NAME_SPACE_RE):
        for m in pattern.finditer(text):
            name = m.group(1)
            if is_name_like(name):
                seen[name] += 1
    return [n for n, _ in seen.most_common(limit)]


def find_dates(text: str) -> list[str]:
    """문서 본문에서 날짜(YYYY-MM)를 추출한다."""
    text = normalize(text)
    out: list[str] = []
    for m in DATE_RES[0].finditer(text):
        y, mo = int(m.group(1)), int(m.group(2))
        if 2000 <= y <= 2099 and 1 <= mo <= 12:
            out.append(f"{y:04d}-{mo:02d}")
    for m in DATE_RES[1].finditer(text):
        y, mo = int(m.group(1)), int(m.group(2))
        if 2000 <= y <= 2099 and 1 <= mo <= 12:
            out.append(f"{y:04d}-{mo:02d}")
    return out


def variants(term: str) -> list[str]:
    """검색어의 표기 변형(띄어쓰기 유무)을 만들어 준다."""
    t = normalize(term).strip()
    out = {t}
    if " " in t:
        out.add(t.replace(" ", ""))
    return [v for v in out if v]
