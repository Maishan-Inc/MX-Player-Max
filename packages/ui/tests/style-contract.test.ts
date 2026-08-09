import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('@mx-player-max/ui stylesheet contract', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../src/style.css'), 'utf8')
  const controller = readFileSync(resolve(import.meta.dirname, '../src/controller.ts'), 'utf8')

  it('publishes namespaced tokens and accessibility rules', () => {
    expect(css).toContain('--mxp-control-size: 40px')
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

  it('does not inject decorative gradients or negative letter spacing', () => {
    expect(css).not.toMatch(/gradient\s*\(/i)
    expect(css).not.toMatch(/letter-spacing\s*:\s*-/i)
  })

  it('stays on SDK public state without media, subtitle, renderer, or persistence internals', () => {
    expect(controller).not.toMatch(/@mx-player-max\/(core|audio|subtitles|renderers|decoder|demux)/)
    expect(controller).not.toMatch(/HTMLVideoElement|HTMLCanvasElement|AudioContext|VideoFrame|GPUTexture|localStorage/)
  })
})
