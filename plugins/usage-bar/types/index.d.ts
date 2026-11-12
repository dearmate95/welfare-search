// usage-bar 가 $.state 에 저장하는 값의 타입 계약
export type UsageRow = { label: string; percent: number; resetsAt?: string }

// 한도 1% 를 쓰는 데 든 비용 추정 (예: 주간 한도 1% ≈ $0.45)
export type PerPercent = { label: string; usd: number }

// 비용 표시용 값 (API 단가 기준 추정)
export type CostView = {
  usd: number // 이번 세션 누적
  lastTurnUsd?: number // 직전 작업(턴) 1회
  avgTurnUsd?: number // 작업 1회 평균
  turns: number // 집계한 작업 수
  perPercent: PerPercent[]
}

export type UsageSnapshot = { rows: UsageRow[]; cost?: CostView }

// 비용 집계용 누적값 (모듈이 다시 불러와져도 유지)
export type CostTrack = {
  lastUsd: number // 직전 작업이 끝났을 때의 누적 비용
  lastTurnUsd?: number
  turns: number
  turnsUsd: number // 집계한 작업들의 비용 합계
  // 한도 종류별 기준점: 이 시점부터 오른 % 와 비용으로 1%당 비용 계산
  base: Record<string, { usd: number; pct: number }>
}

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': {
      snapshot: Shaped<UsageSnapshot | null>
      costTrack: Shaped<CostTrack | null>
      autoLine: boolean // 답변 아래 사용량 줄 표시 여부
    }
  }
}
