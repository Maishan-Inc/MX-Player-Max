import type { SubtitleCue, SubtitleParseResult, SubtitleParserLimitsInput } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { createDiagnosticCollector, checkBudget, normalizeLines, parseTimestamp, readParserTime, safeTrackId } from './parser-common'
import { resolveSubtitleParserLimits } from './limits'

export interface SrtParserOptions {
  trackId?: string
  limits?: SubtitleParserLimitsInput
  now?: () => number
}

export interface SubtitleParser {
  parse(input: string, options?: SrtParserOptions): SubtitleParseResult
}

export function parseSrt(input: string, options: SrtParserOptions = {}): SubtitleParseResult {
  const limits = resolveSubtitleParserLimits(options.limits)
  const diagnostics = createDiagnosticCollector(limits)
  const startedAt = readNow(options.now)
  const lines = normalizeLines(input, limits, diagnostics, options.now, startedAt)
  const trackId = safeTrackId(options.trackId, 'subtitle')
  const cues: SubtitleCue[] = []
  let lineIndex = 0
  let ordinal = 0
  while (lineIndex < lines.length) {
    while (lineIndex < lines.length && (lines[lineIndex] ?? '').trim() === '') lineIndex += 1
    if (lineIndex >= lines.length) break
    if (!checkBudget(options.now, startedAt, limits, diagnostics, lineIndex + 1)) break
    const blockLine = lineIndex + 1
    const first = lines[lineIndex] ?? ''
    if (first.length > limits.maxLineLength) {
      lineIndex = skipBlock(lines, lineIndex)
      continue
    }
    let sequence: string | null = null
    if (/^\s*\d+\s*$/u.test(first)) {
      sequence = first.trim()
      lineIndex += 1
    }
    const timingLine = lines[lineIndex] ?? ''
    const timing = parseTimingLine(timingLine)
    if (timing === null) {
      diagnostics.add(ErrorCodes.SUBTITLE_SRT_INVALID, 'error', 'SRT cue timing line is invalid', blockLine)
      lineIndex = skipBlock(lines, lineIndex)
      continue
    }
    lineIndex += 1
    const textLines: string[] = []
    let invalidTextLine = false
    let textLimitExceeded = false
    let textLength = 0
    while (lineIndex < lines.length && (lines[lineIndex] ?? '').trim() !== '') {
      const textLine = lines[lineIndex] ?? ''
      if (textLine.length > limits.maxLineLength) invalidTextLine = true
      const separatorLength = textLines.length === 0 ? 0 : 1
      const remaining = Math.max(0, limits.maxCueTextLength - textLength - separatorLength)
      textLength += textLine.length + separatorLength
      textLines.push(textLine.slice(0, remaining + 1))
      lineIndex += 1
      if (textLength > limits.maxCueTextLength) {
        diagnostics.add(ErrorCodes.SUBTITLE_INPUT_TOO_LARGE, 'error', 'SRT cue text exceeds the configured limit', blockLine)
        textLimitExceeded = true
        break
      }
    }
    if (textLimitExceeded) lineIndex = skipBlock(lines, lineIndex)
    const text = textLines.join('\n')
    const cueId = `${trackId}:${sequence ?? 'cue'}:${ordinal}`
    ordinal += 1
    if (textLines.length === 0) {
      diagnostics.add(ErrorCodes.SUBTITLE_SRT_INVALID, 'error', 'SRT cue has no text', blockLine, cueId)
      continue
    }
    if (invalidTextLine) {
      diagnostics.add(ErrorCodes.SUBTITLE_LINE_TOO_LONG, 'error', 'SRT cue text contains an overlong line', blockLine, cueId)
      continue
    }
    if (textLimitExceeded) continue
    if (timing.start >= timing.end) {
      diagnostics.add(ErrorCodes.SUBTITLE_TIME_INVALID, 'error', 'SRT cue start must be before end', blockLine, cueId)
      continue
    }
    if (cues.length >= limits.maxCues) {
      diagnostics.add(ErrorCodes.SUBTITLE_CUE_LIMIT_EXCEEDED, 'error', 'Subtitle cue count exceeds the configured limit', blockLine)
      break
    }
    cues.push({ cueId, trackId, start: timing.start, end: timing.end, text, layer: 0 })
  }
  return { cues, diagnostics: diagnostics.values }
}

export class SrtParser implements SubtitleParser {
  parse(input: string, options: SrtParserOptions = {}): SubtitleParseResult { return parseSrt(input, options) }
}

function parseTimingLine(value: string): { start: number; end: number } | null {
  const arrow = value.indexOf('-->')
  if (arrow < 0) return null
  const start = parseTimestamp(value.slice(0, arrow))
  const endToken = value.slice(arrow + 3).trim().split(/\s+/u)[0] ?? ''
  const end = parseTimestamp(endToken)
  if (start === null || end === null) return null
  return { start, end }
}

function skipBlock(lines: readonly string[], index: number): number {
  let cursor = Math.max(0, index)
  while (cursor < lines.length && (lines[cursor] ?? '').trim() !== '') cursor += 1
  return cursor
}

function readNow(now: (() => number) | undefined): number {
  try { return readParserTime(now) } catch { return 0 }
}
