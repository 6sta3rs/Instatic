import { INTERRUPTED_TOOL_RESULT_ERROR, aiToolError } from '@core/ai'
import type { AgentMessage, AgentToolCall } from './types'

/**
 * A pending tool call belongs only to the currently live response stream.
 * Once that stream ends or fails, every unresolved call is historical and
 * must become terminal so the panel never leaves a permanent spinner behind.
 */
export function failPendingToolCalls(
  message: AgentMessage | undefined,
  error: string = INTERRUPTED_TOOL_RESULT_ERROR,
): boolean {
  if (!message) return false

  let changed = false
  for (const block of message.blocks) {
    if (block.kind !== 'toolCall' || block.toolCall.status !== 'pending') continue
    block.toolCall.status = 'error'
    block.toolCall.durationMs = toolCallDurationMs(block.toolCall)
    block.toolCall.result = aiToolError(error)
    changed = true
  }
  return changed
}

/** Wall-clock time since the browser saw the call start; undefined for rehydrated rows. */
export function toolCallDurationMs(call: AgentToolCall): number | undefined {
  return call.startedAt === undefined ? undefined : Date.now() - call.startedAt
}
