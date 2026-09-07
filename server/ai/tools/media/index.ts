/**
 * Media tools — shared by the Site and Content agent scopes (and, through
 * them, by MCP connectors).
 *
 * The Site agent writes `<img>` tags but had no way to find an image: it
 * could not see the library and could not fetch a stock photo, so it either
 * hotlinked a guessed URL or left the slot empty. These three server-resolved
 * tools close that gap with the same primitives the Media workspace uses:
 *
 *   - `media_list`             — the library (`listMediaAssets`)
 *   - `media_search_unsplash`  — Unsplash search (`unsplashClient.searchPhotos`)
 *   - `media_import_unsplash`  — the exact import the Media page runs
 *                                (`importUnsplashPhoto`: licence download ping,
 *                                SSRF-guarded fetch, upload pipeline, credit line)
 *
 * Search deliberately returns no image URLs. Unsplash's terms want the
 * photographer credited and the download tracked when a photo is USED; the
 * import path does both, a hotlinked `<img src>` does neither. The agent gets
 * ids and descriptions to choose from, and a `publicPath` only after import.
 *
 * Capabilities mirror the HTTP routes: reads need `media.read`, import needs
 * `media.write` (plus `ai.tools.write` via the `mutates` stamp).
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import type { AiTool } from '../types'
import { listMediaAssets } from '../../../repositories/media'
import { isUnsplashConfigured, searchPhotos } from '../../../handlers/cms/unsplashClient'
import { importUnsplashPhoto } from '../../../handlers/cms/mediaUnsplash'

/** Enough to choose from without flooding the context; Unsplash caps at 30. */
const UNSPLASH_PAGE_SIZE = 12

/**
 * Turn a ready-to-send error `Response` from the media pipeline into the
 * message a tool error should carry. The pipeline speaks HTTP (`{ error }`
 * envelopes with a status); a tool has no HTTP surface, so the envelope text
 * is the whole story.
 */
export async function mediaResponseErrorMessage(res: Response): Promise<string> {
  const message = await res
    .json()
    .then((body: { error?: string }) => body.error)
    .catch(() => null)
  return message ?? `Media request rejected (HTTP ${res.status}).`
}

// ---------------------------------------------------------------------------
// media_list
// ---------------------------------------------------------------------------

const ListMediaInput = Type.Object({
  query: Type.Optional(Type.String()),
  mimeType: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})

const listMediaTool: AiTool = {
  name: 'media_list',
  scope: 'shared',
  execution: 'server',
  mutates: false,
  requiredCapabilities: ['media.read'],
  description:
    "List existing media assets in the library. Returns id, filename, publicPath, mimeType, altText, width, height. Use `publicPath` as an <img src> on a page, or `{ id }` for a media-typed content field. Optional `query` substring-matches filename + altText (case-insensitive); `mimeType` substring-matches the mime (e.g. 'image'). `limit` default 25, max 100. Need a photo the library doesn't have? Use media_search_unsplash + media_import_unsplash.",
  inputSchema: ListMediaInput,
  handler: async (input, ctx) => {
    const args = input as Static<typeof ListMediaInput>
    const all = await listMediaAssets(ctx.db)
    const lowerQuery = args.query?.toLowerCase()
    const lowerMime = args.mimeType?.toLowerCase()
    const filtered = all.filter((asset) => {
      if (lowerMime && !asset.mimeType.toLowerCase().includes(lowerMime)) return false
      if (lowerQuery) {
        const haystack = `${asset.filename ?? ''} ${asset.altText ?? ''}`.toLowerCase()
        if (!haystack.includes(lowerQuery)) return false
      }
      return true
    })
    const limit = args.limit ?? 25
    return {
      total: filtered.length,
      media: filtered.slice(0, limit).map((m) => ({
        id: m.id,
        filename: m.filename,
        publicPath: m.publicPath,
        mimeType: m.mimeType,
        altText: m.altText,
        width: m.width,
        height: m.height,
      })),
    }
  },
}

// ---------------------------------------------------------------------------
// media_search_unsplash
// ---------------------------------------------------------------------------

const SearchUnsplashInput = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 200 }),
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})

const NOT_CONFIGURED =
  'Unsplash is not configured on this installation (UNSPLASH_ACCESS_KEY is unset). Use media_list to pick from the existing library instead.'

const searchUnsplashTool: AiTool = {
  name: 'media_search_unsplash',
  scope: 'shared',
  execution: 'server',
  mutates: false,
  requiredCapabilities: ['media.read'],
  description:
    'Search Unsplash for a stock photo. Returns up to 12 candidates per `page` with id, description, width, height, and photographer. Pick one and call media_import_unsplash with its id — that is what produces a usable publicPath; there is no direct image URL to hotlink. Describe the subject concretely (e.g. "mountain lake at sunrise", not "nice background"). Fails with a clear message when the installation has no Unsplash key.',
  inputSchema: SearchUnsplashInput,
  handler: async (input, ctx) => {
    const args = input as Static<typeof SearchUnsplashInput>
    if (!isUnsplashConfigured()) throw new Error(NOT_CONFIGURED)
    const result = await searchPhotos(args.query, args.page ?? 1, UNSPLASH_PAGE_SIZE, ctx.signal)
    return {
      photos: result.photos.map((p) => ({
        id: p.id,
        description: p.description,
        width: p.width,
        height: p.height,
        photographerName: p.photographerName,
      })),
      hasMore: result.hasMore,
    }
  },
}

// ---------------------------------------------------------------------------
// media_import_unsplash
// ---------------------------------------------------------------------------

const ImportUnsplashInput = Type.Object({
  photoId: Type.String({ minLength: 1, maxLength: 128 }),
})

const importUnsplashTool: AiTool = {
  name: 'media_import_unsplash',
  scope: 'shared',
  execution: 'server',
  mutates: true,
  requiredCapabilities: ['media.write'],
  description:
    'Import one Unsplash photo (by the id from media_search_unsplash) into the Media library and return the asset: id, publicPath, altText, caption, width, height. Use `publicPath` as the <img src> (or `{ id }` for a media field). The photographer credit is stored in `caption`. Import each photo once and reuse the path.',
  inputSchema: ImportUnsplashInput,
  handler: async (input, ctx) => {
    const args = input as Static<typeof ImportUnsplashInput>
    if (!isUnsplashConfigured()) throw new Error(NOT_CONFIGURED)
    const asset = await importUnsplashPhoto(ctx.db, {
      photoId: args.photoId,
      uploadedByUserId: ctx.userId,
      signal: ctx.signal,
    })
    if (asset instanceof Response) throw new Error(await mediaResponseErrorMessage(asset))
    return {
      id: asset.id,
      publicPath: asset.publicPath,
      altText: asset.altText,
      caption: asset.caption,
      width: asset.width,
      height: asset.height,
    }
  },
}

export const mediaTools: AiTool[] = [listMediaTool, searchUnsplashTool, importUnsplashTool]
