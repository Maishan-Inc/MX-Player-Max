import type { PlayerRenderMode } from '@mx-player-max/ui'
import type { PlaybackIntent, VideoRendererPreference } from '@mx-player-max/types'

/**
 * The demo exposes one render-path state through two controls: the launcher's
 * `playback-intent` selector (kept by ADR-0006) and the player's settings panel. They are
 * two views of the same value rather than competing knobs, so this module owns the mapping
 * in one place and stays a pure function the unit tests can pin down.
 */
export interface RenderModePlayerOptions {
  readonly intent: PlaybackIntent
  readonly renderer: VideoRendererPreference | null
}

/** The three intent values the launcher selector has always offered, in its own order. */
export const RENDER_MODE_INTENT_VALUES = ['normal', 'filters', 'frame-access'] as const

export type RenderModeIntentValue = (typeof RENDER_MODE_INTENT_VALUES)[number]

const BY_INTENT_VALUE: Readonly<Record<RenderModeIntentValue, PlayerRenderMode>> = {
  normal: 'native',
  filters: 'custom-fallback',
  'frame-access': 'custom-webgpu',
}

const BY_MODE: Readonly<Record<PlayerRenderMode, RenderModeIntentValue>> = {
  native: 'normal',
  'custom-fallback': 'filters',
  'custom-webgpu': 'frame-access',
}

/**
 * `ai-enhance` is what makes the strategy compute an `aiPlan`, so the WebGPU mode asks for it
 * rather than for `frame-access`; the AI toggles depend on that plan for their starting tier.
 * The fallback mode deliberately requests WebGL2 so the AI stages report `renderer-path` and the
 * two modes can be compared side by side.
 */
export function renderModePlayerOptions(mode: PlayerRenderMode): RenderModePlayerOptions {
  if (mode === 'custom-webgpu') return { intent: 'ai-enhance', renderer: 'webgpu' }
  if (mode === 'custom-fallback') return { intent: 'filters', renderer: 'webgl2' }
  return { intent: 'normal', renderer: null }
}

export function renderModeFromIntentValue(value: string): PlayerRenderMode {
  return BY_INTENT_VALUE[value as RenderModeIntentValue] ?? 'native'
}

export function intentValueFromRenderMode(mode: PlayerRenderMode): RenderModeIntentValue {
  return BY_MODE[mode] ?? 'normal'
}
