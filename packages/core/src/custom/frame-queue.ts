import type { CustomVideoOptions, DecodedVideoFrame, Micros } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { createEngineError } from '../native/errors'

export const DEFAULT_CUSTOM_VIDEO_OPTIONS = {
  maxDecodedFrames: 8,
  maxDecodeQueueSize: 8,
  lowWaterMark: 3,
  maxBufferedDuration: 1_000_000,
  operationTimeoutMs: 10_000,
  hardwareAcceleration: 'no-preference',
  optimizeForLatency: false,
} as const

export interface ResolvedCustomVideoOptions {
  maxDecodedFrames: number
  maxDecodeQueueSize: number
  lowWaterMark: number
  maxBufferedDuration: Micros
  operationTimeoutMs: number
  hardwareAcceleration: 'no-preference' | 'prefer-hardware' | 'prefer-software'
  optimizeForLatency: boolean
}

interface QueuedFrame {
  value: DecodedVideoFrame
  sequence: number
}

export class VideoFrameQueue {
  readonly #options: ResolvedCustomVideoOptions
  readonly #frames: QueuedFrame[] = []
  readonly #owned = new WeakSet<VideoFrame>()
  #sequence = 0
  #bufferedDuration = 0

  constructor(options: ResolvedCustomVideoOptions) {
    this.#options = options
  }

  get length(): number { return this.#frames.length }
  get bufferedDuration(): Micros { return this.#bufferedDuration }

  canAccept(duration: Micros | null, reservedFrames = 0, reservedDuration = 0): boolean {
    const nextDuration = duration ?? 0
    return this.length + reservedFrames < this.#options.maxDecodedFrames
      && this.#bufferedDuration + reservedDuration + nextDuration <= this.#options.maxBufferedDuration
  }

  push(value: DecodedVideoFrame): void {
    validateFrameMetadata(value)
    if (this.#owned.has(value.frame)) {
      throw createEngineError(ErrorCodes.WEBCODECS_FRAME_INVALID, 'A VideoFrame cannot be queued more than once', false)
    }
    const duration = value.duration ?? 0
    if (this.length >= this.#options.maxDecodedFrames
      || this.#bufferedDuration + duration > this.#options.maxBufferedDuration) {
      safeCloseFrame(value.frame)
      throw createEngineError(ErrorCodes.WEBCODECS_QUEUE_OVERFLOW, 'The decoded video frame queue exceeded its configured limit', false)
    }
    this.#owned.add(value.frame)
    const queued = { value, sequence: this.#sequence++ }
    const index = this.#frames.findIndex((entry) => entry.value.timestamp > value.timestamp
      || (entry.value.timestamp === value.timestamp && entry.sequence > queued.sequence))
    if (index < 0) this.#frames.push(queued)
    else this.#frames.splice(index, 0, queued)
    this.#bufferedDuration += duration
  }

  shift(): DecodedVideoFrame | null {
    const queued = this.#frames.shift()
    if (!queued) return null
    this.#bufferedDuration = Math.max(0, this.#bufferedDuration - (queued.value.duration ?? 0))
    return queued.value
  }

  clear(): number {
    let closed = 0
    for (const queued of this.#frames) {
      safeCloseFrame(queued.value.frame)
      closed += 1
    }
    this.#frames.length = 0
    this.#bufferedDuration = 0
    return closed
  }
}

export function resolveCustomVideoOptions(options: CustomVideoOptions = {}): ResolvedCustomVideoOptions {
  const maxDecodedFrames = integerInRange(options.maxDecodedFrames ?? DEFAULT_CUSTOM_VIDEO_OPTIONS.maxDecodedFrames, 1, 64, 'maxDecodedFrames')
  const maxDecodeQueueSize = integerInRange(options.maxDecodeQueueSize ?? DEFAULT_CUSTOM_VIDEO_OPTIONS.maxDecodeQueueSize, 1, 64, 'maxDecodeQueueSize')
  const lowWaterMark = integerInRange(options.lowWaterMark ?? DEFAULT_CUSTOM_VIDEO_OPTIONS.lowWaterMark, 0, maxDecodedFrames - 1, 'lowWaterMark')
  const maxBufferedDuration = integerInRange(options.maxBufferedDuration ?? DEFAULT_CUSTOM_VIDEO_OPTIONS.maxBufferedDuration, 1, 30_000_000, 'maxBufferedDuration')
  const operationTimeoutMs = integerInRange(options.operationTimeoutMs ?? DEFAULT_CUSTOM_VIDEO_OPTIONS.operationTimeoutMs, 1, 120_000, 'operationTimeoutMs')
  return {
    maxDecodedFrames,
    maxDecodeQueueSize,
    lowWaterMark,
    maxBufferedDuration,
    operationTimeoutMs,
    hardwareAcceleration: options.hardwareAcceleration ?? DEFAULT_CUSTOM_VIDEO_OPTIONS.hardwareAcceleration,
    optimizeForLatency: options.optimizeForLatency ?? DEFAULT_CUSTOM_VIDEO_OPTIONS.optimizeForLatency,
  }
}

export function safeCloseFrame(frame: VideoFrame): void {
  try { frame.close() } catch { /* a malformed frame is never exposed */ }
}

function validateFrameMetadata(value: DecodedVideoFrame): void {
  if (!Number.isSafeInteger(value.timestamp) || value.timestamp < 0
    || (value.duration !== null && (!Number.isSafeInteger(value.duration) || value.duration < 0))
    || !Number.isSafeInteger(value.epoch) || value.epoch < 0) {
    safeCloseFrame(value.frame)
    throw createEngineError(ErrorCodes.WEBCODECS_FRAME_INVALID, 'The decoded VideoFrame metadata is invalid', false)
  }
}

function integerInRange(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw createEngineError(ErrorCodes.CUSTOM_INVALID_QUEUE_CONFIG, `The custom video ${name} option is invalid`, false)
  }
  return value
}
