import { ErrorCodes } from '@mx-player-max/types'
import { audioError } from './errors'

/** Stateful linear resampler. It retains fractional source phase and one boundary frame. */
export class StreamingLinearResampler {
  readonly #inputRate: number
  readonly #outputRate: number
  readonly #channels: number
  readonly #step: number
  #totalInputFrames = 0
  #nextSourcePosition = 0
  #previousFrame: Float32Array | null = null

  constructor(inputRate: number, outputRate: number, channels: number) {
    if (!validRate(inputRate) || !validRate(outputRate) || !Number.isSafeInteger(channels) || channels < 1 || channels > 2) {
      throw audioError(ErrorCodes.AUDIO_RESAMPLE_FAILED, 'Resampler configuration is invalid', false)
    }
    this.#inputRate = inputRate
    this.#outputRate = outputRate
    this.#channels = channels
    this.#step = inputRate / outputRate
  }

  get inputRate(): number { return this.#inputRate }
  get outputRate(): number { return this.#outputRate }
  get channels(): number { return this.#channels }

  process(input: Float32Array): Float32Array {
    if (input.length % this.#channels !== 0) throw audioError(ErrorCodes.AUDIO_RESAMPLE_FAILED, 'PCM input is not frame aligned', false)
    const frames = input.length / this.#channels
    if (frames === 0) return new Float32Array()
    if (this.#inputRate === this.#outputRate) {
      this.#totalInputFrames += frames
      this.#previousFrame = input.slice(input.length - this.#channels)
      this.#nextSourcePosition = this.#totalInputFrames
      return input.slice()
    }
    const start = this.#totalInputFrames
    const end = start + frames
    const maximumOutputs = Math.max(0, Math.ceil((end - this.#nextSourcePosition) / this.#step) + 1)
    const output = new Float32Array(maximumOutputs * this.#channels)
    let outputFrames = 0
    while (Math.floor(this.#nextSourcePosition) + 1 < end) {
      const leftIndex = Math.floor(this.#nextSourcePosition)
      if (leftIndex < start - 1) throw audioError(ErrorCodes.AUDIO_RESAMPLE_FAILED, 'Resampler phase fell behind retained input', false)
      const fraction = this.#nextSourcePosition - leftIndex
      for (let channel = 0; channel < this.#channels; channel += 1) {
        const left = this.#sample(input, start, leftIndex, channel)
        const right = this.#sample(input, start, leftIndex + 1, channel)
        output[outputFrames * this.#channels + channel] = left + (right - left) * fraction
      }
      outputFrames += 1
      this.#nextSourcePosition += this.#step
    }
    this.#totalInputFrames = end
    this.#previousFrame = input.slice(input.length - this.#channels)
    return output.slice(0, outputFrames * this.#channels)
  }

  reset(): void {
    this.#totalInputFrames = 0
    this.#nextSourcePosition = 0
    this.#previousFrame = null
  }

  #sample(input: Float32Array, start: number, globalFrame: number, channel: number): number {
    if (globalFrame === start - 1) return this.#previousFrame?.[channel] ?? input[channel] ?? 0
    const local = globalFrame - start
    return input[local * this.#channels + channel] ?? 0
  }
}

function validRate(value: number): boolean { return Number.isSafeInteger(value) && value >= 8_000 && value <= 384_000 }
