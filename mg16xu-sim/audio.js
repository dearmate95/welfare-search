/* =========================================================
   MG16XU 학습용 시뮬레이터 - 오디오 엔진 (Web Audio API)
   - 내부 기준 레벨: REF(0.1) = 0 dB, 1.0(+20 dB)에서 클리핑
   ========================================================= */
'use strict';

const REF = 0.1;                                   // 0 dB 기준 진폭
const dB = d => Math.pow(10, d / 20);              // dB → 배율
const toDb = v => (v > 1e-7 ? 20 * Math.log10(v) : -140);
const mtof = m => 440 * Math.pow(2, (m - 69) / 12); // 미디 노트 → 주파수

// 페이더 위치(0~1) → dB (0.75 지점이 0 dB, 맨 위 +10 dB)
const FADER_TABLE = [[0, -120], [0.04, -60], [0.12, -40], [0.25, -30], [0.38, -20], [0.5, -10], [0.625, -5], [0.75, 0], [0.875, 5], [1, 10]];
// AUX/SEND 노브 위치 → dB (▼ 표시 0.7 지점이 0 dB)
const KNOB_TABLE = [[0, -120], [0.05, -50], [0.2, -30], [0.4, -15], [0.55, -6], [0.7, 0], [1, 10]];
function tableDb(tbl, p) {
  if (p <= 0.001) return -Infinity;
  for (let i = 1; i < tbl.length; i++) {
    if (p <= tbl[i][0]) {
      const [x0, y0] = tbl[i - 1], [x1, y1] = tbl[i];
      return y0 + (y1 - y0) * (p - x0) / (x1 - x0);
    }
  }
  return tbl[tbl.length - 1][1];
}
const faderDb = p => tableDb(FADER_TABLE, p);
const knobDb = p => tableDb(KNOB_TABLE, p);
const lin = d => (d === -Infinity ? 0 : dB(d));

/* ---------- 채널 구성 ---------- */
const CHANNELS = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ id: String(n), stereo: false, mic: true, pad: true, hpf: true, gain: true, comp: true })),
  { id: '9/10', stereo: true, mic: true, hpf: true, gain: true },
  { id: '11/12', stereo: true, mic: true, hpf: true, gain: true },
  { id: '13/14', stereo: true },
  { id: '15/16', stereo: true, usb: true },
];

/* ---------- 내장 이펙트 프로그램 24종 ---------- */
const sec = v => v.toFixed(2) + ' s', ms = v => Math.round(v * 1000) + ' ms', hz = v => v.toFixed(2) + ' Hz';
const PROGS = [
  ['REV HALL 1', 'rev', { min: 0.8, max: 5, pre: 0.03, bright: 0.45 }, '잔향 시간', sec],
  ['REV HALL 2', 'rev', { min: 0.8, max: 5, pre: 0.05, bright: 0.7 }, '잔향 시간', sec],
  ['REV ROOM 1', 'rev', { min: 0.2, max: 2, pre: 0.005, bright: 0.5 }, '잔향 시간', sec],
  ['REV ROOM 2', 'rev', { min: 0.2, max: 2, pre: 0.01, bright: 0.8 }, '잔향 시간', sec],
  ['REV STAGE 1', 'rev', { min: 0.5, max: 3.5, pre: 0.02, bright: 0.6 }, '잔향 시간', sec],
  ['REV STAGE 2', 'rev', { min: 0.5, max: 3.5, pre: 0.035, bright: 0.85 }, '잔향 시간', sec],
  ['REV PLATE', 'rev', { min: 0.5, max: 4, pre: 0.001, bright: 0.95 }, '잔향 시간', sec],
  ['DRUM AMB', 'rev', { min: 0.1, max: 1, pre: 0.002, bright: 0.75 }, '잔향 시간', sec],
  ['EARLY REF', 'rev', { min: 0.04, max: 0.3, pre: 0.005, bright: 1, early: true }, '공간 크기', ms],
  ['GATE REV', 'rev', { min: 0.08, max: 0.6, pre: 0.005, bright: 0.8, gate: true }, '공간 크기', ms],
  ['SINGLE DLY', 'dly', { min: 0.03, max: 1, fb: 0, lp: 9000 }, '딜레이 타임', ms],
  ['DELAY', 'dly', { min: 0.03, max: 1, fb: 0.45, lp: 7000 }, '딜레이 타임', ms],
  ['VOCAL ECHO', 'dly', { min: 0.08, max: 0.6, fb: 0.5, lp: 3500 }, '딜레이 타임', ms],
  ['KARAOKE', 'dly', { min: 0.06, max: 0.35, fb: 0.38, lp: 2600 }, '딜레이 타임', ms],
  ['PHASER', 'phaser', { min: 0.1, max: 6 }, 'LFO 속도', hz],
  ['FLANGER', 'mod', { min: 0.1, max: 5, base: 0.003, depth: 0.002, fb: 0.6, voices: 1 }, 'LFO 속도', hz],
  ['CHORUS 1', 'mod', { min: 0.2, max: 5, base: 0.018, depth: 0.004, fb: 0, voices: 1 }, 'LFO 속도', hz],
  ['CHORUS 2', 'mod', { min: 0.2, max: 5, base: 0.022, depth: 0.006, fb: 0, voices: 2 }, 'LFO 속도', hz],
  ['SYMPHONIC', 'mod', { min: 0.1, max: 3, base: 0.025, depth: 0.007, fb: 0, voices: 3 }, 'LFO 깊이/속도', hz],
  ['TREMOLO', 'trem', { min: 1, max: 15 }, 'LFO 속도', hz],
  ['AUTO WAH', 'wah', { min: 0.3, max: 6 }, 'LFO 속도', hz],
  ['RADIO VOICE', 'radio', { min: 300, max: 1500 }, '컷오프 오프셋', v => Math.round(v) + ' Hz'],
  ['DISTORTION', 'dist', { min: 1, max: 40 }, '드라이브', v => '×' + v.toFixed(1)],
  ['PITCH CHANGE', 'pitch', { min: -12, max: 12 }, '피치', v => (v >= 0 ? '+' : '') + v.toFixed(1) + ' 반음'],
].map(([name, type, cfg, pname, fmt], i) => ({ no: i + 1, name, type, cfg, pname, fmt }));
const progValue = (prog, p) => prog.cfg.min + (prog.cfg.max - prog.cfg.min) * p;

/* ---------- 가상 입력 장비(음원) ---------- */
// level: 0 dB(REF) 기준 출력 레벨. 마이크는 매우 작고(-40 dB 안팎), 라인은 크다.
const IN_DEVS = [
  { id: 'vox', name: '보컬 마이크', sub: '다이내믹', icon: '🎤', type: 'mic', level: -40, norm: 1.7 },
  { id: 'cho', name: '코러스 마이크', sub: '다이내믹', icon: '🎙️', type: 'mic', level: -42, norm: 1.75 },
  { id: 'agt', name: '통기타 마이크', sub: '콘덴서 · +48V 필요', icon: '🪕', type: 'mic', phantom: true, level: -36, norm: 1.85 },
  { id: 'egt', name: '일렉기타 앰프 마이크', sub: '다이내믹', icon: '🎸', type: 'mic', level: -34, norm: 0.43 },
  { id: 'bass', name: '베이스 (DI 박스)', sub: '마이크 레벨', icon: '🎻', type: 'mic', level: -30, norm: 1.5 },
  { id: 'kick', name: '킥 드럼 마이크', sub: '다이내믹', icon: '🥁', type: 'mic', level: -28, norm: 0.9 },
  { id: 'snr', name: '스네어 마이크', sub: '다이내믹', icon: '🪘', type: 'mic', level: -30, norm: 1.15 },
  { id: 'oh', name: '오버헤드 마이크', sub: '콘덴서 · +48V 필요', icon: '🎚️', type: 'mic', phantom: true, level: -38, norm: 1.0 },
  { id: 'keys', name: '키보드', sub: '스테레오 라인', icon: '🎹', type: 'line', stereo: true, level: -2, norm: 1.3 },
  { id: 'phone', name: '스마트폰 반주(MR)', sub: '스테레오 라인', icon: '📱', type: 'line', stereo: true, level: -6, norm: 1.05 },
  { id: 'tone', name: '테스트 톤 1 kHz', sub: '라인 · 0 dB', icon: '〰️', type: 'line', level: 0, norm: 0.707 },
  { id: 'pink', name: '핑크 노이즈', sub: '라인', icon: '🌫️', type: 'line', level: -6, norm: 0.46 },
  { id: 'real', name: '내 컴퓨터 마이크', sub: '실제 마이크 입력', icon: '💻', type: 'mic', level: -40, norm: 1, real: true },
];

/* ---------- 가상 출력 장비 ---------- */
// zone: house(객석) / stage(무대) / booth(조정석) / phones(헤드폰) / rec(USB 녹음)
const OUT_DEVS = [
  { id: 'mainL', name: '메인 스피커 L', sub: '파워드', icon: '🔊', zone: 'house' },
  { id: 'mainR', name: '메인 스피커 R', sub: '파워드', icon: '🔊', zone: 'house' },
  { id: 'sub', name: '서브우퍼', sub: '파워드 · 저음 전용', icon: '📦', zone: 'house', lowpass: 110 },
  { id: 'wedge1', name: '모니터 스피커 1', sub: '무대 웨지', icon: '📐', zone: 'stage' },
  { id: 'wedge2', name: '모니터 스피커 2', sub: '무대 웨지', icon: '📐', zone: 'stage' },
  { id: 'wedge3', name: '모니터 스피커 3', sub: '무대 웨지', icon: '📐', zone: 'stage' },
  { id: 'boothL', name: '조정석 모니터 L', sub: '니어필드', icon: '🔈', zone: 'booth' },
  { id: 'boothR', name: '조정석 모니터 R', sub: '니어필드', icon: '🔈', zone: 'booth' },
  { id: 'hp', name: '헤드폰', sub: 'PHONES 전용', icon: '🎧', zone: 'phones', only: ['phones'], stereo: true },
  { id: 'pc', name: '노트북 (USB)', sub: '녹음 + 재생', icon: '🖥️', zone: 'rec', only: ['usb'], stereo: true },
];

/* ---------- 출력 단자 ---------- */
const OUT_JACKS = [
  { id: 'stL', label: 'L', group: 'STEREO OUT', pan: -0.85 },
  { id: 'stR', label: 'R', group: 'STEREO OUT', pan: 0.85 },
  { id: 'monL', label: 'L', group: 'MONITOR OUT', pan: -0.6 },
  { id: 'monR', label: 'R', group: 'MONITOR OUT', pan: 0.6 },
  { id: 'grp1', label: '1', group: 'GROUP OUT', pan: 0 },
  { id: 'grp2', label: '2', group: 'GROUP OUT', pan: 0 },
  { id: 'grp3', label: '3', group: 'GROUP OUT', pan: 0 },
  { id: 'grp4', label: '4', group: 'GROUP OUT', pan: 0 },
  { id: 'aux1', label: '1', group: 'AUX SEND', pan: -0.3 },
  { id: 'aux2', label: '2', group: 'AUX SEND', pan: 0.3 },
  { id: 'aux3', label: '3', group: 'AUX SEND', pan: 0 },
  { id: 'aux4', label: '4', group: 'AUX SEND', pan: 0 },
  { id: 'phones', label: '', group: 'PHONES', stereo: true },
  { id: 'usb', label: '', group: 'USB 2.0', stereo: true },
];

// 듣는 위치별로 각 구역 스피커가 얼마나 들리는지
const LISTEN = {
  house: { house: 1, stage: 0.2, booth: 0, phones: 0, rec: 0 },
  stage: { house: 0.22, stage: 1, booth: 0, phones: 0, rec: 0 },
  booth: { house: 0.1, stage: 0, booth: 1, phones: 0, rec: 0 },
  phones: { house: 0, stage: 0, booth: 0, phones: 1, rec: 0 },
  rec: { house: 0, stage: 0, booth: 0, phones: 0, rec: 1 },
};

/* 곡 데이터: 4마디 반복 (C - G - Am - F), 16분음표 64스텝 */
const SONG = {
  bpm: 96,
  chords: [[48, 52, 55, 60], [43, 50, 55, 59], [45, 52, 57, 60], [41, 48, 53, 57]],
  bass: [36, 31, 33, 29],
  lead: [[0, 6, 64], [6, 4, 67], [10, 6, 72], [16, 6, 71], [22, 4, 67], [26, 6, 62], [32, 6, 64], [38, 4, 69], [42, 6, 72], [48, 8, 69], [56, 7, 65]],
  harm: [[0, 14, 67], [16, 14, 62], [32, 14, 64], [48, 14, 60]],
};

class Engine {
  constructor(state) {
    this.state = state;            // UI와 공유하는 컨트롤 값
    this.playing = false;
    this.listen = 'house';
    this.patch = {};               // 채널 id → 입력 장비 인스턴스 (같은 장비를 여러 채널에 꽂을 수 있음)
    this.connOut = {};             // 출력 장비 id → 단자 id
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.buf = new Float32Array(2048);
    this._mkNoise();
    this._mkBuses();
    this.ch = {};
    CHANNELS.forEach(def => { this.ch[def.id] = this._mkChannel(def); });
    this._mkFx();
    this._mkMaster();
    this._mkDevices();
    this.syncAll();
  }

  /* ---------- 노드 생성 도우미 ---------- */
  gain(v = 1, channels = 0) {
    const g = this.ctx.createGain(); g.gain.value = v;
    if (channels) { g.channelCount = channels; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; }
    return g;
  }
  analyser(size = 2048) { const a = this.ctx.createAnalyser(); a.fftSize = size; a.smoothingTimeConstant = 0.75; return a; }
  // 파라미터를 부드럽게 변경 (전원이 꺼져 있을 때는 즉시 반영)
  set(param, v) {
    if (this.ctx.state === 'running') param.setTargetAtTime(v, this.ctx.currentTime, 0.012);
    else param.value = v;
  }
  // 분석기에서 피크 레벨(dB, REF 기준)
  peakDb(an) {
    const b = this.buf; an.getFloatTimeDomainData(b);
    let m = 0; const n = Math.min(b.length, an.fftSize);
    for (let i = 0; i < n; i++) { const v = b[i] < 0 ? -b[i] : b[i]; if (v > m) m = v; }
    return toDb(m / REF);
  }

  _mkNoise() {
    const ctx = this.ctx, n = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // 핑크 노이즈 (Paul Kellet 필터)
    this.pink = ctx.createBuffer(1, n, ctx.sampleRate);
    const p = this.pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.16; b6 = w * 0.115926;
    }
  }

  _mkBuses() {
    this.stBus = this.gain(1, 2);
    this.g12Bus = this.gain(1, 2);
    this.g34Bus = this.gain(1, 2);
    this.auxBus = [0, 1, 2, 3].map(() => this.gain(1, 1));
    this.pflBus = this.gain(1, 2);
    // 하드 클리핑 곡선 (입력이 ±1을 넘으면 잘림)
    this.clipCurve = new Float32Array([-1, 1]);
  }

  /* ---------- 채널 스트립 ---------- */
  _mkChannel(def) {
    const ctx = this.ctx, c = { def, srcType: null };
    c.in = this.gain(1, def.stereo ? 2 : 1);
    if (def.usb) {                 // CH15/16: LINE 단자와 USB 재생 중 선택
      c.lineIn = this.gain(1, 2); c.usbIn = this.gain(0, 2);
      c.lineIn.connect(c.in); c.usbIn.connect(c.in);
    }
    c.jackIn = def.usb ? c.lineIn : c.in;
    c.ha = this.gain(1);                                   // 헤드앰프(PAD + GAIN)
    c.hpf = ctx.createBiquadFilter(); c.hpf.type = 'highpass'; c.hpf.Q.value = 0.707; c.hpf.frequency.value = 5;
    c.clip = ctx.createWaveShaper(); c.clip.curve = this.clipCurve;
    c.in.connect(c.ha); c.ha.connect(c.hpf); c.hpf.connect(c.clip);
    let last = c.clip;
    if (def.comp) {
      c.comp = ctx.createDynamicsCompressor();
      c.comp.knee.value = 6; c.comp.attack.value = 0.02; c.comp.release.value = 0.3; c.comp.ratio.value = 1; c.comp.threshold.value = 0;
      last.connect(c.comp); last = c.comp;
    }
    c.eqL = ctx.createBiquadFilter(); c.eqL.type = 'lowshelf'; c.eqL.frequency.value = 100;
    c.eqM = ctx.createBiquadFilter(); c.eqM.type = 'peaking'; c.eqM.frequency.value = 2500; c.eqM.Q.value = 0.9;
    c.eqH = ctx.createBiquadFilter(); c.eqH.type = 'highshelf'; c.eqH.frequency.value = 10000;
    last.connect(c.eqL); c.eqL.connect(c.eqM); c.eqM.connect(c.eqH);
    // 구간별 레벨 측정용 분석기
    c.anIn = this.analyser(1024); c.in.connect(c.anIn);
    c.anHA = this.analyser(1024); c.clip.connect(c.anHA);
    c.anEQ = this.analyser(2048); c.eqH.connect(c.anEQ);
    // PFL(페이더 전 청취), ON, 페이더, 팬
    c.pfl = this.gain(0); c.eqH.connect(c.pfl); c.pfl.connect(this.pflBus);
    c.on = this.gain(0); c.eqH.connect(c.on);
    c.fader = this.gain(0); c.on.connect(c.fader);
    c.anPost = this.analyser(1024); c.fader.connect(c.anPost);
    c.pan = ctx.createStereoPanner(); c.fader.connect(c.pan);
    c.toST = this.gain(0); c.toG12 = this.gain(0); c.toG34 = this.gain(0);
    c.pan.connect(c.toST); c.toST.connect(this.stBus);
    c.pan.connect(c.toG12); c.toG12.connect(this.g12Bus);
    c.pan.connect(c.toG34); c.toG34.connect(this.g34Bus);
    // AUX 센드: 프리(페이더 전) / 포스트(페이더 후) 두 경로를 만들어 두고 스위치로 선택
    c.auxPre = []; c.auxPost = [];
    for (let i = 0; i < 4; i++) {
      const pre = this.gain(0), post = this.gain(0);
      c.on.connect(pre); pre.connect(this.auxBus[i]);
      c.fader.connect(post); post.connect(this.auxBus[i]);
      c.auxPre.push(pre); c.auxPost.push(post);
    }
    return c;
  }

  /* ---------- 마스터 섹션 ---------- */
  _mkMaster() {
    const ctx = this.ctx, m = this.m = {};
    // STEREO 버스 → ON → 마스터 페이더 → 클립 → 출력
    m.stOn = this.gain(0); m.stFader = this.gain(0);
    m.stClip = ctx.createWaveShaper(); m.stClip.curve = this.clipCurve;
    m.stOut = this.gain(1, 2);
    this.stBus.connect(m.stOn); m.stOn.connect(m.stFader); m.stFader.connect(m.stClip); m.stClip.connect(m.stOut);
    // GROUP 버스
    m.g12Fader = this.gain(0); m.g12Out = this.gain(1, 2); m.g12ToSt = this.gain(0);
    this.g12Bus.connect(m.g12Fader); m.g12Fader.connect(m.g12Out); m.g12Out.connect(m.g12ToSt); m.g12ToSt.connect(this.stBus);
    m.g34Fader = this.gain(0); m.g34Out = this.gain(1, 2); m.g34ToSt = this.gain(0);
    this.g34Bus.connect(m.g34Fader); m.g34Fader.connect(m.g34Out); m.g34Out.connect(m.g34ToSt); m.g34ToSt.connect(this.stBus);
    // AUX SEND 마스터
    m.auxMaster = []; m.auxOut = [];
    for (let i = 0; i < 4; i++) {
      const mg = this.gain(0), out = this.gain(1, 1);
      this.auxBus[i].connect(mg); mg.connect(out);
      m.auxMaster.push(mg); m.auxOut.push(out);
    }
    // FX 리턴: 내장 이펙터 출력 → ON → (PFL / AUX1,2 / 페이더 → 버스)
    m.fxOn = this.gain(0); m.fxRet = this.gain(1, 2);
    this.fx.output.connect(m.fxOn); m.fxOn.connect(m.fxRet);
    m.fxPfl = this.gain(0); m.fxRet.connect(m.fxPfl); m.fxPfl.connect(this.pflBus);
    m.fxFader = this.gain(0); m.fxRet.connect(m.fxFader);
    m.fxToST = this.gain(0); m.fxToG12 = this.gain(0); m.fxToG34 = this.gain(0);
    m.fxFader.connect(m.fxToST); m.fxToST.connect(this.stBus);
    m.fxFader.connect(m.fxToG12); m.fxToG12.connect(this.g12Bus);
    m.fxFader.connect(m.fxToG34); m.fxToG34.connect(this.g34Bus);
    m.fxAux = [this.gain(0), this.gain(0)];
    m.fxAux.forEach((g, i) => { m.fxRet.connect(g); g.connect(this.auxBus[i]); });
    // 모니터: 선택한 버스 또는 PFL
    m.monST = this.gain(1); m.monG12 = this.gain(0); m.monG34 = this.gain(0);
    m.monMix = this.gain(1, 2); m.monNorm = this.gain(1); m.pflGate = this.gain(0); m.monSum = this.gain(1, 2);
    m.stOut.connect(m.monST); m.g12Out.connect(m.monG12); m.g34Out.connect(m.monG34);
    [m.monST, m.monG12, m.monG34].forEach(g => g.connect(m.monMix));
    m.monMix.connect(m.monNorm); m.monNorm.connect(m.monSum);
    this.pflBus.connect(m.pflGate); m.pflGate.connect(m.monSum);
    m.monLevel = this.gain(0); m.monOut = this.gain(1, 2); m.monSum.connect(m.monLevel); m.monLevel.connect(m.monOut);
    m.phLevel = this.gain(0); m.phOut = this.gain(1, 2); m.monSum.connect(m.phLevel); m.phLevel.connect(m.phOut);
    // 레벨 미터(L/R)
    const ms = ctx.createChannelSplitter(2); m.monSum.connect(ms);
    m.anL = this.analyser(1024); m.anR = this.analyser(1024); ms.connect(m.anL, 0); ms.connect(m.anR, 1);
    // 출력 단자 노드
    const J = this.jack = {};
    const split = (src, a, b) => { const s = ctx.createChannelSplitter(2); src.connect(s); J[a] = this.gain(1, 1); J[b] = this.gain(1, 1); s.connect(J[a], 0); s.connect(J[b], 1); };
    split(m.stOut, 'stL', 'stR'); split(m.monOut, 'monL', 'monR');
    split(m.g12Out, 'grp1', 'grp2'); split(m.g34Out, 'grp3', 'grp4');
    for (let i = 0; i < 4; i++) { J['aux' + (i + 1)] = this.gain(1, 1); m.auxOut[i].connect(J['aux' + (i + 1)]); }
    J.phones = this.gain(1, 2); m.phOut.connect(J.phones);
    J.usb = this.gain(1, 2); m.stOut.connect(J.usb);
    // 버스 미터용 분석기
    this.busAn = {};
    const tap = (k, node) => { const a = this.analyser(1024); node.connect(a); this.busAn[k] = a; };
    tap('ST', m.stOut); tap('G1-2', m.g12Out); tap('G3-4', m.g34Out);
    for (let i = 0; i < 4; i++) tap('AUX' + (i + 1), m.auxOut[i]);
    tap('FX', m.fxFader);
    // 청취(컴퓨터 스피커) 출력: 리미터로 보호
    this.listenBus = this.gain(2.2, 2);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 2; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.15;
    this.outVol = this.gain(0.8);
    this.listenBus.connect(limiter); limiter.connect(this.outVol); this.outVol.connect(ctx.destination);
  }

  /* ---------- 장비 ---------- */
  _mkDevices() {
    const ctx = this.ctx;
    this.outDev = {};
    // 여러 채널이 함께 쓰는 공용 음원 (테스트 톤, 핑크 노이즈, 실제 마이크)
    const o = ctx.createOscillator(); o.frequency.value = 1000; this.toneSrc = this.gain(1.414); o.connect(this.toneSrc); o.start();
    const s = ctx.createBufferSource(); s.buffer = this.pink; s.loop = true; this.pinkSrc = this.gain(2); s.connect(this.pinkSrc); s.start();
    this.realSrc = this.gain(8);
    OUT_DEVS.forEach(def => {
      const d = { def, in: this.gain(1, def.stereo ? 2 : 1), zone: this.gain(0) };
      d.an = this.analyser(1024); d.in.connect(d.an);
      let n = d.in;
      if (def.lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = def.lowpass; f.Q.value = 0.8; n.connect(f); n = f; }
      if (!def.stereo) { d.pan = ctx.createStereoPanner(); n.connect(d.pan); n = d.pan; }
      n.connect(d.zone); d.zone.connect(this.listenBus);
      this.outDev[def.id] = d;
    });
    // 노트북 USB 재생 음원 (CH15/16의 USB 입력으로 들어감)
    this.usbPlay = this.gain(REF * dB(-4), 2);
    this.usbPlay.connect(this.ch['15/16'].usbIn);
    this.usbGate = this.gain(0, 2); this.usbGate.connect(this.usbPlay);
    this.setListen(this.listen);
  }

  // 입력 장비 인스턴스 1개 생성 (채널에 꽂을 때마다 새로 만듦)
  _mkInst(def) {
    const d = { def, bus: this.gain(1, def.stereo ? 2 : 1), ph: this.gain(def.phantom ? 0 : 1), out: this.gain(REF * dB(def.level) * def.norm) };
    d.vin = d.bus;
    d.bus.connect(d.ph); d.ph.connect(d.out);
    d.an = this.analyser(1024); d.out.connect(d.an);
    this._mkVoiceChain(d);
    return d;
  }

  // 장비별 고정 음색 체인 (보컬 포먼트, 기타 디스토션 등)
  _mkVoiceChain(d) {
    const ctx = this.ctx, id = d.def.id;
    const bp = (f, q, g) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; const o = this.gain(g); b.connect(o); o.connect(d.bus); return b; };
    if (id === 'vox' || id === 'cho') {
      d.vin = this.gain(1);
      const fm = id === 'vox' ? [[780, 7, 1], [1180, 8, 0.6], [2850, 9, 0.35]] : [[600, 7, 1], [1000, 8, 0.5], [2600, 9, 0.3]];
      fm.forEach(([f, q, g]) => d.vin.connect(bp(f, q, g * 3)));
      const air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 500; const ag = this.gain(0.5);
      d.vin.connect(air); air.connect(ag); ag.connect(d.bus);   // 몸통 저역
    } else if (id === 'egt') {
      d.vin = this.gain(3);
      const sh = ctx.createWaveShaper(); const cv = new Float32Array(257);
      for (let i = 0; i < 257; i++) cv[i] = Math.tanh((i / 128 - 1) * 3);
      sh.curve = cv;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200;
      const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = 110;
      d.vin.connect(sh); sh.connect(f); f.connect(h); h.connect(d.bus);
    } else if (id === 'tone') { d.shared = this.toneSrc; }
    else if (id === 'pink') { d.shared = this.pinkSrc; }
    else if (id === 'real') { d.shared = this.realSrc; }
    if (d.shared) d.shared.connect(d.bus);
  }

  async enableRealMic() {
    if (this.realStream) return true;
    try {
      this.realStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      this.ctx.createMediaStreamSource(this.realStream).connect(this.realSrc);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 케이블 연결 ---------- */
  // 채널에 장비를 꽂음 (그 채널에 있던 장비는 뽑힘, 같은 장비는 다른 채널에도 계속 꽂혀 있음)
  connectIn(devId, chId) {
    this.disconnectCh(chId, true);
    const d = this._mkInst(IN_DEVS.find(x => x.id === devId)), c = this.ch[chId];
    d.out.connect(c.jackIn); this.patch[chId] = d; c.srcType = d.def.type;
    this.syncAll();
  }
  disconnectCh(chId, quiet) {
    const d = this.patch[chId]; if (!d) return;
    try { d.out.disconnect(); } catch (e) { /* 이미 분리됨 */ }
    if (d.shared) { try { d.shared.disconnect(d.bus); } catch (e) { /* 무시 */ } }
    delete this.patch[chId]; this.ch[chId].srcType = null;
    if (!quiet) this.syncAll();
  }
  // 이 장비가 꽂힌 채널 목록 (채널 순서대로)
  devChannels(devId) { return CHANNELS.map(c => c.id).filter(id => this.patch[id] && this.patch[id].def.id === devId); }
  // 같은 장비 중 몇 번째인지 (0부터)
  variant(chId) { const d = this.patch[chId]; return d ? this.devChannels(d.def.id).indexOf(chId) : 0; }
  connectOut(devId, jackId) {
    this.disconnectOut(devId);
    Object.keys(this.connOut).forEach(k => { if (this.connOut[k] === jackId) this.disconnectOut(k); });
    const d = this.outDev[devId];
    this.jack[jackId].connect(d.in); this.connOut[devId] = jackId;
    if (d.pan) d.pan.pan.value = (OUT_JACKS.find(j => j.id === jackId) || {}).pan || 0;
    this.syncAll();
  }
  disconnectOut(devId) {
    const jackId = this.connOut[devId]; if (jackId === undefined) return;
    try { this.jack[jackId].disconnect(this.outDev[devId].in); } catch (e) { /* 이미 분리됨 */ }
    delete this.connOut[devId];
    this.syncAll();
  }
  chDevice(chId) { return this.patch[chId] ? this.patch[chId].def.id : undefined; }
  jackDevice(jackId) { return Object.keys(this.connOut).find(k => this.connOut[k] === jackId); }

  setListen(pos) {
    this.listen = pos;
    OUT_DEVS.forEach(def => this.set(this.outDev[def.id].zone.gain, LISTEN[pos][def.zone]));
  }

  /* ---------- 컨트롤 값 → 오디오 파라미터 ---------- */
  chGainDb(c) {                    // 헤드앰프 총 게인(dB)
    const id = c.def.id, s = this.state;
    if (!c.def.gain) return 0;
    let g = 16 + 44 * s[`ch${id}.gain`];
    if (c.def.pad && s[`ch${id}.pad`]) g -= 26;
    if (!c.def.pad && c.srcType === 'line') g -= 26;   // 9/10, 11/12의 LINE 단자는 감도가 26 dB 낮음
    return g;
  }
  compParams(k) { return { thr: Math.min(0, 2 - 30 * k), ratio: 1 + 3 * k }; }  // 임계값은 dBFS
  syncCh(c) {
    const s = this.state, id = c.def.id, v = k => s[`ch${id}.${k}`] || 0;
    this.set(c.ha.gain, dB(this.chGainDb(c)));
    this.set(c.hpf.frequency, c.def.hpf && v('hpf') ? 80 : 5);
    if (c.comp) { const p = this.compParams(v('comp')); this.set(c.comp.threshold, p.thr); this.set(c.comp.ratio, p.ratio); }
    this.set(c.eqL.gain, (v('low') - 0.5) * 30);
    this.set(c.eqM.gain, (v('mid') - 0.5) * 30);
    this.set(c.eqH.gain, (v('high') - 0.5) * 30);
    this.set(c.eqM.frequency, c.def.stereo ? 2500 : 250 * Math.pow(20, v('midf')));
    this.set(c.pfl.gain, v('pfl') ? 1 : 0);
    this.set(c.on.gain, v('on') ? 1 : 0);
    this.set(c.fader.gain, lin(faderDb(v('fader'))));
    this.set(c.pan.pan, (v('pan') - 0.5) * 2);
    this.set(c.toST.gain, v('st') ? 1 : 0);
    this.set(c.toG12.gain, v('g12') ? 1 : 0);
    this.set(c.toG34.gain, v('g34') ? 1 : 0);
    ['aux1', 'aux2', 'aux3', 'fx'].forEach((k, i) => {
      const lv = lin(knobDb(v(k))), pre = i < 2 && v('pre' + (i + 1));
      this.set(c.auxPre[i].gain, pre ? lv : 0); this.set(c.auxPost[i].gain, pre ? 0 : lv);
    });
    if (c.def.usb) { this.set(c.lineIn.gain, v('lineusb') ? 0 : 1); this.set(c.usbIn.gain, v('lineusb') ? 1 : 0); }
  }
  pflActive() { const s = this.state; return CHANNELS.some(d => s[`ch${d.id}.pfl`]) || !!s['m.fxPfl']; }
  syncMaster() {
    const s = this.state, m = this.m, v = k => s['m.' + k] || 0;
    this.set(m.stOn.gain, v('stOn') ? 1 : 0);
    this.set(m.stFader.gain, lin(faderDb(v('stFader'))));
    this.set(m.g12Fader.gain, lin(faderDb(v('g12Fader')))); this.set(m.g12ToSt.gain, v('g12St') ? 1 : 0);
    this.set(m.g34Fader.gain, lin(faderDb(v('g34Fader')))); this.set(m.g34ToSt.gain, v('g34St') ? 1 : 0);
    for (let i = 0; i < 4; i++) this.set(m.auxMaster[i].gain, lin(knobDb(v('send' + (i + 1)))));
    this.set(m.fxOn.gain, v('fxOn') ? 1 : 0);
    this.set(m.fxPfl.gain, v('fxPfl') ? 1 : 0);
    this.set(m.fxFader.gain, lin(faderDb(v('fxFader'))));
    this.set(m.fxToST.gain, v('fxSt') ? 1 : 0); this.set(m.fxToG12.gain, v('fxG12') ? 1 : 0); this.set(m.fxToG34.gain, v('fxG34') ? 1 : 0);
    this.set(m.fxAux[0].gain, lin(knobDb(v('fxAux1')))); this.set(m.fxAux[1].gain, lin(knobDb(v('fxAux2'))));
    const sel = v('monSel');
    this.set(m.monST.gain, sel === 0 ? 1 : 0); this.set(m.monG12.gain, sel === 1 ? 1 : 0); this.set(m.monG34.gain, sel === 2 ? 1 : 0);
    const pfl = this.pflActive();
    this.set(m.monNorm.gain, pfl ? 0 : 1); this.set(m.pflGate.gain, pfl ? 1 : 0);
    this.set(m.monLevel.gain, v('monLevel')); this.set(m.phLevel.gain, v('phones'));
    // 팬텀 전원: 콘덴서 마이크는 +48V가 켜져 있고 마이크 입력 채널에 꽂혀 있어야 소리가 남
    Object.keys(this.patch).forEach(chId => {
      const d = this.patch[chId]; if (!d.def.phantom) return;
      this.set(d.ph.gain, v('phantom') && this.ch[chId].def.mic ? 1 : 0);
    });
    this.set(this.usbGate.gain, this.connOut.pc === 'usb' ? 1 : 0);
    this.fx.set(v('prog') || 1, v('param'));
  }
  syncAll() { CHANNELS.forEach(d => this.syncCh(this.ch[d.id])); this.syncMaster(); }

  // EQ + HPF 주파수 응답(dB)
  freqResponse(c, freqs) {
    const n = freqs.length, mag = new Float32Array(n), ph = new Float32Array(n), out = new Float32Array(n).fill(1);
    [c.hpf, c.eqL, c.eqM, c.eqH].forEach(f => { f.getFrequencyResponse(freqs, mag, ph); for (let i = 0; i < n; i++) out[i] *= mag[i]; });
    for (let i = 0; i < n; i++) out[i] = toDb(out[i]);
    return out;
  }

  /* ---------- 내장 이펙터 ---------- */
  _mkFx() { this.fx = new FxUnit(this); this.auxBus[3].connect(this.fx.input); }

  /* ---------- 시퀀서(가상 연주자) ---------- */
  setPlaying(on) {
    this.playing = on;
    clearInterval(this.timer);
    if (!on) return;
    this.step = 0; this.nextT = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this._tick(), 25);
  }
  _tick() {
    if (this.ctx.state !== 'running') { this.nextT = this.ctx.currentTime + 0.08; return; }
    const sd = 60 / SONG.bpm / 4;
    if (this.nextT < this.ctx.currentTime) this.nextT = this.ctx.currentTime + 0.02;   // 탭이 백그라운드였을 때 보정
    while (this.nextT < this.ctx.currentTime + 0.12) {
      const st = this.step, t = this.nextT;
      Object.keys(this.patch).forEach(chId => this._play(this.patch[chId].def.id, this.patch[chId].vin, st, t, sd, 1, this.variant(chId)));
      if (this.connOut.pc === 'usb') this._play('phone', this.usbGate, st, t, sd, 1);
      this.step = (st + 1) % 64; this.nextT += sd;
    }
  }
  _env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  _osc(type, f, t, dur, dest, detune) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; if (detune) o.detune.value = detune; o.connect(dest); o.start(t); o.stop(t + dur + 0.05); return o; }
  _noise(dest, t, dur, peak, ftype, f, q) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise;
    const fl = ctx.createBiquadFilter(); fl.type = ftype; fl.frequency.value = f; fl.Q.value = q || 0.7;
    const g = ctx.createGain(); this._env(g, t, 0.001, peak, dur);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  vKick(dest, t, v) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.36);
    this._noise(dest, t, 0.015, v * 0.3, 'lowpass', 3000);
  }
  vSnare(dest, t, v) {
    this._noise(dest, t, 0.17, v * 0.9, 'bandpass', 2200, 0.6);
    const g = this.ctx.createGain(); this._env(g, t, 0.001, v * 0.5, 0.09); g.connect(dest);
    const o = this._osc('triangle', 200, t, 0.12, g); o.frequency.exponentialRampToValueAtTime(150, t + 0.1);
  }
  vHat(dest, t, v, open) { this._noise(dest, t, open ? 0.22 : 0.045, v, 'highpass', 7500); }
  vBass(dest, t, m, dur, v) {
    const ctx = this.ctx, f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = ctx.createGain(); this._env(g, t, 0.005, v, dur * 1.3); f.connect(g); g.connect(dest);
    this._osc('sawtooth', mtof(m), t, dur * 1.4, f); this._osc('sine', mtof(m), t, dur * 1.4, f);
  }
  vKeys(dest, t, notes, dur, v) {
    notes.forEach((m, i) => {
      const ctx = this.ctx, g = ctx.createGain(), p = ctx.createStereoPanner(); p.pan.value = -0.6 + 1.2 * i / (notes.length - 1);
      this._env(g, t, 0.006, v, dur); g.connect(p); p.connect(dest);
      this._osc('sine', mtof(m + 12), t, dur, g);
      const g2 = ctx.createGain(); g2.gain.value = 0.3; g2.connect(g); this._osc('triangle', mtof(m + 24), t, dur, g2, 4);
    });
  }
  vStrum(dest, t, notes, v, up) {
    const seq = up ? notes.slice().reverse() : notes;
    seq.forEach((m, i) => {
      const ctx = this.ctx, tt = t + i * 0.012, f = ctx.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(6000, tt); f.frequency.exponentialRampToValueAtTime(900, tt + 0.5);
      const g = ctx.createGain(); this._env(g, tt, 0.002, v, 0.55); f.connect(g); g.connect(dest);
      this._osc('sawtooth', mtof(m + 12), tt, 0.6, f); this._osc('triangle', mtof(m + 24), tt, 0.6, f, 5);
    });
  }
  vGtr(dest, t, root, dur, v) {
    [0, 7, 12].forEach(iv => {
      const g = this.ctx.createGain(); this._env(g, t, 0.004, v, dur); g.connect(dest);
      this._osc('sawtooth', mtof(root + iv), t, dur, g, iv * 0.7);
    });
  }
  vVox(dest, t, m, dur, v) {
    const ctx = this.ctx, g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.07);
    g.gain.setValueAtTime(v, t + dur - 0.08); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    g.connect(dest);
    const o = this._osc('sawtooth', mtof(m), t, dur, g);
    const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.3; lg.gain.value = 14;
    l.connect(lg); lg.connect(o.detune); l.start(t + 0.15); l.stop(t + dur + 0.05);   // 비브라토
  }
  // 장비별 연주 패턴
  // variant: 같은 장비의 몇 번째 인스턴스인지 (보컬·코러스는 번호마다 다른 파트를 부름)
  _play(id, dest, step, t, sd, v, variant = 0) {
    const bar = step >> 4, s = step & 15, ch = SONG.chords[bar];
    switch (id) {
      case 'kick': if (s === 0 || s === 8 || (s === 10 && bar % 2)) this.vKick(dest, t, v); break;
      case 'snr': if (s === 4 || s === 12) this.vSnare(dest, t, v); break;
      case 'oh':
        if (s % 2 === 0) this.vHat(dest, t, v * (s % 4 === 0 ? 0.6 : 0.35), s === 14);
        if (s === 4 || s === 12) this._noise(dest, t, 0.12, v * 0.25, 'bandpass', 2500, 0.6);
        if (s === 0 && bar === 0) this._noise(dest, t, 1.2, v * 0.5, 'highpass', 5000);   // 크래시 심벌
        break;
      case 'bass': if (s % 2 === 0) this.vBass(dest, t, SONG.bass[bar] + (s === 14 ? 7 : 0), sd * 1.6, v * 0.45); break;
      case 'egt': if ([0, 3, 6, 10, 12].includes(s)) this.vGtr(dest, t, SONG.bass[bar] + 12, sd * 2.2, v * 0.25); break;
      case 'agt': if (s % 2 === 0) this.vStrum(dest, t, ch, v * (s % 4 === 0 ? 0.17 : 0.1), s % 4 === 2); break;
      case 'keys': if (s === 0 || s === 10) this.vKeys(dest, t, ch, sd * 9, v * 0.28); break;
      case 'vox': case 'cho': {
        // 파트 순환: 보컬 = 멜로디 → 화음 → 낮은 멜로디, 코러스 = 화음 → 멜로디 → 낮은 화음
        const k = (variant + (id === 'cho' ? 1 : 0)) % 3, part = k === 1 ? SONG.harm : SONG.lead;
        const shift = variant >= 2 ? -12 : k === 2 ? -12 : 0;
        part.forEach(([st, len, m]) => { if (st === step) this.vVox(dest, t, m + shift, len * sd, v * 0.5); });
        break;
      }
      case 'phone':   // 반주 음원: 드럼 + 베이스 + 건반이 이미 섞여 있는 스테레오 음원
        if (s === 0 || s === 8) this.vKick(dest, t, v * 0.55);
        if (s === 4 || s === 12) this.vSnare(dest, t, v * 0.4);
        if (s % 2 === 0) this.vHat(dest, t, v * 0.15);
        if (s % 4 === 0) this.vBass(dest, t, SONG.bass[bar], sd * 3, v * 0.25);
        if (s === 0) this.vKeys(dest, t, ch, sd * 14, v * 0.14);
        break;
    }
  }
}

/* =========================================================
   내장 디지털 이펙터 (SPX 스타일 24 프로그램) - 웨트 신호만 출력
   ========================================================= */
class FxUnit {
  constructor(engine) {
    this.e = engine; this.ctx = engine.ctx;
    this.input = engine.gain(1, 1); this.output = engine.gain(1, 2);
    this.nodes = []; this.oscs = []; this.prog = 0; this.param = -1;
  }
  set(no, p) {
    if (no !== this.prog) { this.prog = no; this.param = p; this._build(PROGS[no - 1], p); }
    else if (p !== this.param) { this.param = p; if (this.update) this.update(progValue(PROGS[no - 1], p)); }
  }
  _teardown() {
    this.oscs.forEach(o => { try { o.stop(); } catch (e) { /* 무시 */ } });
    try { this.input.disconnect(); } catch (e) { /* 무시 */ }
    this.nodes.forEach(n => { try { n.disconnect(); } catch (e) { /* 무시 */ } });
    this.nodes = []; this.oscs = []; this.update = null; clearTimeout(this.tmr);
  }
  n(node) { this.nodes.push(node); return node; }
  g(v) { return this.n(this.e.gain(v)); }
  lfo(f, depth, target, type) {
    const o = this.ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = f;
    const g = this.g(depth); o.connect(g); g.connect(target); o.start(); this.oscs.push(o); this.n(o); return o;
  }
  filt(type, f, q) { const b = this.n(this.ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; }
  delay(t, max) { const d = this.n(this.ctx.createDelay(max || 1.2)); d.delayTime.value = t; return d; }

  _build(prog, p) {
    this._teardown();
    const cfg = prog.cfg, val = progValue(prog, p), I = this.input, O = this.output, ctx = this.ctx;
    const setP = (param, v) => this.e.set(param, v);
    switch (prog.type) {
      case 'rev': {   // 리버브: 잔향 임펄스를 만들어 컨볼루션
        const cv = this.n(ctx.createConvolver()), w = this.g(cfg.early || cfg.gate ? 4.5 : 2.4);
        I.connect(cv); cv.connect(w); w.connect(O);
        const mk = time => { cv.buffer = this._impulse(time, cfg); };
        mk(val);
        this.update = v => { clearTimeout(this.tmr); this.tmr = setTimeout(() => mk(v), 90); };
        break;
      }
      case 'dly': {   // 딜레이/에코: 피드백 루프
        const d = this.delay(val), lp = this.filt('lowpass', cfg.lp), fb = this.g(cfg.fb), w = this.g(0.9);
        I.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(w); w.connect(O);
        this.update = v => setP(d.delayTime, v);
        break;
      }
      case 'phaser': {   // 페이저: 올패스 필터 4단을 LFO로 움직임
        let last = I; const aps = [];
        for (let i = 0; i < 4; i++) { const a = this.filt('allpass', 600 + i * 500, 0.6); last.connect(a); last = a; aps.push(a); }
        const w = this.g(1); last.connect(w); w.connect(O); const dry = this.g(0.7); I.connect(dry); dry.connect(O);
        const os = aps.map(a => this.lfo(val, 450, a.frequency));
        this.update = v => os.forEach(o => setP(o.frequency, v));
        break;
      }
      case 'mod': {   // 코러스/플랜저: 짧은 딜레이를 LFO로 흔듦
        const os = [];
        for (let i = 0; i < cfg.voices; i++) {
          const d = this.delay(cfg.base * (1 + i * 0.25), 0.1), pan = this.n(ctx.createStereoPanner()), w = this.g(1.1);
          pan.pan.value = cfg.voices === 1 ? 0 : -0.8 + 1.6 * i / (cfg.voices - 1);
          I.connect(d); d.connect(w); w.connect(pan); pan.connect(O);
          if (cfg.fb) { const fb = this.g(cfg.fb); d.connect(fb); fb.connect(d); }
          os.push([this.lfo(val * (1 + i * 0.31), cfg.depth, d.delayTime), 1 + i * 0.31]);
        }
        this.update = v => os.forEach(([o, k]) => setP(o.frequency, v * k));
        break;
      }
      case 'trem': {   // 트레몰로: 음량을 주기적으로 흔듦
        const a = this.g(0.6); I.connect(a); a.connect(O);
        const o = this.lfo(val, 0.6, a.gain);
        this.update = v => setP(o.frequency, v);
        break;
      }
      case 'wah': {   // 오토 와: 밴드패스 필터를 LFO로 스윕
        const f = this.filt('bandpass', 1100, 4), w = this.g(2.5); I.connect(f); f.connect(w); w.connect(O);
        const o = this.lfo(val, 800, f.frequency);
        this.update = v => setP(o.frequency, v);
        break;
      }
      case 'radio': {   // 라디오 보이스: 좁은 대역 + 약한 왜곡
        const h = this.filt('highpass', val, 1.2), l = this.filt('lowpass', val * 3.2, 1.2), sh = this.n(ctx.createWaveShaper()), pre = this.g(12), w = this.g(0.12);
        const cv = new Float32Array(257); for (let i = 0; i < 257; i++) cv[i] = Math.tanh((i / 128 - 1) * 2.5); sh.curve = cv;
        I.connect(h); h.connect(l); l.connect(pre); pre.connect(sh); sh.connect(w); w.connect(O);
        this.update = v => { setP(h.frequency, v); setP(l.frequency, v * 3.2); };
        break;
      }
      case 'dist': {   // 디스토션
        const pre = this.g(val * 6), sh = this.n(ctx.createWaveShaper()), lp = this.filt('lowpass', 4200), w = this.g(0.09);
        const cv = new Float32Array(513); for (let i = 0; i < 513; i++) cv[i] = Math.tanh((i / 256 - 1) * 3); sh.curve = cv;
        I.connect(pre); pre.connect(sh); sh.connect(lp); lp.connect(w); w.connect(O);
        this.update = v => setP(pre.gain, v * 6);
        break;
      }
      case 'pitch': {   // 피치 체인지: 두 개의 가변 딜레이를 교차 페이드
        const D = 0.06, N = 64, re = new Float32Array(N), im = new Float32Array(N);
        for (let k = 1; k < N; k++) im[k] = -2 / (Math.PI * k);
        const saw2 = ctx.createPeriodicWave(re, im, { disableNormalization: true });
        const cosW = ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]), { disableNormalization: true });
        const t0 = ctx.currentTime + 0.05, oscs = [], sgs = [];
        [0, 1].forEach(i => {
          const d = this.delay(D / 2, 0.2), w = this.g(0.5), out = this.g(1.4);
          I.connect(d); d.connect(w); w.connect(out); out.connect(O);
          const so = ctx.createOscillator(); if (i === 0) so.type = 'sawtooth'; else so.setPeriodicWave(saw2);
          const sg = this.g(D / 2); so.connect(sg); sg.connect(d.delayTime); so.start(t0);
          const co = ctx.createOscillator(); co.setPeriodicWave(cosW);
          const cg = this.g(i === 0 ? 0.5 : -0.5); co.connect(cg); cg.connect(w.gain); co.start(t0);
          this.oscs.push(so, co); this.n(so); this.n(co); oscs.push(so, co); sgs.push(sg);
        });
        const apply = semi => {
          const ratio = Math.pow(2, semi / 12), f = Math.max(0.01, Math.abs(1 - ratio) / D), t = ctx.currentTime;
          oscs.forEach(o => o.frequency.setValueAtTime(f, t));
          sgs.forEach(s => s.gain.setValueAtTime((ratio > 1 ? -1 : 1) * D / 2, t));
        };
        apply(val); this.update = apply;
        break;
      }
    }
  }
  // 리버브용 임펄스 응답 생성
  _impulse(time, cfg) {
    const sr = this.ctx.sampleRate, p0 = Math.floor(cfg.pre * sr), n = p0 + Math.floor(time * sr) + 1;
    const b = this.ctx.createBuffer(2, n, sr), a = 0.08 + 0.9 * cfg.bright;
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0;
      if (cfg.early) {           // 초기 반사음: 드문드문한 반사 몇 개
        for (let k = 0; k < 14; k++) { const pos = p0 + Math.floor(Math.random() * time * sr); d[pos] = (Math.random() > 0.5 ? 1 : -1) * (1 - (pos - p0) / (time * sr) * 0.7); }
        continue;
      }
      for (let i = p0; i < n; i++) {
        const t = (i - p0) / sr, env = cfg.gate ? (t < time * 0.92 ? 1 : 0) : Math.exp(-6.9 * t / time);
        lp += a * ((Math.random() * 2 - 1) * env - lp); d[i] = lp;
      }
    }
    return b;
  }
}
