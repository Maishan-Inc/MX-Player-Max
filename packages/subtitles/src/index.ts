import type { Micros, SubtitleCue as SubtitleCueContract } from '@mx-player-max/types'

/** Returns cues active at an integer-microsecond media time. */
export function activeCues(cues: readonly SubtitleCueContract[], time: Micros): SubtitleCueContract[] {
  return cues.filter((cue) => time >= cue.start && time < cue.end)
}

export { SubtitleError, isSubtitleError, subtitleErrorPayload, toSubtitleError } from './errors'
export { DEFAULT_SUBTITLE_PARSER_LIMITS, DEFAULT_SUBTITLE_SOURCE_LIMITS, resolveSubtitleParserLimits, resolveSubtitleSourceLimits, validateNonNegativeMicros, validateSubtitleFormat } from './limits'
export { parseSrt, SrtParser } from './srt'
export type { SrtParserOptions, SubtitleParser } from './srt'
export { parseAss, AssParser, AssPacketParser } from './ass'
export type { AssParserOptions, AssPacketParserOptions } from './ass'
export { parseEmbeddedSubtitlePackets } from './embedded'
export type { EmbeddedSubtitlePacketOptions } from './embedded'
export { loadExternalSubtitle, inferSubtitleFormat, validateExternalSubtitleSource } from './source'
export type { SubtitleLoadOptions } from './source'
export { NativeSubtitleClock, CallbackSubtitleClock, SubtitleScheduler } from './clock'
export type { SubtitleClock, SubtitleClockReader, SubtitleSchedulerOptions, SubtitleCueUpdate } from './clock'
export { SubtitleOverlay } from './overlay'
export type { SubtitleOverlayOptions, SubtitleOverlayTargetKind } from './overlay'
export {
  DEFAULT_SUBTITLE_STYLE,
  LocalSubtitleStyleStore,
  MemorySubtitleStyleStore,
  assertSubtitleStyle,
  createDefaultSubtitleStyleStore,
  normalizeSubtitleStyle,
  subtitleStyleScope,
} from './style-store'
export { SubtitleTrackManager } from './tracks'
export type {
  SubtitleManagerEvent,
  SubtitleTrackDefinition,
  SubtitleTrackLoader,
  SubtitleTrackLoaderRequest,
  SubtitleTrackManagerOptions,
} from './tracks'

export type {
  ExternalSubtitleSourceDescriptor,
  SubtitleAlignment,
  SubtitleClockSnapshot,
  SubtitleCue,
  SubtitleCueMetadata,
  SubtitleCueStyle,
  SubtitleDiagnostic,
  SubtitleDiagnosticSeverity,
  SubtitleErrorCode,
  SubtitleFormat,
  SubtitleOptions,
  SubtitleParseResult,
  SubtitleParserLimits,
  SubtitleParserLimitsInput,
  SubtitleSourceDescriptor,
  SubtitleSourceKind,
  SubtitleSourceLimits,
  SubtitleSourceLimitsInput,
  SubtitleState,
  SubtitleStyleStore,
  SubtitleTrack,
  SubtitleTrackChangeReason,
  SubtitleTrackOptions,
  SubtitleTrackSource,
  SubtitleTrackState,
} from '@mx-player-max/types'
