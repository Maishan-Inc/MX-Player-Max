import { ErrorCodes, type DemuxPacket, type MediaDescriptor, type Micros, type TrackInfo, type TrackKind } from '@mx-player-max/types'
import { DemuxError } from '../../range/errors'
import type { RangeLoader } from '../../range/types'
import { checkedAdd } from '../../range/validation'
import { BoundedRangeReader } from '../bounded-reader'
import { resolveDemuxLimits, type DemuxLimits, type DemuxLimitsInput } from '../limits'
import type { ContainerAdapter, ContainerProbeResult, Demuxer } from '../types'
import { parseEbmlBlock, type EbmlTrackState } from './blocks'
import { EBML_IDS, EBML_TOP_LEVEL_IDS } from './ids'
import {
  elementPayload,
  readEbmlFloat,
  readEbmlText,
  readEbmlUnsigned,
  readMemoryElements,
  readStreamElement,
  parseEbmlVint,
  type EbmlElement,
} from './reader'

interface EbmlAdapterConfig {
  id: string
  name: string
  docType: 'matroska' | 'webm'
  mimeVideo: string
  mimeAudio: string
}

interface ClusterLocation {
  offset: number
  dataStart: number
  dataEnd: number | null
}

interface CueEntry {
  time: Micros
  trackId: number
  clusterOffset: number
}

interface EbmlParseState {
  rawLoader: RangeLoader
  reader: BoundedRangeReader
  limits: DemuxLimits
  result: ContainerProbeResult
  segmentDataStart: number
  segmentEnd: number | null
  timecodeScale: number
  tracks: Map<number, EbmlTrackState>
  clusters: ClusterLocation[]
  cues: CueEntry[]
}

interface RawTrack {
  number: number | null
  type: number | null
  codecId: string | null
  codecPrivate: ArrayBuffer | undefined
  language: string | undefined
  name: string | undefined
  width: number | undefined
  height: number | undefined
  frameRate: number | undefined
  defaultDurationNs: number | undefined
  sampleRate: number | undefined
  channels: number | undefined
}

function requireKnownPayload(element: EbmlElement): { start: number; length: number } {
  if (element.size === null || element.dataEnd === null) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Metadata EBML element cannot use unknown length')
  }
  return { start: element.dataStart, length: element.size }
}

async function readElementPayload(
  reader: BoundedRangeReader,
  element: EbmlElement,
): Promise<Uint8Array> {
  const payload = requireKnownPayload(element)
  if (payload.length === 0) return new Uint8Array()
  return reader.readMetadata(payload.start, payload.length)
}

function findElement(elements: readonly EbmlElement[], id: number): EbmlElement | undefined {
  return elements.find((element) => element.id === id)
}

function uintValue(data: Uint8Array, element: EbmlElement | undefined): number | undefined {
  return element === undefined ? undefined : readEbmlUnsigned(elementPayload(data, element))
}

function floatValue(data: Uint8Array, element: EbmlElement | undefined): number | undefined {
  return element === undefined ? undefined : readEbmlFloat(elementPayload(data, element))
}

function textValue(data: Uint8Array, element: EbmlElement | undefined): string | undefined {
  return element === undefined ? undefined : readEbmlText(elementPayload(data, element))
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

function cloneProbe(result: ContainerProbeResult): ContainerProbeResult {
  const tracks = result.tracks.map(cloneTrack)
  return {
    ...result,
    tracks,
    media: { ...result.media, tracks: tracks.map(cloneTrack) },
  }
}

function mapTrackKind(value: number | null): TrackKind | null {
  if (value === 1) return 'video'
  if (value === 2) return 'audio'
  if (value === 17) return 'subtitle'
  return null
}

function mapCodec(codecId: string, codecPrivate: ArrayBuffer | undefined): string | undefined {
  const codecs: Readonly<Record<string, string>> = {
    'V_MPEG4/ISO/AVC': 'avc1',
    'V_MPEGH/ISO/HEVC': 'hvc1',
    V_VP8: 'vp8',
    V_VP9: 'vp09',
    V_AV1: 'av01',
    A_OPUS: 'opus',
    'A_MPEG/L3': 'mp3',
    A_VORBIS: 'vorbis',
  }
  if (codecId === 'A_AAC') {
    if (codecPrivate !== undefined && codecPrivate.byteLength > 0) {
      const objectType = (new Uint8Array(codecPrivate)[0] ?? 0) >> 3
      if (objectType > 0) return `mp4a.40.${objectType}`
    }
    return 'mp4a.40.2'
  }
  return codecs[codecId]
}

function parseTrackEntry(data: Uint8Array, limits: DemuxLimits): RawTrack {
  const elements = readMemoryElements(data, 0, data.byteLength, limits, 2)
  const raw: RawTrack = {
    number: uintValue(data, findElement(elements, EBML_IDS.TRACK_NUMBER)) ?? null,
    type: uintValue(data, findElement(elements, EBML_IDS.TRACK_TYPE)) ?? null,
    codecId: textValue(data, findElement(elements, EBML_IDS.CODEC_ID)) ?? null,
    codecPrivate: undefined,
    language: textValue(data, findElement(elements, EBML_IDS.LANGUAGE)),
    name: textValue(data, findElement(elements, EBML_IDS.NAME)),
    width: undefined,
    height: undefined,
    frameRate: undefined,
    defaultDurationNs: uintValue(data, findElement(elements, EBML_IDS.DEFAULT_DURATION)),
    sampleRate: undefined,
    channels: undefined,
  }
  const codecPrivate = findElement(elements, EBML_IDS.CODEC_PRIVATE)
  if (codecPrivate !== undefined) raw.codecPrivate = Uint8Array.from(elementPayload(data, codecPrivate)).buffer

  const video = findElement(elements, EBML_IDS.VIDEO)
  if (video !== undefined) {
    const payload = elementPayload(data, video)
    const children = readMemoryElements(payload, 0, payload.byteLength, limits, 3)
    raw.width = uintValue(payload, findElement(children, EBML_IDS.PIXEL_WIDTH))
    raw.height = uintValue(payload, findElement(children, EBML_IDS.PIXEL_HEIGHT))
    raw.frameRate = floatValue(payload, findElement(children, EBML_IDS.FRAME_RATE))
  }
  const audio = findElement(elements, EBML_IDS.AUDIO)
  if (audio !== undefined) {
    const payload = elementPayload(data, audio)
    const children = readMemoryElements(payload, 0, payload.byteLength, limits, 3)
    raw.sampleRate = floatValue(payload, findElement(children, EBML_IDS.SAMPLING_FREQUENCY))
    raw.channels = uintValue(payload, findElement(children, EBML_IDS.CHANNELS))
  }
  return raw
}

function buildTrack(raw: RawTrack): EbmlTrackState | null {
  const kind = mapTrackKind(raw.type)
  if (kind === null) return null
  if (raw.number === null || raw.number <= 0 || raw.codecId === null || raw.codecId.length === 0) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Matroska media track is missing identity or CodecID')
  }
  const codec = mapCodec(raw.codecId, raw.codecPrivate)
  let frameRate = raw.frameRate
  if (frameRate === undefined && raw.defaultDurationNs !== undefined && raw.defaultDurationNs > 0) {
    frameRate = 1_000_000_000 / raw.defaultDurationNs
  }
  const info: TrackInfo = {
    id: raw.number,
    kind,
    codecId: raw.codecId,
    ...(codec === undefined ? {} : { codec }),
    ...(raw.codecPrivate === undefined ? {} : { codecPrivate: raw.codecPrivate }),
    ...(raw.language === undefined ? {} : { language: raw.language }),
    ...(raw.name === undefined ? {} : { name: raw.name }),
    ...(raw.width === undefined ? {} : { width: raw.width }),
    ...(raw.height === undefined ? {} : { height: raw.height }),
    ...(frameRate === undefined ? {} : { frameRate }),
    ...(raw.sampleRate === undefined ? {} : { sampleRate: raw.sampleRate }),
    ...(raw.channels === undefined ? {} : { channels: raw.channels }),
  }
  const defaultDurationMicros = raw.defaultDurationNs === undefined
    ? null
    : Math.round(raw.defaultDurationNs / 1_000)
  if (defaultDurationMicros !== null && !Number.isSafeInteger(defaultDurationMicros)) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Track default duration exceeds the safe microsecond range')
  }
  return { info, defaultDurationMicros }
}

function parseTracks(data: Uint8Array, limits: DemuxLimits): Map<number, EbmlTrackState> {
  const elements = readMemoryElements(data, 0, data.byteLength, limits)
  const entries = elements.filter((element) => element.id === EBML_IDS.TRACK_ENTRY)
  if (entries.length > limits.maxTracks) {
    throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'Matroska track count exceeds the configured budget')
  }
  const tracks = new Map<number, EbmlTrackState>()
  for (const entry of entries) {
    const track = buildTrack(parseTrackEntry(elementPayload(data, entry), limits))
    if (track === null) continue
    if (tracks.has(track.info.id)) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Matroska track numbers must be unique')
    tracks.set(track.info.id, track)
  }
  return tracks
}

function parseInfo(data: Uint8Array, limits: DemuxLimits): { scale: number; durationUnits: number | null } {
  const elements = readMemoryElements(data, 0, data.byteLength, limits)
  const scale = uintValue(data, findElement(elements, EBML_IDS.TIMECODE_SCALE)) ?? 1_000_000
  const durationUnits = floatValue(data, findElement(elements, EBML_IDS.DURATION)) ?? null
  if (scale <= 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Matroska TimecodeScale must be positive')
  if (durationUnits !== null && durationUnits < 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Matroska Duration cannot be negative')
  return { scale, durationUnits }
}

function parseCues(
  data: Uint8Array,
  limits: DemuxLimits,
  timecodeScale: number,
  segmentDataStart: number,
  segmentEnd: number | null,
): CueEntry[] {
  const points = readMemoryElements(data, 0, data.byteLength, limits)
    .filter((element) => element.id === EBML_IDS.CUE_POINT)
  const cues: CueEntry[] = []
  for (const point of points) {
    const pointPayload = elementPayload(data, point)
    const children = readMemoryElements(pointPayload, 0, pointPayload.byteLength, limits, 2)
    const cueTime = uintValue(pointPayload, findElement(children, EBML_IDS.CUE_TIME))
    if (cueTime === undefined) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'CuePoint is missing CueTime')
    for (const positions of children.filter((element) => element.id === EBML_IDS.CUE_TRACK_POSITIONS)) {
      const payload = elementPayload(pointPayload, positions)
      const positionChildren = readMemoryElements(payload, 0, payload.byteLength, limits, 3)
      const trackId = uintValue(payload, findElement(positionChildren, EBML_IDS.CUE_TRACK))
      const relativeOffset = uintValue(payload, findElement(positionChildren, EBML_IDS.CUE_CLUSTER_POSITION))
      if (trackId === undefined || relativeOffset === undefined) {
        throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'CueTrackPositions is incomplete')
      }
      const clusterOffset = checkedAdd(segmentDataStart, relativeOffset)
      if (segmentEnd !== null && clusterOffset >= segmentEnd) {
        throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Cue cluster position exceeds the Segment boundary')
      }
      const time = Math.round((cueTime * timecodeScale) / 1_000)
      if (!Number.isSafeInteger(time)) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Cue timestamp overflowed')
      cues.push({ time, trackId, clusterOffset })
      if (cues.length > limits.maxKeyframes) {
        throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'Cue count exceeds the configured budget')
      }
    }
  }
  return cues.sort((left, right) => left.time - right.time || left.clusterOffset - right.clusterOffset)
}

function parseDocType(data: Uint8Array, limits: DemuxLimits): string {
  const elements = readMemoryElements(data, 0, data.byteLength, limits)
  const maxIdLength = uintValue(data, findElement(elements, EBML_IDS.EBML_MAX_ID_LENGTH))
  const maxSizeLength = uintValue(data, findElement(elements, EBML_IDS.EBML_MAX_SIZE_LENGTH))
  if (maxIdLength !== undefined && maxIdLength > 4) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBMLMaxIDLength exceeds 4')
  if (maxSizeLength !== undefined && maxSizeLength > 8) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBMLMaxSizeLength exceeds 8')
  const docType = textValue(data, findElement(elements, EBML_IDS.DOC_TYPE))
  if (docType === undefined || docType.length === 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML Header is missing DocType')
  return docType
}

async function findUnknownClusterEnd(
  reader: BoundedRangeReader,
  start: number,
  segmentEnd: number | null,
  limits: DemuxLimits,
): Promise<number | null> {
  let offset = start
  while (segmentEnd === null || offset < segmentEnd) {
    if (offset - start > limits.maxForwardScanBytes) {
      throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'Unknown-length Cluster scan exceeded its byte budget')
    }
    const child = await readStreamElement(reader, offset, segmentEnd, limits)
    if (EBML_TOP_LEVEL_IDS.has(child.id)) return offset
    if (child.dataEnd === null || child.dataEnd <= offset) {
      throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Unknown-length Cluster child cannot be skipped safely')
    }
    offset = child.dataEnd
  }
  return segmentEnd
}

async function parseEbmlContainer(
  loader: RangeLoader,
  limits: DemuxLimits,
  config: EbmlAdapterConfig,
): Promise<EbmlParseState> {
  const reader = new BoundedRangeReader(loader, limits)
  await reader.readAt(0, 12)
  const ebml = await readStreamElement(reader, 0, reader.sourceLength, limits)
  if (ebml.id !== EBML_IDS.EBML) throw new DemuxError(ErrorCodes.CONTAINER_UNSUPPORTED, 'Source does not begin with an EBML Header')
  const docType = parseDocType(await readElementPayload(reader, ebml), limits)
  if (docType !== config.docType) {
    throw new DemuxError(ErrorCodes.CONTAINER_UNSUPPORTED, `EBML DocType is ${docType}, not ${config.docType}`)
  }
  if (ebml.dataEnd === null) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML Header cannot have unknown length')
  const segment = await readStreamElement(reader, ebml.dataEnd, reader.sourceLength, limits)
  if (segment.id !== EBML_IDS.SEGMENT) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'EBML Header is not followed by Segment')
  const segmentEnd = segment.dataEnd ?? reader.sourceLength
  const clusters: ClusterLocation[] = []
  let tracks = new Map<number, EbmlTrackState>()
  let timecodeScale = 1_000_000
  let durationUnits: number | null = null
  let cues: CueEntry[] = []
  const cuePayloads: Uint8Array[] = []
  let offset = segment.dataStart

  while (segmentEnd === null || offset < segmentEnd) {
    if (offset - segment.dataStart > limits.maxForwardScanBytes) break
    const element = await readStreamElement(reader, offset, segmentEnd, limits)
    if (element.id === EBML_IDS.INFO) {
      const info = parseInfo(await readElementPayload(reader, element), limits)
      timecodeScale = info.scale
      durationUnits = info.durationUnits
    } else if (element.id === EBML_IDS.TRACKS) {
      tracks = parseTracks(await readElementPayload(reader, element), limits)
    } else if (element.id === EBML_IDS.CUES) {
      cuePayloads.push(await readElementPayload(reader, element))
    } else if (element.id === EBML_IDS.CLUSTER) {
      const dataEnd = element.dataEnd ?? await findUnknownClusterEnd(reader, element.dataStart, segmentEnd, limits)
      clusters.push({ offset: element.headerStart, dataStart: element.dataStart, dataEnd })
      if (dataEnd === null) break
      offset = dataEnd
      continue
    }
    if (element.dataEnd === null || element.dataEnd <= offset) {
      throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Unknown-length top-level EBML element cannot be skipped')
    }
    offset = element.dataEnd
  }
  if (tracks.size === 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Container has no supported media tracks')
  cues = cuePayloads.flatMap((payload) => parseCues(payload, limits, timecodeScale, segment.dataStart, segmentEnd))
  if (cues.length > limits.maxKeyframes) {
    throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'Cue count exceeds the configured budget')
  }
  cues.sort((left, right) => left.time - right.time || left.clusterOffset - right.clusterOffset)
  const duration = durationUnits === null ? null : Math.round((durationUnits * timecodeScale) / 1_000)
  if (duration !== null && !Number.isSafeInteger(duration)) {
    throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Container duration exceeds the safe microsecond range')
  }
  const publicTracks = [...tracks.values()].map((track) => cloneTrack(track.info))
  const hasVideo = publicTracks.some((track) => track.kind === 'video')
  const media: MediaDescriptor = {
    container: config.id,
    tracks: publicTracks.map(cloneTrack),
    duration,
    size: reader.sourceLength,
    mimeType: hasVideo ? config.mimeVideo : config.mimeAudio,
  }
  const result: ContainerProbeResult = {
    container: config.id,
    media,
    tracks: publicTracks,
    duration,
    size: reader.sourceLength,
    hasSeekIndex: cues.length > 0,
  }
  return {
    rawLoader: loader,
    reader,
    limits,
    result,
    segmentDataStart: segment.dataStart,
    segmentEnd,
    timecodeScale,
    tracks,
    clusters,
    cues,
  }
}

interface BlockRecord {
  data: Uint8Array
  keyframe: boolean
  durationTimecodes: number | null
}

function parseBlockGroup(data: Uint8Array, limits: DemuxLimits): BlockRecord {
  const elements = readMemoryElements(data, 0, data.byteLength, limits, 2)
  const block = findElement(elements, EBML_IDS.BLOCK)
  if (block === undefined) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'BlockGroup is missing Block')
  return {
    data: elementPayload(data, block),
    keyframe: findElement(elements, EBML_IDS.REFERENCE_BLOCK) === undefined,
    durationTimecodes: uintValue(data, findElement(elements, EBML_IDS.BLOCK_DURATION)) ?? null,
  }
}

async function readClusterPackets(state: EbmlParseState, cluster: ClusterLocation): Promise<DemuxPacket[]> {
  const end = cluster.dataEnd ?? state.segmentEnd
  if (end === null) throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'Cannot bound an unknown-length final Cluster')
  let offset = cluster.dataStart
  let clusterTimecode: number | null = null
  const records: BlockRecord[] = []
  while (offset < end) {
    const element = await readStreamElement(state.reader, offset, end, state.limits)
    if (element.id === EBML_IDS.TIMECODE) {
      clusterTimecode = readEbmlUnsigned(await readElementPayload(state.reader, element))
    } else if (element.id === EBML_IDS.SIMPLE_BLOCK) {
      const payloadInfo = requireKnownPayload(element)
      const payload = await state.reader.readBuffered(
        payloadInfo.start,
        payloadInfo.length,
        state.limits.maxPacketBytes + 16,
        'SimpleBlock',
      )
      const trackLength = parseEbmlVint(payload, 0).length
      const flags = payload[trackLength + 2]
      records.push({ data: payload, keyframe: flags !== undefined && (flags & 0x80) !== 0, durationTimecodes: null })
    } else if (element.id === EBML_IDS.BLOCK_GROUP) {
      const payloadInfo = requireKnownPayload(element)
      records.push(parseBlockGroup(await state.reader.readBuffered(
        payloadInfo.start,
        payloadInfo.length,
        state.limits.maxPacketBytes + 64 * 1024,
        'BlockGroup',
      ), state.limits))
    }
    if (element.dataEnd === null || element.dataEnd <= offset) {
      throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Cluster child did not advance the parser')
    }
    offset = element.dataEnd
  }
  if (clusterTimecode === null) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Cluster is missing Timecode')
  const packets: DemuxPacket[] = []
  let totalBytes = 0
  for (const record of records) {
    const parsed = parseEbmlBlock(record.data, {
      clusterTimecode,
      timecodeScale: state.timecodeScale,
      keyframe: record.keyframe,
      blockDurationTimecodes: record.durationTimecodes,
      tracks: state.tracks,
      limits: state.limits,
    })
    for (const packet of parsed) {
      totalBytes += packet.data.byteLength
      if (totalBytes > state.limits.maxWorkerMessageBytes) {
        throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'Cluster packet batch exceeds the Worker message budget')
      }
      packets.push(packet)
    }
  }
  return packets
}

class EbmlDemuxer implements Demuxer {
  readonly #statePromise: Promise<EbmlParseState>
  #clusterIndex = 0
  #closed = false

  constructor(statePromise: Promise<EbmlParseState>) {
    this.#statePromise = statePromise
  }

  async probe(): Promise<MediaDescriptor> {
    this.#assertOpen()
    return cloneMedia((await this.#statePromise).result.media)
  }

  async next(): Promise<DemuxPacket[]> {
    this.#assertOpen()
    const state = await this.#statePromise
    while (this.#clusterIndex < state.clusters.length) {
      const cluster = state.clusters[this.#clusterIndex]
      this.#clusterIndex += 1
      if (cluster === undefined) return []
      const packets = await readClusterPackets(state, cluster)
      if (packets.length > 0) return packets
    }
    return []
  }

  async seek(time: Micros): Promise<void> {
    this.#assertOpen()
    if (!Number.isSafeInteger(time) || time < 0) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Seek time must be a non-negative integer microsecond value')
    const state = await this.#statePromise
    let targetOffset: number | null = null
    for (const cue of state.cues) {
      if (cue.time > time) break
      targetOffset = cue.clusterOffset
    }
    if (targetOffset !== null) {
      let index = state.clusters.findIndex((cluster) => cluster.offset === targetOffset)
      if (index < 0) {
        const element = await readStreamElement(state.reader, targetOffset, state.segmentEnd, state.limits)
        if (element.id !== EBML_IDS.CLUSTER) throw new DemuxError(ErrorCodes.CONTAINER_INVALID, 'Cue does not point to a Cluster')
        state.clusters.push({ offset: targetOffset, dataStart: element.dataStart, dataEnd: element.dataEnd })
        state.clusters.sort((left, right) => left.offset - right.offset)
        index = state.clusters.findIndex((cluster) => cluster.offset === targetOffset)
      }
      this.#clusterIndex = Math.max(0, index)
      return
    }

    let selected = 0
    const scanStart = state.clusters[0]?.offset ?? state.segmentDataStart
    for (let index = 0; index < state.clusters.length; index += 1) {
      const cluster = state.clusters[index]
      if (cluster === undefined) continue
      if (cluster.offset - scanStart > state.limits.maxForwardScanBytes) {
        throw new DemuxError(ErrorCodes.CONTAINER_LIMIT_EXCEEDED, 'Forward seek scan exceeded its byte budget')
      }
      const packets = await readClusterPackets(state, cluster)
      const keyframe = packets.find((packet) => packet.kind === 'video' && packet.keyframe)
      if (keyframe !== undefined && keyframe.timestamp <= time) selected = index
      if (keyframe !== undefined && keyframe.timestamp > time) break
    }
    this.#clusterIndex = selected
  }

  close(): void {
    this.#closed = true
  }

  #assertOpen(): void {
    if (this.#closed) throw new DemuxError(ErrorCodes.RANGE_CLOSED, 'Demuxer is closed')
  }
}

export class EbmlContainerAdapter implements ContainerAdapter {
  readonly id: string
  readonly name: string
  readonly #config: EbmlAdapterConfig
  readonly #limits: DemuxLimits
  readonly #states = new WeakMap<ContainerProbeResult, EbmlParseState>()

  constructor(config: EbmlAdapterConfig, limits: DemuxLimitsInput = {}) {
    this.id = config.id
    this.name = config.name
    this.#config = config
    this.#limits = resolveDemuxLimits(limits)
  }

  canProbe(header: Uint8Array): boolean {
    return header.byteLength >= 4
      && header[0] === 0x1a
      && header[1] === 0x45
      && header[2] === 0xdf
      && header[3] === 0xa3
  }

  async probe(reader: RangeLoader): Promise<ContainerProbeResult> {
    const state = await parseEbmlContainer(reader, this.#limits, this.#config)
    const result = state.result
    this.#states.set(result, state)
    return result
  }

  createDemuxer(reader: RangeLoader, metadata: ContainerProbeResult): Demuxer {
    const existing = this.#states.get(metadata)
    const statePromise = existing !== undefined && existing.rawLoader === reader
      ? Promise.resolve(existing)
      : parseEbmlContainer(reader, this.#limits, this.#config)
    return new EbmlDemuxer(statePromise)
  }
}

export class MatroskaContainerAdapter extends EbmlContainerAdapter {
  constructor(limits: DemuxLimitsInput = {}) {
    super({
      id: 'matroska',
      name: 'Matroska',
      docType: 'matroska',
      mimeVideo: 'video/x-matroska',
      mimeAudio: 'audio/x-matroska',
    }, limits)
  }
}
