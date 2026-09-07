import { beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { useEditorStore } from '@site/store/store'
import { CanvasRoot } from '@site/canvas/CanvasRoot'
import { installLivePreviewLinkNavigation, resolveLivePreviewPageId } from '@site/canvas/livePreviewLinks'
import { waitForCanvasNodeInFrame } from './iframeCanvasQuery'
import '@modules/base'

beforeEach(() => {
  cleanup()
})

describe('live view is a read-only preview', () => {
  it('clicking a node in the live frame does not select it', async () => {
    const site = useEditorStore.getState().createSite('Live Preview')
    const page = site.pages[0]!
    const textId = useEditorStore.getState().insertNode('base.text', { text: 'Hello' }, page.rootNodeId)
    const emptyTextId = useEditorStore.getState().insertNode('base.text', { text: '' }, page.rootNodeId)
    const emptyButtonId = useEditorStore.getState().insertNode('base.button', { label: '' }, page.rootNodeId)
    useEditorStore.setState({ canvasView: 'live' })

    render(<DndContext><CanvasRoot /></DndContext>)
    const bp = useEditorStore.getState().activeBreakpointId
    const el = await waitForCanvasNodeInFrame<HTMLElement>(bp, textId)

    act(() => { fireEvent.click(el) })
    expect(useEditorStore.getState().selectedNodeIds).toEqual([])
    expect(el.hasAttribute('data-canvas-selected')).toBe(false)
    expect(el.hasAttribute('tabindex')).toBe(false)

    // Empty nodes render as published — no "Text" / "Button" canvas placeholders.
    expect((await waitForCanvasNodeInFrame<HTMLElement>(bp, emptyTextId)).textContent).toBe('')
    expect((await waitForCanvasNodeInFrame<HTMLElement>(bp, emptyButtonId)).textContent).toBe('')
  })
})

describe('live preview link navigation', () => {
  it('maps internal hrefs to pages and opens them in the canvas', () => {
    const store = useEditorStore.getState()
    const site = store.createSite('Links')
    const home = site.pages[0]!
    const aboutId = store.addPage('About', 'about').id
    const origin = 'http://admin.test'

    expect(resolveLivePreviewPageId('/about', origin)).toBe(aboutId)
    expect(resolveLivePreviewPageId('/', origin)).toBe(home.id)
    expect(resolveLivePreviewPageId('https://example.com/x', origin)).toBeNull()

    const doc = document.implementation.createHTMLDocument('frame')
    const a = doc.createElement('a')
    a.setAttribute('href', '/about')
    doc.body.appendChild(a)
    const dispose = installLivePreviewLinkNavigation(doc, origin)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    a.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(useEditorStore.getState().activePageId).toBe(aboutId)
    dispose()
  })
})
