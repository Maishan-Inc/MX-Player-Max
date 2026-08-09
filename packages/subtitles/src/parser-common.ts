import type { SubtitleDiagnostic, SubtitleDiagnosticSeverity, SubtitleParserLimits } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { SubtitleError } from './errors'

export interface DiagnosticCollector {
  readonly values: SubtitleDiagnostic[]
  add(code: SubtitleDiagnostic['code'], severity: SubtitleDiagnosticSeverity, message: string, line?: number, cueId?: string): void
}

export function createDiagnosticCollector(limits: SubtitleParserLimits): DiagnosticCollector {
  const values: SubtitleDiagnostic[] = []
  return {
    values,
    add(code, severity, message, line, cueId) {
      if (values.length >= limits.maxDiagnostics) return
      const diagnostic: SubtitleDiagnostic = { code, severity, message }
      if (line !== undefined) diagnostic.line = line
      if (cueId !== undefined) diagnostic.cueId = cueId
      values.push(diagnostic)
    },
  }
}

export function normalizeLines(
  input: string,
  limits: SubtitleParserLimits,
  diagnostics: DiagnosticCollector,
  now?: () => number,
  startedAt?: number,
): string[] {
  if (typeof input !== 'string') throw new SubtitleError(ErrorCodes.SUBTITLE_INPUT_INVALID, 'Subtitle input must be text', false)
  if (input.length > limits.maxInputBytes) throw new SubtitleError(ErrorCodes.SUBTITLE_INPUT_TOO_LARGE, 'Subtitle input exceeds the configured byte budget', false)
  const bytes = utf8ByteLength(input)
  if (bytes > limits.maxInputBytes) throw new SubtitleError(ErrorCodes.SUBTITLE_INPUT_TOO_LARGE, 'Subtitle input exceeds the configured byte budget', false)
  const withoutBom = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const lines: string[] = []
  let start = 0
  for (let index = 0; index <= withoutBom.length; index += 1) {
    if (startedAt !== undefined && index % 4_096 === 0 && !checkBudget(now, startedAt, limits, diagnostics, lines.length + 1)) break
    const code = index < withoutBom.length ? withoutBom.charCodeAt(index) : 10
    if (code !== 10 && code !== 13) continue
    const lineLength = index - start
    if (lineLength > limits.maxLineLength) diagnostics.add(ErrorCodes.SUBTITLE_LINE_TOO_LONG, 'error', 'Subtitle line exceeds the configured length budget', lines.length + 1)
    lines.push(withoutBom.slice(start, Math.min(index, start + limits.maxLineLength + 1)))
    if (lines.length >= limits.maxLines) {
      if (index < withoutBom.length) diagnostics.add(ErrorCodes.SUBTITLE_INPUT_TOO_LARGE, 'error', 'Subtitle input exceeds the configured line budget')
      break
    }
    if (code === 13 && withoutBom.charCodeAt(index + 1) === 10) index += 1
    start = index + 1
  }
  return lines
}

export function utf8ByteLength(value: string): number {
  try { return new TextEncoder().encode(value).byteLength } catch { return value.length * 2 }
}

export function decodeUtf8(data: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data) }
  catch { throw new SubtitleError(ErrorCodes.SUBTITLE_INPUT_INVALID, 'Subtitle bytes are not valid UTF-8', false) }
}

export function parseTimestamp(value: string, allowCentiseconds = false): number | null {
  const trimmed = value.trim()
  let match = /^(\d+):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?$/u.exec(trimmed)
  let hours: number
  let minutes: number
  let seconds: number
  let fraction = ''
  if (match) {
    hours = Number(match[1])
    minutes = Number(match[2])
    seconds = Number(match[3])
    fraction = match[4] ?? ''
  } else {
    match = /^(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?$/u.exec(trimmed)
    if (!match) return null
    hours = 0
    minutes = Number(match[1])
    seconds = Number(match[2])
    fraction = match[3] ?? ''
  }
  if (!Number.isSafeInteger(hours) || !Number.isSafeInteger(minutes) || !Number.isSafeInteger(seconds)
    || minutes >= 60 || seconds >= 60) return null
  if (fraction.length === 0) fraction = '0'
  if (allowCentiseconds && fraction.length <= 2) fraction = fraction.padEnd(2, '0')
  const millis = fraction.length === 1 ? Number(fraction) * 100 : fraction.length === 2 ? Number(fraction) * 10 : Number(fraction)
  if (!Number.isSafeInteger(millis) || millis >= 1_000) return null
  const valueMicros = hours * 3_600_000_000 + minutes * 60_000_000 + seconds * 1_000_000 + millis * 1_000
  return Number.isSafeInteger(valueMicros) && valueMicros >= 0 ? valueMicros : null
}

export function checkBudget(
  now: (() => number) | undefined,
  startedAt: number,
  limits: SubtitleParserLimits,
  diagnostics: DiagnosticCollector,
  line: number,
): boolean {
  let elapsed: number
  try { elapsed = readParserTime(now) - startedAt } catch { return true }
  if (!Number.isFinite(elapsed) || elapsed <= limits.parseBudgetMs) return true
  diagnostics.add(ErrorCodes.SUBTITLE_PARSE_BUDGET_EXCEEDED, 'error', 'Subtitle parsing exceeded its time budget', line)
  return false
}

export function readParserTime(now: (() => number) | undefined): number {
  if (now !== undefined) return now()
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export function safeTrackId(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() ?? ''
  if (candidate.length === 0 || candidate.length > 128 || !/^[\w:.\-]+$/u.test(candidate)) return fallback
  return candidate
}

export function cloneCueStyle(style: import('@mx-player-max/types').SubtitleCueStyle | undefined): import('@mx-player-max/types').SubtitleCueStyle | undefined {
  return style === undefined ? undefined : { ...style }
}
