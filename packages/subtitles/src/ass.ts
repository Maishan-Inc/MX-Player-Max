import type {
  SubtitleCue,
  SubtitleCueStyle,
  SubtitleDiagnostic,
  SubtitleParseResult,
  SubtitleParserLimitsInput,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import {
  checkBudget,
  createDiagnosticCollector,
  normalizeLines,
  parseTimestamp,
  readParserTime,
  safeTrackId,
  type DiagnosticCollector,
} from './parser-common'
import { resolveSubtitleParserLimits } from './limits'
import { DEFAULT_SUBTITLE_STYLE, normalizeSubtitleStyle } from './style-store'

export interface AssParserOptions {
  trackId?: string
  limits?: SubtitleParserLimitsInput
  now?: () => number
}

interface AssContext {
  playResX: number | null
  playResY: number | null
  styles: Map<string, SubtitleCueStyle>
  styleFormat: string[]
  eventFormat: string[]
  v4Plus: boolean
}

const DEFAULT_EVENT_FORMAT = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
const DEFAULT_SSA_EVENT_FORMAT = ['marked', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
const DEFAULT_V4_PLUS_STYLE_FORMAT = ['name', 'fontname', 'fontsize', 'primarycolour', 'secondarycolour', 'outlinecolour', 'backcolour', 'bold', 'italic', 'underline', 'strikeout', 'scalex', 'scaley', 'spacing', 'angle', 'borderstyle', 'outline', 'shadow', 'alignment', 'marginl', 'marginr', 'marginv', 'encoding']
const DEFAULT_V4_STYLE_FORMAT = ['name', 'fontname', 'fontsize', 'primarycolour', 'secondarycolour', 'tertiarycolour', 'backcolour', 'bold', 'italic', 'borderstyle', 'outline', 'shadow', 'alignment', 'marginl', 'marginr', 'marginv', 'alphalevel', 'encoding']

export function parseAss(input: string, options: AssParserOptions = {}): SubtitleParseResult {
  const limits = resolveSubtitleParserLimits(options.limits)
  const diagnostics = createDiagnosticCollector(limits)
  const startedAt = readNow(options.now)
  const lines = normalizeLines(input, limits, diagnostics, options.now, startedAt)
  const context = parseContext(lines, diagnostics, limits, options.now, startedAt)
  const trackId = safeTrackId(options.trackId, 'subtitle')
  const cues: SubtitleCue[] = []
  let section = ''
  let eventFormat = context.v4Plus ? [...DEFAULT_EVENT_FORMAT] : [...DEFAULT_SSA_EVENT_FORMAT]
  let ordinal = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (!checkBudget(options.now, startedAt, limits, diagnostics, index + 1)) break
    const sectionName = sectionHeader(line)
    if (sectionName !== null) {
      section = sectionName
      if (section === 'events') eventFormat = context.v4Plus ? [...DEFAULT_EVENT_FORMAT] : [...DEFAULT_SSA_EVENT_FORMAT]
      continue
    }
    if (line.length > limits.maxLineLength || section !== 'events') continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    if (key === 'format') {
      const fields = formatFields(line.slice(colon + 1))
      if (validEventFormat(fields)) eventFormat = fields
      continue
    }
    if (key !== 'dialogue') continue
    const payload = line.slice(colon + 1).trimStart()
    const cueId = `${trackId}:dialogue:${ordinal}`
    ordinal += 1
    const cue = parseDialogue(payload, { ...context, eventFormat }, trackId, cueId, index + 1, diagnostics, undefined, undefined, limits.maxCueTextLength)
    if (cue === null) continue
    if (cues.length >= limits.maxCues) {
      diagnostics.add(ErrorCodes.SUBTITLE_CUE_LIMIT_EXCEEDED, 'error', 'Subtitle cue count exceeds the configured limit', index + 1)
      break
    }
    cues.push(cue)
  }
  return { cues, diagnostics: diagnostics.values }
}

export class AssParser {
  parse(input: string, options: AssParserOptions = {}): SubtitleParseResult { return parseAss(input, options) }
}

export interface AssPacketParserOptions extends AssParserOptions {
  header: string
}

/** Parses Matroska ASS/SSA packets using the track CodecPrivate header. */
export class AssPacketParser {
  readonly #limits: ReturnType<typeof resolveSubtitleParserLimits>
  readonly #trackId: string
  readonly #context: AssContext
  readonly #diagnostics: SubtitleDiagnostic[]

  constructor(options: AssPacketParserOptions = { header: '' }) {
    this.#limits = resolveSubtitleParserLimits(options.limits)
    const diagnostics = createDiagnosticCollector(this.#limits)
    const startedAt = readNow(options.now)
    const lines = normalizeLines(options.header, this.#limits, diagnostics, options.now, startedAt)
    this.#context = parseContext(lines, diagnostics, this.#limits, options.now, startedAt)
    this.#diagnostics = diagnostics.values
    this.#trackId = safeTrackId(options.trackId, 'subtitle')
  }

  get diagnostics(): readonly SubtitleDiagnostic[] { return [...this.#diagnostics] }

  parsePacket(payload: string, start: number, end: number, ordinal: number): SubtitleParseResult {
    const diagnostics = createDiagnosticCollector(this.#limits)
    const cueId = `${this.#trackId}:packet:${ordinal}`
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < 0 || start >= end) {
      diagnostics.add(ErrorCodes.SUBTITLE_TIME_INVALID, 'error', 'Embedded subtitle packet timing is invalid', undefined, cueId)
      return { cues: [], diagnostics: diagnostics.values }
    }
    if (payload.length > this.#limits.maxCueTextLength + this.#limits.maxLineLength) {
      diagnostics.add(ErrorCodes.SUBTITLE_INPUT_TOO_LARGE, 'error', 'Embedded ASS packet exceeds the configured text budget', undefined, cueId)
      return { cues: [], diagnostics: diagnostics.values }
    }
    const dialoguePayload = packetDialoguePayload(payload, this.#context)
    if (dialoguePayload === null) {
      diagnostics.add(ErrorCodes.SUBTITLE_PACKET_INVALID, 'error', 'Embedded ASS packet fields are incomplete', undefined, cueId)
      return { cues: [], diagnostics: diagnostics.values }
    }
    const cue = parseDialogue(dialoguePayload, this.#context, this.#trackId, cueId, undefined, diagnostics, start, end, this.#limits.maxCueTextLength)
    return { cues: cue === null ? [] : [cue], diagnostics: diagnostics.values }
  }
}

/** Matroska ASS/SSA blocks omit timestamps and prepend a container ReadOrder. */
function packetDialoguePayload(payload: string, context: AssContext): string | null {
  const fields = splitWithLimit(payload, 8)
  if (fields.length !== 9 || !/^\s*\d+\s*$/u.test(fields[0] ?? '')) return null
  const packetValues = new Map<string, string>([
    [context.v4Plus ? 'layer' : 'marked', fields[1] ?? ''],
    ['style', fields[2] ?? ''],
    ['name', fields[3] ?? ''],
    ['marginl', fields[4] ?? ''],
    ['marginr', fields[5] ?? ''],
    ['marginv', fields[6] ?? ''],
    ['effect', fields[7] ?? ''],
    ['text', fields[8] ?? ''],
  ])
  const values = context.eventFormat.map((field) => {
    if (field === 'start' || field === 'end') return ''
    return packetValues.get(field) ?? ''
  })
  return values.join(',')
}

function splitWithLimit(value: string, delimiterCount: number): string[] {
  const output: string[] = []
  let start = 0
  for (let count = 0; count < delimiterCount; count += 1) {
    const index = value.indexOf(',', start)
    if (index < 0) break
    output.push(value.slice(start, index))
    start = index + 1
  }
  output.push(value.slice(start))
  return output
}

function parseContext(
  lines: readonly string[],
  diagnostics: DiagnosticCollector,
  limits: ReturnType<typeof resolveSubtitleParserLimits>,
  now: (() => number) | undefined,
  startedAt: number,
): AssContext {
  const context: AssContext = { playResX: null, playResY: null, styles: new Map(), styleFormat: [...DEFAULT_V4_PLUS_STYLE_FORMAT], eventFormat: [...DEFAULT_EVENT_FORMAT], v4Plus: true }
  let section = ''
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.length > limits.maxLineLength) continue
    if (!checkBudget(now, startedAt, limits, diagnostics, index + 1)) break
    const header = sectionHeader(line)
    if (header !== null) {
      section = header
      if (header === 'v4 styles') {
        context.v4Plus = false
        context.eventFormat = [...DEFAULT_SSA_EVENT_FORMAT]
        context.styleFormat = [...DEFAULT_V4_STYLE_FORMAT]
      } else if (header === 'v4+ styles') {
        context.v4Plus = true
        context.styleFormat = [...DEFAULT_V4_PLUS_STYLE_FORMAT]
      }
      continue
    }
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (section === 'script info') {
      if (key === 'playresx') context.playResX = positiveNumber(value)
      if (key === 'playresy') context.playResY = positiveNumber(value)
      if (key === 'collisions' && value.length > 0 && value.toLowerCase() !== 'normal') {
        diagnostics.add(ErrorCodes.SUBTITLE_ASS_UNSUPPORTED_FEATURE, 'warning', 'ASS collision mode was reduced to stable layer ordering', index + 1)
      }
      continue
    }
    if (section === 'events' && key === 'format') {
      const fields = formatFields(value)
      if (validEventFormat(fields)) context.eventFormat = fields
      else diagnostics.add(ErrorCodes.SUBTITLE_ASS_INVALID, 'error', 'ASS Events Format is missing required fields', index + 1)
      continue
    }
    if ((section === 'v4+ styles' || section === 'v4 styles') && key === 'format') {
      const fields = formatFields(value)
      if (fields.includes('name') && fields.includes('fontname') && fields.includes('fontsize') && fields.includes('alignment')) context.styleFormat = fields
      else diagnostics.add(ErrorCodes.SUBTITLE_ASS_INVALID, 'error', 'ASS Styles Format is missing required fields', index + 1)
      continue
    }
    if ((section === 'v4+ styles' || section === 'v4 styles') && key === 'style') {
      const style = parseStyle(value, context.v4Plus, context, diagnostics, index + 1)
      if (style !== null) context.styles.set(style.name.toLowerCase(), style.value)
    }
  }
  return context
}

function formatFields(value: string): string[] {
  return value.split(',').map((field) => field.trim().toLowerCase()).filter((field) => field.length > 0)
}

function validEventFormat(fields: readonly string[]): boolean {
  return fields.includes('start') && fields.includes('end') && fields.includes('text')
}

function parseStyle(payload: string, v4Plus: boolean, context: AssContext, diagnostics: DiagnosticCollector, line: number): { name: string; value: SubtitleCueStyle } | null {
  const fields = payload.split(',').map((field) => field.trim())
  const format = context.styleFormat.length > 0 ? context.styleFormat : (v4Plus ? DEFAULT_V4_PLUS_STYLE_FORMAT : DEFAULT_V4_STYLE_FORMAT)
  const values = new Map<string, string>()
  for (let index = 0; index < format.length; index += 1) values.set(format[index] ?? '', fields[index] ?? '')
  const name = values.get('name') ?? ''
  if (name.length === 0 || fields.length < format.length) {
    diagnostics.add(ErrorCodes.SUBTITLE_ASS_INVALID, 'error', 'ASS style row is incomplete', line)
    return null
  }
  const value: SubtitleCueStyle = {}
  const font = values.get('fontname')
  const size = Number(values.get('fontsize'))
  const primary = parseAssColor(values.get('primarycolour'))
  const outline = parseAssColor(values.get('outlinecolour') ?? values.get('tertiarycolour'))
  if (font !== undefined && font.length > 0) value.fontFamily = font
  if (Number.isFinite(size) && size > 0) value.fontSize = size
  if (primary !== null) value.color = primary
  if (outline !== null) value.outlineColor = outline
  const bold = parseAssBoolean(values.get('bold'))
  const italic = parseAssBoolean(values.get('italic'))
  if (bold !== null) value.bold = bold
  if (italic !== null) value.italic = italic
  const underline = parseAssBoolean(values.get('underline'))
  if (underline !== null) value.underline = underline
  const outlineWidth = Number(values.get('outline'))
  if (Number.isFinite(outlineWidth) && outlineWidth >= 0) value.outlineWidth = Math.min(16, outlineWidth)
  const alignment = alignmentFromAss(Number(values.get('alignment')), v4Plus)
  if (alignment !== null) {
    value.alignment = alignment
    value.x = anchorX(alignment)
    value.y = anchorY(alignment)
  }
  const marginL = Number(values.get('marginl'))
  const marginR = Number(values.get('marginr'))
  if (alignment !== null && context.playResX !== null && context.playResX > 0) {
    if (alignment.endsWith('left') && Number.isFinite(marginL)) value.x = clamp(marginL / context.playResX * 100, 0, 100)
    if (alignment.endsWith('right') && Number.isFinite(marginR)) value.x = clamp(100 - marginR / context.playResX * 100, 0, 100)
  }
  const marginV = Number(values.get('marginv'))
  if (Number.isFinite(marginV) && context.playResY !== null && context.playResY > 0) {
    value.y = alignment !== null && alignment.startsWith('top')
      ? Math.min(100, marginV / context.playResY * 100)
      : alignment !== null && alignment.startsWith('middle')
        ? 50
        : Math.max(0, 100 - marginV / context.playResY * 100)
  }
  warnUnsupportedStyleFields(values, diagnostics, line)
  return { name, value: normalizeSubtitleStyle(value) }
}

function parseDialogue(
  payload: string,
  context: AssContext,
  trackId: string,
  cueId: string,
  line: number | undefined,
  diagnostics: DiagnosticCollector,
  packetStart?: number,
  packetEnd?: number,
  maxCueTextLength = 64 * 1024,
): SubtitleCue | null {
  const textIndex = context.eventFormat.indexOf('text')
  const values = splitAssFields(payload, context.eventFormat)
  const startValue = values[context.eventFormat.indexOf('start')]
  const endValue = values[context.eventFormat.indexOf('end')]
  const textValue = textIndex >= 0 ? values[textIndex] : undefined
  const start = packetStart ?? parseTimestamp(startValue ?? '', true)
  const end = packetEnd ?? parseTimestamp(endValue ?? '', true)
  if (start === null || end === null) {
    diagnostics.add(ErrorCodes.SUBTITLE_TIME_INVALID, 'error', 'ASS dialogue timing is invalid', line, cueId)
    return null
  }
  if (start >= end) {
    diagnostics.add(ErrorCodes.SUBTITLE_TIME_INVALID, 'error', 'ASS dialogue start must be before end', line, cueId)
    return null
  }
  const styleName = values[context.eventFormat.indexOf('style')]?.trim().toLowerCase() ?? ''
  const baseStyle = { ...DEFAULT_SUBTITLE_STYLE, ...(context.styles.get(styleName) ?? {}) }
  const effect = values[context.eventFormat.indexOf('effect')]?.trim() ?? ''
  if (effect.length > 0) unsupported(diagnostics, line, cueId, 'ASS event effect was reduced to plain text')
  const transformed = parseDialogueText(textValue ?? '', baseStyle, context, diagnostics, line, cueId, maxCueTextLength)
  if (transformed === null) return null
  return {
    cueId,
    trackId,
    start,
    end,
    text: transformed.text,
    layer: parseLayer(values[context.eventFormat.indexOf('layer')]),
    ...(transformed.style === undefined ? {} : { style: transformed.style }),
  }
}

function splitAssFields(payload: string, format: readonly string[]): string[] {
  if (format.length === 0) return []
  const tokens = payload.split(',')
  const textIndex = format.indexOf('text')
  if (tokens.length <= format.length) return [...tokens, ...Array.from({ length: format.length - tokens.length }, () => '')]
  if (textIndex < 0) return tokens.slice(0, format.length)
  const suffixCount = format.length - textIndex - 1
  const prefix = tokens.slice(0, textIndex)
  const suffix = suffixCount === 0 ? [] : tokens.slice(Math.max(textIndex, tokens.length - suffixCount))
  const textEnd = suffixCount === 0 ? tokens.length : tokens.length - suffixCount
  return [...prefix, tokens.slice(textIndex, textEnd).join(','), ...suffix]
}

function parseDialogueText(value: string, baseStyle: SubtitleCueStyle, context: AssContext, diagnostics: DiagnosticCollector, line: number | undefined, cueId: string, maxCueTextLength = 64 * 1024): { text: string; style: SubtitleCueStyle } | null {
  const style = { ...baseStyle }
  const overridePattern = /\{([^{}]*)\}/gu
  const state: OverrideState = { drawingMode: false, positioned: false }
  let match: RegExpExecArray | null
  while ((match = overridePattern.exec(value)) !== null) {
    const body = match[1] ?? ''
    parseOverrideBody(body, style, context, diagnostics, line, cueId, state)
  }
  let text = value.replace(overridePattern, '').replace(/\\N/gu, '\n').replace(/\\n/gu, '\n').replace(/\\h/gu, ' ')
  if (state.drawingMode) {
    diagnostics.add(ErrorCodes.SUBTITLE_ASS_UNSUPPORTED_FEATURE, 'warning', 'ASS drawing mode was reduced to plain text', line, cueId)
    text = text.trim()
  }
  if (text.length > maxCueTextLength) {
    diagnostics.add(ErrorCodes.SUBTITLE_INPUT_TOO_LARGE, 'error', 'ASS dialogue text exceeds the configured limit', line, cueId)
    return null
  }
  return { text, style: normalizeSubtitleStyle(style) }
}

interface OverrideState {
  drawingMode: boolean
  positioned: boolean
}

function parseOverrideBody(
  body: string,
  style: SubtitleCueStyle,
  context: AssContext,
  diagnostics: DiagnosticCollector,
  line: number | undefined,
  cueId: string,
  state: OverrideState,
): void {
  let cursor = 0
  while (cursor < body.length) {
    const slash = body.indexOf('\\', cursor)
    if (slash < 0) break
    const nextSlash = body.indexOf('\\', slash + 1)
    const segment = body.slice(slash + 1, nextSlash < 0 ? body.length : nextSlash)
    const parsed = parseOverrideSegment(segment)
    const name = parsed.name
    const argument = parsed.argument
    cursor = nextSlash < 0 ? body.length : nextSlash
    if (name === 'n') continue
    if (name === 'fn') { if (argument.length > 0) style.fontFamily = argument; else unsupported(diagnostics, line, cueId, 'ASS font override is invalid'); continue }
    if (name === 'fs') { const value = Number(argument); if (Number.isFinite(value) && value > 0) style.fontSize = value; else unsupported(diagnostics, line, cueId, 'ASS font-size override is invalid'); continue }
    if (name === 'b' || name === 'i' || name === 'u') {
      const value = parseAssBoolean(argument)
      if (value === null) unsupported(diagnostics, line, cueId, 'ASS boolean override is invalid')
      else if (name === 'b') style.bold = value
      else if (name === 'i') style.italic = value
      else style.underline = value
      continue
    }
    if (name === 'c' || name === '1c' || name === '3c') {
      const color = parseAssColor(argument)
      if (color === null) unsupported(diagnostics, line, cueId, 'ASS color override is invalid')
      else if (name === '3c') style.outlineColor = color
      else style.color = color
      continue
    }
    if (name === 'bord') { const value = Number(argument); if (Number.isFinite(value) && value >= 0) style.outlineWidth = Math.min(16, value); else unsupported(diagnostics, line, cueId, 'ASS outline override is invalid'); continue }
    if (name === 'an' || name === 'a') {
      const alignment = alignmentFromAss(Number(argument), name === 'an')
      if (alignment === null) unsupported(diagnostics, line, cueId, 'ASS alignment override is invalid')
      else {
        style.alignment = alignment
        if (!state.positioned) { style.x = anchorX(alignment); style.y = anchorY(alignment) }
      }
      continue
    }
    if (name === 'pos') {
      const position = /^\(\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*\)$/u.exec(argument)
      if (!position) { unsupported(diagnostics, line, cueId, 'ASS position override is invalid'); continue }
      const x = Number(position[1]); const y = Number(position[2])
      if (!Number.isFinite(x) || !Number.isFinite(y)) { unsupported(diagnostics, line, cueId, 'ASS position override is invalid'); continue }
      style.x = context.playResX && context.playResX > 0 ? clamp(x / context.playResX * 100, 0, 100) : clamp(x, 0, 100)
      style.y = context.playResY && context.playResY > 0 ? clamp(y / context.playResY * 100, 0, 100) : clamp(y, 0, 100)
      state.positioned = true
      continue
    }
    if (name === 'p') { state.drawingMode = Number(argument) !== 0; unsupported(diagnostics, line, cueId, 'ASS drawing mode is unsupported'); continue }
    unsupported(diagnostics, line, cueId, 'ASS override tag is unsupported')
  }
}

function parseOverrideSegment(segment: string): { name: string; argument: string } {
  const match = /^(1c|2c|3c|4c|an|fn|fs|bord|pos|move|fad|fade|t|p|b|i|u|a|c|k|kf|ko|K|q|r|be|blur|frx|fry|frz|fax|fay|fscx|fscy|fsp|shad|alpha|\d+)(.*)$/iu.exec(segment.trim())
  if (!match) return { name: segment.trim().slice(0, 32).toLowerCase(), argument: '' }
  return { name: (match[1] ?? '').toLowerCase(), argument: (match[2] ?? '').trim() }
}

function unsupported(diagnostics: DiagnosticCollector, line: number | undefined, cueId: string, message: string): void {
  diagnostics.add(ErrorCodes.SUBTITLE_ASS_UNSUPPORTED_FEATURE, 'warning', message, line, cueId)
}

function warnUnsupportedStyleFields(values: ReadonlyMap<string, string>, diagnostics: DiagnosticCollector, line: number): void {
  const checks: readonly [string, string, (value: string) => boolean][] = [
    ['shadow', 'ASS style shadow was reduced to outline-only rendering', (value) => Number(value) > 0],
    ['strikeout', 'ASS strikeout styling was reduced to plain text decoration', (value) => parseAssBoolean(value) === true],
    ['scalex', 'ASS horizontal scaling was reduced to normal scale', (value) => Number.isFinite(Number(value)) && Number(value) !== 100],
    ['scaley', 'ASS vertical scaling was reduced to normal scale', (value) => Number.isFinite(Number(value)) && Number(value) !== 100],
    ['spacing', 'ASS letter spacing was reduced to normal spacing', (value) => Number(value) !== 0],
    ['angle', 'ASS rotation was reduced to unrotated text', (value) => Number(value) !== 0],
    ['borderstyle', 'ASS border style was reduced to outline-only rendering', (value) => Number(value) !== 1],
  ]
  for (const [field, message, predicate] of checks) {
    const value = values.get(field)
    if (value !== undefined && value.trim().length > 0 && predicate(value.trim())) diagnostics.add(ErrorCodes.SUBTITLE_ASS_UNSUPPORTED_FEATURE, 'warning', message, line)
  }
}

function parseLayer(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= -1_000 && parsed <= 1_000 ? parsed : 0
}

function parseAssBoolean(value: string | undefined): boolean | null {
  if (value === undefined) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === '-1' || normalized === '1' || normalized === 'true') return true
  if (normalized === '0' || normalized === 'false') return false
  return null
}

function parseAssColor(value: string | undefined): string | null {
  if (value === undefined) return null
  const normalized = value.trim()
  if (/^#[0-9a-f]{6}$/iu.test(normalized)) return normalized.toUpperCase()
  const match = /^&H([0-9a-f]{6,8})&?$/iu.exec(normalized)
  if (!match) return null
  const digits = (match[1] ?? '').padStart(8, '0')
  const red = digits.slice(-2)
  const green = digits.slice(-4, -2)
  const blue = digits.slice(-6, -4)
  return `#${red}${green}${blue}`.toUpperCase()
}

function alignmentFromAss(value: number, modern: boolean): NonNullable<SubtitleCueStyle['alignment']> | null {
  if (!Number.isSafeInteger(value)) return null
  const map: Readonly<Record<number, NonNullable<SubtitleCueStyle['alignment']>>> = modern
    ? { 1: 'bottom-left', 2: 'bottom-center', 3: 'bottom-right', 4: 'middle-left', 5: 'middle-center', 6: 'middle-right', 7: 'top-left', 8: 'top-center', 9: 'top-right' }
    : { 1: 'bottom-left', 2: 'bottom-center', 3: 'bottom-right', 5: 'top-left', 6: 'top-center', 7: 'top-right', 9: 'middle-left', 10: 'middle-center', 11: 'middle-right' }
  return map[value] ?? null
}

function sectionHeader(value: string): string | null {
  const match = /^\s*\[([^\]]+)\]\s*$/u.exec(value)
  return match?.[1]?.trim().toLowerCase() ?? null
}

function positiveNumber(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100_000 ? parsed : null
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)) }

function anchorY(alignment: NonNullable<SubtitleCueStyle['alignment']>): number {
  return alignment.startsWith('top') ? 12 : alignment.startsWith('middle') ? 50 : 88
}

function anchorX(alignment: NonNullable<SubtitleCueStyle['alignment']>): number {
  return alignment.endsWith('left') ? 5 : alignment.endsWith('right') ? 95 : 50
}

function readNow(now: (() => number) | undefined): number {
  try { return readParserTime(now) } catch { return 0 }
}
