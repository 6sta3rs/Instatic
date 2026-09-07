/**
 * ContextMeter — a small ring showing how much of the active model's context
 * window is still free, with a tooltip carrying the exact counts, cumulative
 * conversation billing, and the model's list rates.
 */
import type { CSSProperties } from 'react'
import { useAgentStore } from '@admin/ai/useAgentStore'
import { formatCompactTokens, formatCost, formatNumber, formatPerMTok } from '@admin/ai/usageFormat'
import { Button } from '@ui/components/Button'
import { Tooltip } from '@ui/components/Tooltip'
import { getContextMeterMetrics } from './contextMeterMetrics'
import styles from './ContextMeter.module.css'

interface ContextMeterProps {
  /** Active selection, used to reject a snapshot measured by another provider/model. */
  credentialId: string | null
  modelId: string | null
  /** Active model's max context window, or null when unknown (hides the meter). */
  windowTokens: number | null
  pricing: {
    inputPerMTok: number
    outputPerMTok: number
  } | null
}

export function ContextMeter({ credentialId, modelId, windowTokens, pricing }: ContextMeterProps) {
  const usage = useAgentStore((state) => state.agentUsage)

  if (windowTokens === null || windowTokens <= 0) return null

  const selectionOwnsContext = usage.contextCredentialId === credentialId
    && usage.contextModelId === modelId
  const conversationIsEmpty = usage.promptTokens === 0
    && usage.completionTokens === 0
    && usage.cacheReadTokens === 0
    && usage.cacheCreationTokens === 0
    && usage.costUsd === 0
  const currentContext = selectionOwnsContext && usage.contextTokens !== null
    ? usage.contextTokens
    : conversationIsEmpty
      ? 0
      : null
  const metrics = getContextMeterMetrics(currentContext, windowTokens)
  const valueText = metrics.measured
    ? `${formatNumber(metrics.remainingTokens)} of ${formatNumber(windowTokens)} context tokens available (${metrics.remainingPercentage}%)`
    : `Context has not been measured for this model yet; ${formatNumber(windowTokens)} token window`

  const details = (
    <div className={styles.details}>
      <strong className={styles.headline}>
        {metrics.measured ? `${metrics.remainingPercentage}% available` : 'Waiting for a response'}
      </strong>
      <span className={styles.numbers}>
        {metrics.measured
          ? `${formatCompactTokens(metrics.usedTokens)} used · ${formatCompactTokens(metrics.remainingTokens)} available`
          : `Updates after the next response · ${formatCompactTokens(windowTokens)} window`}
      </span>
      <span className={styles.billing}>
        Conversation billing <strong>{formatCost(usage.costUsd)}</strong>
      </span>
      <dl className={styles.usageGrid}>
        <dt>Input</dt>
        <dd>{formatNumber(usage.promptTokens)}</dd>
        <dt>Output</dt>
        <dd>{formatNumber(usage.completionTokens)}</dd>
        <dt>Cache read</dt>
        <dd>{formatNumber(usage.cacheReadTokens)}</dd>
        <dt>Cache write</dt>
        <dd>{formatNumber(usage.cacheCreationTokens)}</dd>
      </dl>
      {pricing && (
        <span className={styles.pricing}>
          {formatPerMTok(pricing.inputPerMTok)} in · {formatPerMTok(pricing.outputPerMTok)} out · per 1M tokens
        </span>
      )}
    </div>
  )

  return (
    <Tooltip content={details} side="top" align="end" size="wide" openOnFocus>
      <Button
        variant="ghost"
        size="xs"
        className={styles.meter}
        data-tone={metrics.tone}
        style={{ '--meter-fill': metrics.remainingPercentage ?? 100 } as CSSProperties}
        aria-label={`AI context remaining: ${valueText}`}
      >
        <span className={styles.ring} aria-hidden="true" />
      </Button>
    </Tooltip>
  )
}
