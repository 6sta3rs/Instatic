import { describe, expect, it } from 'bun:test'

describe('ClassPropertyRow remove button layout', () => {
  it('does not reserve a right-side gutter that shrinks property controls', async () => {
    const { readFileSync } = await import('fs')
    const css = readFileSync(
      new URL('../../admin/pages/site/panels/PropertiesPanel/ClassPropertyRow.module.css', import.meta.url),
      'utf-8',
    )

    expect(css).not.toMatch(/\.propertyRowWrap\[data-state="set"\]\s*\{[^}]*padding-right:/s)
  })

  it('overlays the remove button on the right end of the row, revealed on hover', async () => {
    // The × sits over the tail of the control and only appears on row hover /
    // focus-within, so the label column keeps its full width and there is no
    // fade overlay to paint. Pinned as a shape so a stray `left:` or a
    // `translateY(-50%)` centring hack doesn't creep back in.
    const { readFileSync } = await import('fs')
    const css = readFileSync(
      new URL('../../admin/pages/site/panels/PropertiesPanel/ClassPropertyRow.module.css', import.meta.url),
      'utf-8',
    )
    const compactCss = css.replace(/\s+/g, '')

    expect(css).toMatch(/--class-remove-row-center:\s*14px/)
    expect(css).toMatch(/--class-remove-button-size:\s*22px/)
    expect(css).not.toMatch(/--class-remove-label-column/)
    expect(css).not.toMatch(/\.propertyRowWrap\[data-state="set"\]::after/)
    expect(compactCss).toContain(
      '.removeBtn{position:absolute;top:calc(var(--class-remove-row-center)-(var(--class-remove-button-size)/2));',
    )
    expect(css).toMatch(/\.removeBtn\s*\{[^}]*right:\s*var\(--space-2xs\)/s)
    expect(css).toMatch(/\.removeBtn\.removeBtn\s*\{[^}]*width:\s*var\(--class-remove-button-size\)/s)
    expect(css).toMatch(/\.removeBtn\.removeBtn\s*\{[^}]*height:\s*var\(--class-remove-button-size\)/s)
    expect(css).not.toMatch(/\.removeBtn\s*\{[^}]*left:/s)
    expect(css).not.toMatch(/\.removeBtn\s*\{[^}]*translateY\(-50%\)/s)
    expect(css).toMatch(/\.propertyRowWrap:hover \.removeBtn[\s\S]*opacity:\s*1/)
  })

  it('uses a neutral remove affordance instead of the destructive danger hover style', async () => {
    const { readFileSync } = await import('fs')
    const rowSource = readFileSync(
      new URL('../../admin/pages/site/panels/PropertiesPanel/ClassPropertyRow.tsx', import.meta.url),
      'utf-8',
    )
    const css = readFileSync(
      new URL('../../admin/pages/site/panels/PropertiesPanel/ClassPropertyRow.module.css', import.meta.url),
      'utf-8',
    )

    // Neutral affordance: a bare glyph, no danger hover variant, subtle text
    // token at rest and the primary text token on hover. No pill or ring —
    // colour alone carries the state, like the media card's dismiss ×.
    expect(rowSource).not.toContain('dangerHover')
    expect(rowSource).toContain('<CloseIcon size={16}')
    expect(css).toMatch(/\.removeBtn\.removeBtn\s*\{[^}]*color:\s*var\(--text-subtle\)/s)
    expect(css).toMatch(/\.removeBtn\.removeBtn:hover[\s\S]*color:\s*var\(--text\)/s)
    expect(css).not.toContain('editor-danger')
  })
})

describe('StyleRuleComposer module style remove button layout', () => {
  it('does not reserve a right-side gutter for module-owned style rows', async () => {
    // Module-owned style rows were removed when classStyleBindings was deleted.
    // This gate ensures no moduleStyleRow padding-right accidentally reappears.
    const { readFileSync } = await import('fs')
    const css = readFileSync(
      new URL('../../admin/pages/site/panels/PropertiesPanel/StyleRuleComposer.module.css', import.meta.url),
      'utf-8',
    )

    expect(css).not.toMatch(/\.moduleStyleRow\s*\{[^}]*padding-right:/s)
  })
})
