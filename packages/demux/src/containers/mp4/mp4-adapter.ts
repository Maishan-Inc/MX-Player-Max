import { ErrorCodes, type DemuxPacket, type MediaDescriptor, type Micros, type TrackInfo, type TrackKind } from '@mx-player-max/types'
import { DemuxError } from '../../range/errors'
import type { RangeLoader } from '../../range/types'
import { BoundedRangeReader } from '../bounded-reader'
import { resolveDemuxLimits, type DemuxLimits, type DemuxLimitsInput } from '../limits'
import type { ContainerAdapter, ContainerProbeResult, Demuxer } from '../types'
import {
  boxPayload,
  readInt32,
  readMemoryBoxes,
  readStreamBox,
  readUint16,
  readUint32,
  readUint64,
  type Mp4Box,
} from './boxes'
import {
  buildMp4Samples,
  type CompositionOffsetEntry,
  type MediaDataRange,
  type Mp4Sample,
  type Mp4TrackTable,
  type SampleToChunkEntry,
  type TimeToSampleEntry,
} from './sample-table'

interface Mp4ParseState {
  rawLoader: RangeLoader
  reader: BoundedRangeReader
  limits: DemuxLimits
  result: ContainerProbeResult
  samplesByTrack: Map<number, Mp4Sample[]>
  fragmented: boolean
}

interface ParsedTrack {
  info: TrackInfo
  timescale: number
  duration: Micros | null
  table: Mp4TrackTable
}

function findBox(boxes: readonly Mp4Box[], type: string): Mp4Box | undefined {
  return boxes.find((box) => box.type === type)
}

function requireBox(boxes: readonly Mp4Box[], type: string): Mp4Box {
  const box = findBox(boxes, type)
  if (box === undefined) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, `MP4 is missing required ${type} box`)
  return box
}

function cloneTrack(track: TrackInfo): TrackInfo {
  return {
    ...track,
    ...(track.codecPrivate === undefined ? {} : { codecPrivate: track.codecPrivate.slice(0) }),
    ...(track.color === undefined ? {} : { color: { ...track.color } }),
    ...(track.audioObjects === undefined ? {} : { audioObjects: { ...track.audioObjects } }),
  }
}

function cloneMedia(media: MediaDescriptor): MediaDescriptor {
  return { ...media, tracks: media.tracks.map(cloneTrack) }
}

function fullBoxVersion(data: Uint8Array): number {
  const version = data[0]
  if (version === undefined) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'MP4 full box header is truncated')
  return version
}

function safeDuration(duration: number | null, timescale: number): Micros | null {
  if (duration === null) return null
  if (!Number.isSafeInteger(timescale) || timescale <= 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'MP4 timescale must be positive')
  const micros = Math.round((duration * 1_000_000) / timescale)
  if (!Number.isSafeInteger(micros)) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'MP4 duration exceeds the safe microsecond range')
  return micros
}

function parseMovieHeader(data: Uint8Array): { timescale: number; duration: number | null } {
  const version = fullBoxVersion(data)
  if (version === 0) {
    const duration = readUint32(data, 16)
    return { timescale: readUint32(data, 12), duration: duration === 0xffff_ffff ? null : duration }
  }
  if (version === 1) {
    if (data.byteLength < 32) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'Version 1 mvhd is truncated')
    const timescale = readUint32(data, 20)
    const raw = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(24)
    return { timescale, duration: raw === 0xffff_ffff_ffff_ffffn ? null : readUint64(data, 24) }
  }
  throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Unsupported mvhd version')
}

function parseTrackId(data: Uint8Array): number {
  const version = fullBoxVersion(data)
  const id = version === 0 ? readUint32(data, 12) : version === 1 ? readUint32(data, 20) : 0
  if (id <= 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'tkhd track ID must be positive')
  return id
}

function parseMediaHeader(data: Uint8Array): { timescale: number; duration: number | null; language: string | undefined } {
  const version = fullBoxVersion(data)
  const timescaleOffset = version === 0 ? 12 : version === 1 ? 20 : -1
  const durationOffset = version === 0 ? 16 : 24
  const languageOffset = version === 0 ? 20 : 32
  if (timescaleOffset < 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Unsupported mdhd version')
  const timescale = readUint32(data, timescaleOffset)
  if (version === 1 && data.byteLength < 34) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'Version 1 mdhd is truncated')
  const rawDuration = version === 0
    ? BigInt(readUint32(data, durationOffset))
    : new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(durationOffset)
  const duration = rawDuration === (version === 0 ? 0xffff_ffffn : 0xffff_ffff_ffff_ffffn)
    ? null
    : rawDuration > BigInt(Number.MAX_SAFE_INTEGER)
      ? (() => { throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'mdhd duration exceeds the safe integer range') })()
      : Number(rawDuration)
  const languageBits = readUint16(data, languageOffset)
  let language: string | undefined
  if (languageBits !== 0) {
    const chars = [
      ((languageBits >> 10) & 0x1f) + 0x60,
      ((languageBits >> 5) & 0x1f) + 0x60,
      (languageBits & 0x1f) + 0x60,
    ]
    if (chars.every((value) => value >= 0x61 && value <= 0x7a)) language = String.fromCharCode(...chars)
  }
  return {
    timescale,
    duration,
    language,
  }
}

function parseHandler(data: Uint8Array): TrackKind | null {
  if (data.byteLength < 12) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'hdlr box is truncated')
  const type = String.fromCharCode(data[8] ?? 0, data[9] ?? 0, data[10] ?? 0, data[11] ?? 0)
  if (type === 'vide') return 'video'
  if (type === 'soun') return 'audio'
  if (type === 'text' || type === 'subt' || type === 'sbtl') return 'subtitle'
  return null
}

function parseEntryArray(
  data: Uint8Array,
  stride: number,
  parse: (offset: number) => void,
): void {
  const count = readUint32(data, 4)
  const required = 8 + count * stride
  if (!Number.isSafeInteger(required) || required !== data.byteLength) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'MP4 table entry count does not match its payload')
  }
  for (let index = 0; index < count; index += 1) parse(8 + index * stride)
}

function parseStts(data: Uint8Array): TimeToSampleEntry[] {
  const entries: TimeToSampleEntry[] = []
  parseEntryArray(data, 8, (offset) => entries.push({ count: readUint32(data, offset), delta: readUint32(data, offset + 4) }))
  return entries
}

function parseCtts(data: Uint8Array): CompositionOffsetEntry[] {
  const version = fullBoxVersion(data)
  if (version !== 0 && version !== 1) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Unsupported ctts version')
  const entries: CompositionOffsetEntry[] = []
  parseEntryArray(data, 8, (offset) => entries.push({
    count: readUint32(data, offset),
    offset: version === 0 ? readUint32(data, offset + 4) : readInt32(data, offset + 4),
  }))
  return entries
}

function parseStsc(data: Uint8Array): SampleToChunkEntry[] {
  const entries: SampleToChunkEntry[] = []
  parseEntryArray(data, 12, (offset) => entries.push({
    firstChunk: readUint32(data, offset),
    samplesPerChunk: readUint32(data, offset + 4),
    sampleDescriptionIndex: readUint32(data, offset + 8),
  }))
  return entries
}

function parseStsz(data: Uint8Array): number[] {
  if (data.byteLength < 12) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'stsz box is truncated')
  const fixedSize = readUint32(data, 4)
  const count = readUint32(data, 8)
  if (fixedSize !== 0) return Array.from({ length: count }, () => fixedSize)
  const required = 12 + count * 4
  if (!Number.isSafeInteger(required) || required !== data.byteLength) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'stsz sample count does not match its payload')
  }
  return Array.from({ length: count }, (_, index) => readUint32(data, 12 + index * 4))
}

function parseChunkOffsets(data: Uint8Array, wide: boolean): number[] {
  const offsets: number[] = []
  parseEntryArray(data, wide ? 8 : 4, (offset) => offsets.push(wide ? readUint64(data, offset) : readUint32(data, offset)))
  return offsets
}

function parseStss(data: Uint8Array, sampleCount: number, limits: DemuxLimits): Set<number> {
  const samples = new Set<number>()
  parseEntryArray(data, 4, (offset) => {
    const sample = readUint32(data, offset)
    if (sample <= 0 || sample > sampleCount) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'stss references an invalid sample number')
    samples.add(sample)
  })
  if (samples.size > limits.maxKeyframes) throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'stss exceeds the keyframe budget')
  return samples
}

function descriptorLength(data: Uint8Array, offset: number): { length: number; bytes: number } {
  let length = 0
  for (let index = 0; index < 4; index += 1) {
    const byte = data[offset + index]
    if (byte === undefined) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'ES descriptor length is truncated')
    length = (length << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) return { length, bytes: index + 1 }
  }
  throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'ES descriptor length exceeds four bytes')
}

function extractAudioSpecificConfig(esds: Uint8Array): Uint8Array {
  for (let offset = 4; offset < esds.byteLength; offset += 1) {
    if (esds[offset] !== 0x05) continue
    const descriptor = descriptorLength(esds, offset + 1)
    const start = offset + 1 + descriptor.bytes
    const end = start + descriptor.length
    if (end > esds.byteLength) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'DecoderSpecificInfo is truncated')
    return esds.slice(start, end)
  }
  return esds.slice()
}

function codecString(type: string, privateData: Uint8Array | undefined): string {
  if ((type === 'avc1' || type === 'avc3') && privateData !== undefined && privateData.byteLength >= 4) {
    const values = [privateData[1] ?? 0, privateData[2] ?? 0, privateData[3] ?? 0]
    return `${type}.${values.map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`
  }
  // A bare `vp08`/`vp09` is rejected by both WebCodecs and canPlayType. vpcC carries the profile,
  // level and bit depth outright, so no bitstream parsing is needed on this container.
  if (type === 'vp08' || type === 'vp09') {
    const vp9 = vpcCCodecSuffix(privateData)
    if (vp9 !== null) return `${type}.${vp9}`
  }
  if (type === 'mp4a' && privateData !== undefined && privateData.byteLength > 0) {
    const objectType = (privateData[0] ?? 0) >> 3
    if (objectType > 0) return `mp4a.40.${objectType}`
  }
  if (type === '.mp3' || type === 'mp3 ') return 'mp3'
  return type
}

/**
 * `vpcC` is a FullBox, so its payload starts with version and flags. Only version 1 has the layout
 * below; anything else keeps the bare sample entry type rather than risk a fabricated string.
 */
function vpcCCodecSuffix(privateData: Uint8Array | undefined): string | null {
  if (privateData === undefined || privateData.byteLength < 7 || privateData[0] !== 1) return null
  const profile = privateData[4] ?? 0
  const level = privateData[5] ?? 0
  const bitDepth = (privateData[6] ?? 0) >> 4
  if (profile > 3 || level < 10 || level > 99 || (bitDepth !== 8 && bitDepth !== 10 && bitDepth !== 12)) return null
  return [profile, level, bitDepth].map((value) => String(value).padStart(2, '0')).join('.')
}

function parseSampleDescription(
  data: Uint8Array,
  kind: TrackKind,
  trackId: number,
  language: string | undefined,
  limits: DemuxLimits,
): TrackInfo {
  if (data.byteLength < 8) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'stsd box is truncated')
  const count = readUint32(data, 4)
  const entries = readMemoryBoxes(data, 8, data.byteLength, limits, 2)
  if (count !== entries.length || count === 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'stsd entry count is invalid')
  const entry = entries[0]
  if (entry === undefined) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'stsd has no sample entry')
  let childStart: number
  let width: number | undefined
  let height: number | undefined
  let channels: number | undefined
  let sampleRate: number | undefined
  if (kind === 'video') {
    childStart = entry.start + 78
    if (childStart > entry.end) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'VisualSampleEntry is truncated')
    width = readUint16(data, entry.dataStart + 24)
    height = readUint16(data, entry.dataStart + 26)
  } else if (kind === 'audio') {
    const version = readUint16(data, entry.dataStart + 8)
    childStart = entry.start + (version === 0 ? 36 : version === 1 ? 52 : 72)
    if (childStart > entry.end) throw new DemuxError(ErrorCodes.CONTAINER_TRUNCATED, 'AudioSampleEntry is truncated')
    channels = readUint16(data, entry.dataStart + 16)
    sampleRate = readUint32(data, entry.dataStart + 24) / 65_536
  } else {
    childStart = Math.min(entry.end, entry.dataStart + 8)
  }
  const children = childStart === entry.end ? [] : readMemoryBoxes(data, childStart, entry.end, limits, 3)
  const preferredTypes = kind === 'video'
    ? ['avcC', 'hvcC', 'av1C', 'vpcC']
    : kind === 'audio' ? ['esds', 'dOps', 'dfLa'] : []
  const config = preferredTypes.map((type) => findBox(children, type)).find((box) => box !== undefined)
  let privateBytes: Uint8Array | undefined
  if (config !== undefined) {
    const payload = boxPayload(data, config)
    privateBytes = config.type === 'esds' ? extractAudioSpecificConfig(payload) : payload.slice()
  }
  return {
    id: trackId,
    kind,
    codecId: entry.type,
    codec: codecString(entry.type, privateBytes),
    ...(privateBytes === undefined ? {} : { codecPrivate: Uint8Array.from(privateBytes).buffer }),
    ...(language === undefined ? {} : { language }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(channels === undefined ? {} : { channels }),
    ...(sampleRate === undefined ? {} : { sampleRate }),
  }
}

function parseTrack(data: Uint8Array, trak: Mp4Box, limits: DemuxLimits): ParsedTrack | null {
  const trakPayload = boxPayload(data, trak)
  const trakChildren = readMemoryBoxes(trakPayload, 0, trakPayload.byteLength, limits, 2)
  const trackId = parseTrackId(boxPayload(trakPayload, requireBox(trakChildren, 'tkhd')))
  const mdiaPayload = boxPayload(trakPayload, requireBox(trakChildren, 'mdia'))
  const mdiaChildren = readMemoryBoxes(mdiaPayload, 0, mdiaPayload.byteLength, limits, 3)
  const mediaHeader = parseMediaHeader(boxPayload(mdiaPayload, requireBox(mdiaChildren, 'mdhd')))
  const kind = parseHandler(boxPayload(mdiaPayload, requireBox(mdiaChildren, 'hdlr')))
  if (kind === null) return null
  const minfPayload = boxPayload(mdiaPayload, requireBox(mdiaChildren, 'minf'))
  const minfChildren = readMemoryBoxes(minfPayload, 0, minfPayload.byteLength, limits, 4)
  const stblPayload = boxPayload(minfPayload, requireBox(minfChildren, 'stbl'))
  const stblChildren = readMemoryBoxes(stblPayload, 0, stblPayload.byteLength, limits, 5)
  const info = parseSampleDescription(boxPayload(stblPayload, requireBox(stblChildren, 'stsd')), kind, trackId, mediaHeader.language, limits)
  const sampleSizes = parseStsz(boxPayload(stblPayload, requireBox(stblChildren, 'stsz')))
  const stco = findBox(stblChildren, 'stco')
  const co64 = findBox(stblChildren, 'co64')
  if ((stco === undefined) === (co64 === undefined)) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'stbl must contain exactly one of stco or co64')
  const stss = findBox(stblChildren, 'stss')
  const ctts = findBox(stblChildren, 'ctts')
  const table: Mp4TrackTable = {
    info,
    kind,
    timescale: mediaHeader.timescale,
    sampleSizes,
    chunkOffsets: parseChunkOffsets(boxPayload(stblPayload, stco ?? requireBox(stblChildren, 'co64')), co64 !== undefined),
    sampleToChunk: parseStsc(boxPayload(stblPayload, requireBox(stblChildren, 'stsc'))),
    timeToSample: parseStts(boxPayload(stblPayload, requireBox(stblChildren, 'stts'))),
    compositionOffsets: ctts === undefined ? null : parseCtts(boxPayload(stblPayload, ctts)),
    syncSamples: stss === undefined ? null : parseStss(boxPayload(stblPayload, stss), sampleSizes.length, limits),
  }
  return { info, timescale: mediaHeader.timescale, duration: safeDuration(mediaHeader.duration, mediaHeader.timescale), table }
}

async function readPacket(reader: BoundedRangeReader, sample: Mp4Sample, limits: DemuxLimits): Promise<Uint8Array> {
  if (sample.size === 0) return new Uint8Array()
  const result = new Uint8Array(sample.size)
  let copied = 0
  while (copied < sample.size) {
    const length = Math.min(limits.maxReadRangeBytes, sample.size - copied)
    result.set(await reader.readAt(sample.offset + copied, length), copied)
    copied += length
  }
  return result
}

async function parseMp4Container(loader: RangeLoader, limits: DemuxLimits): Promise<Mp4ParseState> {
  const reader = new BoundedRangeReader(loader, limits)
  await reader.readAt(0, 12)
  let offset = 0
  const sourceEnd = reader.sourceLength
  let moovData: Uint8Array | null = null
  const mediaData: MediaDataRange[] = []
  let fragmented = false
  let topLevelBoxes = 0
  while (sourceEnd === null || offset < sourceEnd) {
    topLevelBoxes += 1
    if (topLevelBoxes > 10_000) throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'MP4 has too many top-level boxes')
    const box = await readStreamBox(reader, offset, sourceEnd, limits)
    if (offset === 0 && box.type !== 'ftyp') throw new DemuxError(ErrorCodes.CONTAINER_UNSUPPORTED, 'ISO BMFF source does not begin with ftyp')
    if (box.type === 'ftyp' && offset === 0) {
      const payloadLength = box.size - box.headerSize
      if (payloadLength < 8) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'ftyp payload is truncated')
      const payload = await reader.readMetadata(box.dataStart, payloadLength)
      for (const byte of payload.subarray(0, 4)) {
        if (byte < 0x20 || byte > 0x7e) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'ftyp major brand is invalid')
      }
    } else if (box.type === 'moov') {
      moovData = box.size === box.headerSize ? new Uint8Array() : await reader.readMetadata(box.dataStart, box.size - box.headerSize)
    } else if (box.type === 'mdat') {
      mediaData.push({ start: box.dataStart, end: box.end })
    } else if (box.type === 'moof') {
      fragmented = true
    }
    offset = box.end
    if (sourceEnd === null && moovData !== null && mediaData.length > 0) break
  }
  if (moovData === null) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'MP4 is missing moov')
  const moovChildren = readMemoryBoxes(moovData, 0, moovData.byteLength, limits)
  fragmented ||= findBox(moovChildren, 'mvex') !== undefined
  const movieHeader = parseMovieHeader(boxPayload(moovData, requireBox(moovChildren, 'mvhd')))
  const trakBoxes = moovChildren.filter((box) => box.type === 'trak')
  if (trakBoxes.length > limits.maxTracks) throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'MP4 track count exceeds the configured budget')
  const parsedTracks = trakBoxes.map((box) => parseTrack(moovData, box, limits)).filter((track): track is ParsedTrack => track !== null)
  if (parsedTracks.length === 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'MP4 has no supported media tracks')
  const samplesByTrack = new Map<number, Mp4Sample[]>()
  for (const track of parsedTracks) samplesByTrack.set(track.info.id, buildMp4Samples(track.table, mediaData, limits))
  const tracks = parsedTracks.map((track) => cloneTrack(track.info))
  const movieDuration = safeDuration(movieHeader.duration, movieHeader.timescale)
  const duration = movieDuration ?? parsedTracks.reduce<Micros | null>((maximum, track) => {
    if (track.duration === null) return maximum
    return maximum === null ? track.duration : Math.max(maximum, track.duration)
  }, null)
  const media: MediaDescriptor = {
    container: 'mp4',
    tracks: tracks.map(cloneTrack),
    duration,
    size: reader.sourceLength,
    mimeType: tracks.some((track) => track.kind === 'video') ? 'video/mp4' : 'audio/mp4',
  }
  const hasSamples = [...samplesByTrack.values()].some((samples) => samples.length > 0)
  const result: ContainerProbeResult = {
    container: 'mp4',
    media,
    tracks,
    duration,
    size: reader.sourceLength,
    hasSeekIndex: !fragmented && hasSamples,
  }
  return { rawLoader: loader, reader, limits, result, samplesByTrack, fragmented }
}

class Mp4Demuxer implements Demuxer {
  readonly #statePromise: Promise<Mp4ParseState>
  readonly #cursors = new Map<number, number>()
  #closed = false

  constructor(statePromise: Promise<Mp4ParseState>) {
    this.#statePromise = statePromise
  }

  async probe(): Promise<MediaDescriptor> {
    this.#assertOpen()
    return cloneMedia((await this.#statePromise).result.media)
  }

  async next(): Promise<DemuxPacket[]> {
    this.#assertOpen()
    const state = await this.#statePromise
    if (state.fragmented && ![...state.samplesByTrack.values()].some((samples) => samples.length > 0)) {
      throw new DemuxError(ErrorCodes.CONTAINER_UNSUPPORTED, 'Fragmented MP4 packet demux is not implemented in Phase 2')
    }
    const packets: DemuxPacket[] = []
    let totalBytes = 0
    while (packets.length < 32) {
      let selected: Mp4Sample | undefined
      for (const [trackId, samples] of state.samplesByTrack) {
        const candidate = samples[this.#cursors.get(trackId) ?? 0]
        if (candidate === undefined) continue
        if (selected === undefined || candidate.dts < selected.dts || (candidate.dts === selected.dts && candidate.trackId < selected.trackId)) {
          selected = candidate
        }
      }
      if (selected === undefined) break
      if (selected.size > state.limits.maxWorkerMessageBytes) {
        throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'MP4 packet exceeds the Worker message budget')
      }
      if (packets.length > 0 && totalBytes + selected.size > state.limits.maxWorkerMessageBytes) break
      const data = await readPacket(state.reader, selected, state.limits)
      packets.push({
        trackId: selected.trackId,
        kind: selected.kind,
        timestamp: selected.pts,
        duration: selected.duration,
        keyframe: selected.keyframe,
        data,
      })
      totalBytes += data.byteLength
      this.#cursors.set(selected.trackId, (this.#cursors.get(selected.trackId) ?? 0) + 1)
    }
    return packets
  }

  async seek(time: Micros): Promise<void> {
    this.#assertOpen()
    if (!Number.isSafeInteger(time) || time < 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Seek time must be a non-negative integer microsecond value')
    const state = await this.#statePromise
    const videoEntry = [...state.samplesByTrack.entries()]
      .filter(([, samples]) => samples[0]?.kind === 'video')
      .sort(([left], [right]) => left - right)[0]
    let anchorDts = time
    if (videoEntry !== undefined) {
      const [trackId, samples] = videoEntry
      let selectedIndex = 0
      for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index]
        if (sample === undefined || sample.pts > time) break
        if (sample.keyframe) selectedIndex = index
      }
      this.#cursors.set(trackId, selectedIndex)
      anchorDts = samples[selectedIndex]?.dts ?? time
    }
    for (const [trackId, samples] of state.samplesByTrack) {
      if (videoEntry?.[0] === trackId) continue
      const index = samples.findIndex((sample) => sample.dts >= anchorDts)
      this.#cursors.set(trackId, index < 0 ? samples.length : index)
    }
  }

  close(): void {
    this.#closed = true
  }

  #assertOpen(): void {
    if (this.#closed) throw new DemuxError(ErrorCodes.RANGE_CLOSED, 'Demuxer is closed')
  }
}

export class Mp4ContainerAdapter implements ContainerAdapter {
  readonly id = 'mp4'
  readonly name = 'ISO Base Media File Format'
  readonly #limits: DemuxLimits
  readonly #states = new WeakMap<ContainerProbeResult, Mp4ParseState>()

  constructor(limits: DemuxLimitsInput = {}) {
    this.#limits = resolveDemuxLimits(limits)
  }

  canProbe(header: Uint8Array): boolean {
    return header.byteLength >= 8
      && header[4] === 0x66
      && header[5] === 0x74
      && header[6] === 0x79
      && header[7] === 0x70
  }

  async probe(reader: RangeLoader): Promise<ContainerProbeResult> {
    const state = await parseMp4Container(reader, this.#limits)
    this.#states.set(state.result, state)
    return state.result
  }

  createDemuxer(reader: RangeLoader, metadata: ContainerProbeResult): Demuxer {
    const existing = this.#states.get(metadata)
    return new Mp4Demuxer(existing !== undefined && existing.rawLoader === reader
      ? Promise.resolve(existing)
      : parseMp4Container(reader, this.#limits))
  }
}
