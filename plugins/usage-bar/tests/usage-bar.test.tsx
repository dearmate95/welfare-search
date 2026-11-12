import { expect, test } from 'claude-code/testing'

// 테스트용 가짜 사용량 (컨텍스트 41%, 5시간 한도 15%)
const USAGE = {
  startedAt: 0,
  context: { tokens: 82000, window: 200000, percent: 41 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 15, resetsAt: '2026-11-11T14:40:00Z' }],
  cost: { usd: 1.23 },
}

const PANE = {
  plugin: 'usage-bar',
  component: 'Pane',
  requestId: 'usage-bar',
  props: {
    title: '사용량',
    isFocused: false,
    bodyColumns: 40,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('모바일 포함 모든 화면에서 패널에 막대가 그려짐', async ($, on) => {
  // 아래 훅들은 엔진 역할을 대신함
  on('command.register', () => ({ value: { command: 'usage-bar' } }))
  on('session.surfaces', () => ({ value: ['mobile'] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const pct = await ui.find({ type: 'Text', text: /41%/ })
    expect(pct?.text).toBe(' 41%')
    const reset = await ui.find({ type: 'Text', text: /초기화/ })
    // 14:40 UTC → 23:40 KST
    expect(reset?.text).toContain('23:40')
    await ui.unmount()
  }
})

test('모바일에서 "사용량" 메시지를 보내면 모델 호출 없이 막대 행을 배치', async ($, on) => {
  const placed: string[] = []
  on('command.register', () => ({ value: { command: 'usage-bar' } }))
  on('session.surfaces', () => ({ value: ['mobile'] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({ value: USAGE }))
  on('ui.place', (_, e) => {
    placed.push(e.id)
    return { value: { isPlaced: true, requestId: 'r1' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })

  for (const text of ['/usage-bar', '사용량', ' /사용량 ']) {
    const r = await $.prompt.submit({ text })
    expect(r.drop).toContain('41%')
  }
  expect(placed.length).toBe(3)

  // 일반 메시지는 그대로 통과
  const pass = await $.prompt.submit({ text: '사용량 줄이는 법 알려줘' })
  expect(pass.drop).toBeUndefined()

  // 배치된 행이 모바일에서 그려짐
  const ui = await $.ui.mount({
    plugin: 'usage-bar',
    surface: 'mobile',
    component: 'Placed',
    requestId: 'r1',
    props: { id: placed[0]!, plugin: 'usage-bar' },
  })
  expect((await ui.find({ type: 'Text', text: /41%/ }))?.text).toBe(' 41%')
  await ui.unmount()
})

test('작업(턴)마다 비용을 집계하고 한도 1%당 비용을 추정', async ($, on) => {
  // 누적 비용과 주간 한도가 작업마다 오르는 상황
  let usd = 1.0
  let weekly = 10
  on('command.register', () => ({ value: { command: 'usage-bar' } }))
  on('session.surfaces', () => ({ value: ['mobile'] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000, percent: 20 },
      rateLimits: [{ kind: 'seven_day', percentUsed: weekly }],
      cost: { usd },
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })

  const turn = { answer: '', durationMs: 1, isAborted: false, reason: 'answer', text: '' } as const
  usd = 1.3 // 첫 작업 $0.30, 주간 +1%
  weekly = 11
  await $.turn.complete({ ...turn, turnId: 't1' })
  usd = 1.4 // 두 번째 작업 $0.10, 주간 +1% (누적 +2%)
  weekly = 12
  await $.turn.complete({ ...turn, turnId: 't2' })
  // 하위 에이전트 턴은 집계하지 않음
  await $.turn.complete({ ...turn, turnId: 't3', agentId: 'a1' })

  const out = await $.command.run({ command: 'usage-bar' })
  expect(out.text).toContain('이번 세션 $1.40')
  expect(out.text).toContain('직전 작업 $0.10')
  expect(out.text).toContain('작업당 평균 $0.20 (2회)')
  // ($1.40 - $1.00) / 2% = $0.20
  expect(out.text).toContain('주간 한도 1% ≈ $0.20')
})

test('/usage-bar 명령이 대화창에 막대 텍스트를 남김', async ($, on) => {
  on('command.register', () => ({ value: { command: 'usage-bar' } }))
  on('session.surfaces', () => ({ value: ['mobile'] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  const out = await $.command.run({ command: 'usage-bar' })
  expect(out.text).toContain('컨텍스트 ████████')
  expect(out.text).toContain('41%')
  expect(out.text).toContain('5시간 한도')
})

test('/usage-bar 결과에 패널 상태 진단 줄이 붙음', async ($, on) => {
  on('command.register', () => ({ value: { command: 'usage-bar' } }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test-reason' } }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const out = await $.command.run({ command: 'usage-bar' })
  expect(out.text).toContain('[패널] 표시 대기 (test-reason) · 연결된 화면: desktop')
})
