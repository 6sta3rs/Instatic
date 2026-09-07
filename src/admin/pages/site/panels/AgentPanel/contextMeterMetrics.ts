export type ContextMeterTone = 'empty' | 'healthy' | 'warning' | 'danger'

export interface ContextMeterMetrics {
  measured: boolean
  usedTokens: number
  remainingTokens: number
  usedPercentage: number | null
  remainingPercentage: number | null
  progressValue: number
  tone: ContextMeterTone
}

/** Turn a current-context snapshot into the ring meter's UI state. */
export function getContextMeterMetrics(
  usedTokens: number | null,
  windowTokens: number,
): ContextMeterMetrics {
  const measured = usedTokens !== null
  const safeUsed = measured ? Math.max(0, usedTokens) : 0
  const usedRatio = safeUsed / windowTokens
  const remainingTokens = Math.max(0, windowTokens - safeUsed)
  const remainingRatio = remainingTokens / windowTokens
  const tone: ContextMeterTone = !measured
    ? 'empty'
    : usedRatio > 0.8
      ? 'danger'
      : usedRatio > 0.6
        ? 'warning'
        : 'healthy'

  return {
    measured,
    usedTokens: safeUsed,
    remainingTokens,
    usedPercentage: measured ? Math.round(usedRatio * 100) : null,
    remainingPercentage: measured ? Math.round(remainingRatio * 100) : null,
    progressValue: remainingTokens,
    tone,
  }
}
