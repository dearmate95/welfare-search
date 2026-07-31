"""전체 기능 테스트.

  python -m unittest discover tests      (또는)  python tests/test_wsearch.py
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tests import make_samples                                   # noqa: E402
from wsearch import analyze, db, indexer, korean, search          # noqa: E402
from wsearch.config import Config                                 # noqa: E402
from wsearch.extract import extract_text                          # noqa: E402


class Base(unittest.TestCase):
    tmp: str
    conn = None

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="wsearch-test-")
        cls.samples = str(make_samples.build(os.path.join(cls.tmp, "docs")))
        cfg = Config(roots=[cls.samples])
        cfg.db_path = os.path.join(cls.tmp, "index.db")
        cls.cfg = cfg
        cls.progress = indexer.index_once(cfg, quiet=True)
        cls.conn = db.connect(cfg.db_path)

    @classmethod
    def tearDownClass(cls):
        if cls.conn:
            cls.conn.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)


class TestExtract(Base):
    def _find(self, suffix: str) -> str:
        for root, _dirs, files in os.walk(self.samples):
            for f in files:
                if f.endswith(suffix):
                    return os.path.join(root, f)
        self.fail(f"{suffix} 샘플이 없습니다")

    def test_txt_utf8(self):
        r = extract_text(self._find("종결보고서_홍길동.txt"))
        self.assertEqual(r.status, "ok")
        self.assertIn("사후관리", r.text)

    def test_txt_cp949(self):
        """윈도우에서 만든 CP949 파일도 읽어야 한다."""
        r = extract_text(self._find("구형메모_홍길동.txt"))
        self.assertEqual(r.status, "ok")
        self.assertIn("난방비", r.text)

    def test_docx(self):
        r = extract_text(self._find(".docx"))
        self.assertEqual(r.status, "ok")
        self.assertIn("가정방문일지", r.text)

    def test_xlsx_rows(self):
        r = extract_text(self._find(".xlsx"))
        self.assertEqual(r.status, "ok")
        self.assertIn("홍길동", r.text)
        self.assertIn("한부모", r.text)

    def test_hwpx(self):
        r = extract_text(self._find(".hwpx"))
        self.assertEqual(r.status, "ok")
        self.assertIn("슈퍼비전", r.text)

    def test_doc_legacy(self):
        """워드 97-2003(.doc) 조각표에서 본문을 읽어야 한다."""
        r = extract_text(self._find(".doc"))
        self.assertEqual(r.status, "ok", r.note)
        self.assertIn("김영희", r.text)
        self.assertIn("전화상담", r.text)

    def test_xls_legacy(self):
        """엑셀 97-2003(.xls) 공유 문자열 테이블에서 글자를 읽어야 한다."""
        r = extract_text(self._find(".xls"))
        self.assertEqual(r.status, "ok", r.note)
        self.assertIn("홍길동", r.text)
        self.assertIn("집중관리", r.text)

    def test_hwp_binary(self):
        """한글 .hwp(OLE 복합문서 + zlib 압축)에서 본문을 읽어야 한다."""
        r = extract_text(self._find(".hwp"))
        self.assertEqual(r.status, "ok", r.note)
        self.assertIn("박철수", r.text)
        self.assertIn("자활근로", r.text)

    def test_salvage_recovers_text(self):
        """구조 해석이 실패해도 읽을 수 있는 글자는 건져내야 한다."""
        from wsearch.extract.msdoc import _salvage
        blob = (b"\x01\x02\x03" + "홍길동 상담 기록".encode("utf-16-le")
                + b"\xff\xfe" + "김영희 방문".encode("cp949"))
        text = _salvage(blob)
        self.assertIn("홍길동", text)

    def test_broken_file_is_not_fatal(self):
        path = os.path.join(self.tmp, "깨진파일.hwp")
        Path(path).write_bytes(b"not a real hwp file at all")
        r = extract_text(path)
        self.assertIn(r.status, ("error", "empty"))
        self.assertTrue(r.note)


class TestKorean(unittest.TestCase):
    def test_particle_strip(self):
        self.assertEqual(korean.strip_particle("홍길동은"), "홍길동")
        self.assertEqual(korean.strip_particle("사례관리를"), "사례관리")
        self.assertEqual(korean.strip_particle("복지"), "복지")       # 짧으면 그대로

    def test_domain_terms(self):
        text = "기초생활수급 신청과 욕구사정을 진행하였습니다."
        counts = korean.keyword_counts(text)
        self.assertIn("기초생활수급", counts)
        self.assertIn("욕구사정", counts)

    def test_category(self):
        cats = korean.category_counts("월세 체납으로 주거환경이 나쁘고 당뇨가 있음")
        self.assertIn("주거", cats)
        self.assertIn("건강", cats)

    def test_doc_type(self):
        self.assertEqual(korean.guess_doc_type("초기상담지_홍길동.hwp"), "초기상담지")
        self.assertEqual(korean.guess_doc_type("무제.txt", "모니터링 점검표"), "모니터링")

    def test_person_names(self):
        names = korean.find_person_names("성명: 홍길동\n대상자: 김영희")
        self.assertIn("홍길동", names)
        self.assertIn("김영희", names)

    def test_person_names_ignore_headers(self):
        """표 머리글('성명 생년 구분')이 이름으로 잡히면 안 된다."""
        names = korean.find_person_names("연번\t성명\t생년\t구분\t담당자")
        self.assertEqual(names, [])

    def test_dates(self):
        months = korean.find_dates("2024-05-08 방문, 2024년 11월 종결")
        self.assertIn("2024-05", months)
        self.assertIn("2024-11", months)


class TestIndex(Base):
    def test_indexed_all(self):
        self.assertEqual(self.progress.phase, "완료")
        self.assertEqual(self.progress.failed, 0, self.progress.recent_errors)
        stats = db.stats(self.conn)
        self.assertGreaterEqual(stats["ok"], 15)

    def test_incremental_skips_unchanged(self):
        p = indexer.index_once(self.cfg, quiet=True)
        self.assertEqual(p.added, 0)
        self.assertGreater(p.skipped, 0)

    def test_removed_file_is_cleaned(self):
        extra = os.path.join(self.samples, "임시메모.txt")
        Path(extra).write_text("임시 문서 이철수", encoding="utf-8")
        indexer.index_once(self.cfg, quiet=True)
        self.assertEqual(search.search(self.conn, "임시메모")["total"], 1)
        os.remove(extra)
        p = indexer.index_once(self.cfg, quiet=True)
        self.assertGreaterEqual(p.removed, 1)
        self.assertEqual(search.search(self.conn, "임시메모")["total"], 0)


class TestSearch(Base):
    def q(self, text, **kw):
        return search.search(self.conn, text, **kw)

    def test_name_search(self):
        r = self.q("홍길동")
        self.assertGreaterEqual(r["total"], 8)
        self.assertTrue(all("홍길동" in x["name"] or x["hits"] > 0 for x in r["results"]))

    def test_two_char_term(self):
        """2글자 검색어(trigram 색인으로 못 찾는 길이)도 찾아야 한다."""
        self.assertGreater(self.q("상담")["total"], 0)
        self.assertGreater(self.q("종결")["total"], 0)

    def test_and_terms(self):
        r = self.q("홍길동 수급")
        self.assertGreater(r["total"], 0)
        for x in r["results"]:
            self.assertIn("홍길동", str(x["per_term"]))

    def test_exclusion(self):
        names = {x["name"] for x in self.q("홍길동 -종결")["results"]}
        self.assertNotIn("종결보고서_홍길동.txt", names)

    def test_or_terms(self):
        r = self.q("홍길동 | 김영희")
        self.assertGreater(r["total"], self.q("김영희")["total"])

    def test_phrase(self):
        r = self.q('"서비스제공계획"')
        self.assertGreater(r["total"], 0)

    def test_particle_attached(self):
        """'홍길동은'처럼 조사가 붙어 있어도 '홍길동'으로 찾아야 한다."""
        path = os.path.join(self.samples, "조사테스트.txt")
        Path(path).write_text("홍길동은 오늘 상담을 받았다.", encoding="utf-8")
        indexer.index_once(self.cfg, quiet=True)
        names = {x["name"] for x in self.q("홍길동")["results"]}
        self.assertIn("조사테스트.txt", names)
        os.remove(path)
        indexer.index_once(self.cfg, quiet=True)

    def test_snippet_highlight(self):
        r = self.q("기초생활수급")
        first = r["results"][0]
        self.assertTrue(first["snippets"])
        flat = [t for sn in first["snippets"] for t, hit in sn if hit]
        self.assertTrue(any("기초생활수급" in t for t in flat))

    def test_filters(self):
        r = self.q("홍길동", ext="docx")
        self.assertTrue(all(x["ext"] == "docx" for x in r["results"]))

    def test_empty_query(self):
        self.assertEqual(self.q("")["total"], 0)

    def test_get_file(self):
        fid = self.q("홍길동")["results"][0]["id"]
        d = search.get_file(self.conn, fid, "홍길동")
        self.assertIn("홍길동", d["body"] + d["name"])


class TestAnalyze(Base):
    def test_profile(self):
        d = analyze.profile(self.conn, "홍길동")
        self.assertGreaterEqual(d["doc_count"], 8)
        self.assertTrue(d["keywords"])
        terms = {k["term"] for k in d["keywords"]}
        self.assertIn("기초생활수급", terms)
        self.assertNotIn("홍길동", terms)              # 검색어 자신은 제외
        self.assertEqual(d["first_date"], "2024-01")

    def test_checklist(self):
        d = analyze.profile(self.conn, "홍길동")
        forms = {c["form"]: c["ok"] for c in d["checklist"]}
        self.assertTrue(forms["초기상담지"])
        self.assertTrue(forms["종결·사후관리"])

    def test_checklist_detects_missing(self):
        d = analyze.profile(self.conn, "박철수")
        forms = {c["form"]: c["ok"] for c in d["checklist"]}
        self.assertTrue(forms["초기상담지"])
        self.assertFalse(forms["종결·사후관리"])       # 박철수는 종결 문서가 없다

    def test_compare(self):
        d = analyze.compare(self.conn, "홍길동", "김영희")
        only_a = {x["term"] for x in d["only_a"]}
        only_b = {x["term"] for x in d["only_b"]}
        self.assertIn("당뇨", only_a)                  # 홍길동만 건강 이슈
        self.assertIn("방과후", only_b)                # 김영희만 아동 돌봄
        self.assertTrue(d["categories"])

    def test_gaps(self):
        from collections import Counter
        gaps = analyze.find_gaps(Counter({"2024-01": 1, "2024-02": 1, "2024-09": 1}))
        self.assertEqual(len(gaps), 1)
        self.assertEqual(gaps[0]["months"], 6)

    def test_cooccurrence(self):
        d = analyze.cooccurrence(self.conn, "기초생활수급")
        self.assertTrue(d["near"])

    def test_overview(self):
        d = analyze.overview(self.conn)
        names = {p["name"] for p in d["people"]}
        self.assertIn("홍길동", names)
        self.assertIn("김영희", names)

    def test_trend(self):
        d = analyze.keyword_trend(self.conn, "홍길동", ["수급", "가정방문"])
        self.assertEqual(len(d["series"]), 2)


class TestSchema(unittest.TestCase):
    def test_contentless_index_is_rebuilt(self):
        """삭제가 안 되는 옛 방식 색인이 있으면 자동으로 다시 만들어야 한다."""
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "old.db")
        try:
            conn = db.connect(path)
            conn.execute("DROP TABLE ftsdoc")
            conn.execute("CREATE VIRTUAL TABLE ftsdoc "
                         "USING fts5(name, body, tokenize='trigram', content='')")
            conn.execute("INSERT INTO files (path, folder, name, ext, size, mtime,"
                         " indexed_at, status, text_len) "
                         "VALUES ('/x/기록.txt','/x','기록.txt','txt',10,1.0,1.0,'ok',9)")
            conn.execute("INSERT INTO contents (file_id, body) VALUES (1,'홍길동 상담 기록')")
            conn.commit()
            conn.close()

            conn = db.connect(path)                     # 여기서 자동 재구성
            sql = conn.execute("SELECT sql FROM sqlite_master WHERE name='ftsdoc'").fetchone()[0]
            self.assertNotIn("content=", sql)
            hits = conn.execute("SELECT rowid FROM ftsdoc WHERE ftsdoc MATCH '\"홍길동\"'").fetchall()
            self.assertEqual(len(hits), 1)
            conn.execute("DELETE FROM ftsdoc WHERE rowid=1")   # 이제 삭제가 된다
            conn.commit()
            conn.close()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class TestServerBits(unittest.TestCase):
    def test_browse_is_safe(self):
        from wsearch.server import _browse
        d = _browse(str(Path.home()))
        self.assertIn("path", d)
        self.assertIsInstance(d["items"], list)

    def test_free_port(self):
        from wsearch.server import find_free_port
        self.assertGreater(find_free_port(8900), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
