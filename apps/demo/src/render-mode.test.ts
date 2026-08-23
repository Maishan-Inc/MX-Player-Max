import { describe, expect, it } from 'vitest'
import {
  RENDER_MODE_INTENT_VALUES,
  intentValueFromRenderMode,
  renderModeFromIntentValue,
  renderModePlayerOptions,
} from './render-mode'
import type { PlayerRenderMode } from '@mx-player-max/ui'

const MODES: readonly PlayerRenderMode[] = ['native', 'custom-webgpu', 'custom-fallback']

describe('demo render mode', () => {
  it('sends only the WebGPU mode down the AI-capable path', () => {
    expect(renderModePlayerOptions('custom-webgpu')).toEqual({ intent: 'ai-enhance', renderer: 'webgpu' })
    expect(renderModePlayerOptions('custom-fallback')).toEqual({ intent: 'filters', renderer: 'webgl2' })
    expect(renderModePlayerOptions('native')).toEqual({ intent: 'normal', renderer: null })
  })

  it('round-trips every mode through the launcher selector value', () => {
    for (const mode of MODES) expect(renderModeFromIntentValue(intentValueFromRenderMode(mode))).toBe(mode)
    for (const value of RENDER_MODE_INTENT_VALUES) expect(intentValueFromRenderMode(renderModeFromIntentValue(value))).toBe(value)
  })

  it('keeps the three selector values ADR-0006 pins down', () => {
    expect([...RENDER_MODE_INTENT_VALUES]).toEqual(['normal', 'filters', 'frame-access'])
  })

  it('falls back to native for an unknown selector value', () => {
    expect(renderModeFromIntentValue('editing')).toBe('native')
    expect(renderModeFromIntentValue('')).toBe('native')
  })
})
