import type { AudioWorkletInputMessage, AudioWorkletOutputMessage, WorkletPcmMessage } from './worklet-protocol'
import {
  SHARED_AVAILABLE_FRAMES,
  SHARED_CLOSED,
  SHARED_EPOCH,
  SHARED_PAUSED,
  SHARED_READ_FRAME,
  SHARED_RENDERED_FRAMES,
  SHARED_UNDERRUNS,
} from './ring-buffer'

interface WorkletPortLike {
  onmessage: ((event: MessageEvent<AudioWorkletInputMessage>) => void) | null
  postMessage(message: AudioWorkletOutputMessage): void
}

declare class AudioWorkletProcessor {
  readonly port: WorkletPortLike
}

declare function registerProcessor(name: string, constructor: new() => AudioWorkletProcessor): void

interface QueuedBlock {
  sequence: number
  epoch: number
  frames: number
  channels: number
  data: Float32Array
  offset: number
}

class PcmWorkletProcessor extends AudioWorkletProcessor {
  readonly #queue: QueuedBlock[] = []
  #epoch = 0
  #channels = 0
  #paused = true
  #rate = 1
  #phase = 0
  #underrunning = false
  #sharedHeader: Int32Array | null = null
  #sharedSamples: Float32Array | null = null
  #sharedCapacity = 0

  constructor() {
    super()
    this.port.onmessage = (event) => this.#handle(event.data)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]
    const firstChannel = output?.[0]
    if (!output || !firstChannel) return true
    const frames = firstChannel.length
    for (let channel = 0; channel < output.length; channel += 1) output[channel]?.fill(0)
    if (this.#paused) return true
    if (this.#sharedHeader && this.#sharedSamples) this.#renderShared(output, frames)
    else this.#renderMessages(output, frames)
    return true
  }

  #renderShared(output: Float32Array[], frames: number): void {
    const header = this.#sharedHeader
    const samples = this.#sharedSamples
    if (!header || !samples || Atomics.load(header, SHARED_CLOSED) !== 0 || Atomics.load(header, SHARED_PAUSED) !== 0) return
    let readFrame = Atomics.load(header, SHARED_READ_FRAME)
    let available = Atomics.load(header, SHARED_AVAILABLE_FRAMES)
    let consumed = 0
    for (let outFrame = 0; outFrame < frames; outFrame += 1) {
      if (available <= 0) { this.#notifyUnderrun(); break }
      for (let channel = 0; channel < output.length; channel += 1) output[channel]![outFrame] = samples[readFrame * this.#channels + Math.min(channel, this.#channels - 1)] ?? 0
      this.#phase += this.#rate
      const requestedAdvance = Math.floor(this.#phase)
      const advance = Math.min(available, requestedAdvance)
      this.#phase -= requestedAdvance
      if (advance > 0) {
        readFrame = (readFrame + advance) % this.#sharedCapacity
        available -= advance
        consumed += advance
      }
      this.#underrunning = false
    }
    Atomics.store(header, SHARED_READ_FRAME, readFrame)
    Atomics.store(header, SHARED_AVAILABLE_FRAMES, available)
    if (consumed > 0) {
      Atomics.add(header, SHARED_RENDERED_FRAMES, consumed)
      if (available === 0) this.port.postMessage({ type: 'state', epoch: this.#epoch, state: 'drained' })
    }
  }

  #renderMessages(output: Float32Array[], frames: number): void {
    for (let outFrame = 0; outFrame < frames; outFrame += 1) {
      const block = this.#queue[0]
      if (!block) { this.#notifyUnderrun(); break }
      for (let channel = 0; channel < output.length; channel += 1) output[channel]![outFrame] = block.data[block.offset * block.channels + Math.min(channel, block.channels - 1)] ?? 0
      this.#phase += this.#rate
      const advance = Math.floor(this.#phase)
      if (advance > 0) {
        this.#phase -= advance
        this.#advanceMessageFrames(advance)
      }
      this.#underrunning = false
    }
  }

  #advanceMessageFrames(requested: number): void {
    let remaining = requested
    while (remaining > 0) {
      const block = this.#queue[0]
      if (!block) return
      const available = block.frames - block.offset
      const advance = Math.min(remaining, available)
      block.offset += advance
      remaining -= advance
      if (block.offset < block.frames) return
      this.#queue.shift()
      this.port.postMessage({ type: 'consumed', sequence: block.sequence, epoch: block.epoch, frames: block.frames })
    }
  }

  #notifyUnderrun(): void {
    if (this.#underrunning) return
    this.#underrunning = true
    if (this.#sharedHeader) Atomics.add(this.#sharedHeader, SHARED_UNDERRUNS, 1)
    this.port.postMessage({ type: 'underrun', epoch: this.#epoch })
  }

  #handle(message: AudioWorkletInputMessage): void {
    if (message.type === 'shared-init') {
      this.#epoch = message.epoch
      this.#channels = message.channels
      this.#sharedCapacity = message.capacityFrames
      this.#sharedHeader = new Int32Array(message.header)
      this.#sharedSamples = new Float32Array(message.samples)
      return
    }
    if (message.type === 'reset') {
      this.#epoch = message.epoch
      this.#queue.length = 0
      this.#phase = 0
      this.#underrunning = false
      return
    }
    if (message.type === 'playback') {
      if (message.epoch !== this.#epoch) return
      this.#paused = message.paused
      this.#rate = message.rate
      return
    }
    this.#enqueue(message)
  }

  #enqueue(message: WorkletPcmMessage): void {
    if (message.epoch !== this.#epoch || message.channels < 1 || message.channels > 2 || message.frames <= 0 || this.#queue.length >= 64) return
    this.#channels = message.channels
    this.#queue.push({ sequence: message.sequence, epoch: message.epoch, frames: message.frames, channels: message.channels, data: new Float32Array(message.data), offset: 0 })
  }
}

registerProcessor('mx-player-max-pcm', PcmWorkletProcessor)
