import { ErrorCodes } from '@mx-player-max/types'
import { audioError } from './errors'

export interface PcmReadResult {
  readFrames: number
  silentFrames: number
}

export class PcmRingBuffer {
  readonly #data: Float32Array
  readonly #capacityFrames: number
  readonly #channels: number
  #readFrame = 0
  #writeFrame = 0
  #availableFrames = 0
  #underruns = 0
  #closed = false

  constructor(capacityFrames: number, channels: number) {
    if (!positive(capacityFrames) || !positive(channels) || channels > 2) {
      throw audioError(ErrorCodes.AUDIO_INVALID_QUEUE_CONFIG, 'PCM ring buffer dimensions are invalid', false)
    }
    this.#capacityFrames = capacityFrames
    this.#channels = channels
    this.#data = new Float32Array(capacityFrames * channels)
  }

  get capacityFrames(): number { return this.#capacityFrames }
  get channels(): number { return this.#channels }
  get availableFrames(): number { return this.#availableFrames }
  get freeFrames(): number { return this.#capacityFrames - this.#availableFrames }
  get underruns(): number { return this.#underruns }

  write(input: Float32Array): number {
    this.#ensureOpen()
    if (input.length % this.#channels !== 0) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'PCM data is not frame aligned', false)
    const frames = input.length / this.#channels
    if (frames > this.freeFrames) throw audioError(ErrorCodes.AUDIO_BUFFER_OVERFLOW, 'PCM ring buffer overflow', false)
    for (let frame = 0; frame < frames; frame += 1) {
      const targetFrame = (this.#writeFrame + frame) % this.#capacityFrames
      const sourceOffset = frame * this.#channels
      const targetOffset = targetFrame * this.#channels
      for (let channel = 0; channel < this.#channels; channel += 1) {
        this.#data[targetOffset + channel] = input[sourceOffset + channel] ?? 0
      }
    }
    this.#writeFrame = (this.#writeFrame + frames) % this.#capacityFrames
    this.#availableFrames += frames
    return frames
  }

  read(output: Float32Array): PcmReadResult {
    this.#ensureOpen()
    if (output.length % this.#channels !== 0) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'PCM output is not frame aligned', false)
    const requested = output.length / this.#channels
    const readFrames = Math.min(requested, this.#availableFrames)
    for (let frame = 0; frame < readFrames; frame += 1) {
      const sourceFrame = (this.#readFrame + frame) % this.#capacityFrames
      const sourceOffset = sourceFrame * this.#channels
      const targetOffset = frame * this.#channels
      for (let channel = 0; channel < this.#channels; channel += 1) output[targetOffset + channel] = this.#data[sourceOffset + channel] ?? 0
    }
    output.fill(0, readFrames * this.#channels)
    this.#readFrame = (this.#readFrame + readFrames) % this.#capacityFrames
    this.#availableFrames -= readFrames
    const silentFrames = requested - readFrames
    if (silentFrames > 0) this.#underruns += 1
    return { readFrames, silentFrames }
  }

  clear(): void {
    this.#readFrame = 0
    this.#writeFrame = 0
    this.#availableFrames = 0
  }

  close(): void {
    if (this.#closed) return
    this.clear()
    this.#closed = true
  }

  #ensureOpen(): void {
    if (this.#closed) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'PCM ring buffer is closed', false)
  }
}

export const SHARED_PCM_HEADER_LENGTH = 8
export const SHARED_READ_FRAME = 0
export const SHARED_WRITE_FRAME = 1
export const SHARED_AVAILABLE_FRAMES = 2
export const SHARED_EPOCH = 3
export const SHARED_RENDERED_FRAMES = 4
export const SHARED_UNDERRUNS = 5
export const SHARED_PAUSED = 6
export const SHARED_CLOSED = 7

export interface SharedPcmRingDescriptor {
  header: SharedArrayBuffer
  samples: SharedArrayBuffer
  capacityFrames: number
  channels: number
}

export class SharedPcmRingBuffer {
  readonly #headerBuffer: SharedArrayBuffer
  readonly #sampleBuffer: SharedArrayBuffer
  readonly #header: Int32Array
  readonly #samples: Float32Array
  readonly #capacityFrames: number
  readonly #channels: number

  constructor(capacityFrames: number, channels: number, descriptor?: SharedPcmRingDescriptor) {
    if (typeof SharedArrayBuffer === 'undefined') throw audioError(ErrorCodes.AUDIO_WORKLET_UNAVAILABLE, 'SharedArrayBuffer is unavailable', false)
    if (!positive(capacityFrames) || !positive(channels) || channels > 2) throw audioError(ErrorCodes.AUDIO_INVALID_QUEUE_CONFIG, 'Shared PCM ring dimensions are invalid', false)
    this.#capacityFrames = capacityFrames
    this.#channels = channels
    this.#headerBuffer = descriptor?.header ?? new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * SHARED_PCM_HEADER_LENGTH)
    this.#sampleBuffer = descriptor?.samples ?? new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * capacityFrames * channels)
    this.#header = new Int32Array(this.#headerBuffer)
    this.#samples = new Float32Array(this.#sampleBuffer)
  }

  get descriptor(): SharedPcmRingDescriptor { return { header: this.#headerBuffer, samples: this.#sampleBuffer, capacityFrames: this.#capacityFrames, channels: this.#channels } }
  get availableFrames(): number { return Atomics.load(this.#header, SHARED_AVAILABLE_FRAMES) }
  get freeFrames(): number { return this.#capacityFrames - this.availableFrames }
  get renderedFrames(): number { return Atomics.load(this.#header, SHARED_RENDERED_FRAMES) }
  get underruns(): number { return Atomics.load(this.#header, SHARED_UNDERRUNS) }

  write(input: Float32Array, epoch: number): number {
    this.#ensureOpen()
    if (!Number.isSafeInteger(epoch) || epoch < 0) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Shared PCM epoch is invalid', false)
    if (input.length % this.#channels !== 0) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Shared PCM data is not frame aligned', false)
    const frames = input.length / this.#channels
    const available = this.availableFrames
    if (frames > this.#capacityFrames - available) throw audioError(ErrorCodes.AUDIO_BUFFER_OVERFLOW, 'Shared PCM ring buffer overflow', false)
    const writeFrame = Atomics.load(this.#header, SHARED_WRITE_FRAME)
    for (let frame = 0; frame < frames; frame += 1) {
      const target = ((writeFrame + frame) % this.#capacityFrames) * this.#channels
      const source = frame * this.#channels
      for (let channel = 0; channel < this.#channels; channel += 1) this.#samples[target + channel] = input[source + channel] ?? 0
    }
    Atomics.store(this.#header, SHARED_EPOCH, epoch)
    Atomics.store(this.#header, SHARED_WRITE_FRAME, (writeFrame + frames) % this.#capacityFrames)
    Atomics.add(this.#header, SHARED_AVAILABLE_FRAMES, frames)
    return frames
  }

  reset(epoch: number): void {
    this.#ensureOpen()
    if (!Number.isSafeInteger(epoch) || epoch < 0) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Shared PCM epoch is invalid', false)
    Atomics.store(this.#header, SHARED_READ_FRAME, 0)
    Atomics.store(this.#header, SHARED_WRITE_FRAME, 0)
    Atomics.store(this.#header, SHARED_AVAILABLE_FRAMES, 0)
    Atomics.store(this.#header, SHARED_RENDERED_FRAMES, 0)
    Atomics.store(this.#header, SHARED_UNDERRUNS, 0)
    Atomics.store(this.#header, SHARED_EPOCH, epoch)
  }

  setPaused(paused: boolean): void { this.#ensureOpen(); Atomics.store(this.#header, SHARED_PAUSED, paused ? 1 : 0) }
  close(): void { Atomics.store(this.#header, SHARED_CLOSED, 1); Atomics.store(this.#header, SHARED_AVAILABLE_FRAMES, 0) }

  #ensureOpen(): void {
    if (Atomics.load(this.#header, SHARED_CLOSED) !== 0) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Shared PCM ring buffer is closed', false)
  }
}

function positive(value: number): boolean { return Number.isSafeInteger(value) && value > 0 }
