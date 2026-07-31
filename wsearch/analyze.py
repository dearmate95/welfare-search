"""검색 결과 비교분석.

제공 기능
  1. 이용인(또는 임의 검색어) 프로필  : 문서 수·기간·서식 분포·영역 분포·주요 키워드
  2. 두 대상 비교                     : 공통 키워드 / 각자에게만 두드러진 키워드
  3. 기록 점검(체크리스트)            : 사례관리 필수 서식 중 빠진 것
  4. 월별 추이                        : 기록이 몰린 시기와 공백 기간
  5. 함께 등장하는 이름·기관          : 관련 인물, 연계 기관
"""

from __future__ import annotations

import math
import re
import sqlite3
import time
from collections import Counter

from . import korean, search as search_mod

# 사례관리에서 갖춰야 할 기본 서식
REQUIRED_FORMS = [
    ("초기상담지", ["초기상담", "초기면접", "인테이크", "접수"]),
    ("욕구사정", ["욕구사정", "사정", "위기도"]),
    ("서비스제공계획서", ["서비스제공계획", "개입계획", "계획서"]),
    ("상담·과정기록", ["상담일지", "사례관리록", "면담", "과정기록", "상담"]),
    ("모니터링", ["모니터링", "점검", "이행"]),
    ("종결·사후관리", ["종결", "사후관리"]),
    ("개인정보 동의서", ["동의서", "개인정보"]),
]

# 기관·조직으로 보이는 이름 꼬리 (너무 짧고 흔한 꼬리는 오탐이 많아 넣지 않는다)
ORG_SUFFIX = ("복지관", "복지센터", "지원센터", "상담센터", "상담소", "센터",
              "주민센터", "행정복지센터", "구청", "시청", "군청", "도청",
              "보건소", "병원", "의원", "학교", "유치원", "어린이집", "교회", "성당",
              "재단", "협회", "공단", "공사", "지원단", "사무소", "요양원", "요양병원",
              "복지시설", "쉼터", "그룹홈", "보호소")
ORG_RE = re.compile(r"[가-힣A-Za-z0-9]{1,10}(?:" + "|".join(ORG_SUFFIX) + ")(?![가-힣])")
# 기관명으로 잘못 잡히는 직함·일반어
NOT_ORG = {"사회복지사", "복지사", "담당자", "관계자", "이용자", "종사자"}

EPS = 1e-9


def _docs_for(conn: sqlite3.Connection, query: str, limit: int = 3000) -> list[dict]:
    """검색어에 해당하는 문서들의 본문까지 가져온다."""
    res = search_mod.search(conn, query, limit=limit, candidate_limit=50000)
    ids = [r["id"] for r in res["results"]]
    if not ids:
        return []
    rows = []
    for i in range(0, len(ids), 800):
        chunk = ids[i: i + 800]
        marks = ",".join("?" * len(chunk))
        rows.extend(conn.execute(
            f"""SELECT f.id, f.path, f.name, f.ext, f.mtime, f.doc_type, f.dates,
                       c.body
                FROM files f LEFT JOIN contents c ON c.file_id=f.id
                WHERE f.id IN ({marks})""",
            chunk,
        ).fetchall())
    order = {fid: i for i, fid in enumerate(ids)}
    rows.sort(key=lambda r: order.get(r["id"], 1 << 30))
    return [dict(r) for r in rows]


def _month_of(row: dict) -> str:
    """문서의 대표 시점: 본문에 적힌 날짜가 있으면 그것을, 없으면 수정일을."""
    dates = (row.get("dates") or "").split(",")
    dates = [d for d in dates if d]
    if dates:
        return sorted(dates)[-1]
    return time.strftime("%Y-%m", time.localtime(row.get("mtime") or 0))


def profile(conn: sqlite3.Connection, query: str, *, top: int = 30) -> dict:
    """한 대상(이용인 이름 등)에 대한 종합 프로필."""
    docs = _docs_for(conn, query)
    if not docs:
        return {"query": query, "doc_count": 0, "message": "관련 문서를 찾지 못했습니다."}

    kw: Counter = Counter()
    cat: Counter = Counter()
    doc_freq: Counter = Counter()
    months: Counter = Counter()
    doc_types: Counter = Counter()
    exts: Counter = Counter()
    people: Counter = Counter()
    orgs: Counter = Counter()

    query_terms = {t for t in search_mod.parse_query(query).terms}

    for row in docs:
        body = row.get("body") or ""
        counts = korean.keyword_counts(body)
        for term in query_terms:                 # 검색어 자신은 키워드에서 뺀다
            counts.pop(term, None)
        kw.update(counts)
        for term in counts:
            doc_freq[term] += 1
        cat.update(korean.category_counts(body))
        months[_month_of(row)] += 1
        doc_types[row.get("doc_type") or "기타"] += 1
        exts[row.get("ext") or "?"] += 1
        for name in korean.find_person_names(body):
            if name not in query_terms:
                people[name] += 1
        for m in ORG_RE.finditer(korean.normalize(body)):
            org = m.group(0)
            if org in NOT_ORG or any(org.endswith(x) for x in NOT_ORG):
                continue
            orgs[org] += 1

    # 기간: 문서에 적힌 날짜가 있으면 그것을, 없으면 파일 수정일을 쓴다.
    in_doc = sorted({d for r in docs for d in (r.get("dates") or "").split(",") if d})
    mtimes = [r["mtime"] for r in docs if r.get("mtime")]
    if in_doc:
        first, last = in_doc[0], in_doc[-1]
        date_source = "문서에 적힌 날짜"
    elif mtimes:
        first = time.strftime("%Y-%m", time.localtime(min(mtimes)))
        last = time.strftime("%Y-%m", time.localtime(max(mtimes)))
        date_source = "파일 수정일"
    else:
        first = last = ""
        date_source = ""

    keywords = [
        {"term": t, "count": c, "docs": doc_freq[t],
         "category": korean.TERM_CATEGORY.get(t, "")}
        for t, c in kw.most_common(top * 2)
        if doc_freq[t] >= 1
    ][:top]

    return {
        "query": query,
        "doc_count": len(docs),
        "first_date": first,
        "last_date": last,
        "date_source": date_source,
        "months": sorted(months.items()),
        "doc_types": doc_types.most_common(),
        "exts": exts.most_common(10),
        "categories": cat.most_common(),
        "keywords": keywords,
        "people": [{"name": n, "count": c} for n, c in people.most_common(15)],
        "orgs": [{"name": n, "count": c} for n, c in orgs.most_common(15)],
        "checklist": checklist(docs),
        "gaps": find_gaps(months),
        "documents": [
            {"id": r["id"], "name": r["name"], "path": r["path"],
             "doc_type": r.get("doc_type") or "",
             "date": time.strftime("%Y-%m-%d", time.localtime(r.get("mtime") or 0))}
            for r in docs[:100]
        ],
    }


def checklist(docs: list[dict]) -> list[dict]:
    """사례관리 필수 서식이 갖춰졌는지 확인한다."""
    out = []
    for label, keys in REQUIRED_FORMS:
        found: list[dict] = []
        for row in docs:
            name = row.get("name") or ""
            dtype = row.get("doc_type") or ""
            head = (row.get("body") or "")[:800]
            if dtype == label or any(k in name for k in keys) or any(k in head for k in keys):
                found.append({"id": row["id"], "name": name})
            if len(found) >= 3:
                break
        out.append({
            "form": label,
            "ok": bool(found),
            "count": len(found),
            "examples": found[:3],
        })
    return out


def find_gaps(months: Counter, min_gap: int = 3) -> list[dict]:
    """기록이 min_gap개월 이상 비어 있는 구간을 찾는다."""
    keys = sorted(m for m in months if re.fullmatch(r"\d{4}-\d{2}", m))
    if len(keys) < 2:
        return []

    def to_num(m: str) -> int:
        y, mo = m.split("-")
        return int(y) * 12 + int(mo)

    gaps = []
    for a, b in zip(keys, keys[1:]):
        diff = to_num(b) - to_num(a)
        if diff >= min_gap:
            gaps.append({"from": a, "to": b, "months": diff - 1})
    return gaps


def compare(conn: sqlite3.Connection, query_a: str, query_b: str, *,
            top: int = 25) -> dict:
    """두 대상의 키워드를 비교한다(공통 / A 특징 / B 특징)."""
    docs_a = _docs_for(conn, query_a)
    docs_b = _docs_for(conn, query_b)

    def collect(docs: list[dict], own_terms: set[str]):
        kw: Counter = Counter()
        df: Counter = Counter()
        for row in docs:
            counts = korean.keyword_counts(row.get("body") or "")
            for t in own_terms:
                counts.pop(t, None)
            kw.update(counts)
            for t in counts:
                df[t] += 1
        return kw, df

    terms_a = set(search_mod.parse_query(query_a).terms)
    terms_b = set(search_mod.parse_query(query_b).terms)
    both = terms_a | terms_b
    kw_a, df_a = collect(docs_a, both)
    kw_b, df_b = collect(docs_b, both)

    total_a = sum(kw_a.values()) or 1
    total_b = sum(kw_b.values()) or 1

    def rel(c: Counter, total: int, term: str) -> float:
        return c.get(term, 0) / total

    universe = {t for t, c in kw_a.items() if c >= 2} | {t for t, c in kw_b.items() if c >= 2}

    common, only_a, only_b = [], [], []
    for term in universe:
        ca, cb = kw_a.get(term, 0), kw_b.get(term, 0)
        ra, rb = rel(kw_a, total_a, term), rel(kw_b, total_b, term)
        ratio = math.log((ra + EPS) / (rb + EPS))
        item = {
            "term": term, "a": ca, "b": cb,
            "a_docs": df_a.get(term, 0), "b_docs": df_b.get(term, 0),
            "score": round(ratio, 2),
            "category": korean.TERM_CATEGORY.get(term, ""),
        }
        if ca and cb:
            item["together"] = ca + cb
            common.append(item)
        if ratio > 0.7 and ca >= 2:
            only_a.append(item)
        elif ratio < -0.7 and cb >= 2:
            only_b.append(item)

    common.sort(key=lambda d: d["together"], reverse=True)
    only_a.sort(key=lambda d: (d["score"], d["a"]), reverse=True)
    only_b.sort(key=lambda d: (-d["score"], d["b"]), reverse=True)

    cat_a: Counter = Counter()
    cat_b: Counter = Counter()
    for row in docs_a:
        cat_a.update(korean.category_counts(row.get("body") or ""))
    for row in docs_b:
        cat_b.update(korean.category_counts(row.get("body") or ""))
    cats = sorted(set(cat_a) | set(cat_b),
                  key=lambda c: -(cat_a.get(c, 0) + cat_b.get(c, 0)))

    return {
        "a": {"query": query_a, "doc_count": len(docs_a),
              "keywords": [{"term": t, "count": c} for t, c in kw_a.most_common(top)]},
        "b": {"query": query_b, "doc_count": len(docs_b),
              "keywords": [{"term": t, "count": c} for t, c in kw_b.most_common(top)]},
        "common": common[:top],
        "only_a": only_a[:top],
        "only_b": only_b[:top],
        "categories": [
            {"category": c,
             "a": cat_a.get(c, 0), "b": cat_b.get(c, 0),
             "a_pct": round(100 * cat_a.get(c, 0) / (sum(cat_a.values()) or 1), 1),
             "b_pct": round(100 * cat_b.get(c, 0) / (sum(cat_b.values()) or 1), 1)}
            for c in cats
        ],
        "message": "" if (docs_a or docs_b) else "두 검색어 모두 결과가 없습니다.",
    }


def keyword_trend(conn: sqlite3.Connection, query: str, terms: list[str]) -> dict:
    """특정 단어들이 월별로 얼마나 등장하는지."""
    docs = _docs_for(conn, query) if query else _all_docs(conn)
    series: dict[str, Counter] = {t: Counter() for t in terms}
    for row in docs:
        body = korean.normalize(row.get("body") or "")
        month = _month_of(row)
        for t in terms:
            n = body.count(t)
            if n:
                series[t][month] += n
    months = sorted({m for c in series.values() for m in c})
    return {
        "months": months,
        "series": [{"term": t, "values": [series[t].get(m, 0) for m in months]}
                   for t in terms],
    }


def _all_docs(conn: sqlite3.Connection, limit: int = 5000) -> list[dict]:
    rows = conn.execute(
        """SELECT f.id, f.path, f.name, f.ext, f.mtime, f.doc_type, f.dates, c.body
           FROM files f LEFT JOIN contents c ON c.file_id=f.id
           WHERE f.status='ok' ORDER BY f.mtime DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


def overview(conn: sqlite3.Connection, *, top: int = 40) -> dict:
    """색인 전체에서 자주 쓰인 키워드와 이름 후보를 훑어본다."""
    docs = _all_docs(conn, limit=2000)
    kw: Counter = Counter()
    df: Counter = Counter()
    people: Counter = Counter()
    cat: Counter = Counter()
    types: Counter = Counter()
    for row in docs:
        body = row.get("body") or ""
        counts = korean.keyword_counts(body)
        kw.update(counts)
        for t in counts:
            df[t] += 1
        cat.update(korean.category_counts(body))
        types[row.get("doc_type") or "기타"] += 1
        for n in korean.find_person_names(body):
            people[n] += 1
    return {
        "doc_count": len(docs),
        "keywords": [{"term": t, "count": c, "docs": df[t],
                      "category": korean.TERM_CATEGORY.get(t, "")}
                     for t, c in kw.most_common(top)],
        "people": [{"name": n, "count": c} for n, c in people.most_common(40)],
        "categories": cat.most_common(),
        "doc_types": types.most_common(),
    }


def cooccurrence(conn: sqlite3.Connection, term: str, *, window: int = 120,
                 top: int = 30) -> dict:
    """검색어 주변(앞뒤 window 글자)에 자주 나오는 단어들."""
    docs = _docs_for(conn, term)
    near: Counter = Counter()
    for row in docs:
        body = korean.normalize(row.get("body") or "")
        start = 0
        while True:
            i = body.find(term, start)
            if i < 0:
                break
            chunk = body[max(0, i - window): i + len(term) + window]
            for t in korean.tokenize(chunk):
                if t != term:
                    near[t] += 1
            start = i + len(term)
    return {
        "term": term,
        "doc_count": len(docs),
        "near": [{"term": t, "count": c,
                  "category": korean.TERM_CATEGORY.get(t, "")}
                 for t, c in near.most_common(top)],
    }
