import type { PcmBlock } from './pcm'
import { ErrorCodes } from '@mx-player-max/types'
import { audioError } from './errors'
import type { AudioWorkletInputMessage, AudioWorkletOutputMessage } from './worklet-protocol'

export interface AudioMessagePort {
  postMessage(message: AudioWorkletInputMessage, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<AudioWorkletOutputMessage>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<AudioWorkletOutputMessage>) => void): void
  start?(): void
  close?(): void
}

export interface MessagePcmTransportCallbacks {
  onConsumed(frames: number, epoch: number): void
  onUnderrun(epoch: number): void
}

interface PendingBlock { epoch: number; frames: number }

export class MessagePcmTransport {
  readonly #port: AudioMessagePort
  readonly #maximumPending: number
  readonly #callbacks: MessagePcmTransportCallbacks
  readonly #pending = new Map<number, PendingBlock>()
  readonly #listener: (event: MessageEvent<AudioWorkletOutputMessage>) => void
  #sequence = 0
  #epoch = 0
  #closed = false

  constructor(port: AudioMessagePort, maximumPending: number, callbacks: MessagePcmTransportCallbacks) {
    if (!Number.isSafeInteger(maximumPending) || maximumPending < 1 || maximumPending > 64) throw audioError(ErrorCodes.AUDIO_INVALID_QUEUE_CONFIG, 'MessagePort pending limit is invalid', false)
    this.#port = port
    this.#maximumPending = maximumPending
    this.#callbacks = callbacks
    this.#listener = (event) => this.#handle(event.data)
    port.addEventListener('message', this.#listener)
    port.start?.()
  }

  get pendingBlocks(): number { return this.#pending.size }
  get pendingFrames(): number { return [...this.#pending.values()].reduce((sum, value) => sum + value.frames, 0) }
  get canEnqueue(): boolean { return !this.#closed && this.#pending.size < this.#maximumPending }

  enqueue(block: PcmBlock): number {
    if (this.#closed) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'MessagePort PCM transport is closed', false)
    if (this.#pending.size >= this.#maximumPending) throw audioError(ErrorCodes.AUDIO_BUFFER_OVERFLOW, 'MessagePort PCM pending limit was exceeded', false)
    const data = block.data.byteOffset === 0 && block.data.byteLength === block.data.buffer.byteLength ? block.data : block.data.slice()
    const sequence = ++this.#sequence
    this.#epoch = block.epoch
    this.#pending.set(sequence, { epoch: block.epoch, frames: block.frames })
    try {
      this.#port.postMessage({ type: 'pcm', sequence, epoch: block.epoch, frames: block.frames, channels: block.channels, sampleRate: block.sampleRate, data: data.buffer as ArrayBuffer }, [data.buffer as ArrayBuffer])
    } catch (cause) {
      this.#pending.delete(sequence)
      throw audioError(ErrorCodes.AUDIO_WORKLET_FAILED, 'PCM transfer to AudioWorklet failed', true, cause)
    }
    return sequence
  }

  setPlayback(paused: boolean, rate: number, epoch = this.#epoch): void {
    if (this.#closed) return
    this.#port.postMessage({ type: 'playback', paused, rate, epoch })
  }

  reset(epoch: number): void {
    if (this.#closed) return
    this.#epoch = epoch
    this.#pending.clear()
    this.#port.postMessage({ type: 'reset', epoch })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#pending.clear()
    this.#port.removeEventListener('message', this.#listener)
    this.#port.close?.()
  }

  #handle(message: AudioWorkletOutputMessage): void {
    if (this.#closed || message.epoch !== this.#epoch) return
    if (message.type === 'consumed') {
      const pending = this.#pending.get(message.sequence)
      if (!pending || pending.epoch !== message.epoch || pending.frames !== message.frames) return
      this.#pending.delete(message.sequence)
      this.#callbacks.onConsumed(message.frames, message.epoch)
    } else if (message.type === 'underrun') {
      this.#callbacks.onUnderrun(message.epoch)
    }
  }
}
