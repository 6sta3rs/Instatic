/** Shared number and USD formatting for AI usage surfaces. */

/** Whole-number with en-US grouping, no fraction (e.g. token + chat counts). The
 * admin UI is English-only, so the label must not vary with the machine locale. */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/** USD spend: $0.00, "< $0.01" for tiny non-zero values, else 2-dp grouped. */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `< $0.01`
  if (usd < 1) return `$${usd.toFixed(2)}`
  return `$${usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

/** Token count → compact label: `12K`, `1.2M`, `800`. */
export function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round((tokens / 1_000_000) * 10) / 10}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}

/** A per-million-token USD price → compact label. `$3`, `$0.50`, `$1.25`. */
export function formatPerMTok(value: number): string {
  if (value === 0) return '$0'
  // Sub-dollar prices keep two decimals; whole-dollar prices drop the `.00`.
  const text = value < 1 ? value.toFixed(2) : String(Math.round(value * 100) / 100)
  return `$${text}`
}
