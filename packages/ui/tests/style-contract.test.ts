import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('@mx-player-max/ui stylesheet contract', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../src/style.css'), 'utf8')
  const controller = readFileSync(resolve(import.meta.dirname, '../src/controller.ts'), 'utf8')

  it('publishes namespaced tokens and accessibility rules', () => {
    expect(css).toContain('--mxp-control-size: 36px')
    expect(css).toContain('border-radius: 50%')
    expect(css).toContain('.mxp-player-ui')
    expect(css).toContain(':focus-visible')
    expect(css).toContain('prefers-reduced-motion')
  })

  it('contains the 760px responsive rule and independent theme tokens', () => {
    expect(css).toContain('@media (max-width: 760px)')
    expect(css).toContain('@container (max-width: 760px)')
    expect(css).toContain('.mxp-volume-slider')
    expect(css).toContain('.mxp-theater-control')
    expect(css).toContain('[data-mxp-theme="light"]')
  })

  // The control shell carries one functional scrim so white controls stay legible over bright
  // frames. It has to come from the `--mxp-scrim` token, and nothing else may add a gradient.
  it('limits gradients to the scrim token and rejects negative letter spacing', () => {
    const gradientLines = css.split('\n').filter((line) => /gradient\s*\(/i.test(line))
    expect(gradientLines.length).toBeGreaterThan(0)
    for (const line of gradientLines) expect(line.trimStart().startsWith('--mxp-scrim:')).toBe(true)
    expect(css).toContain('background: var(--mxp-scrim)')
    expect(css).not.toMatch(/letter-spacing\s*:\s*-/i)
  })

  it('stays on SDK public state without media, subtitle, renderer, or persistence internals', () => {
    expect(controller).not.toMatch(/@mx-player-max\/(core|audio|subtitles|renderers|decoder|demux)/)
    expect(controller).not.toMatch(/HTMLVideoElement|HTMLCanvasElement|AudioContext|VideoFrame|GPUTexture|localStorage/)
  })

  // The right-click menu, the docked miniplayer and the diagnostic sheet are the only surfaces
  // allowed outside the bottom control shell, and the sheet is the only coloured one.
  it('publishes the menu, miniplayer and statistics surfaces with their own tokens', () => {
    expect(css).toContain('.mxp-context-menu')
    expect(css).toContain('.mxp-menu-separator')
    expect(css).toContain('.mxp-stats-overlay')
    expect(css).toContain('.mxp-stats-meter-fill')
    expect(css).toContain('.mxp-stats-graph')
    expect(css).toContain('.mxp-toast')
    expect(css).toContain('--mxp-stats-meter:')
    expect(css).toContain('--mxp-stats-warn:')
    expect(css).toContain('.mxp-player-host[data-mxp-mini="true"]')
  })
})
