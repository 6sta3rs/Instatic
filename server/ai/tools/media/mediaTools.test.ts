import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { ToolContext } from '../../runtime/types'
import { mediaTools } from './index'
import { siteTools } from '../site'
import { contentTools } from '../content'

const realKey = process.env.UNSPLASH_ACCESS_KEY

beforeEach(() => {
  delete process.env.UNSPLASH_ACCESS_KEY
})

afterEach(() => {
  if (realKey === undefined) delete process.env.UNSPLASH_ACCESS_KEY
  else process.env.UNSPLASH_ACCESS_KEY = realKey
})

function tool(name: string) {
  const found = mediaTools.find((t) => t.name === name)
  if (!found?.handler) throw new Error(`${name} missing or has no handler`)
  return found
}

const ctx = { signal: new AbortController().signal, userId: 'u', db: null } as unknown as ToolContext

describe('shared media tools', () => {
  it('are registered in BOTH the site and content scopes', () => {
    for (const toolset of [siteTools, contentTools]) {
      const names = toolset.map((t) => t.name)
      expect(names).toContain('media_list')
      expect(names).toContain('media_search_unsplash')
      expect(names).toContain('media_import_unsplash')
    }
  })

  it('stamp import as the only mutating tool, gated on media.write', () => {
    expect(tool('media_list').mutates).toBe(false)
    expect(tool('media_search_unsplash').mutates).toBe(false)
    expect(tool('media_search_unsplash').requiredCapabilities).toEqual(['media.read'])
    expect(tool('media_import_unsplash').mutates).toBe(true)
    expect(tool('media_import_unsplash').requiredCapabilities).toEqual(['media.write'])
  })

  it('tell the model to fall back to the library when Unsplash is not configured', async () => {
    await expect(tool('media_search_unsplash').handler!({ query: 'forest' }, ctx)).rejects.toThrow(/media_list/)
    await expect(tool('media_import_unsplash').handler!({ photoId: 'abc' }, ctx)).rejects.toThrow(/UNSPLASH_ACCESS_KEY/)
  })
})
