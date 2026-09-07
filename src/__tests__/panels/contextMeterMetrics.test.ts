import { describe, expect, it } from 'bun:test'
import { getContextMeterMetrics } from '@site/panels/AgentPanel'

describe('context meter metrics', () => {
  it.each([
    [null, 'empty'],
    [0, 'healthy'],
    [1, 'healthy'],
    [200, 'healthy'],
    [400, 'healthy'],
    [600, 'healthy'],
    [601, 'warning'],
    [800, 'warning'],
    [801, 'danger'],
    [1000, 'danger'],
    [1200, 'danger'],
  ] as const)(
    'maps %s used tokens to %s tone',
    (usedTokens, tone) => {
      expect(getContextMeterMetrics(usedTokens, 1000).tone).toBe(tone)
    },
  )

  it('keeps unknown context indeterminate and clamps invalid progress values', () => {
    expect(getContextMeterMetrics(null, 1000)).toMatchObject({
      measured: false,
      usedPercentage: null,
      remainingPercentage: null,
      progressValue: 1000,
      remainingTokens: 1000,
    })
    expect(getContextMeterMetrics(-50, 1000)).toMatchObject({
      measured: true,
      usedTokens: 0,
      progressValue: 1000,
      usedPercentage: 0,
      remainingPercentage: 100,
    })
    expect(getContextMeterMetrics(1200, 1000)).toMatchObject({
      measured: true,
      progressValue: 0,
      remainingTokens: 0,
      usedPercentage: 120,
      remainingPercentage: 0,
    })
  })
})
