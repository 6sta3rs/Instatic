import { afterEach, describe, expect, it } from 'bun:test'
import { runToolLoop } from './toolLoop'
import { makeChatCompletionsAdapter } from './chatCompletions'
import type { AiStreamRequest } from '../types'
import type { AiStreamEvent } from '../../runtime/types'

/**
 * A round that ends with neither text nor tool calls, or one the provider's
 * output cap cut off, used to end the turn in silence — the user saw the agent
 * read a few documents and then stop with no reply. Both must surface as a
 * stream error (after the usage event, so the round is still billed).
 */

const realFetch = globalThis.fetch

function sseResponse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function stubFetch(responses: Response[]): void {
  const queue = [...responses]
  globalThis.fetch = (async () => {
    const next = queue.shift()
    if (!next) throw new Error('unexpected extra provider round')
    return next
  }) as typeof fetch
}

function request(): AiStreamRequest {
  return {
    systemPrompt: ['be terse'],
    messages: [{ role: 'user', content: [{ kind: 'text', text: 'hi' }] }],
    tools: [],
    modelId: 'test-model',
    modelCapabilities: {
      toolCalling: true,
      visionInput: false,
      toolResultImages: false,
      promptCache: false,
      streaming: true,
    },
    credentials: { apiKey: 'k', baseUrl: null },
    signal: new AbortController().signal,
    bridge: { callBrowser: async () => ({ ok: false, error: 'no bridge' }) },
    toolContextBase: {
      db: null as never,
      userId: 'u',
      capabilities: [],
      scope: 'site',
      conversationId: 'c',
      snapshot: null,
    },
  } as unknown as AiStreamRequest
}

async function collect(): Promise<AiStreamEvent[]> {
  const adapter = makeChatCompletionsAdapter({ baseUrl: 'https://example.test', apiKey: 'k', label: 'Test' })
  const events: AiStreamEvent[] = []
  for await (const event of runToolLoop(adapter, request())) events.push(event)
  return events
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('runToolLoop silent-turn guards', () => {
  it('reports an empty round (no text, no tool calls) as an error after the usage event', async () => {
    stubFetch([
      sseResponse([
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 0 } },
      ]),
    ])
    const events = await collect()
    const types = events.map((e) => e.type)
    expect(types).toEqual(['context', 'usage', 'error'])
    const error = events.find((e) => e.type === 'error')
    expect(error && 'message' in error ? error.message : '').toContain('empty reply')
  })

  it('reports finish_reason=length as a truncated reply instead of a clean stop', async () => {
    stubFetch([
      sseResponse([
        { choices: [{ delta: { content: 'Half a sen' } }] },
        { choices: [{ delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
      ]),
    ])
    const events = await collect()
    expect(events.map((e) => e.type)).toEqual(['text', 'context', 'usage', 'error'])
    const error = events.find((e) => e.type === 'error')
    expect(error && 'message' in error ? error.message : '').toContain('output token limit')
  })

  it('still ends a normal text reply cleanly', async () => {
    stubFetch([
      sseResponse([
        { choices: [{ delta: { content: 'Done.' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
      ]),
    ])
    const events = await collect()
    expect(events.map((e) => e.type)).toEqual(['text', 'context', 'usage'])
  })
})
