import {
  AudioSampleClock,
  AudioWorkletOutput,
  MediaWallClock,
  PcmStreamProcessor,
  resolveCustomAudioOptions,
  type AudioDataLike,
  type AudioOutputLike,
  type MediaClock,
  type PcmBlock,
  type ResolvedCustomAudioOptions,
} from '@mx-player-max/audio'
import {
  AudioDecoderAdapter,
  createAudioDecoderConfig,
  type AudioDecoderAdapterCallbacks,
  type AudioDecoderAdapterLike,
} from '@mx-player-max/decoder-webcodecs'
import type {
  AudioClockSnapshot,
  CapabilitySnapshot,
  CustomAudioOptions,
  CustomAudioStats,
  DemuxPacket,
  EngineError,
  MediaCapabilityReport,
  MediaDescriptor,
  Micros,
  TrackInfo,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { createEngineError, isEngineError, type EngineErrorException } from '../native/errors'

export interface CustomAudioControllerCallbacks {
  onCapacity(): void
  onStarted(): void
  onDrained(): void
  onState(stats: CustomAudioStats): void
  onUnderrun(stats: CustomAudioStats): void
  onClock(clock: AudioClockSnapshot): void
  onError(error: EngineError, epoch: number): void
}

export interface CustomAudioControllerDependencies {
  createAudioDecoder?(callbacks: AudioDecoderAdapterCallbacks): AudioDecoderAdapterLike
  createAudioOutput?(options: ResolvedCustomAudioOptions, callbacks: ConstructorParameters<typeof AudioWorkletOutput>[0]['callbacks']): AudioOutputLike
}

export interface CustomAudioControllerOptions {
  media: MediaDescriptor
  report: MediaCapabilityReport
  capabilities?: CapabilitySnapshot
  customAudio?: CustomAudioOptions
  callbacks: CustomAudioControllerCallbacks
  dependencies?: CustomAudioControllerDependencies
}

interface PendingOperation { timer: ReturnType<typeof setTimeout>; reject(reason: unknown): void }

export class CustomAudioController {
  readonly #report: MediaCapabilityReport
  readonly #options: ResolvedCustomAudioOptions
  readonly #callbacks: CustomAudioControllerCallbacks
  readonly #audioTrack: TrackInfo | null
  readonly #decoder: AudioDecoderAdapterLike | null
  readonly #output: AudioOutputLike | null
  readonly #config: AudioDecoderConfig | null
  readonly #operations = new Map<number, PendingOperation>()
  #processor: PcmStreamProcessor | null = null
  #clock: MediaClock
  #epoch = 0
  #operationSequence = 0
  #closed = false
  #decoderEndOfStream = false
  #requestedPlaying = false
  #outputStarted = false
  #backpressured = false
  /**
   * Blocks the transport had no room for yet.
   *
   * The processor consumes nothing while paused, and `startBufferDuration` alone can fill
   * the transport queue, so the block that arrives before the first `consumed` ack used to
   * hit the hard `AUDIO_BUFFER_OVERFLOW` in `enqueue`. Holding it here and reporting high
   * water instead turns that race into backpressure: the pipeline stops feeding the decoder
   * and the queue drains as soon as the processor acknowledges a block.
   */
  readonly #holdback: PcmBlock[] = []
  #seekTarget: Micros | null = null
  #clockAnchored = false
  #decodedBlocks = 0
  #decodedFrames = 0
  #droppedStaleBlocks = 0
  #droppedPreSeekFrames = 0
  #underruns = 0
  #overflows = 0
  #inputSampleRate: number | null = null

  constructor(options: CustomAudioControllerOptions) {
    this.#report = options.report
    this.#options = resolveCustomAudioOptions(options.customAudio)
    this.#callbacks = options.callbacks
    this.#audioTrack = options.media.tracks.find((track) => track.kind === 'audio') ?? null
    if (this.#audioTrack === null) {
      this.#decoder = null
      this.#output = null
      this.#config = null
      this.#clock = new MediaWallClock()
      return
    }
    if (options.report.webCodecs.audio.status !== 'supported' || !options.report.query.audio) {
      throw createEngineError(ErrorCodes.CUSTOM_AUDIO_BACKEND_UNAVAILABLE, 'The selected audio track has no verified WebCodecs configuration', false)
    }
    this.#config = createAudioDecoderConfig(this.#audioTrack, options.report)
    const decoderFactory = options.dependencies?.createAudioDecoder ?? ((callbacks: AudioDecoderAdapterCallbacks) => new AudioDecoderAdapter({ callbacks }))
    this.#decoder = decoderFactory({
      onData: (data, epoch) => this.#handleData(data, epoch),
      onError: (error, epoch) => this.#callbacks.onError(error, epoch),
      onDequeue: (epoch) => { if (epoch === this.#epoch) { this.#callbacks.onCapacity(); this.#startIfReady() } },
    })
    const capabilities = options.capabilities
    const outputCallbacks: ConstructorParameters<typeof AudioWorkletOutput>[0]['callbacks'] = {
      onConsumed: (total, epoch) => this.#handleConsumed(total, epoch),
      onUnderrun: (epoch) => this.#handleUnderrun(epoch),
      onState: (_state, epoch) => { if (epoch === this.#epoch) this.#callbacks.onState(this.stats!) },
    }
    this.#output = options.dependencies?.createAudioOutput?.(this.#options, outputCallbacks) ?? new AudioWorkletOutput({
      options: this.#options,
      capabilities: { crossOriginIsolated: capabilities?.crossOriginIsolated ?? false, sharedArrayBuffer: capabilities?.sharedArrayBuffer ?? false },
      callbacks: outputCallbacks,
    })
    this.#clock = new MediaWallClock()
  }

  get enabled(): boolean { return this.#audioTrack !== null }
  get track(): TrackInfo | null { return this.#audioTrack }
  get options(): ResolvedCustomAudioOptions { return this.#options }
  get decoderEndOfStream(): boolean { return this.#decoderEndOfStream }
  get drained(): boolean { return !this.enabled || (this.#decoderEndOfStream && this.#holdback.length === 0 && (this.#output?.bufferedFrames ?? 0) === 0) }
  get clock(): AudioClockSnapshot {
    if (this.#clock instanceof AudioSampleClock && this.#output) {
      const rendered = this.#output.renderedFrames
      if (rendered > this.#clock.snapshot.renderedFrames) this.#clock.updateRenderedFrames(rendered)
    }
    return this.#clock.snapshot
  }
  get stats(): CustomAudioStats | null {
    if (!this.enabled || !this.#decoder || !this.#output) return null
    // Held-back blocks are decoded and owned by this controller, so they count as buffered.
    const bufferedFrames = this.#output.bufferedFrames + this.#holdback.reduce((sum, block) => sum + block.frames, 0)
    const sampleRate = this.#output.sampleRate
    return {
      decodedBlocks: this.#decodedBlocks, decodedFrames: this.#decodedFrames, renderedFrames: this.#output.renderedFrames,
      droppedStaleBlocks: this.#droppedStaleBlocks, droppedPreSeekFrames: this.#droppedPreSeekFrames,
      underruns: this.#underruns, overflows: this.#overflows, decodeQueueSize: this.#decoder.decodeQueueSize,
      bufferedFrames, bufferedDuration: sampleRate > 0 ? Math.round(bufferedFrames * 1_000_000 / sampleRate) : 0,
      inputSampleRate: this.#inputSampleRate, outputSampleRate: sampleRate || null, channels: this.#audioTrack?.channels ?? null,
      pendingMessageBlocks: this.#output.pendingMessageBlocks, transport: this.#output.transport, outputState: this.#output.state,
      endOfStream: this.#decoderEndOfStream,
    }
  }

  async initialize(workerTracks: readonly TrackInfo[], epoch: number): Promise<void> {
    this.#ensureOpen()
    this.#epoch = epoch
    if (!this.enabled || !this.#audioTrack || !this.#decoder || !this.#output || !this.#config) return
    const workerTrack = workerTracks.find((track) => track.kind === 'audio' && track.id === this.#audioTrack?.id)
    if (!workerTrack || workerTrack.sampleRate !== this.#audioTrack.sampleRate || workerTrack.channels !== this.#audioTrack.channels) {
      throw createEngineError(ErrorCodes.CUSTOM_AUDIO_TRACK_INVALID, 'The Demux Worker audio track does not match the selected track', false)
    }
    await this.#withTimeout(this.#output.initialize(this.#config.numberOfChannels, epoch), ErrorCodes.AUDIO_WORKLET_LOAD_FAILED, 'AudioWorklet initialization timed out')
    this.#processor = new PcmStreamProcessor(this.#output.sampleRate)
    this.#clock.close()
    this.#clock = new AudioSampleClock(this.#output.sampleRate, () => this.#output?.contextTime ?? 0)
    await this.#withTimeout(this.#decoder.configure(this.#config, this.#report.webCodecs.audio.status === 'supported', epoch), ErrorCodes.WEBCODECS_AUDIO_CONFIGURE_FAILED, 'AudioDecoder configuration timed out')
    this.#callbacks.onState(this.stats!)
  }

  atHighWater(): boolean {
    if (!this.enabled || !this.#decoder || !this.#output) return false
    if (this.#holdback.length > 0) return true
    const stats = this.stats!
    if (this.#decoder.decodeQueueSize >= this.#options.maxDecodeQueueSize) return true
    if (stats.bufferedDuration >= this.#options.maxBufferedDuration) return true
    if (stats.pendingMessageBlocks >= this.#options.maxMessagePortPendingBlocks) return true
    return this.#backpressured && stats.bufferedDuration > this.#options.lowWaterMark
  }

  canDecode(): boolean {
    const blocked = this.atHighWater()
    this.#backpressured = blocked
    return !blocked
  }

  decode(packet: DemuxPacket, epoch: number): void {
    if (!this.#decoder || packet.kind !== 'audio' || packet.trackId !== this.#audioTrack?.id) return
    if (epoch !== this.#epoch) return
    this.#decoder.decode(packet, epoch)
  }

  async requestPlay(): Promise<void> {
    this.#ensureOpen()
    this.#requestedPlaying = true
    if (!this.enabled) {
      if (this.#clockAnchored) {
        this.#clock.play()
        this.#callbacks.onStarted()
      }
      return
    }
    try {
      await this.#output?.resumeContext()
      this.#startIfReady()
    } catch (cause) {
      this.#requestedPlaying = false
      throw cause
    }
  }

  pause(): void {
    this.#requestedPlaying = false
    this.#outputStarted = false
    this.#output?.pause(this.#epoch)
    this.#clock.pause()
  }

  setPlaybackRate(rate: number): void { this.#clock.setPlaybackRate(rate); this.#output?.setPlaybackRate(rate, this.#epoch) }
  setVolume(value: number): void { this.#output?.setVolume(value) }
  setMuted(value: boolean): void { this.#output?.setMuted(value) }

  anchorVideoFrame(timestamp: Micros, epoch: number): void {
    if (this.enabled || this.#closed || epoch !== this.#epoch || this.#clockAnchored) return
    this.#clock.seek(timestamp, epoch)
    this.#clockAnchored = true
    if (!this.#requestedPlaying) return
    this.#clock.play()
    this.#callbacks.onStarted()
  }

  async reset(epoch: number, target: Micros): Promise<void> {
    this.#ensureOpen()
    this.#epoch = epoch
    this.#decoderEndOfStream = false
    this.#outputStarted = false
    this.#seekTarget = target
    this.#clockAnchored = false
    this.#holdback.length = 0
    this.#processor?.reset()
    this.#output?.reset(epoch)
    this.#clock.seek(target, epoch)
    if (this.#decoder) await this.#withTimeout(this.#decoder.reset(epoch), ErrorCodes.WEBCODECS_AUDIO_RESET_FAILED, 'AudioDecoder reset timed out')
    if (this.#decoder && this.#config) await this.#withTimeout(this.#decoder.configure(this.#config, true, epoch), ErrorCodes.WEBCODECS_AUDIO_CONFIGURE_FAILED, 'AudioDecoder reconfiguration timed out')
  }

  async flush(epoch: number): Promise<void> {
    if (!this.#decoder || this.#decoderEndOfStream) return
    await this.#withTimeout(this.#decoder.flush(epoch), ErrorCodes.WEBCODECS_AUDIO_FLUSH_FAILED, 'AudioDecoder flush timed out')
    if (epoch !== this.#epoch) throw aborted('Audio flush was superseded')
    this.#decoderEndOfStream = true
    this.#startIfReady()
    if (this.drained) this.#callbacks.onDrained()
    this.#callbacks.onState(this.stats!)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#requestedPlaying = false
    for (const pending of this.#operations.values()) { clearTimeout(pending.timer); pending.reject(createEngineError(ErrorCodes.ENGINE_CLOSED, 'The media engine is closed', false)) }
    this.#operations.clear()
    this.#decoder?.close()
    this.#output?.close()
    this.#clock.close()
    this.#processor?.reset()
    this.#holdback.length = 0
  }

  #handleData(data: AudioData, epoch: number): void {
    if (this.#closed || epoch !== this.#epoch || !this.#processor || !this.#output) {
      try { data.close() } catch { /* stale AudioData ownership release */ }
      this.#droppedStaleBlocks += 1
      return
    }
    try {
      const inputFrames = data.numberOfFrames
      const inputSampleRate = data.sampleRate
      const inputTimestamp = data.timestamp
      const inputDuration = data.duration ?? Math.round(inputFrames * 1_000_000 / inputSampleRate)
      const seekTarget = this.#seekTarget
      const croppedFrames = seekTarget !== null
        && Number.isSafeInteger(inputTimestamp)
        && Number.isSafeInteger(inputDuration)
        && inputTimestamp < seekTarget
        && inputTimestamp + inputDuration > seekTarget
        ? Math.min(inputFrames, Math.ceil((seekTarget - inputTimestamp) * inputSampleRate / 1_000_000))
        : 0
      const block = this.#processor.process(data as unknown as AudioDataLike, epoch, this.#seekTarget)
      if (!block) { this.#droppedPreSeekFrames += inputFrames; return }
      this.#droppedPreSeekFrames += croppedFrames
      this.#seekTarget = null
      this.#inputSampleRate = inputSampleRate
      const current = this.stats!
      if (current.bufferedDuration + block.duration > this.#options.maxBufferedDuration) {
        this.#overflows += 1
        throw createEngineError(ErrorCodes.AUDIO_BUFFER_OVERFLOW, 'Decoded PCM exceeded the configured audio buffer', false)
      }
      if (!this.#clockAnchored && this.#clock instanceof AudioSampleClock) { this.#clock.setAnchor(block.timestamp, block.sampleRate); this.#clockAnchored = true }
      this.#submit(block)
      this.#decodedBlocks += 1
      this.#decodedFrames += block.frames
      this.#callbacks.onCapacity()
      this.#callbacks.onState(this.stats!)
      this.#startIfReady()
    } catch (cause) {
      this.#callbacks.onError(toAudioError(cause), epoch)
    }
  }

  /**
   * Hand a block to the transport, or hold it until the processor makes room.
   *
   * Order matters: once anything is held back, later blocks queue behind it so the PCM
   * stream stays contiguous.
   */
  #submit(block: PcmBlock): void {
    if (!this.#output) return
    if (this.#holdback.length === 0 && this.#output.canAccept(block.frames)) {
      this.#output.enqueue(block)
      return
    }
    // The pipeline stops feeding the decoder as soon as `atHighWater()` sees a held block, so
    // only the decoder's already-queued output can land here. More than that is a real
    // invariant break rather than backpressure.
    if (this.#holdback.length >= this.#options.maxDecodeQueueSize) {
      this.#overflows += 1
      throw createEngineError(ErrorCodes.AUDIO_BUFFER_OVERFLOW, 'Decoded PCM outran the audio transport', false)
    }
    this.#holdback.push(block)
    this.#backpressured = true
  }

  #drainHoldback(): void {
    if (!this.#output) return
    while (this.#holdback.length > 0) {
      const next = this.#holdback[0]!
      if (!this.#output.canAccept(next.frames)) return
      this.#holdback.shift()
      this.#output.enqueue(next)
    }
  }

  #handleConsumed(total: number, epoch: number): void {
    if (this.#closed || epoch !== this.#epoch) return
    if (this.#clock instanceof AudioSampleClock) this.#clock.updateRenderedFrames(total)
    this.#drainHoldback()
    this.#callbacks.onCapacity()
    this.#callbacks.onClock(this.clock)
    this.#callbacks.onState(this.stats!)
    if (this.drained) this.#callbacks.onDrained()
  }

  #handleUnderrun(epoch: number): void {
    if (this.#closed || epoch !== this.#epoch) return
    this.#underruns += 1
    if (this.#clock instanceof AudioSampleClock) this.#clock.noteUnderrun(true)
    this.#backpressured = false
    this.#drainHoldback()
    this.#callbacks.onCapacity()
    this.#callbacks.onUnderrun(this.stats!)
    this.#callbacks.onClock(this.clock)
  }

  #startIfReady(): void {
    if (!this.#requestedPlaying || this.#outputStarted || !this.#output) return
    const buffered = this.stats?.bufferedDuration ?? 0
    if (buffered < this.#options.startBufferDuration && !this.#decoderEndOfStream) return
    if (buffered === 0 && this.#decoderEndOfStream) { this.#callbacks.onDrained(); return }
    this.#outputStarted = true
    this.#output.play(this.#epoch)
    this.#clock.play()
    this.#callbacks.onStarted()
    this.#callbacks.onClock(this.clock)
  }

  #withTimeout(operation: Promise<void>, code: string, message: string): Promise<void> {
    const id = ++this.#operationSequence
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { if (!this.#operations.delete(id)) return; reject(createEngineError(code, message, true)) }, this.#options.operationTimeoutMs)
      this.#operations.set(id, { timer, reject })
      void operation.then(
        () => { const pending = this.#operations.get(id); if (!pending) return; clearTimeout(pending.timer); this.#operations.delete(id); resolve() },
        (cause: unknown) => { const pending = this.#operations.get(id); if (!pending) return; clearTimeout(pending.timer); this.#operations.delete(id); reject(cause) },
      )
    })
  }

  #ensureOpen(): void { if (this.#closed) throw createEngineError(ErrorCodes.ENGINE_CLOSED, 'The media engine is closed', false) }
}

function toAudioError(cause: unknown): EngineErrorException {
  if (isEngineError(cause)) return cause as EngineErrorException
  return createEngineError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Custom audio processing failed', true, cause)
}
function aborted(message: string): EngineErrorException { return createEngineError(ErrorCodes.WEBCODECS_AUDIO_ABORTED, message, true) }
