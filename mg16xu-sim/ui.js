/* =========================================================
   MG16XU 학습용 시뮬레이터 - 화면(UI)
   ========================================================= */
'use strict';

const state = {};          // 모든 컨트롤 값 (엔진과 공유)
const C = {};              // 컨트롤 등록부: id → { type, kind, el, def, ch }
const chEls = {};          // 채널별 표시 요소 (PEAK LED, 가상 미터, 이름표, 단자)
const jackEls = {};        // 출력 단자 요소
let E = null;              // 오디오 엔진
let selCh = '1';           // 분석 패널에 표시 중인 채널
let power = false;
let lastInfo = null;

const $ = s => document.querySelector(s);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1);
const dbTxt = d => (d === -Infinity || d < -100 ? '−∞ dB' : sgn(d) + ' dB');

/* ---------- 컨트롤 설명 (이름, 하는 일, 무엇이 변하는지) ---------- */
const DESC = {
  pad: ['PAD 스위치 (26 dB)', '입력 신호를 26 dB 줄여 주는 감쇠 스위치입니다. 키보드·음원 기기처럼 큰 신호(라인 레벨)를 꽂았을 때 켭니다.', '「프리앰프 후」 레벨 막대가 26 dB 내려갑니다. PEAK가 켜지던 채널이 깨끗해집니다.'],
  lineusb: ['LINE / USB 전환 스위치', 'CH 15/16에 들어올 소리를 고릅니다. LINE = 채널 단자에 꽂은 기기, USB = 노트북에서 USB로 재생하는 소리.', '「입력」 레벨 막대의 신호가 바뀝니다. USB로 두려면 노트북을 USB 단자에 연결해야 합니다.'],
  hpf: ['HPF (하이패스 필터, 80 Hz)', '80 Hz 아래 저음을 잘라냅니다. 마이크의 숨소리·핸들링 노이즈·무대 울림 제거용. 킥·베이스에는 끄는 것이 보통입니다.', 'EQ 곡선의 왼쪽(저음)이 아래로 꺾입니다.'],
  gain: ['GAIN (입력 게인)', '마이크의 아주 작은 신호를 믹서가 다루기 좋은 크기로 키웁니다. 가장 먼저, 가장 신중하게 맞추는 노브입니다. PEAK가 가끔 깜빡일까 말까 한 지점이 적정.', '「프리앰프 후」 레벨이 변합니다. 너무 올리면 PEAK LED가 켜지고 소리가 찌그러집니다(클리핑).'],
  comp: ['COMP (원노브 컴프레서)', '큰 소리는 눌러 주고 전체 음량은 올려서 소리 크기를 고르게 만듭니다. 돌릴수록 임계값이 내려가고 압축 비율이 올라갑니다.', '컴프레서 그래프의 꺾이는 점이 내려가고, 게인 리덕션 막대가 움직입니다.'],
  high: ['EQ HIGH (고음, 10 kHz 셸빙)', '10 kHz 위쪽 고음을 ±15 dB 조절합니다. 올리면 선명·화사, 내리면 부드럽고 치찰음이 줄어듭니다.', 'EQ 곡선의 오른쪽 끝이 올라가거나 내려갑니다.'],
  mid: ['EQ MID (중음, 피킹)', '중음대를 ±15 dB 조절합니다. 모노 채널은 아래 주파수 노브로 고른 대역을, 스테레오 채널은 2.5 kHz를 조절합니다.', 'EQ 곡선 가운데에 봉우리(부스트) 또는 골짜기(컷)가 생깁니다.'],
  midf: ['EQ MID 주파수 (250 Hz ~ 5 kHz)', 'MID 노브가 조절할 중심 주파수를 고릅니다. MID를 올린 채 이 노브를 돌려 거슬리는 대역을 찾은 뒤 MID를 내리는 것이 기본 사용법입니다.', 'EQ 곡선의 봉우리/골짜기가 좌우로 이동합니다. (MID가 가운데면 변화 없음)'],
  low: ['EQ LOW (저음, 100 Hz 셸빙)', '100 Hz 아래 저음을 ±15 dB 조절합니다. 올리면 묵직, 내리면 웅웅거림이 줄어듭니다.', 'EQ 곡선의 왼쪽 끝이 올라가거나 내려갑니다.'],
  aux1: ['AUX 1 센드', '이 채널 소리를 AUX 1 버스로 보내는 양입니다. 주로 무대 모니터 스피커용 믹스를 만듭니다.', '버스 레벨의 AUX1 막대가 변합니다. AUX SEND 1에 꽂은 모니터 스피커에서 이 채널이 들립니다.'],
  aux2: ['AUX 2 센드', '이 채널 소리를 AUX 2 버스로 보내는 양입니다. 두 번째 모니터 믹스에 사용합니다.', '버스 레벨의 AUX2 막대가 변합니다.'],
  aux3: ['AUX 3 센드 (포스트 페이더)', '이 채널 소리를 AUX 3 버스로 보냅니다. 페이더를 거친 뒤의 신호라 채널 페이더를 내리면 함께 줄어듭니다. 외부 이펙터·녹음 송출용.', '버스 레벨의 AUX3 막대가 변합니다.'],
  fx: ['AUX 4 / FX 센드', '이 채널 소리를 내장 이펙터(리버브 등)와 AUX 4 버스로 보내는 양입니다. 많이 보낼수록 울림이 많이 걸립니다.', '버스 레벨의 AUX4·FX 막대가 변합니다. FX RTN 페이더와 ON이 올라가 있어야 들립니다.'],
  pre1: ['PRE 스위치 (AUX 1)', '켜면 AUX 1으로 가는 신호를 페이더 "앞"에서 뽑습니다(프리 페이더). 객석 음량을 바꿔도 모니터 음량은 그대로라서 무대 모니터용에 적합합니다.', '켠 상태에서 채널 페이더를 움직여도 AUX1 막대는 변하지 않습니다. 끄면 함께 움직입니다.'],
  pre2: ['PRE 스위치 (AUX 2)', '켜면 AUX 2로 가는 신호를 페이더 "앞"에서 뽑습니다(프리 페이더).', '켠 상태에서 채널 페이더를 움직여도 AUX2 막대는 변하지 않습니다.'],
  pan: ['PAN / BAL', '소리를 좌우 어디에 놓을지 정합니다. GROUP에 보낼 때는 왼쪽 = 홀수(1, 3), 오른쪽 = 짝수(2, 4) 그룹으로 갑니다.', '마스터 레벨 미터의 L/R 균형이 바뀝니다.'],
  on: ['ON 스위치', '채널을 켜고 끕니다. 꺼져 있으면 STEREO·GROUP·AUX 어디로도 소리가 가지 않습니다. 안 쓰는 채널은 꺼 두어 잡음을 줄입니다.', '끄면 「페이더 후」 레벨과 모든 버스로 가는 신호가 사라집니다. (PFL로는 여전히 들을 수 있음)'],
  pfl: ['PFL (프리 페이더 리슨)', '이 채널의 페이더 "앞" 소리만 MONITOR OUT / PHONES / 레벨 미터로 보냅니다. 객석에는 영향 없이 채널 하나를 확인하거나 게인을 맞출 때 사용합니다.', '레벨 미터가 이 채널의 레벨만 표시하고 PFL 표시등이 깜빡입니다. 헤드폰·조정석에서 이 채널만 들립니다.'],
  g12: ['GROUP 1-2 할당', '이 채널을 GROUP 1-2 버스로 보냅니다. 드럼 여러 채널을 묶어 페이더 하나로 조절하는 식으로 씁니다.', '버스 레벨의 G1-2 막대에 이 채널이 더해집니다.'],
  g34: ['GROUP 3-4 할당', '이 채널을 GROUP 3-4 버스로 보냅니다.', '버스 레벨의 G3-4 막대에 이 채널이 더해집니다.'],
  st: ['ST (STEREO 버스) 할당', '이 채널을 메인 출력인 STEREO 버스로 직접 보냅니다. 꺼져 있으면 페이더를 올려도 메인 스피커에서 소리가 나지 않습니다.', '버스 레벨의 ST 막대와 마스터 미터에 이 채널이 더해집니다.'],
  fader: ['채널 페이더', '이 채널이 믹스에 들어가는 음량입니다. 0 눈금(굵은 선)이 기준이며, GAIN을 제대로 맞췄다면 0 근처에서 섬세하게 조절할 수 있습니다.', '「페이더 후」 레벨, ST/GROUP 버스 레벨이 변합니다. PRE가 꺼진 AUX 센드도 함께 변합니다.'],
  phantom: ['PHANTOM +48V', '콘덴서 마이크와 액티브 DI 박스에 필요한 48V 전원을 마이크(XLR) 입력 전체에 공급합니다. 켜고 끌 때는 페이더와 마스터를 내려 두는 것이 안전합니다.', '콘덴서 마이크(통기타·오버헤드)의 입력 레벨이 살아납니다. 꺼져 있으면 전혀 소리가 나지 않습니다.'],
  send: ['SEND 마스터 (AUX {n})', 'AUX {n} 버스 전체를 AUX SEND {n} 단자로 내보내는 최종 음량입니다. 모니터 스피커 한 대의 "전체 볼륨"에 해당합니다.', '버스 레벨의 AUX{n} 막대 전체가 변합니다.'],
  prog: ['FX PROGRAM (이펙트 종류)', '내장 디지털 이펙터의 프로그램 24종 중 하나를 고릅니다. 1~10 리버브 계열, 11~14 딜레이·에코, 15~24 변조·특수 효과.', '디스플레이 번호와 목록의 강조 표시가 바뀌고, 울림의 성격이 달라집니다.'],
  param: ['FX PARAMETER', '선택한 이펙트의 대표 값 하나를 조절합니다. 리버브는 잔향 시간, 딜레이는 반복 간격, 변조 계열은 흔들리는 속도.', '값 표시가 바뀌고, 울림의 길이·간격·속도가 달라집니다.'],
  fxOn: ['FX ON', '내장 이펙터를 켜고 끕니다. 풋 스위치를 연결하면 발로도 켜고 끌 수 있습니다(곡 사이 멘트 때 리버브를 끄는 용도).', '끄면 버스 레벨의 FX 막대가 사라지고 울림 없는 원음만 남습니다.'],
  fxAux: ['FX RTN → AUX {n}', '이펙트 소리를 AUX {n}(무대 모니터)에도 보냅니다. 가수가 모니터에서 자기 목소리의 리버브를 듣고 싶어 할 때 올립니다.', '버스 레벨의 AUX{n} 막대에 이펙트 소리가 더해집니다.'],
  fxPfl: ['FX RTN PFL', '이펙트 소리만 MONITOR OUT / PHONES로 따로 들어 봅니다.', '레벨 미터가 이펙트 레벨만 표시합니다.'],
  fxG12: ['FX RTN → GROUP 1-2', '이펙트 소리를 GROUP 1-2 버스로 보냅니다.', '버스 레벨 G1-2에 이펙트가 더해집니다.'],
  fxG34: ['FX RTN → GROUP 3-4', '이펙트 소리를 GROUP 3-4 버스로 보냅니다.', '버스 레벨 G3-4에 이펙트가 더해집니다.'],
  fxSt: ['FX RTN → ST', '이펙트 소리를 메인(STEREO) 버스로 보냅니다. 보통 켜 둡니다.', '버스 레벨 ST에 이펙트가 더해집니다.'],
  fxFader: ['FX RTN 페이더', '이펙트(울림) 소리가 믹스에 섞이는 양입니다. 채널의 FX 노브가 "얼마나 보낼지"라면, 이 페이더는 "돌아온 울림을 얼마나 섞을지"입니다.', '버스 레벨의 FX 막대가 변합니다.'],
  gFader: ['GROUP {n} 페이더', 'GROUP {n} 버스에 모인 채널들의 음량을 한꺼번에 조절합니다. GROUP OUT 단자로도 나갑니다.', '버스 레벨의 G{n} 막대가 변합니다.'],
  gSt: ['GROUP {n} → ST', 'GROUP {n} 버스를 STEREO 버스에 합칩니다. 서브그룹으로 쓸 때 켭니다. 끄면 GROUP OUT 단자로만 나갑니다.', '켜면 ST 버스 레벨에 그룹 소리가 더해집니다.'],
  stOn: ['STEREO ON', '메인 출력(STEREO OUT)을 켜고 끕니다. 장비를 연결·분리하거나 팬텀을 조작할 때 꺼 두면 안전합니다.', '끄면 마스터 미터와 메인 스피커가 조용해집니다.'],
  stFader: ['STEREO 마스터 페이더', '객석으로 나가는 최종 음량입니다. 채널 간 균형은 채널 페이더로 잡고, 전체 크기는 이 페이더로 조절합니다.', '마스터 레벨 미터와 메인 스피커 레벨이 변합니다. PEAK까지 가지 않도록 합니다.'],
  monSel: ['MONITOR 소스 선택', 'MONITOR OUT·PHONES·레벨 미터로 무엇을 들을지 고릅니다. (PFL이 켜진 채널이 있으면 PFL이 우선)', '레벨 미터와 헤드폰/조정석 소리가 선택한 버스로 바뀝니다.'],
  monLevel: ['MONITOR LEVEL', 'MONITOR OUT 단자(조정석 모니터 스피커)의 음량입니다. 객석 음량에는 영향이 없습니다.', '조정석 모니터 스피커 카드의 레벨이 변합니다.'],
  phones: ['PHONES LEVEL', '헤드폰 음량입니다. 귀 보호를 위해 낮은 곳에서부터 올립니다.', '헤드폰 카드의 레벨이 변합니다.'],
};
const BTN_TXT = { lineusb: ['LINE', 'USB'], pre1: ['POST (페이더 후)', 'PRE (페이더 전)'], pre2: ['POST (페이더 후)', 'PRE (페이더 전)'] };
const MON_SRC = ['STEREO', 'GROUP 1-2', 'GROUP 3-4'];

/* ---------- 값 표시 ---------- */
function fmt(id) {
  const c = C[id], v = state[id], k = c.kind;
  switch (k) {
    case 'gain': { const ch = E.ch[c.ch]; return `게인 ${sgn(E.chGainDb(ch))} dB` + (state[`ch${c.ch}.pad`] ? ' (PAD −26 포함)' : '') + (!ch.def.pad && ch.srcType === 'line' ? ' (LINE 단자)' : ''); }
    case 'comp': { const p = E.compParams(v); return v < 0.01 ? '꺼짐 (1:1)' : `임계 ${sgn(p.thr + 20)} dB · 비율 ${p.ratio.toFixed(1)}:1`; }
    case 'high': case 'mid': case 'low': return dbTxt((v - 0.5) * 30);
    case 'midf': { const f = 250 * Math.pow(20, v); return f >= 1000 ? (f / 1000).toFixed(2) + ' kHz' : Math.round(f) + ' Hz'; }
    case 'aux1': case 'aux2': case 'aux3': case 'fx': case 'send': case 'fxAux': return dbTxt(knobDb(v));
    case 'pan': { const p = Math.round((v - 0.5) * 200); return p === 0 ? 'C (가운데)' : (p < 0 ? 'L ' : 'R ') + Math.abs(p); }
    case 'fader': case 'fxFader': case 'gFader': case 'stFader': return dbTxt(faderDb(v));
    case 'prog': return `${String(v).padStart(2, '0')} ${PROGS[v - 1].name}`;
    case 'param': { const p = PROGS[state['m.prog'] - 1]; return `${p.pname}: ${p.fmt(progValue(p, v))}`; }
    case 'monSel': return MON_SRC[v];
    case 'monLevel': case 'phones': return (v * 10).toFixed(1) + ' / 10';
    default: return BTN_TXT[k] ? BTN_TXT[k][v ? 1 : 0] : (v ? 'ON (켜짐)' : 'OFF (꺼짐)');
  }
}

/* ---------- 컨트롤 등록 / 값 변경 ---------- */
function reg(id, o) {
  o.id = id; C[id] = o; state[id] = o.def;
  const m = id.match(/^ch(.+)\.(\w+)$/); if (m) o.ch = m[1];
  o.el.dataset.id = id;
  o.el.addEventListener('pointerenter', () => showInfo(id));
  o.el.addEventListener('focus', () => showInfo(id));
  if (o.type !== 'btn') o.el.addEventListener('dblclick', () => setVal(id, o.def, true));
}
function setVal(id, v, user) {
  const c = C[id]; if (!c || state[id] === v) { if (user) showInfo(id); return; }
  state[id] = v; paint(id);
  if (E) { if (c.ch) E.syncCh(E.ch[c.ch]); else E.syncMaster(); }
  if (user) { if (c.ch) selectCh(c.ch); showInfo(id); }
}
function paint(id) {
  const c = C[id], v = state[id];
  if (c.type === 'knob') c.el.style.setProperty('--a', (-135 + 270 * v) + 'deg');
  else if (c.type === 'step') { c.el.style.setProperty('--a', ((v - 1) * 15) + 'deg'); paintFx(); }
  else if (c.type === 'fader') c.el.style.setProperty('--v', v);
  else if (c.kind === 'monSel') { c.el.textContent = MON_SRC[v]; c.el.classList.add('on'); }
  else c.el.classList.toggle('on', !!v);
  if (c.kind === 'param') paintFx();
}

function showInfo(id) {
  lastInfo = id;
  const c = C[id], d = DESC[c.kind] || [c.kind, '', ''], n = c.n || '';
  const rep = s => s.replace(/\{n\}/g, n);
  $('#infoName').textContent = (c.ch ? `CH ${c.ch} · ` : '') + rep(d[0]);
  $('#infoVal').textContent = E ? fmt(id) : '';
  $('#infoDesc').textContent = rep(d[1]);
  $('#infoWatch').innerHTML = d[2] ? '<b>👀 변화 확인</b> ' + rep(d[2]) : '';
  document.querySelectorAll('.hot').forEach(e => e.classList.remove('hot'));
  c.el.classList.add('hot');
}

/* ---------- 컨트롤 생성 ---------- */
function knob(id, kind, label, color, def = 0, opt = {}) {
  const w = h('div', 'kw'), k = h('div', 'knob ' + color, '<i></i>'); k.tabIndex = 0;
  w.append(k, h('span', 'lb', label));
  reg(id, Object.assign({ type: opt.step ? 'step' : 'knob', kind, el: k, def }, opt));
  let raw = 0;
  const apply = () => {
    if (opt.step) return setVal(id, Math.round(clamp(raw, 1, 24)), true);
    let v = clamp(raw); if (opt.center && Math.abs(v - 0.5) < 0.025) v = 0.5;   // 가운데 걸림
    setVal(id, v, true);
  };
  k.addEventListener('pointerdown', e => {
    e.preventDefault(); k.setPointerCapture(e.pointerId); raw = state[id]; let y = e.clientY;
    const mv = ev => { const dy = y - ev.clientY; y = ev.clientY; raw = opt.step ? clamp(raw + dy / 10, 1, 24) : clamp(raw + dy / (ev.shiftKey ? 700 : 170)); apply(); };
    const up = () => { k.removeEventListener('pointermove', mv); k.removeEventListener('pointerup', up); k.removeEventListener('pointercancel', up); };
    k.addEventListener('pointermove', mv); k.addEventListener('pointerup', up); k.addEventListener('pointercancel', up);
    showInfo(id); if (C[id].ch) selectCh(C[id].ch);
  });
  const nudge = d => { raw = state[id] + (opt.step ? Math.sign(d) : d); apply(); };
  k.addEventListener('wheel', e => { e.preventDefault(); nudge(e.deltaY < 0 ? 0.03 : -0.03); }, { passive: false });
  k.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowRight') nudge(0.02); else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') nudge(-0.02); else return; e.preventDefault(); });
  return w;
}
function btn(id, kind, label, cls = '', def = 0, opt = {}) {
  const b = h('button', 'sw ' + cls, label);
  reg(id, Object.assign({ type: 'btn', kind, el: b, def }, opt));
  b.addEventListener('click', () => setVal(id, kind === 'monSel' ? (state[id] + 1) % 3 : (state[id] ? 0 : 1), true));
  return b;
}
function fader(id, kind, cls = '', opt = {}) {
  const f = h('div', 'fader ' + cls, '<div class="scale">' + [1, 0.875, 0.75, 0.625, 0.5, 0.38, 0.25, 0.12, 0].map(p => `<b class="${p === 0.75 ? 'z' : ''}" style="bottom:${(p * 86 + 7).toFixed(1)}%"></b>`).join('') + '</div><div class="track"></div><div class="cap"></div>');
  f.tabIndex = 0;
  reg(id, Object.assign({ type: 'fader', kind, el: f, def: 0 }, opt));
  const fromY = y => { const r = f.getBoundingClientRect(), cap = r.height * 0.14; return clamp(1 - (y - r.top - cap / 2) / (r.height - cap)); };
  f.addEventListener('pointerdown', e => {
    e.preventDefault(); f.setPointerCapture(e.pointerId);
    const onCap = e.target.classList.contains('cap'), off = onCap ? fromY(e.clientY) - state[id] : 0;
    const mv = ev => setVal(id, clamp(fromY(ev.clientY) - off), true);
    const up = () => { f.removeEventListener('pointermove', mv); f.removeEventListener('pointerup', up); f.removeEventListener('pointercancel', up); };
    f.addEventListener('pointermove', mv); f.addEventListener('pointerup', up); f.addEventListener('pointercancel', up);
    if (!onCap) mv(e); else { showInfo(id); if (C[id].ch) selectCh(C[id].ch); }
  });
  f.addEventListener('wheel', e => { e.preventDefault(); setVal(id, clamp(state[id] + (e.deltaY < 0 ? 0.02 : -0.02)), true); }, { passive: false });
  f.addEventListener('keydown', e => { if (e.key === 'ArrowUp') setVal(id, clamp(state[id] + 0.02), true); else if (e.key === 'ArrowDown') setVal(id, clamp(state[id] - 0.02), true); else return; e.preventDefault(); });
  return f;
}
const gap = cls => h('div', 'gap ' + cls);

/* ---------- 채널 스트립 ---------- */
function buildStrip(def) {
  const id = def.id, p = k => `ch${id}.${k}`, s = h('div', 'strip' + (def.stereo ? ' stereo' : ''));
  s.dataset.ch = id;
  s.addEventListener('pointerdown', () => selectCh(id));
  const jack = h('button', 'jack', ''); jack.title = `CH ${id} 입력 단자 — 눌러서 장비 연결`;
  jack.addEventListener('click', e => { e.stopPropagation(); menuForChannel(id, jack); });
  const jc = h('div', 'jackCell'); jc.append(h('span', 'jl', def.mic ? 'MIC / LINE' : (def.usb ? 'LINE (USB)' : 'LINE')), jack);
  s.append(jc);
  s.append(def.usb ? btn(p('lineusb'), 'lineusb', 'LINE<i>▮</i>USB', 'small') : def.pad ? btn(p('pad'), 'pad', 'PAD', 'small') : gap('b'));
  s.append(def.hpf ? btn(p('hpf'), 'hpf', 'HPF 80', 'small') : gap('b'));
  s.append(def.gain ? knob(p('gain'), 'gain', 'GAIN', 'white') : gap('k'));
  const peak = h('div', 'peakRow', '<i class="led red"></i><span>PEAK</span>'); s.append(peak);
  s.append(def.comp ? knob(p('comp'), 'comp', 'COMP', 'yellow') : gap('k'));
  s.append(knob(p('high'), 'high', 'HIGH', 'green', 0.5, { center: true }));
  s.append(knob(p('mid'), 'mid', def.stereo ? 'MID 2.5k' : 'MID', 'green', 0.5, { center: true }));
  s.append(def.stereo ? gap('k') : knob(p('midf'), 'midf', '250–5k', 'green2', 0.767));
  s.append(knob(p('low'), 'low', 'LOW', 'green', 0.5, { center: true }));
  s.append(knob(p('aux1'), 'aux1', 'AUX1', 'blue'), btn(p('pre1'), 'pre1', 'PRE', 'small'));
  s.append(knob(p('aux2'), 'aux2', 'AUX2', 'blue'), btn(p('pre2'), 'pre2', 'PRE', 'small'));
  s.append(knob(p('aux3'), 'aux3', 'AUX3', 'blue'));
  s.append(knob(p('fx'), 'fx', 'AUX4/FX', 'cyan'));
  s.append(knob(p('pan'), 'pan', def.stereo ? 'BAL' : 'PAN', 'red', 0.5, { center: true }));
  s.append(btn(p('on'), 'on', 'ON', 'onb'), btn(p('pfl'), 'pfl', 'PFL', 'pflb'));
  const fz = h('div', 'fz'), as = h('div', 'assign');
  as.append(btn(p('g12'), 'g12', '1-2', 'small'), btn(p('g34'), 'g34', '3-4', 'small'), btn(p('st'), 'st', 'ST', 'small stb'));
  const vm = h('div', 'vm', '<i></i>'); vm.title = '가상 레벨 미터(학습용, 실제 기기에는 없음)';
  fz.append(as, fader(p('fader'), 'fader'), vm);
  s.append(fz);
  const tape = h('div', 'tape', '');
  s.append(h('div', 'chNo', id), tape);
  chEls[id] = { strip: s, jack, peak: peak.firstChild, vm: vm.firstChild, tape, lv: -100, pk: 0 };
  return s;
}

/* ---------- 마스터 섹션 ---------- */
let meterSegs = [], fxDisp, fxList, fxParamTxt, pflLed, phLed, pwrLed;
const METER_MARKS = [17, 10, 6, 3, 0, -3, -6, -10, -15, -20, -25, -30];
function buildMaster() {
  const m = h('div', 'master');
  // 출력 단자 패널
  const jp = h('div', 'jackPanel'); const groups = {};
  OUT_JACKS.forEach(j => {
    if (!groups[j.group]) { groups[j.group] = h('div', 'jg', `<span class="jgt">${j.group}</span><div class="jgr"></div>`); jp.append(groups[j.group]); }
    const b = h('button', 'jack out', ''); b.title = `${j.group} ${j.label} — 눌러서 장비 연결`;
    b.addEventListener('click', () => menuForJack(j.id, b));
    const w = h('div', 'jw'); w.append(b, h('span', 'jl', j.label || '&nbsp;'));
    groups[j.group].lastChild.append(w); jackEls[j.id] = b;
  });
  const foot = h('div', 'jg', '<span class="jgt">FOOT SW</span><div class="jgr"></div>');
  const pedal = h('button', 'pedal', '🦶'); pedal.title = '풋 스위치 밟기 — FX ON/OFF 전환';
  pedal.addEventListener('click', () => setVal('m.fxOn', state['m.fxOn'] ? 0 : 1, true));
  foot.lastChild.append(pedal); jp.append(foot);
  const ph = h('div', 'jg phg', '<span class="jgt">PHANTOM +48V</span><div class="jgr"></div>');
  phLed = h('i', 'led red'); ph.lastChild.append(phLed, btn('m.phantom', 'phantom', '+48V', 'small'));
  jp.append(ph);
  m.append(jp);

  // 가운데: 이펙터 / 미터 / 센드 마스터 / 모니터
  const mid = h('div', 'mMid');
  const fx = h('div', 'box fxBox', '<span class="bt">내장 이펙터 (SPX)</span>');
  fxDisp = h('div', 'fxDisp', '01'); fxParamTxt = h('div', 'fxParam', '');
  fxList = h('ol', 'fxList'); PROGS.forEach(p => { const li = h('li', '', p.name); li.addEventListener('click', () => setVal('m.prog', p.no, true)); fxList.append(li); });
  const fk = h('div', 'row');
  fk.append(fxDisp, knob('m.prog', 'prog', 'PROGRAM', 'white big', 1, { step: true }), knob('m.param', 'param', 'PARAMETER', 'white', 0.4));
  fx.append(fxList, fk, fxParamTxt);
  const mt = h('div', 'box meterBox', '<span class="bt">LEVEL</span>');
  pwrLed = h('i', 'led green'); pflLed = h('i', 'led amber');
  const leds = h('div', 'row tiny'); leds.append(pwrLed, h('span', '', 'POWER'), pflLed, h('span', '', 'PFL'));
  const bars = h('div', 'meter');
  meterSegs = [[], []];
  const colL = h('div', 'mcol'), colS = h('div', 'mscale'), colR = h('div', 'mcol');
  METER_MARKS.forEach((d, i) => {
    const cls = i === 0 ? 'r' : d > 0 ? 'y' : 'g';
    [colL, colR].forEach((c, k) => { const sg = h('i', 'seg ' + cls); c.append(sg); meterSegs[k].push(sg); });
    colS.append(h('span', '', i === 0 ? 'PEAK' : (d > 0 ? '+' : '') + d));
  });
  meterSegs[0].lv = meterSegs[1].lv = -100;
  bars.append(colL, colS, colR);
  mt.append(leds, bars, h('div', 'row tiny lr', '<span>L</span><span>R</span>'));
  const sd = h('div', 'box sendBox', '<span class="bt">SEND MASTER</span>');
  const sr = h('div', 'row');
  for (let i = 1; i <= 4; i++) sr.append(knob('m.send' + i, 'send', i === 4 ? 'AUX4' : 'AUX' + i, 'blue', 0, { n: i }));
  sd.append(sr, h('span', 'bt', 'MONITOR / PHONES'));
  const mr = h('div', 'row');
  mr.append(btn('m.monSel', 'monSel', 'STEREO', 'small monsel', 0), knob('m.monLevel', 'monLevel', 'MONITOR', 'white'), knob('m.phones', 'phones', 'PHONES', 'white'));
  sd.append(mr);
  mid.append(fx, mt, sd); m.append(mid);

  // 아래: FX RTN / GROUP / STEREO 페이더
  const bot = h('div', 'mBot');
  const mk = (title, cls) => { const s = h('div', 'mstrip ' + cls, `<span class="bt">${title}</span>`); bot.append(s); return s; };
  const fr = mk('FX RTN', 'fxr');
  fr.append(knob('m.fxAux1', 'fxAux', 'AUX1', 'blue', 0, { n: 1 }), knob('m.fxAux2', 'fxAux', 'AUX2', 'blue', 0, { n: 2 }));
  fr.append(btn('m.fxOn', 'fxOn', 'ON', 'onb'), btn('m.fxPfl', 'fxPfl', 'PFL', 'pflb'));
  const fz = h('div', 'fz'), as = h('div', 'assign');
  as.append(btn('m.fxG12', 'fxG12', '1-2', 'small'), btn('m.fxG34', 'fxG34', '3-4', 'small'), btn('m.fxSt', 'fxSt', 'ST', 'small stb'));
  fz.append(as, fader('m.fxFader', 'fxFader', 'capY')); fr.append(fz);
  [['12', '1-2'], ['34', '3-4']].forEach(([k, n]) => {
    const g = mk('GROUP ' + n, 'grp'), z = h('div', 'fz'), a = h('div', 'assign');
    a.append(btn(`m.g${k}St`, 'gSt', 'ST', 'small stb', 0, { n }));
    z.append(a, fader(`m.g${k}Fader`, 'gFader', 'capB', { n })); g.append(z);
  });
  const st = mk('STEREO', 'stm'), z = h('div', 'fz'), a = h('div', 'assign');
  a.append(btn('m.stOn', 'stOn', 'ON', 'onb'));
  z.append(a, fader('m.stFader', 'stFader', 'capR')); st.append(z);
  m.append(bot);
  return m;
}
function paintFx() {
  const no = state['m.prog'] || 1, p = PROGS[no - 1];
  if (!fxDisp) return;
  fxDisp.textContent = String(no).padStart(2, '0');
  [...fxList.children].forEach((li, i) => li.classList.toggle('cur', i === no - 1));
  fxParamTxt.textContent = `${p.pname} ${p.fmt(progValue(p, state['m.param'] || 0))}`;
}

/* ---------- 장비 카드 / 연결 메뉴 ---------- */
const PALETTE = ['#ff6b6b', '#ffa94d', '#ffd43b', '#a9e34b', '#51cf66', '#38d9a9', '#3bc9db', '#4dabf7', '#748ffc', '#b197fc', '#e599f7', '#f783ac', '#ced4da'];
const devEls = {};
function buildDevices() {
  const mk = (def, i, out) => {
    const b = h('button', 'dev' + (out ? ' out' : ''), `<span class="ic">${def.icon}</span><span class="tx"><b>${def.name}</b><small>${def.sub}</small><em></em></span><span class="mt"><i></i></span>`);
    b.style.setProperty('--c', PALETTE[i % PALETTE.length]);
    b.addEventListener('click', () => (out ? menuForOutDev(def.id, b) : menuForInDev(def.id, b)));
    devEls[def.id] = { el: b, cn: b.querySelector('em'), mt: b.querySelector('.mt i'), color: PALETTE[i % PALETTE.length], lv: -100 };
    return b;
  };
  IN_DEVS.forEach((d, i) => $('#inDevs').append(mk(d, i, false)));
  OUT_DEVS.forEach((d, i) => $('#outDevs').append(mk(d, i + 3, true)));
}
const inDef = id => IN_DEVS.find(d => d.id === id), outDef = id => OUT_DEVS.find(d => d.id === id), jackDef = id => OUT_JACKS.find(j => j.id === id);
const jackName = id => { const j = jackDef(id); return (j.group + ' ' + j.label).trim(); };

function showMenu(anchor, title, items) {
  const m = $('#menu'); m.innerHTML = ''; m.append(h('div', 'mtitle', title));
  items.forEach(it => {
    const b = h('button', 'mi' + (it.cur ? ' cur' : '') + (it.danger ? ' danger' : ''), `<span>${it.label}</span><small>${it.sub || ''}</small>`);
    if (it.disabled) b.disabled = true;
    b.addEventListener('click', () => { hideMenu(); it.act(); });
    m.append(b);
  });
  m.hidden = false;
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = clamp(r.left, 8, window.innerWidth - mw - 8) + 'px';
  m.style.top = (r.bottom + mh + 8 > window.innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
}
function hideMenu() { $('#menu').hidden = true; }
document.addEventListener('pointerdown', e => { if (!e.target.closest('#menu') && !e.target.closest('.jack') && !e.target.closest('.dev')) hideMenu(); });

async function plugIn(devId, chId) {
  if (inDef(devId).real && !(await E.enableRealMic())) { alert('마이크 사용 권한이 없어서 연결하지 못했습니다. 브라우저의 마이크 권한을 허용해 주세요.'); return; }
  E.connectIn(devId, chId); refreshConn(); selectCh(chId);
}
function canPlugIn(dev, ch) { return dev.type !== 'mic' || ch.mic; }
function menuForInDev(devId, el) {
  const dev = inDef(devId), cur = E.connIn[devId];
  const items = CHANNELS.map(ch => {
    const used = E.chDevice(ch.id), ok = canPlugIn(dev, ch);
    return { label: `CH ${ch.id}`, sub: !ok ? '마이크(XLR) 단자 없음' : used === devId ? '연결됨' : used ? `${inDef(used).name} → 교체` : (ch.mic ? '비어 있음' : '비어 있음 · 라인 전용'), cur: used === devId, disabled: !ok, act: () => plugIn(devId, ch.id) };
  });
  if (cur !== undefined) items.push({ label: '케이블 뽑기', danger: true, act: () => { E.disconnectIn(devId); refreshConn(); } });
  showMenu(el, `${dev.icon} ${dev.name} → 어느 채널에 꽂을까요?` + (dev.real ? ' (스피커로 들으면 하울링 주의, 헤드폰 권장)' : ''), items);
}
function menuForChannel(chId, el) {
  const ch = CHANNELS.find(c => c.id === chId), cur = E.chDevice(chId);
  const items = IN_DEVS.map(dev => {
    const at = E.connIn[dev.id], ok = canPlugIn(dev, ch);
    return { label: `${dev.icon} ${dev.name}`, sub: !ok ? '이 채널에는 마이크 단자가 없음' : at === chId ? '연결됨' : at !== undefined ? `CH ${at}에서 옮기기` : dev.sub, cur: at === chId, disabled: !ok, act: () => plugIn(dev.id, chId) };
  });
  if (cur) items.push({ label: '케이블 뽑기', danger: true, act: () => { E.disconnectIn(cur); refreshConn(); } });
  showMenu(el, `CH ${chId} 입력에 무엇을 꽂을까요?`, items);
}
function canPlugOut(dev, jackId) { return dev.only ? dev.only.includes(jackId) : !jackDef(jackId).stereo; }
function menuForOutDev(devId, el) {
  const dev = outDef(devId), cur = E.connOut[devId];
  const items = OUT_JACKS.filter(j => canPlugOut(dev, j.id)).map(j => {
    const used = E.jackDevice(j.id);
    return { label: jackName(j.id), sub: used === devId ? '연결됨' : used ? `${outDef(used).name} → 교체` : '비어 있음', cur: used === devId, act: () => { E.connectOut(devId, j.id); refreshConn(); } };
  });
  if (cur !== undefined) items.push({ label: '케이블 뽑기', danger: true, act: () => { E.disconnectOut(devId); refreshConn(); } });
  showMenu(el, `${dev.icon} ${dev.name} ← 어느 출력 단자에 연결할까요?`, items);
}
function menuForJack(jackId, el) {
  const cur = E.jackDevice(jackId);
  const items = OUT_DEVS.filter(d => canPlugOut(d, jackId)).map(dev => {
    const at = E.connOut[dev.id];
    return { label: `${dev.icon} ${dev.name}`, sub: at === jackId ? '연결됨' : at !== undefined ? `${jackName(at)}에서 옮기기` : dev.sub, cur: at === jackId, act: () => { E.connectOut(dev.id, jackId); refreshConn(); } };
  });
  if (cur) items.push({ label: '케이블 뽑기', danger: true, act: () => { E.disconnectOut(cur); refreshConn(); } });
  showMenu(el, `${jackName(jackId)} 단자에 무엇을 연결할까요?`, items);
}
// 연결 상태를 화면에 반영
function refreshConn() {
  IN_DEVS.forEach(d => {
    const at = E.connIn[d.id], e = devEls[d.id];
    e.el.classList.toggle('conn', at !== undefined);
    const warn = d.phantom && at !== undefined && !state['m.phantom'];
    e.el.classList.toggle('warn', !!warn);
    e.cn.textContent = at === undefined ? '미연결' : `→ CH ${at}` + (warn ? ' · +48V 꺼짐!' : '');
  });
  OUT_DEVS.forEach(d => {
    const at = E.connOut[d.id], e = devEls[d.id];
    e.el.classList.toggle('conn', at !== undefined);
    e.cn.textContent = at === undefined ? '미연결' : `← ${jackName(at)}`;
  });
  CHANNELS.forEach(c => {
    const dev = E.chDevice(c.id), e = chEls[c.id];
    e.jack.textContent = dev ? inDef(dev).icon : '';
    e.jack.classList.toggle('plug', !!dev);
    e.jack.style.setProperty('--c', dev ? devEls[dev].color : 'transparent');
    e.tape.textContent = dev ? inDef(dev).name.replace(' 마이크', '').replace(' (DI 박스)', '') : (c.usb && state['ch15/16.lineusb'] ? 'USB 재생' : '');
  });
  OUT_JACKS.forEach(j => {
    const dev = E.jackDevice(j.id), b = jackEls[j.id];
    b.textContent = dev ? outDef(dev).icon : '';
    b.classList.toggle('plug', !!dev);
    b.style.setProperty('--c', dev ? devEls[dev].color : 'transparent');
  });
  updateChanHead();
}

/* ---------- 분석 패널 ---------- */
const STAGES = [['입력', 'anIn'], ['프리앰프 후', 'anHA'], ['EQ 후', 'anEQ'], ['페이더 후', 'anPost']];
const stageEls = [], busEls = {};
function buildInspector() {
  CHANNELS.forEach(c => { const o = h('option', '', 'CH ' + c.id); o.value = c.id; $('#chanSel').append(o); });
  $('#chanSel').addEventListener('change', e => selectCh(e.target.value));
  STAGES.forEach(([name]) => {
    const r = h('div', 'stg', `<span>${name}</span><div class="bar"><i></i><u></u></div><b>−∞</b>`);
    $('#stages').append(r); stageEls.push({ row: r, bar: r.querySelector('i'), txt: r.querySelector('b'), lv: -100 });
  });
  ['ST', 'G1-2', 'G3-4', 'AUX1', 'AUX2', 'AUX3', 'AUX4', 'FX'].forEach(k => {
    const r = h('div', 'bus', `<div class="bar v"><i></i></div><span>${k}</span>`);
    $('#buses').append(r); busEls[k] = { bar: r.querySelector('i'), lv: -100 };
  });
}
function selectCh(id) {
  if (selCh === id && $('#chanSel').value === id) return;
  selCh = id; $('#chanSel').value = id;
  document.querySelectorAll('.strip.sel').forEach(e => e.classList.remove('sel'));
  chEls[id].strip.classList.add('sel');
  $('#compBox').style.display = E.ch[id].def.comp ? '' : 'none';
  stageEls.forEach(s => { s.lv = -100; s.hold = -140; });
  updateChanHead();
}
function updateChanHead() {
  if (!E) return;
  const dev = E.chDevice(selCh), c = E.ch[selCh];
  $('#chanDev').innerHTML = dev ? `${inDef(dev).icon} <b>${inDef(dev).name}</b> <small>${inDef(dev).sub}</small>` : (c.def.usb && state['ch15/16.lineusb'] ? '🖥️ <b>USB 재생</b>' : '<small>연결된 장비 없음 — 단자를 눌러 장비를 꽂아 보세요</small>');
}
// dB → 막대 길이(%)  (−60 ~ +24 dB)
const barPct = d => clamp((d + 60) / 84) * 100;
const barCls = d => (d >= 17 ? 'r' : d >= 0 ? 'y' : 'g');
function decay(o, d, rate = 1.2) { o.lv = d > o.lv ? d : Math.max(d, o.lv - rate); return o.lv; }

function updateRoute() {
  const p = k => state[`ch${selCh}.${k}`], out = [];
  const pan = Math.round((p('pan') - 0.5) * 200);
  out.push(`<span class="chip">${E.ch[selCh].def.stereo ? 'BAL' : 'PAN'} ${pan === 0 ? 'C' : (pan < 0 ? 'L' : 'R') + Math.abs(pan)}</span>`);
  const on = p('on'), fd = faderDb(p('fader'));
  out.push(`<span class="chip ${on && p('st') ? 'ok' : ''}">ST ${p('st') ? '할당' : '—'}</span>`);
  [['g12', 'G1-2', '12'], ['g34', 'G3-4', '34']].forEach(([k, n, mk]) => out.push(`<span class="chip ${on && p(k) ? 'ok' : ''}">${n} ${p(k) ? '할당' + (state[`m.g${mk}St`] ? ' → ST' : ' (GROUP OUT만)') : '—'}</span>`));
  ['aux1', 'aux2', 'aux3', 'fx'].forEach((k, i) => {
    const d = knobDb(p(k)), pre = i < 2 && p('pre' + (i + 1));
    out.push(`<span class="chip ${on && d > -100 ? 'ok' : ''}">${i === 3 ? 'AUX4/FX' : 'AUX' + (i + 1)} ${dbTxt(d)} <small>${pre ? 'PRE' : 'POST'}</small></span>`);
  });
  out.push(`<span class="chip">페이더 ${dbTxt(fd)}</span>`);
  $('#route').innerHTML = out.join('');
}
function updateCheck() {
  const c = E.ch[selCh], p = k => state[`ch${selCh}.${k}`], m = k => state['m.' + k], dev = E.chDevice(selCh), items = [];
  const usbMode = c.def.usb && p('lineusb');
  items.push([power, '믹서 전원(POWER) 켜짐']);
  if (usbMode) items.push([E.connOut.pc === 'usb', 'USB 단자에 노트북 연결 (LINE/USB 스위치가 USB)']);
  else items.push([!!dev, dev ? `입력 장비 연결: ${inDef(dev).name}` : '입력 단자에 장비 연결']);
  if (dev && inDef(dev).phantom && !usbMode) items.push([!!m('phantom'), '콘덴서 마이크 → PHANTOM +48V 켜기']);
  const inLv = stageEls[0].hold, haLv = stageEls[1].hold;
  items.push([inLv > -75, E.playing ? '입력 신호 들어옴' : '입력 신호 들어옴 (▶ 연주 시작을 누르세요)']);
  if (c.def.gain) items.push([haLv > -14 && haLv < 19, haLv >= 19 ? 'GAIN이 너무 높음 — PEAK! GAIN을 내리거나 PAD를 켜세요' : haLv <= -14 ? 'GAIN 올리기 (프리앰프 후 레벨이 0 dB 근처가 되도록)' : 'GAIN 적정']);
  items.push([!!p('on'), '채널 ON 스위치']);
  items.push([p('fader') > 0.2, '채널 페이더 올리기']);
  const viaG = (p('g12') && m('g12St') && m('g12Fader') > 0.2) || (p('g34') && m('g34St') && m('g34Fader') > 0.2);
  items.push([!!p('st') || viaG, 'ST 스위치 (또는 GROUP → ST 경로)']);
  items.push([!!m('stOn'), 'STEREO ON 스위치']);
  items.push([m('stFader') > 0.2, 'STEREO 마스터 페이더 올리기']);
  items.push([!!(E.jackDevice('stL') || E.jackDevice('stR')), 'STEREO OUT에 메인 스피커 연결']);
  let blocked = false;
  $('#check').innerHTML = items.map(([ok, t]) => { const first = !ok && !blocked; if (first) blocked = true; return `<li class="${ok ? 'ok' : 'no'}${first ? ' first' : ''}">${ok ? '✔' : '✖'} ${t}${first ? ' <b>← 여기서 막힘</b>' : ''}</li>`; }).join('');
}

/* ---------- 그래프 ---------- */
const FREQS = new Float32Array(160); for (let i = 0; i < 160; i++) FREQS[i] = 20 * Math.pow(1000, i / 159);
const specBuf = new Float32Array(1024);
function drawEq() {
  const cv = $('#eqCv'), g = cv.getContext('2d'), W = cv.width, H = cv.height, c = E.ch[selCh];
  const fx = f => Math.log(f / 20) / Math.log(1000) * W, dy = d => H / 2 - d / 20 * (H / 2);
  g.clearRect(0, 0, W, H);
  // 스펙트럼
  if (power) {
    c.anEQ.getFloatFrequencyData(specBuf);
    const nyq = E.ctx.sampleRate / 2; g.beginPath(); g.moveTo(0, H);
    for (let i = 1; i < 1024; i++) { const f = i / 1024 * nyq; if (f < 20) continue; if (f > 20000) break; g.lineTo(fx(f), H - clamp((specBuf[i] + 105) / 85) * H); }
    g.lineTo(W, H); g.closePath(); g.fillStyle = 'rgba(120,180,255,.22)'; g.fill();
  }
  // 눈금
  g.strokeStyle = 'rgba(255,255,255,.1)'; g.fillStyle = 'rgba(255,255,255,.45)'; g.font = '18px sans-serif'; g.lineWidth = 1;
  [[100, '100'], [1000, '1k'], [10000, '10k']].forEach(([f, t]) => { g.beginPath(); g.moveTo(fx(f), 0); g.lineTo(fx(f), H); g.stroke(); g.fillText(t, fx(f) + 4, H - 6); });
  [-12, 0, 12].forEach(d => { g.beginPath(); g.moveTo(0, dy(d)); g.lineTo(W, dy(d)); g.stroke(); g.fillText((d > 0 ? '+' : '') + d, 4, dy(d) - 4); });
  // 곡선
  const r = E.freqResponse(c, FREQS);
  g.beginPath(); for (let i = 0; i < 160; i++) { const x = i / 159 * W, y = dy(Math.max(-22, r[i])); i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.strokeStyle = '#7CFC9A'; g.lineWidth = 4; g.stroke();
  g.lineTo(W, dy(0)); g.lineTo(0, dy(0)); g.closePath(); g.fillStyle = 'rgba(124,252,154,.14)'; g.fill();
}
function drawComp() {
  const c = E.ch[selCh]; if (!c.comp) return;
  const cv = $('#compCv'), g = cv.getContext('2d'), W = cv.width, H = cv.height, k = state[`ch${selCh}.comp`], p = E.compParams(k);
  const lo = -40, hi = 20, X = d => (d - lo) / (hi - lo) * W, Y = d => H - (d - lo) / (hi - lo) * H, thr = p.thr + 20;
  const f = d => (d <= thr ? d : thr + (d - thr) / p.ratio);
  g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(X(lo), Y(lo)); g.lineTo(X(hi), Y(hi)); g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#FFD43B'; g.lineWidth = 4; g.beginPath(); g.moveTo(X(lo), Y(f(lo))); g.lineTo(X(thr), Y(f(thr))); g.lineTo(X(hi), Y(f(hi))); g.stroke();
  const lv = clamp(stageEls[1].lv, lo, hi);
  if (power && lv > lo) { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(lv), Y(f(lv)), 7, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '17px sans-serif'; g.fillText('입력 →', W - 62, H - 8); g.fillText('출력 ↑', 6, 20);
  const gr = power ? -c.comp.reduction : 0;
  $('#grBar').firstChild.style.height = clamp(gr / 20) * 100 + '%';
  $('#grTxt').textContent = '−' + gr.toFixed(1) + ' dB';
  $('#compTxt').textContent = k < 0.01 ? '꺼짐' : `임계 ${sgn(thr)} dB · ${p.ratio.toFixed(1)}:1`;
}

/* ---------- 실시간 표시 루프 ---------- */
let frame = 0;
function loop() {
  requestAnimationFrame(loop);
  if (!E) return;
  frame++;
  const now = performance.now();
  // 채널: PEAK LED + 가상 미터
  CHANNELS.forEach(d => {
    const e = chEls[d.id], c = E.ch[d.id];
    const lv = power ? Math.max(E.peakDb(c.anEQ), E.peakDb(c.anHA)) : -140;
    if (lv >= 17) e.pk = now + 250;
    e.peak.classList.toggle('on', power && now < e.pk);
    const post = power ? E.peakDb(c.anPost) : -140;
    e.vm.style.height = barPct(decay(e, post)) + '%'; e.vm.className = barCls(e.lv);
  });
  // 마스터 미터
  [E.m.anL, E.m.anR].forEach((an, k) => {
    const o = meterSegs[k]; o.lv = decay(o, power ? E.peakDb(an) : -140, 0.9);
    o.forEach((sg, i) => sg.classList.toggle('on', o.lv >= METER_MARKS[i]));
  });
  pflLed.classList.toggle('on', power && E.pflActive() && Math.floor(now / 250) % 2 === 0);
  phLed.classList.toggle('on', power && !!state['m.phantom']);
  // 장비 카드 레벨
  IN_DEVS.forEach(d => { const e = devEls[d.id]; if (E.connIn[d.id] === undefined) { e.mt.style.width = '0'; return; } e.mt.style.width = clamp((decay(e, power ? E.peakDb(E.inDev[d.id].an) : -140, 1.5) + 70) / 80) * 100 + '%'; });
  OUT_DEVS.forEach(d => {
    const e = devEls[d.id]; if (E.connOut[d.id] === undefined) { e.mt.style.width = '0'; e.el.classList.remove('clip'); return; }
    const lv = decay(e, power ? E.peakDb(E.outDev[d.id].an) : -140, 1.5);
    e.mt.style.width = barPct(lv) + '%'; e.el.classList.toggle('clip', lv >= 19); e.el.classList.toggle('live', lv > -40);
  });
  // 선택 채널 분석
  const c = E.ch[selCh];
  STAGES.forEach(([, an], i) => {
    const s = stageEls[i], lv = decay(s, power ? E.peakDb(c[an]) : -140, 0.8);
    s.hold = Math.max(lv, (s.hold === undefined ? -140 : s.hold) - 0.06);   // 점검표용 느린 피크 홀드
    s.bar.style.width = barPct(lv) + '%'; s.bar.className = barCls(lv);
    if (frame % 6 === 0) s.txt.textContent = lv < -90 ? '−∞' : sgn(lv);
  });
  Object.keys(busEls).forEach(k => { const b = busEls[k], lv = decay(b, power ? E.peakDb(E.busAn[k]) : -140, 1); b.bar.style.height = barPct(lv) + '%'; b.bar.className = barCls(lv); });
  if (frame % 2 === 0) { drawEq(); drawComp(); }
  if (frame % 12 === 0) { updateRoute(); updateCheck(); if (lastInfo) $('#infoVal').textContent = fmt(lastInfo); if (frame % 60 === 0) refreshConn(); }
}

/* ---------- 프리셋 ---------- */
function resetControls() { Object.keys(C).forEach(id => { state[id] = C[id].def; paint(id); }); E.syncAll(); }
function unplugAll() { Object.keys(E.connIn).forEach(k => E.disconnectIn(k)); Object.keys(E.connOut).forEach(k => E.disconnectOut(k)); }
const WIRING_IN = { vox: '1', cho: '2', agt: '3', egt: '4', bass: '5', kick: '6', snr: '7', oh: '8', keys: '9/10', phone: '13/14' };
const WIRING_OUT = { mainL: 'stL', mainR: 'stR', wedge1: 'aux1', wedge2: 'aux2', boothL: 'monL', boothR: 'monR', hp: 'phones', pc: 'usb' };
function wire() {
  unplugAll();
  Object.keys(WIRING_IN).forEach(k => E.connectIn(k, WIRING_IN[k]));
  Object.keys(WIRING_OUT).forEach(k => E.connectOut(k, WIRING_OUT[k]));
}
function applyAll(obj) { Object.keys(obj).forEach(id => { if (C[id]) { state[id] = obj[id]; paint(id); } }); E.syncAll(); refreshConn(); }
function presetBand() {
  resetControls(); wire();
  const s = {}, ch = (id, o) => Object.keys(o).forEach(k => { s[`ch${id}.${k}`] = o[k]; });
  // 게인: 장비 레벨에 맞춰 프리앰프 후 피크가 0 dB 근처가 되도록
  const gainFor = (lv, pad) => clamp((-3 - lv - 16 + (pad ? 26 : 0)) / 44);
  ch('1', { gain: gainFor(-40), hpf: 1, comp: 0.35, high: 0.56, on: 1, st: 1, fader: 0.76, aux1: 0.7, pre1: 1, aux2: 0.5, pre2: 1, fx: 0.62 });
  ch('2', { gain: gainFor(-42), hpf: 1, comp: 0.3, on: 1, st: 1, fader: 0.68, pan: 0.4, aux1: 0.5, pre1: 1, aux2: 0.7, pre2: 1, fx: 0.6 });
  ch('3', { gain: gainFor(-36), hpf: 1, on: 1, st: 1, fader: 0.66, pan: 0.3, aux1: 0.5, pre1: 1, fx: 0.4, low: 0.42 });
  ch('4', { gain: gainFor(-34), hpf: 1, on: 1, st: 1, fader: 0.62, pan: 0.72, aux2: 0.5, pre2: 1, mid: 0.56 });
  ch('5', { gain: gainFor(-30), comp: 0.4, on: 1, st: 1, fader: 0.72, aux1: 0.4, pre1: 1 });
  ch('6', { gain: gainFor(-28), on: 1, g12: 1, fader: 0.75, low: 0.58 });
  ch('7', { gain: gainFor(-30), hpf: 1, on: 1, g12: 1, fader: 0.7, fx: 0.45 });
  ch('8', { gain: gainFor(-38), hpf: 1, on: 1, g12: 1, fader: 0.66, high: 0.58 });
  ch('9/10', { gain: gainFor(-2, true), on: 1, st: 1, fader: 0.66, aux1: 0.45, pre1: 1 });
  ch('13/14', { on: 0, st: 1, fader: 0.6 });
  Object.assign(s, {
    'm.phantom': 1, 'm.stOn': 1, 'm.stFader': 0.72, 'm.g12Fader': 0.75, 'm.g12St': 1,
    'm.send1': 0.7, 'm.send2': 0.7, 'm.fxOn': 1, 'm.fxSt': 1, 'm.fxFader': 0.62, 'm.fxAux1': 0.4,
    'm.prog': 1, 'm.param': 0.35, 'm.monLevel': 0.6, 'm.phones': 0.5,
  });
  applyAll(s);
  setPlay(true); selectCh('1');
}

/* ---------- 상단 바 ---------- */
async function setPower(on) {
  power = on;
  if (on) await E.ctx.resume(); else await E.ctx.suspend();
  $('#btnPower').classList.toggle('on', on); $('#btnPower').classList.remove('hint'); $('#mixer').classList.toggle('off', !on);
  pwrLed.classList.toggle('on', on);
  if (on) E.syncAll();
}
function setPlay(on) {
  E.setPlaying(on);
  $('#btnPlay').textContent = on ? '■ 연주 정지' : '▶ 연주 시작'; $('#btnPlay').classList.toggle('on', on);
}
let userZoom = false;
function fitZoom() {
  if (userZoom) return;
  const mx = $('#mixer'); mx.style.zoom = 1;
  const wide = window.innerWidth > 1100;   // 넓은 화면: 믹서 옆에 장비 선반(약 300px)을 둠
  const availH = window.innerHeight - $('#left').getBoundingClientRect().top - 26, availW = $('#left').clientWidth - (wide ? 320 : 24);
  const z = clamp(Math.min(wide ? availH / mx.offsetHeight : 9, availW / mx.offsetWidth), 0.5, 1.15);
  mx.style.zoom = z; $('#zoom').value = Math.round(z * 100);
}

function init() {
  const mx = $('#mixer');
  CHANNELS.forEach(d => mx.append(buildStrip(d)));
  mx.append(buildMaster());
  buildDevices(); buildInspector();
  E = new Engine(state);
  Object.keys(C).forEach(paint);
  E.syncAll(); refreshConn(); selCh = ''; selectCh('1');

  $('#btnPower').addEventListener('click', () => setPower(!power));
  $('#btnPlay').addEventListener('click', async () => { if (!power) await setPower(true); setPlay(!E.playing); });
  $('#listenSeg').addEventListener('click', e => {
    const b = e.target.closest('button[data-pos]'); if (!b) return;
    [...$('#listenSeg').querySelectorAll('button')].forEach(x => x.classList.toggle('on', x === b));
    E.setListen(b.dataset.pos);
  });
  $('#vol').addEventListener('input', e => E.set(E.outVol.gain, Math.pow(e.target.value / 100, 2) * 1.6));
  E.outVol.gain.value = Math.pow(0.7, 2) * 1.6;
  $('#zoom').addEventListener('input', e => { userZoom = true; mx.style.zoom = e.target.value / 100; });
  $('#btnWire').addEventListener('click', () => { resetControls(); wire(); refreshConn(); selectCh('1'); });
  $('#btnPreset').addEventListener('click', async () => { if (!power) await setPower(true); presetBand(); });
  $('#btnReset').addEventListener('click', () => { setPlay(false); unplugAll(); resetControls(); refreshConn(); });
  $('#btnHelp').addEventListener('click', () => { $('#help').hidden = false; });
  $('#helpClose').addEventListener('click', () => { $('#help').hidden = true; });
  $('#help').addEventListener('click', e => { if (e.target.id === 'help') $('#help').hidden = true; });
  window.addEventListener('resize', fitZoom);
  $('#btnPower').classList.add('hint');
  fitZoom(); loop();
}
init();
