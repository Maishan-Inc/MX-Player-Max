import {
  createVideoDecoderConfig,
  VideoDecoderAdapter,
  type VideoDecoderAdapterCallbacks,
  type VideoDecoderAdapterLike,
} from '@mx-player-max/decoder-webcodecs'
import type {
  AudioClockSnapshot,
  CapabilitySnapshot,
  CustomAudioOptions,
  CustomAudioStats,
  CustomVideoOptions,
  CustomVideoStats,
  DecodedVideoFrame,
  DemuxPacket,
  EngineError,
  MediaCapabilityReport,
  MediaDescriptor,
  Micros,
  SourceDescriptor,
  TrackInfo,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { createEngineError, isEngineError, type EngineErrorException } from '../native/errors'
import { DemuxWorkerSession, type DemuxSessionLike } from './demux-session'
import { CustomAudioController, type CustomAudioControllerDependencies } from './audio-controller'
import type { DecodedFrameSource, PipelineFrame } from '@mx-player-max/postprocess'
import type { CustomPipelineEvent } from './events'
import {
  resolveCustomVideoOptions,
  safeCloseFrame,
  VideoFrameQueue,
  type ResolvedCustomVideoOptions,
} from './frame-queue'

export interface CustomPipelineCallbacks {
  onEvent(event: CustomPipelineEvent): void
  isActive(): boolean
}

export interface CustomPipelineDependencies {
  createDemuxSession?(options: ResolvedCustomVideoOptions): DemuxSessionLike
  createDecoder?(callbacks: VideoDecoderAdapterCallbacks): VideoDecoderAdapterLike
  audio?: CustomAudioControllerDependencies
}

export interface CustomMediaPipelineOptions {
  source: SourceDescriptor
  media: MediaDescriptor
  capabilityReport: MediaCapabilityReport
  capabilities?: CapabilitySnapshot
  customVideo?: CustomVideoOptions
  customAudio?: CustomAudioOptions
  callbacks: CustomPipelineCallbacks
  dependencies?: CustomPipelineDependencies
}

interface PendingReader {
  epoch: number
  resolve(value: DecodedVideoFrame | null): void
  reject(reason: unknown): void
}

interface CapacityWaiter {
  epoch: number
  promise: Promise<void>
  resolve(): void
  reject(reason: unknown): void
}

interface SeekCompletion {
  epoch: number
  promise: Promise<void>
  resolve(): void
  reject(reason: unknown): void
  timer: ReturnType<typeof setTimeout>
}

interface PendingDecoderOperation {
  epoch: number
  timer: ReturnType<typeof setTimeout>
  reject(reason: unknown): void
}

export class CustomMediaPipeline {
  readonly #source: SourceDescriptor
  readonly #media: MediaDescriptor
  readonly #report: MediaCapabilityReport
  readonly #callbacks: CustomPipelineCallbacks
  readonly #options: ResolvedCustomVideoOptions
  readonly #videoTrack: TrackInfo
  readonly #config: VideoDecoderConfig
  readonly #demux: DemuxSessionLike
  readonly #decoder: VideoDecoderAdapterLike
  readonly #queue: VideoFrameQueue
  readonly #audio: CustomAudioController
  readonly #pendingReaders: PendingReader[] = []
  readonly #reservations = new Map<number, number[]>()
  readonly #seenFrames = new WeakSet<VideoFrame>()
  readonly #decoderOperations = new Map<number, PendingDecoderOperation>()
  #pendingPackets: DemuxPacket[] = []
  #reservedFrames = 0
  #reservedDuration = 0
  #epoch = 0
  #initialized = false
  #playing = false
  #seeking = false
  #resumeAfterSeek = false
  #closed = false
  #failed = false
  #requireKeyframe = true
  #seekTarget: Micros | null = null
  #demuxEndOfStream = false
  #decoderEndOfStream = false
  #endedEmitted = false
  #backpressured = false
  #pumpTask: Promise<void> | null = null
  #capacityWaiter: CapacityWaiter | null = null
  #seekCompletion: SeekCompletion | null = null
  #playbackRate = 1
  #volume = 1
  #muted = false
  #decodedFrames = 0
  #deliveredFrames = 0
  #droppedFrames = 0
  #droppedStaleFrames = 0
  #droppedPreSeekFrames = 0
  #decoderOperationSequence = 0

  constructor(options: CustomMediaPipelineOptions) {
    this.#source = options.source
    this.#media = options.media
    this.#report = options.capabilityReport
    this.#callbacks = options.callbacks
    this.#options = resolveCustomVideoOptions(options.customVideo)
    const videoTrack = options.media.tracks.find((track) => track.kind === 'video')
    if (!videoTrack) throw createEngineError(ErrorCodes.CUSTOM_VIDEO_TRACK_REQUIRED, 'A video track is required for frame access', false)
    this.#videoTrack = videoTrack
    this.#config = createVideoDecoderConfig(videoTrack, options.capabilityReport, this.#options)
    this.#queue = new VideoFrameQueue(this.#options)
    this.#demux = options.dependencies?.createDemuxSession?.(this.#options)
      ?? new DemuxWorkerSession({ operationTimeoutMs: this.#options.operationTimeoutMs })
    const createDecoder = options.dependencies?.createDecoder
      ?? ((callbacks: VideoDecoderAdapterCallbacks) => new VideoDecoderAdapter({ callbacks }))
    this.#decoder = createDecoder({
      onFrame: (frame, epoch) => this.#handleFrame(frame, epoch),
      onError: (error, epoch) => this.#handleDecoderError(error, epoch),
      onDequeue: (epoch) => {
        if (epoch === this.#epoch) this.#signalCapacity()
      },
    })
    this.#audio = new CustomAudioController({
      media: options.media,
      report: options.capabilityReport,
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
      ...(options.customAudio === undefined ? {} : { customAudio: options.customAudio }),
      callbacks: {
        onCapacity: () => this.#signalCapacity(),
        onStarted: () => {
          if (this.#playing && !this.#closed && !this.#failed) this.#callbacks.onEvent({ type: 'playing' })
        },
        onDrained: () => this.#finishEndedIfDrained(),
        onState: (stats) => this.#callbacks.onEvent({ type: 'audiostatechange', stats }),
        onUnderrun: (stats) => {
          this.#callbacks.onEvent({ type: 'audiounderrun', stats })
          this.#callbacks.onEvent({ type: 'buffering', bufferedAhead: stats.bufferedDuration })
        },
        onClock: (clock) => this.#callbacks.onEvent({ type: 'clockupdate', clock }),
        onError: (error, epoch) => this.#handleDecoderError(error, epoch),
      },
      ...(options.dependencies?.audio === undefined ? {} : { dependencies: options.dependencies.audio }),
    })
  }

  get videoTrack(): TrackInfo { return this.#videoTrack }
  get epoch(): number { return this.#epoch }
  get playbackRate(): number { return this.#playbackRate }
  get volume(): number { return this.#volume }
  get muted(): boolean { return this.#muted }
  get seeking(): boolean { return this.#seeking }
  get playing(): boolean { return this.#playing }
  get audioTrack(): TrackInfo | null { return this.#audio.track }
  get audioStats(): CustomAudioStats | null { return this.#audio.stats }
  get audioClock(): AudioClockSnapshot { return this.#audio.clock }
  get decodedFrameSource(): DecodedFrameSource {
    const pipeline = this
    return {
      peekAt: (timestamp) => toPipelineFrame(this.#queue.peekAt(timestamp)),
      peekNext: (timestamp) => toPipelineFrame(this.#queue.peekNext(timestamp)),
      get endOfStream() { return pipeline.#decoderEndOfStream },
      get epoch() { return pipeline.#epoch },
    }
  }

  consumeFramesThrough(timestamp: Micros): DecodedVideoFrame[] {
    const frames = this.#queue.detachThrough(timestamp)
    if (frames.length > 0) this.#signalCapacity()
    this.#finishEndedIfDrained()
    return frames
  }
  get stats(): CustomVideoStats {
    return {
      decodedFrames: this.#decodedFrames,
      deliveredFrames: this.#deliveredFrames,
      droppedFrames: this.#droppedFrames,
      droppedStaleFrames: this.#droppedStaleFrames,
      droppedPreSeekFrames: this.#droppedPreSeekFrames,
      queuedFrames: this.#queue.length,
      decodeQueueSize: this.#decoder.decodeQueueSize,
      bufferedDuration: this.#queue.bufferedDuration,
      endOfStream: this.#decoderEndOfStream,
    }
  }

  async initialize(): Promise<void> {
    this.#ensureOpen()
    if (this.#initialized) return
    const metadata = await this.#demux.start(this.#source, this.#epoch)
    this.#ensureEpoch(0)
    const workerTrack = metadata.tracks.find((track) => track.id === this.#videoTrack.id && track.kind === 'video')
    if (!workerTrack) throw createEngineError(ErrorCodes.CUSTOM_VIDEO_TRACK_REQUIRED, 'The Demux Worker did not expose the selected video track', false)
    await this.#awaitDecoderOperation(
      this.#decoder.configure(this.#config, this.#report.webCodecs.video.status === 'supported', this.#epoch),
      this.#epoch,
      ErrorCodes.WEBCODECS_CONFIGURE_FAILED,
      'VideoDecoder configuration timed out',
    )
    await this.#audio.initialize(metadata.tracks, this.#epoch)
    this.#ensureEpoch(0)
    this.#initialized = true
    this.#callbacks.onEvent({ type: 'ready' })
  }

  async play(): Promise<void> {
    this.#ensureUsable()
    if (!this.#initialized) throw createEngineError(ErrorCodes.CUSTOM_OPERATION_FAILED, 'The custom video pipeline is not ready', true)
    if (this.#seeking) {
      this.#resumeAfterSeek = true
      return
    }
    if (this.#playing || this.#decoderEndOfStream) return
    this.#playing = true
    try {
      await this.#audio.requestPlay()
    } catch (cause) {
      this.#playing = false
      throw cause
    }
    this.#signalCapacity()
    this.#schedulePump()
  }

  pause(): void {
    this.#ensureUsable()
    if (this.#seeking) {
      this.#resumeAfterSeek = false
      return
    }
    if (!this.#playing) return
    this.#playing = false
    this.#audio.pause()
    this.#callbacks.onEvent({ type: 'paused' })
  }

  readVideoFrame(): Promise<DecodedVideoFrame | null> {
    try { this.#ensureUsable() } catch (cause) { return Promise.reject(cause) }
    const frame = this.#queue.shift()
    if (frame) {
      this.#deliveredFrames += 1
      this.#signalCapacity()
      this.#finishEndedIfDrained()
      return Promise.resolve(frame)
    }
    if (this.#decoderEndOfStream) {
      this.#finishEndedIfDrained()
      return Promise.resolve(null)
    }
    if (this.#pendingReaders.length >= 64) {
      return Promise.reject(createEngineError(ErrorCodes.CUSTOM_OPERATION_FAILED, 'Too many pending video frame readers', false))
    }
    return new Promise<DecodedVideoFrame | null>((resolve, reject) => {
      this.#pendingReaders.push({ epoch: this.#epoch, resolve, reject })
    })
  }

  async seek(time: Micros): Promise<void> {
    this.#ensureUsable()
    if (!Number.isSafeInteger(time) || time < 0) {
      throw createEngineError(ErrorCodes.CUSTOM_SEEK_FAILED, 'Seek time must be a non-negative integer microsecond value', false)
    }
    const resumePlaying = this.#seeking ? this.#resumeAfterSeek : this.#playing
    const seekEpoch = this.#epoch + 1
    this.#epoch = seekEpoch
    this.#playing = false
    this.#audio.pause()
    this.#seeking = true
    this.#resumeAfterSeek = resumePlaying
    this.#requireKeyframe = true
    this.#seekTarget = time
    this.#demuxEndOfStream = false
    this.#decoderEndOfStream = false
    this.#endedEmitted = false
    this.#pendingPackets = []
    this.#clearReservations()
    const staleFrames = this.#queue.clear()
    this.#droppedFrames += staleFrames
    this.#droppedStaleFrames += staleFrames
    this.#rejectReaders(abortedError('Pending frame reads were cancelled by seek'))
    this.#rejectSeek(abortedError('The previous seek was superseded'))
    this.#rejectCapacity(abortedError('The previous decode epoch was superseded'))
    this.#abortDecoderOperations(abortedError('The previous decoder operation was superseded'))
    this.#callbacks.onEvent({ type: 'seeking' })

    try {
      this.#demux.advanceEpoch(seekEpoch)
      await this.#awaitDecoderOperation(
        this.#decoder.reset(seekEpoch),
        seekEpoch,
        ErrorCodes.WEBCODECS_RESET_FAILED,
        'VideoDecoder reset timed out',
      )
      this.#ensureEpoch(seekEpoch)
      await this.#awaitDecoderOperation(
        this.#decoder.configure(this.#config, this.#report.webCodecs.video.status === 'supported', seekEpoch),
        seekEpoch,
        ErrorCodes.WEBCODECS_CONFIGURE_FAILED,
        'VideoDecoder reconfiguration timed out',
      )
      await this.#audio.reset(seekEpoch, time)
      this.#ensureEpoch(seekEpoch)
      await this.#demux.seek(seekEpoch, time)
      this.#ensureEpoch(seekEpoch)
      const completion = this.#createSeekCompletion(seekEpoch)
      this.#schedulePump()
      await completion.promise
      this.#ensureEpoch(seekEpoch)
      this.#seeking = false
      this.#seekTarget = null
      this.#playing = this.#resumeAfterSeek
      this.#callbacks.onEvent({ type: 'seeked', resume: 'ready' })
      if (this.#resumeAfterSeek) {
        await this.#audio.requestPlay()
        this.#schedulePump()
      }
    } catch (cause) {
      if (seekEpoch !== this.#epoch) throw abortedError('The seek operation was superseded', cause)
      this.#seeking = false
      this.#resumeAfterSeek = false
      this.#seekTarget = null
      const error = isEngineError(cause) && cause.code === ErrorCodes.WEBCODECS_ABORTED
        ? cause as EngineErrorException
        : createEngineError(ErrorCodes.CUSTOM_SEEK_FAILED, 'The custom video seek failed', true, cause)
      this.#fail(error)
      throw error
    }
  }

  setPlaybackRate(rate: number): void {
    this.#ensureUsable()
    if (!Number.isFinite(rate) || rate <= 0) throw createEngineError(ErrorCodes.NATIVE_INVALID_RATE, 'Playback rate must be a finite positive value', false)
    this.#playbackRate = rate
    this.#audio.setPlaybackRate(rate)
  }

  setVolume(volume: number): void {
    this.#ensureUsable()
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw createEngineError(ErrorCodes.NATIVE_INVALID_VOLUME, 'Volume must be between 0 and 1', false)
    this.#volume = volume
    this.#audio.setVolume(volume)
  }

  setMuted(muted: boolean): void {
    this.#ensureUsable()
    this.#muted = muted
    this.#audio.setMuted(muted)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#playing = false
    this.#seeking = false
    this.#resumeAfterSeek = false
    this.#epoch += 1
    const aborted = createEngineError(ErrorCodes.ENGINE_CLOSED, 'The media engine is closed', false)
    this.#rejectReaders(aborted)
    this.#rejectSeek(aborted)
    this.#rejectCapacity(aborted)
    this.#abortDecoderOperations(aborted)
    this.#pendingPackets = []
    this.#clearReservations()
    this.#queue.clear()
    this.#demux.close(this.#epoch)
    this.#decoder.close()
    this.#audio.close()
  }

  #schedulePump(): void {
    if (this.#pumpTask || this.#closed || this.#failed || (!this.#playing && !this.#seeking) || this.#decoderEndOfStream) return
    const epoch = this.#epoch
    const task = this.#runPump(epoch)
      .catch((cause: unknown) => {
        if (epoch !== this.#epoch || this.#closed || this.#failed) return
        this.#fail(toPipelineError(cause))
      })
      .finally(() => {
        if (this.#pumpTask === task) this.#pumpTask = null
        if (epoch === this.#epoch && (this.#playing || this.#seeking) && !this.#decoderEndOfStream) this.#schedulePump()
      })
    this.#pumpTask = task
  }

  async #runPump(epoch: number): Promise<void> {
    while (this.#isPumpActive(epoch)) {
      const packet = this.#pendingPackets.shift()
      if (packet) {
        if (packet.kind === 'audio' && packet.trackId === this.#audio.track?.id) {
          while (!this.#audio.canDecode()) {
            this.#backpressured = true
            const waiter = this.#createCapacityWaiter(epoch)
            await waiter.promise
            this.#ensureEpoch(epoch)
          }
          this.#audio.decode(packet, epoch)
          continue
        }
        if (packet.kind !== 'video' || packet.trackId !== this.#videoTrack.id) continue
        if (this.#requireKeyframe) {
          if (!packet.keyframe) continue
          this.#requireKeyframe = false
        }
        await this.#waitForCapacity(packet, epoch)
        if (!this.#isPumpActive(epoch)) return
        this.#reserve(packet)
        try {
          this.#decoder.decode(packet, epoch)
        } catch (cause) {
          this.#releaseReservation(packet.timestamp)
          throw cause
        }
        continue
      }
      if (this.#demuxEndOfStream) {
        await this.#flushEndOfStream(epoch)
        return
      }
      await this.#waitForReadCapacity(epoch)
      if (!this.#isPumpActive(epoch)) return
      const response = await this.#demux.read(epoch)
      this.#ensureEpoch(epoch)
      this.#pendingPackets = response.packets.filter((value) => (value.kind === 'video' && value.trackId === this.#videoTrack.id)
        || (value.kind === 'audio' && value.trackId === this.#audio.track?.id))
      if (response.endOfStream) this.#demuxEndOfStream = true
      if (!this.#isPumpActive(epoch)) return
    }
  }

  async #waitForCapacity(packet: DemuxPacket, epoch: number): Promise<void> {
    const duration = packet.duration ?? 0
    if (duration > this.#options.maxBufferedDuration) {
      throw createEngineError(ErrorCodes.WEBCODECS_QUEUE_OVERFLOW, 'One decoded frame exceeds the configured buffered duration limit', false)
    }
    while (!this.#canDecode(packet)) {
      this.#backpressured = true
      const waiter = this.#createCapacityWaiter(epoch)
      await waiter.promise
      this.#ensureEpoch(epoch)
    }
    this.#backpressured = false
  }

  async #waitForReadCapacity(epoch: number): Promise<void> {
    while (this.#atHighWater()) {
      this.#backpressured = true
      const waiter = this.#createCapacityWaiter(epoch)
      await waiter.promise
      this.#ensureEpoch(epoch)
    }
    this.#backpressured = false
  }

  #atHighWater(): boolean {
    if (this.#decoder.decodeQueueSize >= this.#options.maxDecodeQueueSize) return true
    if (this.#audio.atHighWater()) return true
    if (this.#queue.length + this.#reservedFrames >= this.#options.maxDecodedFrames) return true
    if (this.#queue.bufferedDuration + this.#reservedDuration >= this.#options.maxBufferedDuration) return true
    return this.#backpressured && this.#queue.length > this.#options.lowWaterMark
  }

  #canDecode(packet: DemuxPacket): boolean {
    if (this.#decoder.decodeQueueSize >= this.#options.maxDecodeQueueSize) return false
    if (this.#backpressured && this.#queue.length > this.#options.lowWaterMark) return false
    return this.#queue.canAccept(packet.duration, this.#reservedFrames, this.#reservedDuration)
  }

  #reserve(packet: DemuxPacket): void {
    const duration = packet.duration ?? 0
    const values = this.#reservations.get(packet.timestamp) ?? []
    values.push(duration)
    this.#reservations.set(packet.timestamp, values)
    this.#reservedFrames += 1
    this.#reservedDuration += duration
  }

  #releaseReservation(timestamp: number): void {
    let values = this.#reservations.get(timestamp)
    let key = timestamp
    if (!values || values.length === 0) {
      const first = this.#reservations.entries().next().value as [number, number[]] | undefined
      if (!first) return
      key = first[0]
      values = first[1]
    }
    const duration = values.shift() ?? 0
    if (values.length === 0) this.#reservations.delete(key)
    this.#reservedFrames = Math.max(0, this.#reservedFrames - 1)
    this.#reservedDuration = Math.max(0, this.#reservedDuration - duration)
  }

  #clearReservations(): void {
    this.#reservations.clear()
    this.#reservedFrames = 0
    this.#reservedDuration = 0
  }

  #handleFrame(frame: VideoFrame, epoch: number): void {
    if (this.#closed || this.#failed || !this.#callbacks.isActive() || epoch !== this.#epoch) {
      safeCloseFrame(frame)
      if (!this.#closed) {
        this.#droppedFrames += 1
        this.#droppedStaleFrames += 1
      }
      return
    }
    this.#releaseReservation(frame.timestamp)
    this.#signalCapacity()
    const timestamp = safeMicros(frame.timestamp)
    const rawDuration = frame.duration
    const duration = rawDuration === null || rawDuration === undefined ? null : safeMicros(rawDuration)
    if (timestamp === null || (rawDuration !== null && rawDuration !== undefined && duration === null)) {
      safeCloseFrame(frame)
      this.#droppedFrames += 1
      this.#fail(createEngineError(ErrorCodes.WEBCODECS_FRAME_INVALID, 'VideoDecoder produced invalid frame timing metadata', false))
      return
    }
    if (this.#seenFrames.has(frame)) {
      this.#fail(createEngineError(ErrorCodes.WEBCODECS_FRAME_INVALID, 'VideoDecoder produced the same VideoFrame more than once', false))
      return
    }
    this.#seenFrames.add(frame)
    this.#decodedFrames += 1
    if (this.#seekTarget !== null && timestamp < this.#seekTarget) {
      safeCloseFrame(frame)
      this.#droppedFrames += 1
      this.#droppedPreSeekFrames += 1
      return
    }
    const value: DecodedVideoFrame = { frame, timestamp, duration, epoch }
    const reader = this.#takeReader(epoch)
    if (reader) {
      this.#deliveredFrames += 1
      reader.resolve(value)
    } else {
      try {
        this.#queue.push(value)
      } catch (cause) {
        this.#droppedFrames += 1
        this.#fail(toPipelineError(cause))
        return
      }
      this.#callbacks.onEvent({
        type: 'frameavailable',
        queuedFrames: this.#queue.length,
        bufferedDuration: this.#queue.bufferedDuration,
      })
    }
    this.#resolveSeek(epoch)
  }

  #handleDecoderError(error: EngineError, epoch: number): void {
    if (epoch !== this.#epoch || this.#closed || this.#failed) return
    this.#fail(error)
  }

  async #flushEndOfStream(epoch: number): Promise<void> {
    if (this.#decoderEndOfStream) return
    try {
      await Promise.all([
        this.#awaitDecoderOperation(this.#decoder.flush(epoch), epoch, ErrorCodes.WEBCODECS_FLUSH_FAILED, 'VideoDecoder flush timed out'),
        this.#audio.flush(epoch),
      ])
    } catch (cause) {
      if (isEngineError(cause)) throw cause
      throw createEngineError(ErrorCodes.WEBCODECS_FLUSH_FAILED, 'VideoDecoder flush failed at end of stream', true, cause)
    }
    this.#ensureEpoch(epoch)
    this.#clearReservations()
    this.#decoderEndOfStream = true
    this.#signalCapacity()
    if (this.#seeking && this.#seekCompletion?.epoch === epoch) {
      this.#rejectSeek(createEngineError(ErrorCodes.CUSTOM_SEEK_FAILED, 'Seek reached end of stream before a deliverable frame', true))
    }
    this.#finishEndedIfDrained()
  }

  #finishEndedIfDrained(): void {
    if (!this.#decoderEndOfStream || this.#queue.length > 0 || !this.#audio.drained) return
    for (const reader of this.#pendingReaders.splice(0)) reader.resolve(null)
    if (!this.#endedEmitted) {
      this.#endedEmitted = true
      this.#playing = false
      this.#callbacks.onEvent({ type: 'ended' })
    }
  }

  #takeReader(epoch: number): PendingReader | null {
    while (this.#pendingReaders.length > 0) {
      const reader = this.#pendingReaders.shift()
      if (!reader) return null
      if (reader.epoch === epoch) return reader
      reader.reject(abortedError('The frame reader belongs to an inactive epoch'))
    }
    return null
  }

  #rejectReaders(error: EngineError): void {
    for (const reader of this.#pendingReaders.splice(0)) reader.reject(error)
  }

  #createCapacityWaiter(epoch: number): CapacityWaiter {
    if (this.#capacityWaiter?.epoch === epoch) return this.#capacityWaiter
    let resolve!: () => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<void>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
    const waiter = { epoch, promise, resolve, reject }
    this.#capacityWaiter = waiter
    return waiter
  }

  #signalCapacity(): void {
    const waiter = this.#capacityWaiter
    if (!waiter) return
    this.#capacityWaiter = null
    waiter.resolve()
  }

  #rejectCapacity(error: EngineError): void {
    const waiter = this.#capacityWaiter
    if (!waiter) return
    this.#capacityWaiter = null
    waiter.reject(error)
  }

  #createSeekCompletion(epoch: number): SeekCompletion {
    let resolve!: () => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<void>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
    const timer = setTimeout(() => {
      if (this.#seekCompletion?.epoch !== epoch) return
      this.#seekCompletion = null
      reject(createEngineError(ErrorCodes.CUSTOM_SEEK_FAILED, 'The custom video seek timed out', true))
    }, this.#options.operationTimeoutMs)
    const completion = { epoch, promise, resolve, reject, timer }
    this.#seekCompletion = completion
    return completion
  }

  #resolveSeek(epoch: number): void {
    const completion = this.#seekCompletion
    if (!completion || completion.epoch !== epoch) return
    clearTimeout(completion.timer)
    this.#seekCompletion = null
    completion.resolve()
  }

  #rejectSeek(error: EngineError): void {
    const completion = this.#seekCompletion
    if (!completion) return
    clearTimeout(completion.timer)
    this.#seekCompletion = null
    completion.reject(error)
  }

  #awaitDecoderOperation(
    operation: Promise<void>,
    epoch: number,
    timeoutCode: string,
    timeoutMessage: string,
  ): Promise<void> {
    const operationId = ++this.#decoderOperationSequence
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.#decoderOperations.delete(operationId)) return
        reject(createEngineError(timeoutCode, timeoutMessage, true))
      }, this.#options.operationTimeoutMs)
      this.#decoderOperations.set(operationId, { epoch, timer, reject })
      void operation.then(
        () => {
          const pending = this.#decoderOperations.get(operationId)
          if (!pending) return
          clearTimeout(pending.timer)
          this.#decoderOperations.delete(operationId)
          if (this.#closed || epoch !== this.#epoch) reject(abortedError('The decoder operation was superseded'))
          else resolve()
        },
        (cause: unknown) => {
          const pending = this.#decoderOperations.get(operationId)
          if (!pending) return
          clearTimeout(pending.timer)
          this.#decoderOperations.delete(operationId)
          reject(cause)
        },
      )
    })
  }

  #abortDecoderOperations(error: EngineError): void {
    for (const pending of this.#decoderOperations.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#decoderOperations.clear()
  }

  #isPumpActive(epoch: number): boolean {
    return !this.#closed && !this.#failed && epoch === this.#epoch && (this.#playing || this.#seeking) && !this.#decoderEndOfStream
  }

  #ensureEpoch(epoch: number): void {
    if (this.#closed || epoch !== this.#epoch) throw abortedError('The custom video operation was superseded')
  }

  #ensureOpen(): void {
    if (this.#closed) throw createEngineError(ErrorCodes.ENGINE_CLOSED, 'The media engine is closed', false)
  }

  #ensureUsable(): void {
    this.#ensureOpen()
    if (this.#failed) throw createEngineError(ErrorCodes.CUSTOM_OPERATION_FAILED, 'The custom video pipeline is in an error state', false)
  }

  #fail(error: EngineError): void {
    if (this.#closed || this.#failed) return
    this.#failed = true
    this.#playing = false
    this.#seeking = false
    this.#resumeAfterSeek = false
    this.#epoch += 1
    this.#rejectReaders(error)
    this.#rejectSeek(error)
    this.#rejectCapacity(error)
    this.#abortDecoderOperations(error)
    this.#pendingPackets = []
    this.#clearReservations()
    this.#queue.clear()
    this.#demux.close(this.#epoch)
    this.#decoder.close()
    this.#audio.close()
    if (this.#callbacks.isActive()) this.#callbacks.onEvent({ type: 'error', error })
  }
}

function toPipelineFrame(value: DecodedVideoFrame | null): PipelineFrame | null {
  if (!value) return null
  return { location: 'cpu', frame: value.frame, timestamp: value.timestamp }
}

function safeMicros(value: number): Micros | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function abortedError(message: string, cause?: unknown): EngineErrorException {
  return createEngineError(ErrorCodes.WEBCODECS_ABORTED, message, true, cause)
}

function toPipelineError(cause: unknown): EngineErrorException {
  if (isEngineError(cause)) return cause as EngineErrorException
  return createEngineError(ErrorCodes.CUSTOM_OPERATION_FAILED, 'The custom video operation failed', true, cause)
}
