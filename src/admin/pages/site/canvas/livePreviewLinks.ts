/**
 * Live-preview link navigation.
 *
 * The live frame is an `about:srcdoc` iframe, so an internal `<a href="/about">`
 * would resolve against the ADMIN origin and load the admin app inside the
 * frame. Instead we intercept clicks: an internal path opens the matching
 * page in the canvas (so the preview navigates like the published site),
 * hash links keep their native in-frame scroll, and external links open in a
 * new tab so the editor is never navigated away.
 */

import { useEditorStore } from '@site/store/store'
import { isHomePage } from '@core/page-tree'

export function resolveLivePreviewPageId(href: string, origin: string): string | null {
  const url = new URL(href, origin)
  if (url.origin !== origin) return null
  const path = url.pathname.replace(/\/+$/, '')
  const pages = useEditorStore.getState().site?.pages ?? []
  const page = pages.find((p) => (path === '' ? isHomePage(p) : `/${p.slug}` === path))
  return page?.id ?? null
}

export function installLivePreviewLinkNavigation(doc: Document, origin: string): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return
    const target = event.target instanceof Element ? event.target : null
    const anchor = target?.closest('a[href]')
    if (!(anchor instanceof HTMLAnchorElement)) return
    const href = anchor.getAttribute('href') ?? ''
    if (href.startsWith('#')) return
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return
    event.preventDefault()
    const pageId = resolveLivePreviewPageId(href, origin)
    if (pageId) {
      useEditorStore.getState().openPageInCanvas(pageId)
      return
    }
    const url = new URL(href, origin)
    // ponytail: unknown internal paths (posts, dynamic routes) open the published page in a new tab
    doc.defaultView?.open(url.href, '_blank', 'noopener')
  }
  doc.addEventListener('click', onClick)
  return () => doc.removeEventListener('click', onClick)
}
