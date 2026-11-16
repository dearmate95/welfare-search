/* =========================================================
   MG16XU 학습용 시뮬레이터 - 기능 사전 & 이름 퀴즈
   - 사전: 이름만 보고 기능·사용 요령·변화를 학습, 믹서에서 위치 표시
   - 퀴즈: ① 이름 보고 믹서에서 위치 찾기 ② 설명 보고 이름 고르기
   ========================================================= */
'use strict';

const SECS = ['입력', 'EQ·컴프', '센드', '채널 출력', '이펙터', 'FX RTN', '마스터', '모니터·미터', '출력 단자'];

/* 사전 항목
   name: 패널 표기, ctx: 위치 설명, aka: 정식 명칭, kind: DESC 재사용(하는 일·변화), how: 사용 요령, sel: 믹서에서 찾을 선택자 */
const GLOSSARY = [
  // ---------- 입력 ----------
  { id: 'injack', sec: '입력', name: 'MIC / LINE 입력 단자', aka: 'XLR·TRS 콤보 입력', sel: '.strip .jack',
    what: '마이크나 악기를 꽂는 입구입니다. CH 1~8과 9/10, 11/12에는 마이크(XLR)를 꽂을 수 있고, 13/14와 15/16은 라인(키보드·음원 기기) 전용입니다.',
    how: '마이크는 마이크 단자가 있는 채널에, 스테레오 기기(키보드·스마트폰)는 스테레오 채널에 꽂습니다. 꽂거나 뽑을 때는 해당 채널 ON을 끄거나 페이더를 내려 "퍽" 소리를 막습니다.',
    watch: '장비를 꽂으면 채널 아래 이름표와 「입력」 레벨 막대가 살아납니다.' },
  { id: 'lineusb', sec: '입력', name: 'LINE / USB', kind: 'lineusb', sel: '[data-id$=".lineusb"]',
    how: '노트북에서 반주(MR)를 틀 때 USB로 두고, 노트북을 USB 단자에 연결합니다. 평소에는 LINE.' },
  { id: 'pad', sec: '입력', name: 'PAD', aka: 'Pad (감쇠기, −26 dB)', kind: 'pad', sel: '[data-id$=".pad"]',
    how: 'GAIN을 최소로 내려도 PEAK가 켜질 만큼 큰 소리(라인 기기, 킥 드럼 등)에만 켭니다. 일반 보컬 마이크에는 끈 상태가 기본입니다.' },
  { id: 'hpf', sec: '입력', name: 'HPF 80', aka: 'High Pass Filter (저역 차단 필터)', kind: 'hpf', sel: '[data-id$=".hpf"]',
    how: '보컬·통기타·심벌 마이크에는 켜고, 킥 드럼·베이스처럼 저음이 핵심인 악기에는 끕니다.' },
  { id: 'gain', sec: '입력', name: 'GAIN', aka: 'Input Gain (입력 감도)', kind: 'gain', sel: '[data-id$=".gain"]',
    how: '① 페이더는 0 dB 근처에 두고 ② 실제 연주 크기로 소리를 내게 한 뒤 ③ PFL을 눌러 미터를 보며 GAIN을 올립니다. 가장 큰 소리에서 PEAK가 켜지지 않을 정도가 적정입니다.' },
  { id: 'peak', sec: '입력', name: 'PEAK', aka: 'Peak 표시등', sel: '.peakRow',
    what: '프리앰프(GAIN) 뒤 신호가 찌그러지기 직전까지 커지면 빨갛게 켜지는 경고등입니다.',
    how: '연주 중 계속 켜져 있으면 GAIN을 내리거나 PAD를 켭니다. 가장 큰 순간에 아주 가끔 깜빡이는 정도는 괜찮습니다.',
    watch: 'GAIN을 크게 올리면 켜지고, 오른쪽 「프리앰프 후」 막대가 빨간색이 됩니다.' },
  { id: 'phantom', sec: '입력', name: 'PHANTOM +48V', aka: 'Phantom Power (팬텀 전원)', kind: 'phantom', sel: '[data-id="m.phantom"]',
    how: '켜고 끄기 전에 STEREO 마스터를 내립니다. 다이내믹 마이크는 켜져 있어도 대개 문제없지만, 리본 마이크나 일부 기기는 손상될 수 있어 확인 후 켭니다.' },

  // ---------- EQ·컴프 ----------
  { id: 'comp', sec: 'EQ·컴프', name: 'COMP', aka: 'One-knob Compressor', kind: 'comp', sel: '[data-id$=".comp"]',
    how: '보컬·베이스에 9~12시 정도로 조금만 겁니다. 너무 많이 돌리면 소리가 답답해지고 하울링이 쉬워집니다.' },
  { id: 'high', sec: 'EQ·컴프', name: 'HIGH', aka: 'High EQ (고음 조절)', kind: 'high', sel: '[data-id$=".high"]',
    how: '말소리가 먹먹하면 살짝 올리고, "치" 소리가 따가우면 내립니다. EQ는 올리기보다 내리는 쪽이 하울링에 안전합니다.' },
  { id: 'mid', sec: 'EQ·컴프', name: 'MID', aka: 'Mid EQ (중음 조절)', kind: 'mid', sel: '[data-id$=".mid"]',
    how: '보컬이 묻히면 2~3 kHz 근처를 조금 올리고, 소리가 박스처럼 울리면 300~500 Hz를 내립니다.' },
  { id: 'midf', sec: 'EQ·컴프', name: 'MID 주파수 (250–5k)', aka: 'Mid Frequency (스윕 주파수)', kind: 'midf', sel: '[data-id$=".midf"]',
    how: 'MID를 크게 올린 채 이 노브를 천천히 돌려 거슬리는 소리가 가장 커지는 곳을 찾고, 그다음 MID를 내려 그 대역을 줄입니다(스윕 기법).' },
  { id: 'low', sec: 'EQ·컴프', name: 'LOW', aka: 'Low EQ (저음 조절)', kind: 'low', sel: '[data-id$=".low"]',
    how: '보컬이 웅웅거리면 내리고, 킥·베이스가 가벼우면 살짝 올립니다.' },

  // ---------- 센드 ----------
  { id: 'aux1', sec: '센드', name: 'AUX1 (채널)', aka: 'Auxiliary Send 1', kind: 'aux1', sel: '[data-id^="ch"][data-id$=".aux1"]',
    how: '무대 모니터 1번 스피커 앞에 있는 연주자가 "내 소리 더 주세요"라고 하면 그 채널의 AUX1을 올립니다.' },
  { id: 'aux2', sec: '센드', name: 'AUX2 (채널)', aka: 'Auxiliary Send 2', kind: 'aux2', sel: '[data-id^="ch"][data-id$=".aux2"]',
    how: '두 번째 모니터 믹스(예: 드러머용)를 따로 만들 때 씁니다.' },
  { id: 'pre', sec: '센드', name: 'PRE', aka: 'Pre-fader Send (페이더 전 송출)', kind: 'pre1', alt: ['pre2'], sel: '[data-id$=".pre1"], [data-id$=".pre2"]',
    how: '모니터용 AUX는 PRE를 켜는 것이 기본입니다. 객석 음량을 조절할 때마다 무대 모니터가 함께 변하면 연주자가 혼란스럽기 때문입니다.' },
  { id: 'aux3', sec: '센드', name: 'AUX3 (채널)', aka: 'Auxiliary Send 3 (포스트 페이더)', kind: 'aux3', sel: '[data-id^="ch"][data-id$=".aux3"]',
    how: '녹음·중계용으로 객석 믹스와 비슷하게 보내거나 외부 이펙터에 보낼 때 씁니다.' },
  { id: 'fxsend', sec: '센드', name: 'AUX4/FX', aka: 'Effect Send (이펙트 보내기)', kind: 'fx', sel: '[data-id$=".fx"]',
    how: '보컬에는 적당히, 드럼·베이스에는 거의 보내지 않는 것이 일반적입니다. 말하는 순서(멘트)에는 FX RTN ON을 끄거나 풋 스위치로 끕니다.' },

  // ---------- 채널 출력 ----------
  { id: 'pan', sec: '채널 출력', name: 'PAN', aka: 'Panorama (좌우 위치)', kind: 'pan', sel: '.strip:not(.stereo) [data-id$=".pan"]',
    how: '보컬·킥·베이스는 가운데, 기타·키보드 등은 좌우로 조금씩 벌려 겹치지 않게 합니다.' },
  { id: 'bal', sec: '채널 출력', name: 'BAL', aka: 'Balance (좌우 균형)', kind: 'pan', sel: '.strip.stereo [data-id$=".pan"]',
    what: '스테레오 채널에서 왼쪽(L)과 오른쪽(R) 소리의 크기 균형을 조절합니다. PAN과 달리 좌우 두 신호를 각각 줄이는 방식입니다.',
    how: '보통은 가운데에 두고, 한쪽 소리가 크게 들릴 때만 조절합니다.' },
  { id: 'on', sec: '채널 출력', name: 'ON', aka: 'Channel On (채널 켜기)', kind: 'on', sel: '[data-id^="ch"][data-id$=".on"]',
    how: '연주하지 않는 채널, 장비를 꽂고 빼는 채널은 꺼 둡니다. 공연 중 "갑자기 소리가 안 나요"의 흔한 원인입니다.' },
  { id: 'pfl', sec: '채널 출력', name: 'PFL', aka: 'Pre Fader Listen (페이더 전 듣기)', kind: 'pfl', sel: '[data-id^="ch"][data-id$=".pfl"]',
    how: 'GAIN을 맞출 때, 어느 채널에서 잡음이 나는지 찾을 때 헤드폰을 끼고 사용합니다. 다 쓰고 나면 꼭 다시 끕니다.' },
  { id: 'g12', sec: '채널 출력', name: '1-2', aka: 'Group 1-2 Assign', kind: 'g12', sel: '[data-id^="ch"][data-id$=".g12"]',
    how: '드럼 채널을 모두 1-2에 보내고 ST는 끈 뒤, GROUP 1-2 페이더 하나로 드럼 전체 음량을 조절합니다.' },
  { id: 'g34', sec: '채널 출력', name: '3-4', aka: 'Group 3-4 Assign', kind: 'g34', sel: '[data-id^="ch"][data-id$=".g34"]',
    how: '코러스·보컬 묶음 등 두 번째 그룹을 만들 때 씁니다.' },
  { id: 'st', sec: '채널 출력', name: 'ST', aka: 'Stereo Assign', kind: 'st', sel: '[data-id^="ch"][data-id$=".st"]',
    how: '그룹을 쓰지 않는 채널은 ST를 켭니다. 그룹으로 보낸 채널은 ST를 꺼야 같은 소리가 두 번 섞이지 않습니다.' },
  { id: 'fader', sec: '채널 출력', name: '채널 페이더', aka: 'Channel Fader', kind: 'fader', sel: '[data-id^="ch"][data-id$=".fader"]',
    how: '0 눈금(굵은 선) 근처를 기준으로 두고 위아래로 조절합니다. 페이더가 맨 아래 근처에서만 맞는다면 GAIN이 너무 높은 것입니다.' },
  { id: 'tape', sec: '채널 출력', name: '이름표 (스크리블 스트립)', aka: 'Scribble Strip', sel: '.tape',
    what: '각 채널에 무엇이 꽂혀 있는지 적어 두는 자리입니다. 실제 현장에서는 마스킹 테이프에 펜으로 적습니다.',
    how: '공연 전 리허설 때 반드시 적어 둡니다. 급할 때 엉뚱한 페이더를 올리는 실수를 막아 줍니다.',
    watch: '장비를 꽂으면 자동으로 이름이 적힙니다.' },
  { id: 'vm', sec: '채널 출력', name: '채널 미터 (학습용)', aka: '가상 레벨 미터', sel: '.vm',
    what: '페이더를 지난 채널 레벨을 보여 주는 막대입니다. 실제 MG16XU에는 없고, 학습을 돕기 위해 추가한 표시입니다.',
    how: '어느 채널에서 소리가 나고 있는지 한눈에 볼 때 참고합니다.' },

  // ---------- 이펙터 ----------
  { id: 'prog', sec: '이펙터', name: 'PROGRAM', aka: 'Effect Program Select', kind: 'prog', sel: '[data-id="m.prog"], .fxList',
    how: '노래에는 REV HALL·REV PLATE, 말하기에는 REV ROOM을 짧게, 특별한 연출에는 ECHO·DELAY를 씁니다.' },
  { id: 'fxdisp', sec: '이펙터', name: '프로그램 번호 표시', aka: 'Program Display', sel: '.fxDisp',
    what: '지금 선택된 이펙트 프로그램 번호(01~24)를 보여 줍니다.',
    how: '번호와 옆의 프로그램 목록을 맞춰 보며 어떤 효과인지 확인합니다.' },
  { id: 'param', sec: '이펙터', name: 'PARAMETER', aka: 'Effect Parameter', kind: 'param', sel: '[data-id="m.param"]',
    how: '빠른 곡은 잔향을 짧게, 느린 발라드는 길게 합니다. 딜레이는 곡 템포에 맞추면 자연스럽습니다.' },
  { id: 'foot', sec: '이펙터', name: 'FOOT SW', aka: 'Foot Switch 단자', sel: '.pedal',
    what: '발로 밟는 스위치를 꽂는 단자입니다. 밟을 때마다 내장 이펙터(FX RTN ON)가 켜지고 꺼집니다.',
    how: '노래 중에는 리버브를 켜고, 곡 사이 멘트 때는 꺼서 말소리를 또렷하게 합니다. (이 사이트에서는 발 아이콘을 클릭)',
    watch: 'FX RTN의 ON 버튼이 켜졌다 꺼졌다 합니다.' },

  // ---------- FX RTN ----------
  { id: 'fxaux', sec: 'FX RTN', name: 'AUX1 · AUX2 (FX RTN)', aka: 'Effect Return to AUX', kind: 'fxAux', sel: '[data-id^="m.fxAux"]',
    how: '가수가 "모니터에서 울림이 안 들려요"라고 할 때 조금 올립니다. 너무 많으면 무대가 웅웅거립니다.' },
  { id: 'fxon', sec: 'FX RTN', name: 'ON (FX RTN)', aka: 'Effect Return On', kind: 'fxOn', sel: '[data-id="m.fxOn"]',
    how: '이펙트를 통째로 켜고 끄는 스위치입니다. 이펙트가 안 걸리면 가장 먼저 확인합니다.' },
  { id: 'fxpfl', sec: 'FX RTN', name: 'PFL (FX RTN)', aka: 'Effect Return PFL', kind: 'fxPfl', sel: '[data-id="m.fxPfl"]',
    how: '프로그램을 바꿔 보며 어떤 소리인지 헤드폰으로만 미리 들어 볼 때 씁니다.' },
  { id: 'fxassign', sec: 'FX RTN', name: '1-2 · 3-4 · ST (FX RTN)', aka: 'Effect Return Assign', kind: 'fxSt', alt: ['fxG12', 'fxG34'], sel: '[data-id="m.fxG12"], [data-id="m.fxG34"], [data-id="m.fxSt"]',
    what: '이펙트 소리를 어느 버스(GROUP 1-2, GROUP 3-4, STEREO)로 보낼지 정합니다.',
    how: '보통 ST만 켭니다. 그룹으로 녹음·송출할 때만 1-2, 3-4를 함께 켭니다.' },
  { id: 'fxfader', sec: 'FX RTN', name: 'FX RTN 페이더', aka: 'Effect Return Fader', kind: 'fxFader', sel: '[data-id="m.fxFader"]',
    how: '울림 전체의 양은 이 페이더로, 채널별 울림 차이는 채널의 AUX4/FX 노브로 조절합니다.' },

  // ---------- 마스터 ----------
  { id: 'send', sec: '마스터', name: 'SEND MASTER (AUX1~4)', aka: 'Aux Send Master', kind: 'send', sel: '[data-id^="m.send"]',
    how: '모니터 스피커 전체가 크거나 작을 때 이 노브로 조절합니다. 처음 켤 때는 낮은 곳에서 올립니다.' },
  { id: 'gfader', sec: '마스터', name: 'GROUP 페이더 (1-2 · 3-4)', aka: 'Group Master Fader', kind: 'gFader', sel: '[data-id="m.g12Fader"], [data-id="m.g34Fader"]',
    how: '여러 채널을 묶어 한 번에 올리고 내릴 때 씁니다. 그룹 안의 균형은 각 채널 페이더로 먼저 맞춥니다.' },
  { id: 'gst', sec: '마스터', name: 'ST (GROUP)', aka: 'Group to Stereo', kind: 'gSt', sel: '[data-id="m.g12St"], [data-id="m.g34St"]',
    how: '그룹을 객석 스피커로도 내보내려면 반드시 켭니다. 그룹 페이더를 올렸는데 소리가 안 나면 이 스위치를 확인합니다.' },
  { id: 'ston', sec: '마스터', name: 'ON (STEREO)', aka: 'Stereo Master On', kind: 'stOn', sel: '[data-id="m.stOn"]',
    how: '공연 시작 전, 장비 연결이 모두 끝난 뒤에 켭니다.' },
  { id: 'stfader', sec: '마스터', name: 'STEREO 페이더', aka: 'Stereo Master Fader', kind: 'stFader', sel: '[data-id="m.stFader"]',
    how: '켤 때는 "믹서 먼저, 스피커 나중", 끌 때는 "스피커 먼저, 믹서 나중". 레벨 미터가 0 근처에서 움직이도록 맞춥니다.' },

  // ---------- 모니터·미터 ----------
  { id: 'monsel', sec: '모니터·미터', name: 'MONITOR 소스 (STEREO 버튼)', aka: 'Monitor Source Select', kind: 'monSel', sel: '[data-id="m.monSel"]',
    how: '평소에는 STEREO로 두고, 그룹 소리만 확인할 때 바꿉니다. PFL을 누르면 이 선택보다 PFL이 우선합니다.' },
  { id: 'monlevel', sec: '모니터·미터', name: 'MONITOR', aka: 'Monitor Level', kind: 'monLevel', sel: '[data-id="m.monLevel"]',
    how: '음향 조정석 옆에 놓은 확인용 스피커의 크기를 조절합니다.' },
  { id: 'phones', sec: '모니터·미터', name: 'PHONES', aka: 'Headphone Level', kind: 'phones', sel: '[data-id="m.phones"]',
    how: '헤드폰을 쓰기 전에 먼저 내려 두고, 쓴 뒤 천천히 올립니다.' },
  { id: 'meter', sec: '모니터·미터', name: 'LEVEL 미터', aka: 'Level Meter (L/R)', sel: '.meter',
    what: 'MONITOR에서 고른 버스(또는 PFL 채널)의 소리 크기를 L/R 막대로 보여 줍니다.',
    how: '초록~노랑(0 근처)에서 움직이면 적당하고, 맨 위 PEAK(빨강)가 켜지면 너무 큽니다.',
    watch: '페이더·GAIN을 움직이거나 PFL을 누르면 막대 높이가 바뀝니다.' },
  { id: 'leds', sec: '모니터·미터', name: 'POWER · PFL 표시등', aka: 'Power / PFL Indicator', sel: '.meterBox .row.tiny',
    what: 'POWER는 전원이 켜졌는지, PFL은 어느 채널이든 PFL이 눌려 있는지 알려 줍니다.',
    how: 'PFL 표시등이 깜빡이면 헤드폰·미터가 일부 채널만 보여 주는 상태입니다. 다 쓰고 나면 PFL을 꺼 둡니다.' },

  // ---------- 출력 단자 ----------
  { id: 'jst', sec: '출력 단자', name: 'STEREO OUT (L/R)', aka: 'Stereo Output', sel: '[data-jack="stL"], [data-jack="stR"]',
    what: '메인 출력입니다. 객석을 향한 메인 스피커(파워드 스피커) 또는 앰프에 연결합니다.',
    how: 'L은 왼쪽, R은 오른쪽 스피커로 연결합니다. 이 단자가 비어 있으면 객석에서 소리가 나지 않습니다.' },
  { id: 'jmon', sec: '출력 단자', name: 'MONITOR OUT (L/R)', aka: 'Monitor Output', sel: '[data-jack="monL"], [data-jack="monR"]',
    what: '조정석 확인용 스피커로 가는 출력입니다. MONITOR 노브와 소스 선택, PFL의 영향을 받습니다.',
    how: '무대 모니터(웨지)가 아니라 음향 담당자가 듣는 스피커에 연결합니다. 무대 모니터는 AUX SEND에 연결합니다.' },
  { id: 'jgrp', sec: '출력 단자', name: 'GROUP OUT (1~4)', aka: 'Group Output', sel: '[data-jack^="grp"]',
    what: 'GROUP 1~4 버스를 따로 내보내는 출력입니다. 별도 구역 스피커, 녹음기, 중계 장비에 연결합니다.',
    how: '로비·별관 스피커처럼 따로 조절해야 하는 곳에 연결합니다.' },
  { id: 'jaux', sec: '출력 단자', name: 'AUX SEND (1~4)', aka: 'Aux Send Output', sel: '[data-jack^="aux"]',
    what: 'AUX 버스를 내보내는 출력입니다. 무대 모니터 스피커, 인이어, 외부 이펙터에 연결합니다.',
    how: 'AUX SEND 1에 모니터 스피커를 꽂았다면, 그 스피커 소리는 채널의 AUX1 노브와 SEND MASTER AUX1로 조절합니다.' },
  { id: 'jph', sec: '출력 단자', name: 'PHONES 단자', aka: 'Headphone Output', sel: '[data-jack="phones"]',
    what: '헤드폰을 꽂는 단자입니다. MONITOR OUT과 같은 소리가 나옵니다.',
    how: 'PFL과 함께 사용해 채널별 소리를 확인합니다.' },
  { id: 'jusb', sec: '출력 단자', name: 'USB 2.0', aka: 'USB Audio Interface', sel: '[data-jack="usb"]',
    what: '노트북과 연결하는 단자입니다. STEREO 믹스를 녹음하고, 노트북 소리를 CH 15/16(USB)으로 재생할 수 있습니다.',
    how: '예배·행사 녹음, 유튜브 송출, 노트북 반주 재생에 씁니다.' },
];

/* ---------- 도우미 ---------- */
const L$ = s => document.querySelector(s);
const Lh = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// {n} 자리에 컨트롤 종류에 맞는 번호를 넣음
const N_TXT = { gFader: ' 1-2 · 3-4', gSt: ' 1-2 · 3-4', fxAux: '1 · 2', send: '1~4' };
const fill = (s, k) => (s || '').replace(/ ?\{n\}/g, m => (m[0] === ' ' ? '' : '') + (N_TXT[k] || '1~4'));
function entryText(g) {
  const d = (g.kind && DESC[g.kind]) || [];
  return { what: fill(g.what || d[1], g.kind), watch: fill(g.watch || d[2], g.kind), how: g.how };
}
// 선택자에 맞는 믹서 요소 (가능하면 현재 선택된 채널 안의 것)
function findEl(g) {
  const all = [...document.querySelectorAll(g.sel)];
  return all.find(e => e.closest(`.strip[data-ch="${selCh}"]`)) || all[0];
}
// 컨트롤 종류(kind)로 사전 항목 찾기
const byKind = k => GLOSSARY.find(g => g.kind === k || (g.alt || []).includes(k));
// 클릭한 요소가 어떤 항목인지
function entryOf(el) { return GLOSSARY.find(g => el.closest(g.sel)); }

/* ---------- 위치 표시 ---------- */
let locTimer;
function locate(g, msg) {
  const el = findEl(g); if (!el) return;
  document.querySelectorAll('.locate').forEach(e => e.classList.remove('locate'));
  document.querySelectorAll(g.sel).forEach(e => e.classList.add('locate', 'locateAll'));
  el.classList.remove('locateAll');
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  clearTimeout(locTimer);
  locTimer = setTimeout(() => document.querySelectorAll('.locate').forEach(e => e.classList.remove('locate', 'locateAll')), 4500);
  if (msg !== false) toast(`📍 <b>${esc(g.name)}</b> — 노랗게 깜빡이는 곳입니다` + (document.querySelectorAll(g.sel).length > 1 ? ' (같은 컨트롤이 여러 채널에 있음)' : ''), true);
}
function toast(html, back) {
  const t = L$('#toast'); t.innerHTML = html;
  if (back) { const b = Lh('button', 'tb', '📖 사전으로'); b.onclick = () => { t.hidden = true; openDict(); }; t.append(b); }
  t.hidden = false; clearTimeout(t.tmr); t.tmr = setTimeout(() => { t.hidden = true; }, 6000);
}

/* ---------- 사전 패널 ---------- */
let curSec = '전체', curId = null;
function buildDrawer() {
  const d = Lh('div', '', `
    <div class="dHead">
      <div class="dTabs"><button data-tab="dict" class="on">📖 기능 사전</button><button data-tab="quiz">🎯 이름 퀴즈</button></div>
      <button class="dClose" title="닫기">✕</button>
    </div>
    <div class="dBody" id="dictPane">
      <input id="dSearch" type="search" placeholder="이름으로 찾기 (예: PFL, 게인, 모니터)">
      <div id="dSecs" class="dSecs"></div>
      <div id="dList"></div>
      <div id="dDetail" hidden></div>
    </div>
    <div class="dBody" id="quizPane" hidden></div>`);
  d.id = 'drawer'; d.hidden = true;
  document.body.append(d);
  d.querySelector('.dClose').onclick = closeDict;
  d.querySelectorAll('.dTabs button').forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
  ['전체', ...SECS].forEach(s => {
    const b = Lh('button', s === '전체' ? 'on' : '', s);
    b.onclick = () => { curSec = s; L$('#dSecs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderList(); };
    L$('#dSecs').append(b);
  });
  L$('#dSearch').addEventListener('input', renderList);
  renderList();
}
function showTab(tab) {
  L$('#drawer').querySelectorAll('.dTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  L$('#dictPane').hidden = tab !== 'dict'; L$('#quizPane').hidden = tab !== 'quiz';
  if (tab === 'quiz') renderQuizHome();
}
function openDict(id) {
  L$('#drawer').hidden = false; L$('#toast').hidden = true; showTab('dict');
  if (id) showDetail(id);
}
function closeDict() { L$('#drawer').hidden = true; }
function renderList() {
  const q = L$('#dSearch').value.trim().toLowerCase();
  const list = L$('#dList'); list.innerHTML = ''; L$('#dDetail').hidden = true; list.hidden = false;
  SECS.forEach(sec => {
    if (curSec !== '전체' && curSec !== sec) return;
    const items = GLOSSARY.filter(g => g.sec === sec && (!q || (g.name + ' ' + (g.aka || '') + ' ' + entryText(g).what).toLowerCase().includes(q)));
    if (!items.length) return;
    list.append(Lh('div', 'dSecT', sec));
    items.forEach(g => {
      const b = Lh('button', 'dItem', `<b>${esc(g.name)}</b><small>${esc(g.aka || (g.kind && DESC[g.kind] ? DESC[g.kind][0].replace(/\{n\}/g, '') : ''))}</small>`);
      b.onclick = () => showDetail(g.id);
      list.append(b);
    });
  });
  if (!list.children.length) list.append(Lh('p', 'dEmpty', '찾는 이름이 없습니다. 다른 말로 검색해 보세요.'));
}
function showDetail(id) {
  curId = id;
  const g = GLOSSARY.find(x => x.id === id), t = entryText(g), i = GLOSSARY.indexOf(g);
  const det = L$('#dDetail');
  det.innerHTML = `
    <button class="dBack">◀ 목록</button>
    <div class="dSecChip">${esc(g.sec)}</div>
    <h2>${esc(g.name)}</h2>
    ${g.aka ? `<div class="dAka">${esc(g.aka)}</div>` : ''}
    <div class="dBlock"><h5>하는 일</h5><p>${esc(t.what)}</p></div>
    <div class="dBlock"><h5>사용 요령</h5><p>${esc(t.how)}</p></div>
    ${t.watch ? `<div class="dBlock watch"><h5>👀 조작하면 이렇게 바뀝니다</h5><p>${esc(t.watch)}</p></div>` : ''}
    <div class="dBtns">
      <button class="tb accent dLoc">📍 믹서에서 위치 보기</button>
    </div>
    <div class="dNav">
      <button class="tb dPrev" ${i === 0 ? 'disabled' : ''}>◀ 이전</button>
      <span>${i + 1} / ${GLOSSARY.length}</span>
      <button class="tb dNext" ${i === GLOSSARY.length - 1 ? 'disabled' : ''}>다음 ▶</button>
    </div>`;
  det.querySelector('.dBack').onclick = renderList;
  det.querySelector('.dLoc').onclick = () => { closeDict(); locate(g); };
  det.querySelector('.dPrev').onclick = () => showDetail(GLOSSARY[i - 1].id);
  det.querySelector('.dNext').onclick = () => showDetail(GLOSSARY[i + 1].id);
  L$('#dList').hidden = true; det.hidden = false; det.scrollTop = 0;
  L$('#dictPane').scrollTop = 0;
}

/* ---------- 퀴즈 ---------- */
const Q = { active: false, mode: null, list: [], n: 0, score: 0, cur: null, locked: false };
const QN = 10;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function renderQuizHome() {
  const p = L$('#quizPane');
  p.innerHTML = `
    <p class="qIntro">이름만 보고 기능을 떠올려 보는 연습입니다. 한 판에 ${QN}문제입니다.</p>
    <button class="qMode" data-m="find"><b>📍 위치 찾기</b><small>이름을 보고 믹서에서 그 컨트롤을 직접 클릭합니다.<br>(퀴즈 중에는 컨트롤이 조작되지 않습니다)</small></button>
    <button class="qMode" data-m="name"><b>📝 이름 맞히기</b><small>기능 설명을 읽고 알맞은 이름을 4개 중에서 고릅니다.</small></button>
    <button class="qMode" data-m="func"><b>💡 기능 맞히기</b><small>이름을 보고 알맞은 기능 설명을 4개 중에서 고릅니다.</small></button>
    <div class="qSecs"><span>출제 범위</span>${['전체', ...SECS].map(s => `<label><input type="radio" name="qsec" value="${s}" ${s === '전체' ? 'checked' : ''}> ${s}</label>`).join('')}</div>`;
  p.querySelectorAll('.qMode').forEach(b => { b.onclick = () => startQuiz(b.dataset.m); });
}
function startQuiz(mode) {
  const sec = (L$('#quizPane input[name="qsec"]:checked') || {}).value || '전체';
  let pool = GLOSSARY.filter(g => sec === '전체' || g.sec === sec);
  if (mode === 'find') pool = pool.filter(g => findEl(g));
  if (pool.length < 4) pool = GLOSSARY.slice();
  Object.assign(Q, { mode, list: shuffle(pool.slice()).slice(0, Math.min(QN, pool.length)), n: 0, score: 0, active: mode === 'find', pool });
  document.querySelectorAll('.hot').forEach(e => e.classList.remove('hot'));
  if (mode === 'find') { closeDict(); L$('#quizBar').hidden = false; document.body.classList.add('quizOn'); }
  nextQ();
}
function nextQ() {
  Q.locked = false;
  if (Q.n >= Q.list.length) return endQuiz();
  Q.cur = Q.list[Q.n++];
  if (Q.mode === 'find') return renderFindQ();
  renderChoiceQ();
}
// ① 위치 찾기
function renderFindQ() {
  const g = Q.cur;
  L$('#quizBar').innerHTML = `
    <span class="qNum">${Q.n} / ${Q.list.length}</span>
    <span class="qAsk">믹서에서 찾아 클릭하세요: <b>「${esc(g.name)}」</b>${g.aka ? ` <small>${esc(g.aka)}</small>` : ''}</span>
    <span class="qRes" id="qRes"></span>
    <span class="qScore">점수 ${Q.score}</span>
    <button class="tb" id="qSkip">모르겠어요</button><button class="tb" id="qStop">그만하기</button>`;
  L$('#qSkip').onclick = () => { if (Q.locked) return; Q.locked = true; showFindAnswer(null); };
  L$('#qStop').onclick = stopQuiz;
}
function showFindAnswer(okEl) {
  const g = Q.cur, t = entryText(g);
  L$('#qRes').innerHTML = (okEl ? '<em class="ok">⭕ 정답!</em> ' : '') + `<small>${esc(t.what)}</small>`;
  locate(g, false);
  L$('#qSkip').textContent = Q.n >= Q.list.length ? '결과 보기 ▶' : '다음 문제 ▶';
  L$('#qSkip').onclick = nextQ;
}
// 퀴즈 중 믹서 클릭 가로채기
function onQuizPointer(e) {
  if (!Q.active || !e.target.closest('#mixer')) return;
  e.stopPropagation(); e.preventDefault();
  if (e.type !== 'pointerdown' || Q.locked) return;
  const g = Q.cur, hit = e.target.closest(g.sel);
  if (hit) {
    Q.locked = true; Q.score++;
    hit.classList.add('qOk'); setTimeout(() => hit.classList.remove('qOk'), 900);
    L$('.qScore').textContent = '점수 ' + Q.score;
    showFindAnswer(hit);
  } else {
    const other = entryOf(e.target);
    L$('#qRes').innerHTML = `<em class="no">❌ ${other ? `그건 「${esc(other.name)}」예요` : '거기가 아니에요'}</em> 다시 찾아보세요`;
    const el = e.target.closest('.knob, .sw, .fader, .jack, .tape, .peakRow, .vm, .meter, .pedal, .fxDisp, .fxList') || e.target;
    el.classList.add('qNo'); setTimeout(() => el.classList.remove('qNo'), 600);
  }
}
// ②③ 객관식
function renderChoiceQ() {
  const g = Q.cur, p = L$('#quizPane');
  const wrong = shuffle(Q.pool.filter(x => x !== g && x.name !== g.name)).slice(0, 3);
  const opts = shuffle([g, ...wrong]);
  const mask = s => { let r = s; [g.name, ...(g.name.split(/[ ()·/]+/).filter(w => w.length > 1))].forEach(w => { r = r.split(w).join('○○'); }); return r; };
  const ask = Q.mode === 'name'
    ? `<div class="qQ"><small>이 설명에 맞는 이름은?</small><p>${esc(mask(entryText(g).what))}</p></div>`
    : `<div class="qQ"><small>이 컨트롤이 하는 일은?</small><h2>${esc(g.name)}</h2>${g.aka ? `<div class="dAka">${esc(g.aka)}</div>` : ''}</div>`;
  p.innerHTML = `<div class="qTop"><span>${Q.n} / ${Q.list.length}</span><span>점수 ${Q.score}</span><button class="tb" id="qStop2">그만하기</button></div>${ask}<div class="qOpts"></div><div class="qFb"></div>`;
  L$('#qStop2').onclick = stopQuiz;
  opts.forEach(o => {
    const b = Lh('button', 'qOpt' + (Q.mode === 'func' ? ' long' : ''), Q.mode === 'name' ? `<b>${esc(o.name)}</b>` : esc(entryText(o).what));
    b.onclick = () => {
      if (Q.locked) return; Q.locked = true;
      const ok = o === g; if (ok) Q.score++;
      p.querySelectorAll('.qOpt').forEach((x, i) => { x.disabled = true; if (opts[i] === g) x.classList.add('right'); else if (x === b) x.classList.add('wrong'); });
      p.querySelector('.qFb').innerHTML = `<p>${ok ? '<em class="ok">⭕ 정답!</em>' : `<em class="no">❌ 정답은 「${esc(g.name)}」</em>`}</p><p class="qHow"><b>사용 요령</b> ${esc(entryText(g).how)}</p>`;
      const nb = Lh('button', 'tb accent', Q.n >= Q.list.length ? '결과 보기 ▶' : '다음 문제 ▶'); nb.onclick = nextQ;
      const lb = Lh('button', 'tb', '📍 위치 보기'); lb.onclick = () => { closeDict(); locate(g, false); toast(`📍 <b>${esc(g.name)}</b>`, false); setTimeout(() => { L$('#drawer').hidden = false; }, 2600); };
      p.querySelector('.qFb').append(nb, lb);
    };
    p.querySelector('.qOpts').append(b);
  });
}
function grade(s, n) { const r = s / n; return r === 1 ? '🏆 완벽합니다!' : r >= 0.8 ? '👍 아주 잘했어요' : r >= 0.5 ? '🙂 절반 이상 맞혔어요' : '📖 사전으로 한 번 더 복습해 보세요'; }
function endQuiz() {
  const s = Q.score, n = Q.list.length;
  if (Q.mode === 'find') {
    L$('#quizBar').innerHTML = `<span class="qAsk"><b>결과 ${s} / ${n}</b> — ${grade(s, n)}</span><button class="tb accent" id="qAgain">한 판 더</button><button class="tb" id="qStop">닫기</button>`;
    L$('#qAgain').onclick = () => startQuiz('find'); L$('#qStop').onclick = stopQuiz;
    Q.active = false; document.body.classList.remove('quizOn');
  } else {
    L$('#quizPane').innerHTML = `<div class="qEnd"><h2>${s} / ${n}</h2><p>${grade(s, n)}</p></div>`;
    const a = Lh('button', 'tb accent', '한 판 더'); a.onclick = () => startQuiz(Q.mode);
    const h = Lh('button', 'tb', '퀴즈 처음으로'); h.onclick = renderQuizHome;
    L$('#quizPane').append(a, h);
  }
}
function stopQuiz() {
  const wasFind = Q.mode === 'find';
  Q.active = false; L$('#quizBar').hidden = true; document.body.classList.remove('quizOn');
  if (wasFind) { openDict(); showTab('quiz'); } else renderQuizHome();
}

/* ---------- 초기화 ---------- */
(function initLearn() {
  // 출력 단자에 식별자 부여 (위치 찾기용)
  Object.keys(jackEls).forEach(id => { jackEls[id].dataset.jack = id; });
  buildDrawer();
  const bar = Lh('div', '', ''); bar.id = 'quizBar'; bar.hidden = true; document.body.append(bar);
  const t = Lh('div', '', ''); t.id = 'toast'; t.hidden = true; document.body.append(t);
  ['pointerdown', 'click', 'dblclick', 'wheel'].forEach(ev => window.addEventListener(ev, onQuizPointer, { capture: true, passive: false }));
  // 퀴즈 중에는 마우스를 올려도 정답(이름)이 보이지 않게
  const orig = showInfo;
  showInfo = id => { if (Q.active) return; orig(id); const c = C[id]; L$('#infoMore').hidden = !byKind(c.kind); L$('#infoMore').dataset.kind = c.kind; };
  L$('#infoMore').onclick = () => { const g = byKind(L$('#infoMore').dataset.kind); if (g) openDict(g.id); };
  L$('#btnDict').onclick = () => (L$('#drawer').hidden ? openDict() : closeDict());
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !L$('#drawer').hidden) closeDict(); });
})();
