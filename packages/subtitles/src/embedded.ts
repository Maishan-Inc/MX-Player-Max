import type { DemuxPacket, SubtitleCue, SubtitleDiagnostic, SubtitleFormat, SubtitleParseResult } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { AssPacketParser } from './ass'
import { decodeUtf8, safeTrackId } from './parser-common'
import { resolveSubtitleParserLimits, validateSubtitleFormat } from './limits'
import { SubtitleError } from './errors'

export interface EmbeddedSubtitlePacketOptions {
  trackId: string
  format: SubtitleFormat
  codecPrivate?: ArrayBuffer
  limits?: import('@mx-player-max/types').SubtitleParserLimitsInput
  now?: () => number
}

export function parseEmbeddedSubtitlePackets(
  packets: readonly DemuxPacket[],
  options: EmbeddedSubtitlePacketOptions,
): SubtitleParseResult {
  const limits = resolveSubtitleParserLimits(options.limits)
  const format = validateSubtitleFormat(options.format)
  const trackId = safeTrackId(options.trackId, 'embedded')
  const cues: SubtitleCue[] = []
  const diagnostics: SubtitleDiagnostic[] = []
  const addDiagnostic = (diagnostic: SubtitleDiagnostic): void => {
    if (diagnostics.length >= limits.maxDiagnostics) return
    diagnostics.push({ ...diagnostic })
  }
  const appendDiagnostics = (values: readonly SubtitleDiagnostic[]): void => {
    for (const diagnostic of values) {
      if (diagnostics.length >= limits.maxDiagnostics) return
      addDiagnostic(diagnostic)
    }
  }
  let packetParser: AssPacketParser | null = null
  const assFormat = format === 'ass' || format === 'ssa'
  if (assFormat) {
    try {
      if (options.codecPrivate !== undefined && options.codecPrivate.byteLength > limits.maxInputBytes) {
        addDiagnostic({ code: ErrorCodes.SUBTITLE_INPUT_TOO_LARGE, severity: 'error', message: 'ASS codec private data exceeds the configured byte budget' })
      } else {
        packetParser = new AssPacketParser({
          trackId,
          header: options.codecPrivate === undefined ? '' : decodeUtf8(new Uint8Array(options.codecPrivate)),
          ...(options.limits === undefined ? {} : { limits: options.limits }),
          ...(options.now === undefined ? {} : { now: options.now }),
        })
      }
    } catch (cause) {
      addDiagnostic(cause instanceof SubtitleError
        ? { code: cause.code, severity: 'error', message: cause.message }
        : { code: ErrorCodes.SUBTITLE_ASS_INVALID, severity: 'error', message: 'ASS codec private data is invalid' })
    }
  }
  if (packetParser) appendDiagnostics(packetParser.diagnostics)
  const maxPackets = Math.min(packets.length, limits.maxCues + limits.maxDiagnostics)
  for (let index = 0; index < maxPackets; index += 1) {
    if (cues.length >= limits.maxCues) {
      addDiagnostic({ code: ErrorCodes.SUBTITLE_CUE_LIMIT_EXCEEDED, severity: 'error', message: 'Subtitle cue count exceeds the configured limit' })
      break
    }
    const packet = packets[index]
    if (packet === undefined) continue
    if (assFormat && packetParser === null) continue
    if (packet.kind !== 'subtitle' || !(packet.data instanceof Uint8Array) || packet.data.byteLength > limits.maxInputBytes) {
      addDiagnostic({ code: packet.data instanceof Uint8Array && packet.data.byteLength > limits.maxInputBytes ? ErrorCodes.SUBTITLE_INPUT_TOO_LARGE : ErrorCodes.SUBTITLE_PACKET_INVALID, severity: 'error', message: 'Embedded subtitle packet is invalid or too large' })
      continue
    }
    const next = packets[index + 1]
    const end = packet.duration === null ? next?.timestamp ?? null : safeAdd(packet.timestamp, packet.duration)
    if (end === null || !Number.isSafeInteger(packet.timestamp) || packet.timestamp < 0 || end <= packet.timestamp) {
      addDiagnostic({ code: ErrorCodes.SUBTITLE_PACKET_INVALID, severity: 'error', message: 'Embedded subtitle packet has no valid bounded duration', cueId: `${trackId}:packet:${index}` })
      continue
    }
    try {
      const text = decodeUtf8(packet.data)
      if (text.length > limits.maxCueTextLength) {
        addDiagnostic({ code: ErrorCodes.SUBTITLE_INPUT_TOO_LARGE, severity: 'error', message: 'Embedded subtitle cue text exceeds the configured limit', cueId: `${trackId}:packet:${index}` })
        continue
      }
      const result = packetParser
        ? packetParser.parsePacket(text, packet.timestamp, end, index)
        : parseUtf8Packet(text, trackId, packet.timestamp, end, index)
      appendDiagnostics(result.diagnostics)
      for (const cue of result.cues) {
        if (cues.length >= limits.maxCues) break
        cues.push(cue)
      }
    } catch (cause) {
      if (cause instanceof SubtitleError) addDiagnostic({ code: cause.code, severity: 'error', message: cause.message, cueId: `${trackId}:packet:${index}` })
      else addDiagnostic({ code: ErrorCodes.SUBTITLE_PACKET_INVALID, severity: 'error', message: 'Embedded subtitle packet could not be decoded', cueId: `${trackId}:packet:${index}` })
    }
  }
  if (packets.length > maxPackets && diagnostics.length < limits.maxDiagnostics) addDiagnostic({ code: ErrorCodes.SUBTITLE_PARSE_BUDGET_EXCEEDED, severity: 'error', message: 'Embedded subtitle packet count exceeds the parsing budget' })
  cues.sort(compareCue)
  return { cues, diagnostics: diagnostics.slice(0, limits.maxDiagnostics) }
}

function parseUtf8Packet(text: string, trackId: string, start: number, end: number, index: number): SubtitleParseResult {
  const normalized = text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
  if (start >= end || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < 0) return { cues: [], diagnostics: [{ code: ErrorCodes.SUBTITLE_TIME_INVALID, severity: 'error', message: 'Embedded subtitle packet timing is invalid', cueId: `${trackId}:packet:${index}` }] }
  if (normalized.trim().length === 0) return { cues: [], diagnostics: [{ code: ErrorCodes.SUBTITLE_PACKET_INVALID, severity: 'error', message: 'Embedded subtitle packet has no text', cueId: `${trackId}:packet:${index}` }] }
  return { cues: [{ cueId: `${trackId}:packet:${index}`, trackId, start, end, text: normalized, layer: 0 }], diagnostics: [] }
}

function safeAdd(left: number, right: number | null): number | null {
  if (right === null || !Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0) return null
  const value = left + right
  return Number.isSafeInteger(value) ? value : null
}

function compareCue(left: import('@mx-player-max/types').SubtitleCue, right: import('@mx-player-max/types').SubtitleCue): number {
  return compareNumber(left.start, right.start) || compareNumber(left.end, right.end) || compareNumber(right.layer, left.layer) || compareString(left.cueId, right.cueId)
}

function compareNumber(left: number, right: number): number { return left < right ? -1 : left > right ? 1 : 0 }
function compareString(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }
