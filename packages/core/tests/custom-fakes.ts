import type {
  CapabilitySnapshot,
  CustomAudioOptions,
  CustomVideoOptions,
  DemuxPacket,
  EngineError,
  MediaCapabilityReport,
  MediaDescriptor,
  Micros,
  SourceDescriptor,
} from '@mx-player-max/types'
import type {
  AudioDecoderAdapterCallbacks,
  AudioDecoderAdapterLike,
  VideoDecoderAdapterCallbacks,
  VideoDecoderAdapterLike,
} from '@mx-player-max/decoder-webcodecs'
import type {
  AudioOutputCallbacks,
  AudioOutputLike,
  PcmBlock,
  ResolvedCustomAudioOptions,
} from '@mx-player-max/audio'
import type { ContainerProbeResult, DemuxWorkerPacketsResponse } from '@mx-player-max/demux'
import { vi } from 'vitest'
import {
  CustomMediaPipeline,
  type CustomPipelineEvent,
  type DemuxSessionLike,
} from '../src/index'

export interface FakeFrameRecord {
  frame: VideoFrame
  close: ReturnType<typeof vi.fn>
}

export function fakeFrame(timestamp: number, duration: number | null = 33_333): FakeFrameRecord {
  const close = vi.fn()
  return { frame: { timestamp, duration, close } as unknown as VideoFrame, close }
}

export class FakeDecoder implements VideoDecoderAdapterLike {
  decodeQueueSize = 0
  epoch = 0
  autoOutput = true
  flushError: unknown = null
  resetError: unknown = null
  readonly configured: Array<{ config: VideoDecoderConfig; supported: boolean; epoch: number }> = []
  readonly decoded: Array<{ packet: DemuxPacket; epoch: number }> = []
  readonly configure = vi.fn(async (config: VideoDecoderConfig, supported: boolean, epoch: number) => {
    this.configured.push({ config, supported, epoch })
    this.epoch = epoch
  })
  readonly decode = vi.fn((packet: DemuxPacket, epoch: number) => {
    this.decoded.push({ packet, epoch })
    this.decodeQueueSize += 1
    if (this.autoOutput) {
      this.decodeQueueSize -= 1
      this.callbacks.onDequeue(epoch)
      this.emitFrame(packet.timestamp, packet.duration, epoch)
    }
  })
  readonly flush = vi.fn(async (_epoch: number) => {
    if (this.flushError) throw this.flushError
  })
  readonly reset = vi.fn(async (epoch: number) => {
    if (this.resetError) throw this.resetError
    this.decodeQueueSize = 0
    this.epoch = epoch
  })
  readonly close = vi.fn()

  constructor(readonly callbacks: VideoDecoderAdapterCallbacks) {}

  emitFrame(timestamp: number, duration: number | null = 33_333, epoch = this.epoch): FakeFrameRecord {
    const record = fakeFrame(timestamp, duration)
    this.callbacks.onFrame(record.frame, epoch)
    return record
  }

  emitError(error: EngineError, epoch = this.epoch): void {
    this.callbacks.onError(error, epoch)
  }

  dequeue(epoch = this.epoch): void {
    this.decodeQueueSize = Math.max(0, this.decodeQueueSize - 1)
    this.callbacks.onDequeue(epoch)
  }
}

export class FakeAudioData {
  readonly numberOfFrames: number
  readonly numberOfChannels: number
  readonly sampleRate: number
  readonly timestamp: number
  readonly duration: number
  readonly close = vi.fn()

  constructor(options: { timestamp: number; frames?: number; channels?: number; sampleRate?: number }) {
    this.timestamp = options.timestamp
    this.numberOfFrames = options.frames ?? 480
    this.numberOfChannels = options.channels ?? 2
    this.sampleRate = options.sampleRate ?? 48_000
    this.duration = Math.round(this.numberOfFrames * 1_000_000 / this.sampleRate)
  }

  copyTo(destination: AllowSharedBufferSource, options: AudioDataCopyToOptions): void {
    const output = destination as Float32Array
    const channel = options.planeIndex ?? 0
    for (let index = 0; index < output.length; index += 1) output[index] = channel + index / Math.max(1, output.length)
  }
}

export class FakeAudioDecoder implements AudioDecoderAdapterLike {
  decodeQueueSize = 0
  epoch = 0
  autoOutput = true
  flushError: unknown = null
  readonly configured: Array<{ config: AudioDecoderConfig; supported: boolean; epoch: number }> = []
  readonly decoded: Array<{ packet: DemuxPacket; epoch: number }> = []
  readonly outputs: FakeAudioData[] = []
  readonly configure = vi.fn(async (config: AudioDecoderConfig, supported: boolean, epoch: number) => {
    this.configured.push({ config, supported, epoch })
    this.epoch = epoch
  })
  readonly decode = vi.fn((packet: DemuxPacket, epoch: number) => {
    this.decoded.push({ packet, epoch })
    this.decodeQueueSize += 1
    if (this.autoOutput) {
      this.decodeQueueSize -= 1
      this.callbacks.onDequeue(epoch)
      const frames = Math.max(1, Math.round((packet.duration ?? 10_000) * 48_000 / 1_000_000))
      this.emitData(new FakeAudioData({ timestamp: packet.timestamp, frames }), epoch)
    }
  })
  readonly flush = vi.fn(async (_epoch: number) => { if (this.flushError) throw this.flushError })
  readonly reset = vi.fn(async (epoch: number) => { this.decodeQueueSize = 0; this.epoch = epoch })
  readonly close = vi.fn()

  constructor(readonly callbacks: AudioDecoderAdapterCallbacks) {}

  emitData(data: FakeAudioData, epoch = this.epoch): void {
    this.outputs.push(data)
    this.callbacks.onData(data as unknown as AudioData, epoch)
  }

  emitError(error: EngineError, epoch = this.epoch): void { this.callbacks.onError(error, epoch) }
  dequeue(epoch = this.epoch): void { this.decodeQueueSize = Math.max(0, this.decodeQueueSize - 1); this.callbacks.onDequeue(epoch) }
}

export class FakeAudioOutput implements AudioOutputLike {
  readonly sampleRate = 48_000
  pendingMessageBlocks = 0
  renderedFrames = 0
  transport = 'message-port' as const
  state = 'uninitialized' as const | 'ready' | 'running' | 'paused' | 'buffering' | 'drained' | 'closed'
  contextTime = 0
  readonly blocks: PcmBlock[] = []
  resumeError: unknown = null
  epoch = 0
  channels = 0
  readonly initialize = vi.fn(async (channels: number, epoch: number) => { this.channels = channels; this.epoch = epoch; this.state = 'ready' })
  readonly resumeContext = vi.fn(async () => { if (this.resumeError) throw this.resumeError })
  readonly play = vi.fn((epoch: number) => { if (epoch === this.epoch) this.state = 'running' })
  readonly pause = vi.fn((epoch: number) => { if (epoch === this.epoch) this.state = 'paused' })
  readonly reset = vi.fn((epoch: number) => { this.epoch = epoch; this.blocks.splice(0); this.renderedFrames = 0; this.state = 'ready' })
  readonly setPlaybackRate = vi.fn()
  readonly setVolume = vi.fn()
  readonly setMuted = vi.fn()
  readonly close = vi.fn(() => { this.blocks.splice(0); this.state = 'closed' })

  constructor(
    readonly options: ResolvedCustomAudioOptions,
    readonly callbacks: AudioOutputCallbacks,
  ) {}

  get bufferedFrames(): number { return this.blocks.reduce((total, block) => total + block.frames, 0) }

  /** Mirrors the real transport: bounded by `maxMessagePortPendingBlocks`, refuses when full. */
  canAccept(frames: number): boolean {
    if (this.state === 'closed') return false
    if (!Number.isSafeInteger(frames) || frames < 0) return false
    return this.blocks.length < this.options.maxMessagePortPendingBlocks
  }

  enqueue(block: PcmBlock): void { this.blocks.push(block) }

  consume(frames = this.bufferedFrames, epoch = this.epoch): void {
    const target = Math.min(frames, this.bufferedFrames)
    let remaining = target
    while (remaining > 0) {
      const block = this.blocks[0]
      if (!block) break
      if (remaining >= block.frames) {
        remaining -= block.frames
        this.blocks.shift()
      } else {
        const consumed = remaining
        block.data = block.data.slice(consumed * block.channels)
        block.frames -= consumed
        block.duration = Math.round(block.frames * 1_000_000 / block.sampleRate)
        remaining = 0
      }
    }
    const consumed = target - remaining
    this.renderedFrames += consumed
    this.callbacks.onConsumed(this.renderedFrames, epoch)
  }

  underrun(epoch = this.epoch): void { this.state = 'buffering'; this.callbacks.onUnderrun(epoch) }
}

export class FakeDemuxSession implements DemuxSessionLike {
  epoch = 0
  closed = false
  readonly start = vi.fn(async (_source: SourceDescriptor, epoch: number) => { this.epoch = epoch; return metadata(this.media) })
  readonly read = vi.fn(async (epoch: number): Promise<DemuxWorkerPacketsResponse> => {
    this.epoch = epoch
    const next = this.responses.shift() ?? { packets: [], endOfStream: true }
    return { type: 'packets', sessionId: 'fake', epoch, requestId: `read-${this.read.mock.calls.length}`, ...next }
  })
  readonly seek = vi.fn(async (epoch: number, _time: Micros) => { this.epoch = epoch })
  readonly advanceEpoch = vi.fn((epoch: number) => { this.epoch = epoch })
  readonly close = vi.fn((_epoch: number) => { this.closed = true })

  constructor(
    readonly media: MediaDescriptor,
    readonly responses: Array<{ packets: DemuxPacket[]; endOfStream: boolean }> = [],
  ) {}
}

export function createCustomHarness(options: {
  responses?: Array<{ packets: DemuxPacket[]; endOfStream: boolean }>
  customVideo?: CustomVideoOptions
  customAudio?: CustomAudioOptions
  audio?: boolean
  source?: SourceDescriptor
} = {}) {
  const media = createMedia(options.audio ?? false)
  const report = createReport()
  const demux = new FakeDemuxSession(media, options.responses ?? [])
  const events: CustomPipelineEvent[] = []
  let decoder!: FakeDecoder
  let audioDecoder: FakeAudioDecoder | undefined
  let audioOutput: FakeAudioOutput | undefined
  const pipeline = new CustomMediaPipeline({
    source: options.source ?? { kind: 'file', file: new Blob(['media']) as File },
    media,
    capabilityReport: report,
    ...(options.customVideo === undefined ? {} : { customVideo: options.customVideo }),
    ...(options.customAudio === undefined ? {} : { customAudio: options.customAudio }),
    callbacks: { isActive: () => true, onEvent: (event) => events.push(event) },
    dependencies: {
      createDemuxSession: () => demux,
      createDecoder: (callbacks) => { decoder = new FakeDecoder(callbacks); return decoder },
      ...(options.audio === true ? { audio: {
        createAudioDecoder: (callbacks: AudioDecoderAdapterCallbacks) => { audioDecoder = new FakeAudioDecoder(callbacks); return audioDecoder },
        createAudioOutput: (resolved: ResolvedCustomAudioOptions, callbacks: AudioOutputCallbacks) => { audioOutput = new FakeAudioOutput(resolved, callbacks); return audioOutput },
      } } : {}),
    },
  })
  return { pipeline, demux, decoder: () => decoder, audioDecoder: () => audioDecoder, audioOutput: () => audioOutput, events, media, report }
}

export function packet(timestamp: number, options: Partial<DemuxPacket> = {}): DemuxPacket {
  return { trackId: 1, kind: 'video', timestamp, duration: 33_333, keyframe: timestamp === 0, data: Uint8Array.of(1, 2, 3), ...options }
}

export function createMedia(audio = false): MediaDescriptor {
  return {
    container: 'webm', duration: 1_000_000, size: 100, mimeType: 'video/webm',
    tracks: [
      { id: 1, kind: 'video', codecId: 'V_VP8', codec: 'vp8', width: 640, height: 360, frameRate: 30 },
      ...(audio ? [{ id: 2, kind: 'audio' as const, codecId: 'A_OPUS', codec: 'opus', sampleRate: 48_000, channels: 2 }] : []),
    ],
  }
}

export function createReport(): MediaCapabilityReport {
  return {
    schemaVersion: 1,
    query: { container: 'webm', mimeType: 'video/webm', video: { codec: 'vp8', codedWidth: 640, codedHeight: 360, framerate: 30 }, audio: { codec: 'opus', sampleRate: 48_000, numberOfChannels: 2 } },
    native: {
      video: { status: 'unsupported', reasons: [], contentType: null, canPlayType: '' },
      audio: { status: 'unsupported', reasons: [], contentType: null, canPlayType: '' },
      playable: 'unsupported', reasons: [],
    },
    webCodecs: {
      video: { status: 'supported', reasons: [], configPresent: true },
      audio: { status: 'supported', reasons: [], configPresent: true },
      playable: 'supported', reasons: [],
    },
  }
}

export function createSnapshot(): CapabilitySnapshot {
  return {
    schemaVersion: 1, sdkVersion: 'test', browser: 'unknown', browserVersion: null, platform: 'unknown',
    crossOriginIsolated: false, sharedArrayBuffer: false, wasmSimd: false, wasmThreads: false,
    htmlVideo: true, mediaCapabilities: true, webCodecsVideo: true, webCodecsAudio: true,
    webGpu: false, webGl2: false, canvas2d: true, workerMediaSource: false,
    webGpuFeatures: { available: false, float32Filterable: false, shaderF16: false, maxComputeWorkgroupStorageSize: 0, maxTextureDimension2d: 0, maxBufferSize: 0, importExternalTexture: false, adapterVendor: null, adapterArchitecture: null, isFallbackAdapter: false },
    quirks: [],
  }
}

function metadata(media: MediaDescriptor): ContainerProbeResult {
  return { container: media.container, media, tracks: media.tracks, duration: media.duration, size: media.size, hasSeekIndex: true }
}
