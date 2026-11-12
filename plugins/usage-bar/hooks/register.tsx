import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit, UiOpenResult } from 'claude-code'

import type { CostTrack, CostView, PerPercent, UsageRow, UsageSnapshot } from '../types'

// 가장 최근 사용량 수치 (세션 동안 유지)
// shape 태그: 이전 버전이 저장한 값(비용 필드 형식이 다름)은 버리고 새로 읽음
const snapshot = atom({ plugin: 'usage-bar', key: 'snapshot' } as const, null, { shape: 'snap-2' })

// 비용 집계용 누적값
const costTrack = atom({ plugin: 'usage-bar', key: 'costTrack' } as const, null, { shape: 'cost-1' })

// 막대 길이(칸 수)
const BAR_WIDTH = 20

// 1%당 비용을 계산하기 전에 최소한 올라야 하는 %p (너무 작으면 오차가 큼)
const MIN_PCT_FOR_ESTIMATE = 2

// 한도 창 이름을 한국어 라벨로 변환
const KIND_LABEL: Record<string, string> = {
  five_hour: '5시간 한도',
  seven_day: '주간 한도',
  spend_limit: '지출 한도',
}

// 0~100 퍼센트를 █/░ 막대 문자열로 변환
function bar(percent: number): string {
  const p = Math.max(0, Math.min(100, percent))
  const filled = Math.round((p / 100) * BAR_WIDTH)
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

// 사용률에 따른 색상 (70% 미만 초록, 90% 미만 노랑, 그 이상 빨강)
function colorOf(percent: number): string {
  if (percent >= 90) return 'red'
  if (percent >= 70) return 'yellow'
  return 'green'
}

// 달러 표시 ($0.01 미만은 소수 셋째 자리까지)
function money(usd: number): string {
  return usd < 0.01 && usd > 0 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`
}

// 한국 표준시(KST, UTC+9) 오프셋 (밀리초) — 한국은 서머타임이 없어 고정값
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

// UTC 시각을 9시간 당긴 Date 로 변환 (이후 getUTC* 로 읽으면 한국 시간)
function toKst(ms: number): Date {
  return new Date(ms + KST_OFFSET_MS)
}

// 초기화 시각을 한국 시간 기준 "HH:MM" 또는 "M/D HH:MM" 으로 표시
// (실행 컴퓨터의 시간대 설정과 무관하게 항상 KST)
function formatReset(iso?: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const d = toKst(t)
  const now = toKst(Date.now())
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  const sameDay =
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  return sameDay ? `${hm} 초기화` : `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm} 초기화`
}

// ── 비용 집계 ─────────────────────────────────────────────

// 한도 기준점 갱신: 처음 보거나 한도가 초기화(%가 내려감)되면 지금을 기준점으로
function rebase(track: CostTrack, usd: number, limits: SessionRateLimit[]): CostTrack {
  const base = { ...track.base }
  for (const r of limits) {
    const b = base[r.kind]
    if (b === undefined || r.percentUsed < b.pct) {
      base[r.kind] = { usd, pct: r.percentUsed }
    }
  }
  return { ...track, base }
}

// 화면에 보일 비용 값 계산
function toCostView(track: CostTrack | null, usd: number | undefined, limits: SessionRateLimit[]): CostView | undefined {
  if (usd === undefined) return undefined
  const perPercent: PerPercent[] = []
  if (track !== null) {
    for (const r of limits) {
      const b = track.base[r.kind]
      if (b === undefined) continue
      const dPct = r.percentUsed - b.pct
      const dUsd = usd - b.usd
      if (dPct >= MIN_PCT_FOR_ESTIMATE && dUsd > 0) {
        perPercent.push({ label: KIND_LABEL[r.kind] ?? r.kind, usd: dUsd / dPct })
      }
    }
  }
  const turns = track?.turns ?? 0
  return {
    usd,
    lastTurnUsd: track?.lastTurnUsd,
    avgTurnUsd: track !== null && turns > 0 ? track.turnsUsd / turns : undefined,
    turns,
    perPercent,
  }
}

// 엔진 수치를 화면에 그릴 값으로 정리
function toSnapshot(
  context: SessionContextUsage,
  limits: SessionRateLimit[],
  usd: number | undefined,
  track: CostTrack | null,
): UsageSnapshot {
  const rows: UsageRow[] = []
  if (context.percent !== undefined) {
    rows.push({ label: '컨텍스트', percent: context.percent })
  }
  for (const r of limits) {
    rows.push({ label: KIND_LABEL[r.kind] ?? r.kind, percent: r.percentUsed, resetsAt: r.resetsAt })
  }
  return { rows, cost: toCostView(track, usd, limits) }
}

// 상태 표시줄용 한 줄 요약
function statusText(s: UsageSnapshot): string | undefined {
  const parts = s.rows.map(r => `${r.label} ${Math.round(r.percent)}%`)
  if (s.cost?.lastTurnUsd !== undefined) parts.push(`직전 작업 ${money(s.cost.lastTurnUsd)}`)
  return parts.length === 0 ? undefined : parts.join(' · ')
}

// 수치를 읽어 저장 (finishedTurn: 작업 1회가 끝난 시점이면 그 비용을 집계)
async function refresh($: EngineInterface, finishedTurn = false) {
  const u = await $.session.usage()
  const usd = u.cost?.usd
  let track = await read($, costTrack)

  if (usd !== undefined) {
    if (track === null) {
      // 처음: 지금까지의 비용을 출발점으로 삼음
      track = { lastUsd: usd, turns: 0, turnsUsd: 0, base: {} }
    } else if (finishedTurn && usd > track.lastUsd) {
      const turnUsd = usd - track.lastUsd
      track = { ...track, lastUsd: usd, lastTurnUsd: turnUsd, turns: track.turns + 1, turnsUsd: track.turnsUsd + turnUsd }
    }
    track = rebase(track, usd, u.rateLimits)
    const saved = track
    await update($, costTrack, () => saved)
  }

  const s = toSnapshot(u.context, u.rateLimits, usd, track)
  await update($, snapshot, () => s)
  $.ui.status(statusText(s))
}

// ── 화면 ─────────────────────────────────────────────────

// 패널 id 와 슬래시 명령 이름
const PANE_ID = 'usage-bar'
const COMMAND = 'usage-bar'

// 입력창에 이 문구만 보내면 사용량을 표시 (모바일용)
const TRIGGERS = new Set(['/usage-bar', '/사용량', '사용량'])

// 대화창에 배치한 행별 수치 (모듈 재로드 시 비워지며, 그때는 최신 수치로 표시)
const placedRows = new Map<string, UsageSnapshot>()
let rowSeq = 0

// 비용 안내 줄들 (화면·텍스트 공용)
function costLines(c: CostView): string[] {
  const lines: string[] = []
  const parts = [`이번 세션 ${money(c.usd)}`]
  if (c.lastTurnUsd !== undefined) parts.push(`직전 작업 ${money(c.lastTurnUsd)}`)
  if (c.avgTurnUsd !== undefined) parts.push(`작업당 평균 ${money(c.avgTurnUsd)} (${c.turns}회)`)
  lines.push(`예상 크레딧 ${parts.join(' · ')}`)
  for (const p of c.perPercent) {
    lines.push(`${p.label} 1% ≈ ${money(p.usd)}`)
  }
  return lines
}

// 화면 요소(Box/Text)는 화면 종류마다 타입이 달라 느슨하게 받음
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Els = { Box: any; Text: any }

// 막대 묶음 그리기 (입력창 위 band·패널·대화창 행이 함께 사용)
function drawUsage({ Box, Text }: Els, s: UsageSnapshot) {
  const labelWidth = Math.max(0, ...s.rows.map(r => r.label.length))
  return (
    <Box flexDirection="column">
      {s.rows.map(r => (
        <Box key={r.label}>
          <Text>{r.label.padEnd(labelWidth + 1, '　')}</Text>
          <Text color={colorOf(r.percent)}>{bar(r.percent)}</Text>
          <Text bold> {Math.round(r.percent)}%</Text>
          {r.resetsAt ? <Text dimColor>  ({formatReset(r.resetsAt)})</Text> : null}
        </Box>
      ))}
      {s.cost ? costLines(s.cost).map(line => <Text dimColor>{line}</Text>) : null}
    </Box>
  )
}

// 대화창에 남길 텍스트 버전
function usageText(s: UsageSnapshot | null): string {
  if (s === null || (s.rows.length === 0 && !s.cost)) {
    return '아직 사용량 수치가 없습니다. 응답을 한 번 받은 뒤 다시 실행해 주세요.'
  }
  const lines = s.rows.map(r => {
    const reset = r.resetsAt ? ` (${formatReset(r.resetsAt)})` : ''
    return `${r.label} ${bar(r.percent)} ${Math.round(r.percent)}%${reset}`
  })
  if (s.cost) lines.push(...costLines(s.cost))
  lines.push('※ 비용은 API 표준 단가 기준 추정치')
  return lines.join('\n')
}

// 한 줄 요약 (입력 가로채기 안내 문구용)
function usageLine(s: UsageSnapshot | null): string {
  if (s === null || (s.rows.length === 0 && !s.cost)) {
    return '아직 사용량 수치가 없습니다. 응답을 한 번 받은 뒤 다시 보내 주세요.'
  }
  const parts = s.rows.map(r => {
    const reset = r.resetsAt ? `(${formatReset(r.resetsAt)})` : ''
    return `${r.label} ${Math.round(r.percent)}%${reset}`
  })
  if (s.cost) parts.push(...costLines(s.cost))
  return `[사용량] ${parts.join(' · ')} ※ 비용은 API 단가 기준 추정`
}

// 고정 패널 열기 (이미 열려 있으면 그대로 유지)
async function openPane($: EngineInterface): Promise<UiOpenResult> {
  return $.ui.open({ id: PANE_ID, title: '사용량' })
}

// 패널 상태 진단 한 줄
async function paneDiag($: EngineInterface, r: UiOpenResult): Promise<string> {
  const surfaces = (await $.session.surfaces()).join(', ') || '없음'
  return r.isPlaced
    ? `[패널] 고정 표시 중 · 연결된 화면: ${surfaces}`
    : `[패널] 표시 대기 (${r.reason}) · 연결된 화면: ${surfaces}`
}

// 그릴 내용이 있는지
function hasContent(s: UsageSnapshot | null): s is UsageSnapshot {
  return s !== null && (s.rows.length > 0 || s.cost !== undefined)
}

export const register: Register = on => {
  // 세션 시작 시 수치를 읽고, 슬래시 명령 등록
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: COMMAND,
      description: '사용량(컨텍스트·5시간·주간 한도)과 예상 크레딧 비용 보기',
    })
    await refresh($)
    // 이미 앱이 연결된 상태로 시작·재로드되면 바로 패널을 엶
    const surfaces = await $.session.surfaces()
    if (surfaces.some(s => s !== 'terminal')) void openPane($)
    return result
  })

  // 앱(PC·모바일·웹)이 연결될 때마다 고정 패널을 열어 둠
  // (터미널은 입력창 위 band 가 이미 고정 표시하므로 제외)
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    if (e.surface !== 'terminal') void openPane($)
    return result
  })

  // /usage-bar : 고정 패널을 열고, 대화창에도 막대를 텍스트로 출력
  // 패널이 안 뜨는 화면이면 그 이유를 마지막 줄에 표시
  on('command.run', { command: COMMAND }, async $ => {
    await refresh($)
    const opened = await openPane($)
    const text = usageText(await read($, snapshot))
    return { text: `${text}\n${await paneDiag($, opened)}` }
  })

  // 모바일 앱은 슬래시 명령을 일반 메시지로 보내므로 입력 단계에서 직접 가로챔
  // "/usage-bar", "/사용량", "사용량" 을 보내면 모델에 보내지 않고 막대 행을 대화창에 표시
  on('prompt.submit', async ($, e, next) => {
    if (!TRIGGERS.has(e.text.trim())) {
      return next(e)
    }
    await refresh($)
    const s = await read($, snapshot)
    // 대화창 끝에 막대 행 배치 (모든 화면에서 그려지는 Placed 행)
    rowSeq += 1
    const id = `usage-${rowSeq}-${Date.now()}`
    if (s !== null) placedRows.set(id, s)
    void $.ui.place({ id })
    // 사람이 직접 보낸 요청이므로 좁은 화면(모바일)에서도 고정 패널이 열림
    void openPane($)
    // 모델 호출 없이 종료 — 안내 문구는 한 줄로 (줄바꿈이 깨지는 화면이 있음)
    return { drop: usageLine(s) }
  })

  // 메인 대화의 작업(턴) 1회가 끝나면 그 비용을 집계 (하위 에이전트 턴은 제외)
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await refresh($, true)
    return result
  })

  // 한도 수치가 바뀔 때마다 갱신 (작업 비용 집계는 turn.complete 에서만)
  on('session.measure', async ($, e, next) => {
    const track = await read($, costTrack)
    const s = toSnapshot(e.context, e.rateLimits, e.cost?.usd, track)
    await update($, snapshot, () => s)
    $.ui.status(statusText(s))
    return next(e)
  })

  // 프롬프트(채팅 입력창) 바로 위 band 에 막대 그리기 (터미널·데스크톱)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (e.props.hasSurvey || !hasContent(s)) {
      return next(e)
    }
    return drawUsage($.ui.resolve(e), s)
  })

  // 대화창에 배치한 막대 행 그리기 (요청 시점의 수치, 없으면 최신 수치)
  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== 'usage-bar') return next(e)
    const s = placedRows.get(e.props.id) ?? (await read($, snapshot))
    const { Box, Text } = $.ui.resolve(e)
    if (!hasContent(s)) {
      return <Text dimColor>응답을 한 번 받으면 사용량이 표시됩니다.</Text>
    }
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>사용량</Text>
        {drawUsage({ Box, Text }, s)}
        <Text dimColor>※ 비용은 API 표준 단가 기준 추정치</Text>
      </Box>
    )
  })

  // 사용량 패널 그리기 (모바일 포함 모든 화면)
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const s = await read($, snapshot)
    const { Box, Text } = $.ui.resolve(e)
    if (!hasContent(s)) {
      return <Text dimColor>응답을 한 번 받으면 사용량이 표시됩니다.</Text>
    }
    return (
      <Box flexDirection="column">
        {drawUsage({ Box, Text }, s)}
        <Text dimColor>※ 비용은 API 표준 단가 기준 추정치</Text>
      </Box>
    )
  })
}
