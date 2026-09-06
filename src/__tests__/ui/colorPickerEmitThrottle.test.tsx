/**
 * ColorPicker is optimistic: its handles move every frame, while `onChange`
 * — a store commit + CRDT op + canvas repaint per call — is leading+trailing
 * throttled. The first change in a burst fires immediately (single clicks
 * stay instant), the rest collapses to one trailing fire with the latest
 * value, and a pending trailing value is flushed on unmount rather than lost.
 * Without this an unthrottled drag overflows the collab socket backlog until
 * the write gate refuses edits.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ColorPicker } from '@ui/components/ColorPicker'

afterEach(cleanup)

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function renderPicker(values: string[]) {
  // Saturated red: every hue step changes the emitted hex, unlike black.
  return render(<ColorPicker value="#ff0000" onChange={(value) => values.push(value)} />)
}

describe('ColorPicker emit throttle', () => {
  it('fires a single change immediately', () => {
    const values: string[] = []
    renderPicker(values)
    fireEvent.keyDown(screen.getByLabelText('Hue'), { key: 'ArrowRight' })
    expect(values).toHaveLength(1)
    expect(values[0]).not.toBe('#ff0000')
  })

  it('collapses a burst to leading + trailing fires with the final value', async () => {
    const values: string[] = []
    renderPicker(values)
    const hue = screen.getByLabelText('Hue')
    for (let i = 0; i < 4; i += 1) fireEvent.keyDown(hue, { key: 'ArrowRight' })
    expect(values).toHaveLength(1)

    await sleep(160)
    expect(values).toHaveLength(2)
    // One step is 3.6° of hue (KEY_STEP 0.01); the trailing value carries all
    // four steps (14.4°), not just the second one.
    expect(values[0]).toBe('#ff0f00')
    expect(values[1]).toBe('#ff3d00')
  })

  it('flushes the pending trailing value on unmount instead of dropping it', () => {
    const values: string[] = []
    const view = renderPicker(values)
    const hue = view.getByLabelText('Hue')
    fireEvent.keyDown(hue, { key: 'ArrowRight' })
    fireEvent.keyDown(hue, { key: 'ArrowRight' })
    expect(values).toHaveLength(1)
    view.unmount()
    expect(values).toHaveLength(2)
  })
})
