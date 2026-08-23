import type { AudioOutputState, AudioTransportKind } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { audioError } from './errors'
import { MessagePcmTransport, type AudioMessagePort } from './message-transport'
import type { PcmBlock } from './pcm'
import type { ResolvedCustomAudioOptions } from './options'
import { SharedPcmRingBuffer } from './ring-buffer'
import type { AudioWorkletInputMessage, AudioWorkletOutputMessage } from './worklet-protocol'

export interface AudioOutputCallbacks {
  onConsumed(totalRenderedFrames: number, epoch: number): void
  onUnderrun(epoch: number): void
  onState(state: AudioOutputState, epoch: number): void
}

export interface AudioOutputCapabilities { crossOriginIsolated: boolean; sharedArrayBuffer: boolean }

export interface AudioParamLike {
  value: number
  cancelScheduledValues(time: number): void
  setTargetAtTime(value: number, startTime: number, timeConstant: number): void
}

export interface GainNodeLike {
  readonly gain: AudioParamLike
  connect(destination: unknown): unknown
  disconnect(): void
}

export interface AudioWorkletNodeLike {
  readonly port: AudioMessagePort
  connect(destination: unknown): unknown
  disconnect(): void
}

export interface AudioContextLike {
  readonly sampleRate: number
  readonly currentTime: number
  readonly state: string
  readonly destination: unknown
  readonly audioWorklet?: { addModule(url: URL): Promise<void> }
  createGain(): GainNodeLike
  resume(): Promise<void>
  suspend(): Promise<void>
  close(): Promise<void>
}

export interface AudioOutputRuntime {
  createContext(options: AudioContextOptions): AudioContextLike
  createWorkletNode(context: AudioContextLike, name: string, options: AudioWorkletNodeOptions): AudioWorkletNodeLike
}

export interface AudioWorkletOutputOptions {
  options: ResolvedCustomAudioOptions
  capabilities: AudioOutputCapabilities
  callbacks: AudioOutputCallbacks
  runtime?: AudioOutputRuntime
  workletUrl?: URL
}

export interface AudioOutputLike {
  readonly sampleRate: number
  readonly bufferedFrames: number
  readonly pendingMessageBlocks: number
  readonly renderedFrames: number
  readonly transport: AudioTransportKind
  readonly state: AudioOutputState
  readonly contextTime: number
  initialize(channels: number, epoch: number): Promise<void>
  /**
   * Whether `frames` can be handed over right now. `enqueue` past the transport limit is a
   * hard `AUDIO_BUFFER_OVERFLOW`, so a producer has to ask before pushing: the processor
   * consumes nothing while paused, and the start buffer alone can fill the queue.
   */
  canAccept(frames: number): boolean
  enqueue(block: PcmBlock): void
  resumeContext(): Promise<void>
  play(epoch: number): void
  pause(epoch: number): void
  reset(epoch: number): void
  setPlaybackRate(rate: number, epoch: number): void
  setVolume(value: number): void
  setMuted(value: boolean): void
  close(): void
}

export class AudioWorkletOutput implements AudioOutputLike {
  readonly #options: ResolvedCustomAudioOptions
  readonly #capabilities: AudioOutputCapabilities
  readonly #callbacks: AudioOutputCallbacks
  readonly #runtime: AudioOutputRuntime
  readonly #workletUrl: URL
  #context: AudioContextLike | null = null
  #node: AudioWorkletNodeLike | null = null
  #gain: GainNodeLike | null = null
  #shared: SharedPcmRingBuffer | null = null
  #messages: MessagePcmTransport | null = null
  #sharedListener: ((event: MessageEvent<AudioWorkletOutputMessage>) => void) | null = null
  #channels = 0
  #renderedFrames = 0
  #state: AudioOutputState = 'uninitialized'
  #transport: AudioTransportKind = 'none'
  #epoch = 0
  #rate = 1
  #volume = 1
  #muted = false
  #closed = false

  constructor(options: AudioWorkletOutputOptions) {
    this.#options = options.options
    this.#capabilities = options.capabilities
    this.#callbacks = options.callbacks
    this.#runtime = options.runtime ?? browserAudioOutputRuntime
    this.#workletUrl = options.workletUrl ?? new URL('./worklet-processor.js', import.meta.url)
  }

  get sampleRate(): number { return this.#context?.sampleRate ?? this.#options.outputSampleRate ?? 0 }
  get bufferedFrames(): number { return this.#shared?.availableFrames ?? this.#messages?.pendingFrames ?? 0 }
  get pendingMessageBlocks(): number { return this.#messages?.pendingBlocks ?? 0 }
  get renderedFrames(): number { return this.#shared?.renderedFrames ?? this.#renderedFrames }
  get transport(): AudioTransportKind { return this.#transport }
  get state(): AudioOutputState { return this.#state }
  get contextTime(): number { return this.#context?.currentTime ?? 0 }

  async initialize(channels: number, epoch: number): Promise<void> {
    this.#ensureOpen()
    if (this.#context) return
    if (!Number.isSafeInteger(channels) || channels < 1 || channels > 2) throw audioError(ErrorCodes.AUDIO_CHANNEL_LAYOUT_UNSUPPORTED, 'Audio output supports mono or stereo only', false)
    this.#channels = channels
    this.#epoch = epoch
    try {
      const contextOptions: AudioContextOptions = {
        latencyHint: this.#options.latencyHint,
        ...(this.#options.outputSampleRate === null ? {} : { sampleRate: this.#options.outputSampleRate }),
      }
      this.#context = this.#runtime.createContext(contextOptions)
    } catch (cause) {
      throw audioError(ErrorCodes.AUDIO_CONTEXT_UNAVAILABLE, 'AudioContext could not be created', false, cause)
    }
    const context = this.#context
    if (!context.audioWorklet) {
      const error = audioError(ErrorCodes.AUDIO_WORKLET_UNAVAILABLE, 'AudioWorklet is unavailable', false)
      this.close()
      throw error
    }
    try { await context.audioWorklet.addModule(this.#workletUrl) } catch (cause) {
      const error = audioError(ErrorCodes.AUDIO_WORKLET_LOAD_FAILED, 'AudioWorklet module could not be loaded', false, cause)
      this.close()
      throw error
    }
    try {
      this.#node = this.#runtime.createWorkletNode(context, 'mx-player-max-pcm', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [channels] })
      this.#gain = context.createGain()
      this.#node.connect(this.#gain)
      this.#gain.connect(context.destination)
      this.#applyGain()
      const capacityFrames = Math.max(1, Math.ceil(this.#options.maxBufferedDuration * context.sampleRate / 1_000_000))
      if (this.#capabilities.crossOriginIsolated && this.#capabilities.sharedArrayBuffer && typeof SharedArrayBuffer !== 'undefined') {
        this.#shared = new SharedPcmRingBuffer(capacityFrames, channels)
        const descriptor = this.#shared.descriptor
        this.#node.port.postMessage({ type: 'shared-init', epoch, channels, capacityFrames, header: descriptor.header, samples: descriptor.samples } as AudioWorkletInputMessage)
        this.#sharedListener = (event) => {
          const message = event.data
          if (message.epoch !== this.#epoch) return
          if (message.type === 'underrun') this.#handleUnderrun(message.epoch)
          if (message.type === 'state' && message.state === 'drained') {
            this.#renderedFrames = this.#shared?.renderedFrames ?? this.#renderedFrames
            this.#callbacks.onConsumed(this.#renderedFrames, message.epoch)
            this.#setState('drained')
          }
        }
        this.#node.port.addEventListener('message', this.#sharedListener)
        this.#node.port.start?.()
        this.#transport = 'shared-array-buffer'
      } else {
        this.#messages = new MessagePcmTransport(this.#node.port, this.#options.maxMessagePortPendingBlocks, {
          onConsumed: (frames, messageEpoch) => { this.#renderedFrames += frames; this.#callbacks.onConsumed(this.#renderedFrames, messageEpoch) },
          onUnderrun: (messageEpoch) => this.#handleUnderrun(messageEpoch),
        })
        // The shared path seeds the processor epoch through `shared-init`. This one has no
        // such message, and the processor drops every `pcm` and `playback` whose epoch does
        // not match its own, so without this reset it stays on epoch 0 and renders nothing.
        this.#messages.reset(epoch)
        this.#transport = 'message-port'
      }
      this.#setState('ready')
    } catch (cause) {
      this.close()
      if (typeof cause === 'object' && cause !== null && 'code' in cause) throw cause
      throw audioError(ErrorCodes.AUDIO_WORKLET_FAILED, 'AudioWorklet output graph could not be created', false, cause)
    }
  }

  canAccept(frames: number): boolean {
    if (this.#closed || !this.#node) return false
    if (!Number.isSafeInteger(frames) || frames < 0) return false
    if (this.#shared) return frames <= this.#shared.freeFrames
    return this.#messages?.canEnqueue ?? false
  }

  enqueue(block: PcmBlock): void {
    this.#ensureInitialized()
    if (block.epoch !== this.#epoch || block.channels !== this.#channels || block.sampleRate !== this.sampleRate) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'PCM block does not match the active audio output', false)
    if (this.#shared) this.#shared.write(block.data, block.epoch)
    else this.#messages?.enqueue(block)
    if (this.#state === 'drained') this.#setState('buffering')
  }

  async resumeContext(): Promise<void> {
    this.#ensureInitialized()
    try { await this.#context?.resume() } catch (cause) { throw audioError(ErrorCodes.AUDIO_AUTOPLAY_BLOCKED, 'AudioContext resume was blocked', true, cause) }
  }

  play(epoch: number): void {
    this.#ensureInitialized()
    if (epoch !== this.#epoch) return
    this.#shared?.setPaused(false)
    if (this.#shared) this.#node?.port.postMessage({ type: 'playback', paused: false, rate: this.#rate, epoch })
    else this.#messages?.setPlayback(false, this.#rate, epoch)
    this.#setState('running')
  }

  pause(epoch: number): void {
    if (this.#closed || epoch !== this.#epoch) return
    this.#shared?.setPaused(true)
    if (this.#shared) this.#node?.port.postMessage({ type: 'playback', paused: true, rate: this.#rate, epoch })
    else this.#messages?.setPlayback(true, this.#rate, epoch)
    this.#setState('paused')
  }

  reset(epoch: number): void {
    this.#ensureInitialized()
    this.#epoch = epoch
    this.#renderedFrames = 0
    this.#shared?.reset(epoch)
    if (this.#shared) this.#node?.port.postMessage({ type: 'reset', epoch })
    else this.#messages?.reset(epoch)
    this.#setState('ready')
  }

  setPlaybackRate(rate: number, epoch: number): void {
    if (!Number.isFinite(rate) || rate <= 0 || rate > 16) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Audio playback rate is invalid', false)
    this.#rate = rate
    if (epoch !== this.#epoch) return
    if (this.#shared) this.#node?.port.postMessage({ type: 'playback', paused: this.#state !== 'running', rate, epoch })
    else this.#messages?.setPlayback(this.#state !== 'running', rate, epoch)
  }

  setVolume(value: number): void { if (!Number.isFinite(value) || value < 0 || value > 1) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Audio volume is invalid', false); this.#volume = value; this.#applyGain() }
  setMuted(value: boolean): void { this.#muted = value; this.#applyGain() }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#shared?.close()
    this.#messages?.close()
    if (this.#sharedListener) this.#node?.port.removeEventListener('message', this.#sharedListener)
    try { this.#node?.disconnect() } catch { /* best effort */ }
    try { this.#gain?.disconnect() } catch { /* best effort */ }
    try { this.#node?.port.close?.() } catch { /* best effort */ }
    void this.#context?.close().catch(() => undefined)
    this.#node = null; this.#gain = null; this.#context = null; this.#shared = null; this.#messages = null; this.#sharedListener = null; this.#transport = 'none'
    this.#state = 'closed'
  }

  #handleUnderrun(epoch: number): void { if (epoch !== this.#epoch || this.#closed) return; this.#setState('buffering'); this.#callbacks.onUnderrun(epoch) }
  #setState(state: AudioOutputState): void {
    if (this.#closed || this.#state === state) return
    this.#state = state
    this.#callbacks.onState(state, this.#epoch)
  }
  #applyGain(): void { const gain = this.#gain?.gain; const context = this.#context; if (!gain || !context) return; const target = this.#muted ? 0 : this.#volume; gain.cancelScheduledValues(context.currentTime); gain.setTargetAtTime(target, context.currentTime, 0.005) }
  #ensureOpen(): void { if (this.#closed) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Audio output is closed', false) }
  #ensureInitialized(): void { this.#ensureOpen(); if (!this.#context || !this.#node) throw audioError(ErrorCodes.AUDIO_OPERATION_FAILED, 'Audio output is not initialized', false) }
}

interface AudioContextConstructorLike { new(options?: AudioContextOptions): AudioContext }

export const browserAudioOutputRuntime: AudioOutputRuntime = {
  createContext(options) {
    const root = globalThis as unknown as { AudioContext?: AudioContextConstructorLike; webkitAudioContext?: AudioContextConstructorLike }
    const Constructor = root.AudioContext ?? root.webkitAudioContext
    if (!Constructor) throw audioError(ErrorCodes.AUDIO_CONTEXT_UNAVAILABLE, 'AudioContext is unavailable', false)
    return new Constructor(options) as unknown as AudioContextLike
  },
  createWorkletNode(context, name, options) {
    if (typeof AudioWorkletNode === 'undefined') throw audioError(ErrorCodes.AUDIO_WORKLET_UNAVAILABLE, 'AudioWorkletNode is unavailable', false)
    return new AudioWorkletNode(context as unknown as BaseAudioContext, name, options) as unknown as AudioWorkletNodeLike
  },
}
