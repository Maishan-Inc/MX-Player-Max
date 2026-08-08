import type { Micros } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { audioError } from './errors'
import { StreamingLinearResampler } from './resampler'

export interface AudioDataLike {
  readonly numberOfFrames: number
  readonly numberOfChannels: number
  readonly sampleRate: number
  readonly timestamp: number
  readonly duration: number | null
  copyTo(destination: AllowSharedBufferSource, options: AudioDataCopyToOptions): void
  close(): void
}

export interface PcmBlock {
  data: Float32Array
  frames: number
  channels: number
  sampleRate: number
  timestamp: Micros
  duration: Micros
  epoch: number
}

export function normalizeAudioData(data: AudioDataLike, epoch: number): PcmBlock {
  try {
    const frames = data.numberOfFrames
    const channels = data.numberOfChannels
    const sampleRate = data.sampleRate
    const timestamp = data.timestamp
    const duration = data.duration
    if (!positive(frames) || !positive(sampleRate) || !safeMicros(timestamp) || !Number.isSafeInteger(epoch) || epoch < 0) {
      throw invalidData('AudioData timing or dimensions are invalid')
    }
    if (!positive(channels) || channels > 2) throw audioError(ErrorCodes.AUDIO_CHANNEL_LAYOUT_UNSUPPORTED, 'Only mono and stereo AudioData are supported', false)
    const expectedDuration = Math.round(frames * 1_000_000 / sampleRate)
    if (duration !== null && (!safeMicros(duration) || Math.abs(duration - expectedDuration) > 2)) {
      throw invalidData('AudioData duration is inconsistent with its frame count')
    }
    const planar = Array.from({ length: channels }, () => new Float32Array(frames))
    for (let channel = 0; channel < channels; channel += 1) {
      data.copyTo(planar[channel] as Float32Array, { planeIndex: channel, format: 'f32-planar' })
    }
    const interleaved = new Float32Array(frames * channels)
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) interleaved[frame * channels + channel] = planar[channel]?.[frame] ?? 0
    }
    return { data: interleaved, frames, channels, sampleRate, timestamp, duration: expectedDuration, epoch }
  } catch (cause) {
    if (typeof cause === 'object' && cause !== null && 'code' in cause) throw cause
    throw invalidData('AudioData could not be converted to Float32 PCM', cause)
  } finally {
    try { data.close() } catch { /* ownership is still released */ }
  }
}

export function trimPcmBefore(block: PcmBlock, target: Micros): PcmBlock | null {
  if (!safeMicros(target)) throw invalidData('The PCM trim target is invalid')
  const end = block.timestamp + block.duration
  if (!Number.isSafeInteger(end)) throw invalidData('The PCM block end time overflowed')
  if (end <= target) return null
  if (block.timestamp >= target) return block
  const trimFrames = Math.min(block.frames, Math.ceil((target - block.timestamp) * block.sampleRate / 1_000_000))
  if (trimFrames >= block.frames) return null
  const data = block.data.slice(trimFrames * block.channels)
  const frames = block.frames - trimFrames
  const timestamp = block.timestamp + Math.round(trimFrames * 1_000_000 / block.sampleRate)
  return { ...block, data, frames, timestamp, duration: Math.round(frames * 1_000_000 / block.sampleRate) }
}

export class PcmStreamProcessor {
  readonly #outputSampleRate: number
  #resampler: StreamingLinearResampler | null = null
  #inputSampleRate: number | null = null
  #channels: number | null = null

  constructor(outputSampleRate: number) {
    if (!positive(outputSampleRate)) throw audioError(ErrorCodes.AUDIO_RESAMPLE_FAILED, 'The output sample rate is invalid', false)
    this.#outputSampleRate = outputSampleRate
  }

  process(data: AudioDataLike, epoch: number, trimBefore: Micros | null = null): PcmBlock | null {
    let block = normalizeAudioData(data, epoch)
    if (trimBefore !== null) {
      const trimmed = trimPcmBefore(block, trimBefore)
      if (!trimmed) return null
      block = trimmed
    }
    if (this.#inputSampleRate !== block.sampleRate || this.#channels !== block.channels || this.#resampler === null) {
      this.#inputSampleRate = block.sampleRate
      this.#channels = block.channels
      this.#resampler = new StreamingLinearResampler(block.sampleRate, this.#outputSampleRate, block.channels)
    }
    const output = this.#resampler.process(block.data)
    const frames = output.length / block.channels
    return { ...block, data: output, frames, sampleRate: this.#outputSampleRate, duration: Math.round(frames * 1_000_000 / this.#outputSampleRate) }
  }

  reset(): void {
    this.#resampler?.reset()
    this.#resampler = null
    this.#inputSampleRate = null
    this.#channels = null
  }
}

function positive(value: number): boolean { return Number.isSafeInteger(value) && value > 0 }
function safeMicros(value: number): boolean { return Number.isSafeInteger(value) && value >= 0 }
function invalidData(message: string, cause?: unknown) { return audioError(ErrorCodes.WEBCODECS_AUDIO_DATA_INVALID, message, false, cause) }
