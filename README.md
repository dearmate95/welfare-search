# welfare-search

## mg16xu-sim — MG16XU 믹서 학습 시뮬레이터 (비공식 교육용)

16채널 아날로그 믹서의 노브·버튼·페이더를 브라우저에서 직접 조작하고,
소리(Web Audio)와 신호 흐름의 변화를 실시간으로 확인하는 정적 웹사이트입니다.

- 빌드 과정 없음: `mg16xu-sim/` 폴더(index.html, style.css, audio.js, ui.js)가 전부입니다.
- 로컬 실행: `cd mg16xu-sim && python3 -m http.server 8000` → http://localhost:8000
- Netlify 배포: 저장소 루트의 `netlify.toml`이 `mg16xu-sim` 폴더를 게시하도록 설정되어 있습니다.
  - 방법 A) Netlify → Add new site → Import an existing project → 이 저장소/브랜치 선택
  - 방법 B) Netlify → Add new site → Deploy manually → `mg16xu-sim` 폴더를 끌어다 놓기
