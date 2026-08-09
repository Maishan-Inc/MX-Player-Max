import type { SourceDescriptor, SubtitleCueStyle, SubtitleStyleStore } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { SubtitleError } from './errors'

export const DEFAULT_SUBTITLE_STYLE: Readonly<Required<SubtitleCueStyle>> = {
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Microsoft YaHei", "Yu Gothic", "Malgun Gothic", "PingFang SC", "Hiragino Sans GB", sans-serif',
  fontSize: 36,
  color: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 2,
  bold: false,
  italic: false,
  underline: false,
  alignment: 'bottom-center',
  x: 50,
  y: 88,
}

const STORAGE_PREFIX = 'mxp-subtitle-style:v1:'

export class MemorySubtitleStyleStore implements SubtitleStyleStore {
  readonly #styles = new Map<string, SubtitleCueStyle>()

  load(scope: string): SubtitleCueStyle {
    const value = this.#styles.get(scope)
    return normalizeSubtitleStyle(value ?? DEFAULT_SUBTITLE_STYLE)
  }

  save(scope: string, style: SubtitleCueStyle): void {
    this.#styles.set(scope, normalizeSubtitleStyle(style))
  }

  clear(scope: string): void { this.#styles.delete(scope) }
}

export class LocalSubtitleStyleStore implements SubtitleStyleStore {
  readonly #fallback: SubtitleStyleStore
  readonly #storage: Storage | null

  constructor(fallback: SubtitleStyleStore = new MemorySubtitleStyleStore()) {
    this.#fallback = fallback
    this.#storage = resolveStorage()
  }

  load(scope: string): SubtitleCueStyle {
    if (!this.#storage) return this.#fallback.load(scope)
    try {
      const raw = this.#storage.getItem(storageKey(scope))
      if (raw === null) return this.#fallback.load(scope)
      const parsed: unknown = JSON.parse(raw)
      if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.style)) return this.#fallback.load(scope)
      return assertSubtitleStyle(parsed.style as SubtitleCueStyle)
    } catch {
      return this.#fallback.load(scope)
    }
  }

  save(scope: string, style: SubtitleCueStyle): void {
    const normalized = normalizeSubtitleStyle(style)
    if (!this.#storage) {
      this.#fallback.save(scope, normalized)
      return
    }
    try {
      this.#storage.setItem(storageKey(scope), JSON.stringify({ version: 1, style: normalized }))
    } catch {
      this.#fallback.save(scope, normalized)
    }
  }

  clear(scope: string): void {
    try { this.#storage?.removeItem(storageKey(scope)) } catch { /* storage is optional */ }
    try { this.#fallback.clear?.(scope) } catch { /* fallback storage is optional */ }
  }
}

export function createDefaultSubtitleStyleStore(): SubtitleStyleStore {
  return new LocalSubtitleStyleStore()
}

export function subtitleStyleScope(source: SourceDescriptor): string {
  if (source.kind === 'file') return 'local-file'
  try {
    const base = typeof document !== 'undefined' ? document.baseURI : undefined
    const url = new URL(source.url, base)
    return url.origin === 'null' ? 'unknown-host' : url.origin
  } catch {
    return 'unknown-host'
  }
}

export function normalizeSubtitleStyle(style: SubtitleCueStyle | Readonly<Record<string, unknown>>): SubtitleCueStyle {
  const input = style as Readonly<Record<string, unknown>>
  const fontFamily = typeof input.fontFamily === 'string' && validFontFamily(input.fontFamily) ? input.fontFamily : DEFAULT_SUBTITLE_STYLE.fontFamily
  const fontSize = boundedNumber(input.fontSize, DEFAULT_SUBTITLE_STYLE.fontSize, 6, 256)
  const color = validColor(input.color) ? input.color : DEFAULT_SUBTITLE_STYLE.color
  const outlineColor = validColor(input.outlineColor) ? input.outlineColor : DEFAULT_SUBTITLE_STYLE.outlineColor
  const outlineWidth = boundedNumber(input.outlineWidth, DEFAULT_SUBTITLE_STYLE.outlineWidth, 0, 16)
  const alignment = isAlignment(input.alignment) ? input.alignment : DEFAULT_SUBTITLE_STYLE.alignment
  const x = boundedNumber(input.x, DEFAULT_SUBTITLE_STYLE.x, 0, 100)
  const y = boundedNumber(input.y, DEFAULT_SUBTITLE_STYLE.y, 0, 100)
  return {
    fontFamily, fontSize, color, outlineColor, outlineWidth,
    bold: typeof input.bold === 'boolean' ? input.bold : DEFAULT_SUBTITLE_STYLE.bold,
    italic: typeof input.italic === 'boolean' ? input.italic : DEFAULT_SUBTITLE_STYLE.italic,
    underline: typeof input.underline === 'boolean' ? input.underline : DEFAULT_SUBTITLE_STYLE.underline,
    alignment, x, y,
  }
}

export function assertSubtitleStyle(style: SubtitleCueStyle): SubtitleCueStyle {
  if (!isRecord(style)) throw new SubtitleError(ErrorCodes.SUBTITLE_STYLE_INVALID, 'Subtitle style is invalid', false)
  const input: Readonly<Record<string, unknown>> = style
  const allowed = new Set(['fontFamily', 'fontSize', 'color', 'outlineColor', 'outlineWidth', 'bold', 'italic', 'underline', 'alignment', 'x', 'y'])
  for (const key of Object.keys(style)) if (!allowed.has(key)) throw new SubtitleError(ErrorCodes.SUBTITLE_STYLE_INVALID, 'Subtitle style contains an unsupported field', false)
  if (input.fontFamily !== undefined && (typeof input.fontFamily !== 'string' || !validFontFamily(input.fontFamily))) throw new SubtitleError(ErrorCodes.SUBTITLE_STYLE_INVALID, 'Subtitle font family is invalid', false)
  if (input.fontSize !== undefined && !inRange(input.fontSize, 6, 256)) throw new SubtitleError(ErrorCodes.SUBTITLE_STYLE_INVALID, 'Subtitle font size is invalid', false)
  if (input.color !== undefined && !validColor(input.color)) throw new SubtitleError(ErrorCodes.SUBTITLE_STYLE_INVALID, 'Subtitle color is invalid', false)
  if (input.outlineColor !== undefined && !validColor(input.outlineColor)) throw new SubtitleError(ErrorCodes.SUBTITLE_STYLE_INVALID, 'Subtitle outline color is invalid', false)
  if (input.outlineWidth !== undefined && !inRange(input.outlineWidth, 0, 16)) throw new SubtitleError(ErrorCodes.SUBTITLE_STYLE_INVALID, 'Subtitle outline width is invalid', false)
  if (input.bold !== undefined && typeof input.bold !== 'boolean') throw new SubtitleError(ErrorCodes.SUBTITLE_STYLE_INVALID, 'Subtitle bold value is invalid', false)
  if (input.italic !== undefined && typeof input.italic !== 'boolean') throw new SubtitleError(ErrorCodes.SUBTITLE_STYLE_INVALID, 'Subtitle italic value is invalid', false)
  if (input.underline !== undefined && typeof input.underline !== 'boolean') throw new SubtitleError(ErrorCodes.SUBTITLE_STYLE_INVALID, 'Subtitle underline value is invalid', false)
  if (input.alignment !== undefined && !isAlignment(input.alignment)) throw new SubtitleError(ErrorCodes.SUBTITLE_STYLE_INVALID, 'Subtitle alignment is invalid', false)
  if (input.x !== undefined && !inRange(input.x, 0, 100)) throw new SubtitleError(ErrorCodes.SUBTITLE_STYLE_INVALID, 'Subtitle x position is invalid', false)
  if (input.y !== undefined && !inRange(input.y, 0, 100)) throw new SubtitleError(ErrorCodes.SUBTITLE_STYLE_INVALID, 'Subtitle y position is invalid', false)
  return normalizeSubtitleStyle(style)
}

function resolveStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const probe = '__mxp_subtitle_style_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    return null
  }
}

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(scope).slice(0, 256)}`
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validFontFamily(value: string): boolean {
  return value.length > 0
    && value.length <= 512
    && !/[;(){}<>\\\r\n\u0000-\u001f]/u.test(value)
    && !/\b(?:url|var|expression)\s*\(/iu.test(value)
    && !/!\s*important\b/iu.test(value)
}

function validColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu.test(value)
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback
}

function inRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function isAlignment(value: unknown): value is NonNullable<SubtitleCueStyle['alignment']> {
  return typeof value === 'string' && [
    'top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right',
    'bottom-left', 'bottom-center', 'bottom-right',
  ].includes(value)
}
