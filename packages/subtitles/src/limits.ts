import type {
  SubtitleFormat,
  SubtitleParserLimits,
  SubtitleParserLimitsInput,
  SubtitleSourceLimits,
  SubtitleSourceLimitsInput,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { SubtitleError } from './errors'

export const DEFAULT_SUBTITLE_PARSER_LIMITS: SubtitleParserLimits = {
  maxInputBytes: 8 * 1024 * 1024,
  maxLineLength: 16 * 1024,
  maxLines: 8_000,
  maxCues: 20_000,
  maxCueTextLength: 64 * 1024,
  maxDiagnostics: 1_024,
  parseBudgetMs: 100,
}

export const DEFAULT_SUBTITLE_SOURCE_LIMITS: SubtitleSourceLimits = {
  maxResponseBytes: 8 * 1024 * 1024,
  maxResponseChunks: 65_536,
  maxPacketBatches: 100_000,
  operationTimeoutMs: 30_000,
}

const HARD_PARSER_LIMITS: SubtitleParserLimits = {
  maxInputBytes: 32 * 1024 * 1024,
  maxLineLength: 64 * 1024,
  maxLines: 200_000,
  maxCues: 100_000,
  maxCueTextLength: 256 * 1024,
  maxDiagnostics: 10_000,
  parseBudgetMs: 10_000,
}

const HARD_SOURCE_LIMITS: SubtitleSourceLimits = {
  maxResponseBytes: 32 * 1024 * 1024,
  maxResponseChunks: 500_000,
  maxPacketBatches: 500_000,
  operationTimeoutMs: 120_000,
}

export function resolveSubtitleParserLimits(input: SubtitleParserLimitsInput = {}): SubtitleParserLimits {
  return {
    maxInputBytes: boundedInteger(input.maxInputBytes, DEFAULT_SUBTITLE_PARSER_LIMITS.maxInputBytes, 1, HARD_PARSER_LIMITS.maxInputBytes, 'maxInputBytes'),
    maxLineLength: boundedInteger(input.maxLineLength, DEFAULT_SUBTITLE_PARSER_LIMITS.maxLineLength, 1, HARD_PARSER_LIMITS.maxLineLength, 'maxLineLength'),
    maxLines: boundedInteger(input.maxLines, DEFAULT_SUBTITLE_PARSER_LIMITS.maxLines, 1, HARD_PARSER_LIMITS.maxLines, 'maxLines'),
    maxCues: boundedInteger(input.maxCues, DEFAULT_SUBTITLE_PARSER_LIMITS.maxCues, 1, HARD_PARSER_LIMITS.maxCues, 'maxCues'),
    maxCueTextLength: boundedInteger(input.maxCueTextLength, DEFAULT_SUBTITLE_PARSER_LIMITS.maxCueTextLength, 1, HARD_PARSER_LIMITS.maxCueTextLength, 'maxCueTextLength'),
    maxDiagnostics: boundedInteger(input.maxDiagnostics, DEFAULT_SUBTITLE_PARSER_LIMITS.maxDiagnostics, 1, HARD_PARSER_LIMITS.maxDiagnostics, 'maxDiagnostics'),
    parseBudgetMs: boundedNumber(input.parseBudgetMs, DEFAULT_SUBTITLE_PARSER_LIMITS.parseBudgetMs, 1, HARD_PARSER_LIMITS.parseBudgetMs, 'parseBudgetMs'),
  }
}

export function resolveSubtitleSourceLimits(input: SubtitleSourceLimitsInput = {}): SubtitleSourceLimits {
  return {
    maxResponseBytes: boundedInteger(input.maxResponseBytes, DEFAULT_SUBTITLE_SOURCE_LIMITS.maxResponseBytes, 1, HARD_SOURCE_LIMITS.maxResponseBytes, 'maxResponseBytes'),
    maxResponseChunks: boundedInteger(input.maxResponseChunks, DEFAULT_SUBTITLE_SOURCE_LIMITS.maxResponseChunks, 1, HARD_SOURCE_LIMITS.maxResponseChunks, 'maxResponseChunks'),
    maxPacketBatches: boundedInteger(input.maxPacketBatches, DEFAULT_SUBTITLE_SOURCE_LIMITS.maxPacketBatches, 1, HARD_SOURCE_LIMITS.maxPacketBatches, 'maxPacketBatches'),
    operationTimeoutMs: boundedNumber(input.operationTimeoutMs, DEFAULT_SUBTITLE_SOURCE_LIMITS.operationTimeoutMs, 1, HARD_SOURCE_LIMITS.operationTimeoutMs, 'operationTimeoutMs'),
  }
}

export function validateNonNegativeMicros(value: number, code = ErrorCodes.SUBTITLE_TIME_INVALID): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SubtitleError(code, 'Subtitle time must be a non-negative integer microsecond value', false)
  }
  return value
}

export function validateSubtitleFormat(value: unknown): SubtitleFormat {
  if (value === 'srt' || value === 'ass' || value === 'ssa') return value
  throw new SubtitleError(ErrorCodes.SUBTITLE_FORMAT_UNSUPPORTED, 'Subtitle format is not supported', false)
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new SubtitleError(ErrorCodes.SUBTITLE_INPUT_INVALID, `Subtitle ${name} is outside its safe limit`, false)
  }
  return value
}

function boundedNumber(value: number | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new SubtitleError(ErrorCodes.SUBTITLE_INPUT_INVALID, `Subtitle ${name} is outside its safe limit`, false)
  }
  return value
}
