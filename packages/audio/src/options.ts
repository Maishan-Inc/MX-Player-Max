import type { AudioLatencyHint, CustomAudioOptions, Micros } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { audioError } from './errors'

export const DEFAULT_CUSTOM_AUDIO_OPTIONS = {
  maxDecodeQueueSize: 16,
  maxBufferedDuration: 2_000_000,
  lowWaterMark: 500_000,
  startBufferDuration: 150_000,
  maxMessagePortPendingBlocks: 8,
  operationTimeoutMs: 10_000,
  latencyHint: 'interactive',
} as const

export interface ResolvedCustomAudioOptions {
  maxDecodeQueueSize: number
  maxBufferedDuration: Micros
  lowWaterMark: Micros
  startBufferDuration: Micros
  maxMessagePortPendingBlocks: number
  operationTimeoutMs: number
  latencyHint: AudioLatencyHint
  outputSampleRate: number | null
}

export function resolveCustomAudioOptions(options: CustomAudioOptions = {}): ResolvedCustomAudioOptions {
  const maxDecodeQueueSize = integer(options.maxDecodeQueueSize ?? 16, 1, 128, 'maxDecodeQueueSize')
  const maxBufferedDuration = integer(options.maxBufferedDuration ?? 2_000_000, 20_000, 30_000_000, 'maxBufferedDuration')
  const lowWaterMark = integer(options.lowWaterMark ?? 500_000, 0, maxBufferedDuration - 1, 'lowWaterMark')
  const startBufferDuration = integer(options.startBufferDuration ?? 150_000, 0, maxBufferedDuration, 'startBufferDuration')
  const maxMessagePortPendingBlocks = integer(options.maxMessagePortPendingBlocks ?? 8, 1, 64, 'maxMessagePortPendingBlocks')
  const operationTimeoutMs = integer(options.operationTimeoutMs ?? 10_000, 1, 120_000, 'operationTimeoutMs')
  const latencyHint = validateLatencyHint(options.latencyHint ?? 'interactive')
  const outputSampleRate = options.outputSampleRate === undefined
    ? null
    : integer(options.outputSampleRate, 8_000, 192_000, 'outputSampleRate')
  return { maxDecodeQueueSize, maxBufferedDuration, lowWaterMark, startBufferDuration, maxMessagePortPendingBlocks, operationTimeoutMs, latencyHint, outputSampleRate }
}

function integer(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw audioError(ErrorCodes.AUDIO_INVALID_QUEUE_CONFIG, `The custom audio ${name} option is invalid`, false)
  }
  return value
}

function validateLatencyHint(value: AudioLatencyHint): AudioLatencyHint {
  if (value === 'interactive' || value === 'balanced' || value === 'playback') return value
  if (!Number.isFinite(value) || value <= 0 || value > 10) {
    throw audioError(ErrorCodes.AUDIO_INVALID_QUEUE_CONFIG, 'The custom audio latencyHint option is invalid', false)
  }
  return value
}
