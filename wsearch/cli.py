"""명령줄 사용법.

  python main.py                     화면(브라우저) 열기
  python main.py add  <폴더>          검색할 폴더 추가
  python main.py index [--full]      색인 만들기/갱신
  python main.py find <검색어>        검색
  python main.py profile <이름>       이용인 기록 요약
  python main.py compare <A> <B>     두 대상 비교
  python main.py status              현재 상태 보기
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from . import APP_NAME, __version__, analyze, db, indexer, search as search_mod
from .config import Config


def _line(char: str = "-", n: int = 62) -> None:
    print(char * n)


def cmd_add(cfg: Config, args) -> int:
    added = []
    for raw in args.folders:
        p = Path(raw).expanduser()
        if not p.is_dir():
            print(f"  폴더가 없습니다: {raw}")
            continue
        s = str(p.resolve())
        if s not in cfg.roots:
            cfg.roots.append(s)
            added.append(s)
    cfg.save()
    for s in added:
        print(f"  추가됨: {s}")
    print(f"  현재 검색 폴더 {len(cfg.roots)}개")
    return 0


def cmd_index(cfg: Config, args) -> int:
    if not cfg.normalized_roots():
        print("  먼저 검색할 폴더를 추가하세요:  python main.py add <폴더>")
        return 1
    print(f"  색인 시작 ({'전체 다시' if args.full else '변경분만'})")
    p = indexer.index_once(cfg, full=args.full)
    _line()
    print(f"  {p.phase} · 새 문서 {p.added} · 갱신 {p.updated} · 건너뜀 {p.skipped} "
          f"· 실패 {p.failed} · 삭제정리 {p.removed} · {round(p.finished_at - p.started_at, 1)}초")
    if p.error:
        print(f"  오류: {p.error}")
    if p.recent_errors:
        print("  읽지 못한 파일(최근):")
        for e in p.recent_errors[:10]:
            print("   -", e)
    return 0


def cmd_find(cfg: Config, args) -> int:
    conn = db.connect(cfg.db_path)
    res = search_mod.search(conn, " ".join(args.query), limit=args.limit, sort=args.sort)
    _line("=")
    print(f"  '{res['query']}' 검색 결과 {res['total']}건 ({res['elapsed']}초)")
    _line("=")
    for i, r in enumerate(res["results"], 1):
        badge = f"[{r['doc_type']}]" if r["doc_type"] else ""
        print(f"\n{i:3}. {r['name']}  {badge}")
        print(f"     {r['folder']}")
        print(f"     수정 {r['mtime_text']} · 본문 {r['hits']}회 일치")
        for sn in r["snippets"][:2]:
            text = "".join(f"[{t}]" if h else t for t, h in sn)
            print(f"     … {text.strip()}")
    if not res["results"]:
        print("  " + (res.get("message") or "결과 없음"))
    return 0


def cmd_profile(cfg: Config, args) -> int:
    conn = db.connect(cfg.db_path)
    d = analyze.profile(conn, args.name)
    if not d.get("doc_count"):
        print("  " + d.get("message", "결과 없음"))
        return 1
    _line("=")
    print(f"  {args.name} 기록 요약")
    _line("=")
    print(f"  관련 문서 {d['doc_count']}건 · 기간 {d['first_date']} ~ {d['last_date']}"
          f" ({d.get('date_source','')})")
    print("\n  [필수 서식 점검]")
    for c in d["checklist"]:
        mark = "O" if c["ok"] else "X"
        detail = ", ".join(e["name"] for e in c["examples"]) if c["ok"] else "확인되지 않음"
        print(f"   {mark} {c['form']:<16} {detail}")
    if d["gaps"]:
        print("\n  [기록 공백 구간]")
        for g in d["gaps"]:
            print(f"   - {g['from']} → {g['to']} ({g['months']}개월 비어 있음)")
    print("\n  [영역별 비중]")
    total = sum(c[1] for c in d["categories"]) or 1
    for cat, n in d["categories"]:
        bar = "■" * max(1, round(24 * n / total))
        print(f"   {cat:<10} {bar} {n}")
    print("\n  [주요 키워드]")
    for k in d["keywords"][:15]:
        print(f"   {k['term']:<14} {k['count']:>4}회 / {k['docs']}건  {k['category']}")
    if d["people"]:
        print("\n  [함께 나오는 이름] " + ", ".join(f"{p['name']}({p['count']})" for p in d["people"]))
    if d["orgs"]:
        print("  [연계 기관] " + ", ".join(f"{o['name']}({o['count']})" for o in d["orgs"]))
    print("\n  [관련 문서]")
    for f in d["documents"][:20]:
        print(f"   {f['date']}  {f['doc_type']:<12} {f['name']}")
    return 0


def cmd_compare(cfg: Config, args) -> int:
    conn = db.connect(cfg.db_path)
    d = analyze.compare(conn, args.a, args.b)
    _line("=")
    print(f"  '{args.a}' vs '{args.b}' 비교")
    _line("=")
    print(f"  문서 수: A {d['a']['doc_count']}건 · B {d['b']['doc_count']}건")
    print("\n  [영역별 비중 %]")
    print(f"   {'영역':<12}{'A':>8}{'B':>8}")
    for c in d["categories"]:
        print(f"   {c['category']:<12}{c['a_pct']:>7}%{c['b_pct']:>7}%")
    print("\n  [공통 키워드]")
    for c in d["common"][:12]:
        print(f"   {c['term']:<14} A {c['a']:>3} · B {c['b']:>3}")
    print(f"\n  [A '{args.a}' 에서만 두드러진 단어]")
    for c in d["only_a"][:12]:
        print(f"   {c['term']:<14} A {c['a']:>3} · B {c['b']:>3}  {c['category']}")
    print(f"\n  [B '{args.b}' 에서만 두드러진 단어]")
    for c in d["only_b"][:12]:
        print(f"   {c['term']:<14} A {c['a']:>3} · B {c['b']:>3}  {c['category']}")
    return 0


def cmd_status(cfg: Config, args) -> int:
    conn = db.connect(cfg.db_path)
    s = db.stats(conn)
    _line("=")
    print(f"  {APP_NAME} v{__version__}")
    _line("=")
    print(f"  검색 폴더 {len(cfg.roots)}개")
    for r in cfg.roots:
        print(f"   - {r}")
    print(f"  색인 위치 : {cfg.db_path}")
    print(f"  전체 파일 : {s['total']}건 (검색 가능 {s['ok']}건)")
    print(f"  색인 글자 : {s['chars']:,}자")
    if s["last_indexed"]:
        print(f"  마지막 색인: {time.strftime('%Y-%m-%d %H:%M', time.localtime(s['last_indexed']))}")
    if s["by_ext"]:
        print("  파일형식  : " + ", ".join(f"{e['ext']} {e['c']}" for e in s["by_ext"][:10]))
    if s["problems"]:
        print("  처리못함  : " + ", ".join(f"{p['status']} {p['c']}" for p in s["problems"]))
    return 0


def cmd_web(cfg: Config, args) -> int:
    from .server import serve
    serve(cfg, port=args.port, open_browser=not args.no_browser)
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="복지사례 문서검색",
        description="내 컴퓨터 안의 사례관리 문서를 찾고 비교분석합니다.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--version", action="version", version=__version__)
    sub = ap.add_subparsers(dest="cmd")

    p = sub.add_parser("web", help="브라우저 화면 열기(기본)")
    p.add_argument("--port", type=int, default=0)
    p.add_argument("--no-browser", action="store_true")
    p.set_defaults(func=cmd_web)

    p = sub.add_parser("add", help="검색할 폴더 추가")
    p.add_argument("folders", nargs="+")
    p.set_defaults(func=cmd_add)

    p = sub.add_parser("index", help="색인 만들기/갱신")
    p.add_argument("--full", action="store_true", help="처음부터 다시 만들기")
    p.set_defaults(func=cmd_index)

    p = sub.add_parser("find", help="검색")
    p.add_argument("query", nargs="+")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--sort", default="score", choices=["score", "date", "hits", "name"])
    p.set_defaults(func=cmd_find)

    p = sub.add_parser("profile", help="이용인 기록 요약")
    p.add_argument("name")
    p.set_defaults(func=cmd_profile)

    p = sub.add_parser("compare", help="두 대상 비교")
    p.add_argument("a")
    p.add_argument("b")
    p.set_defaults(func=cmd_compare)

    p = sub.add_parser("status", help="현재 상태")
    p.set_defaults(func=cmd_status)
    return ap


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    ap = build_parser()
    if not argv:
        argv = ["web"]
    args = ap.parse_args(argv)
    cfg = Config.load()
    if not hasattr(args, "func"):
        ap.print_help()
        return 0
    try:
        return args.func(cfg, args)
    except KeyboardInterrupt:
        print("\n중단했습니다.")
        return 130
