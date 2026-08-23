import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import {
  AudioWorkletOutput,
  resolveCustomAudioOptions,
  type AudioContextLike,
  type AudioMessagePort,
  type AudioOutputRuntime,
  type AudioParamLike,
  type AudioWorkletInputMessage,
  type AudioWorkletNodeLike,
  type AudioWorkletOutputMessage,
  type GainNodeLike,
} from '../src/index'

class FakePort implements AudioMessagePort {
  readonly messages: AudioWorkletInputMessage[] = []
  listener: ((event: MessageEvent<AudioWorkletOutputMessage>) => void) | null = null
  readonly close = vi.fn()
  postMessage(message: AudioWorkletInputMessage): void { this.messages.push(message) }
  addEventListener(_type: 'message', listener: (event: MessageEvent<AudioWorkletOutputMessage>) => void): void { this.listener = listener }
  removeEventListener(): void { this.listener = null }
  respond(message: AudioWorkletOutputMessage): void { this.listener?.({ data: message } as MessageEvent<AudioWorkletOutputMessage>) }
}

function harness(options: { isolated?: boolean; resumeReject?: boolean; workletUnavailable?: boolean } = {}) {
  const port = new FakePort()
  const param: AudioParamLike = { value: 1, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() }
  const gain: GainNodeLike = { gain: param, connect: vi.fn(), disconnect: vi.fn() }
  const node: AudioWorkletNodeLike = { port, connect: vi.fn(), disconnect: vi.fn() }
  const context: AudioContextLike = {
    sampleRate: 48_000, currentTime: 1, state: 'suspended', destination: {},
    ...(options.workletUnavailable ? {} : { audioWorklet: { addModule: vi.fn(async () => {}) } }), createGain: () => gain,
    resume: options.resumeReject ? vi.fn(async () => { throw new Error('blocked') }) : vi.fn(async () => {}),
    suspend: vi.fn(async () => {}), close: vi.fn(async () => {}),
  }
  const runtime: AudioOutputRuntime = { createContext: () => context, createWorkletNode: () => node }
  const callbacks = { onConsumed: vi.fn(), onUnderrun: vi.fn(), onState: vi.fn() }
  const output = new AudioWorkletOutput({ options: resolveCustomAudioOptions(), capabilities: { crossOriginIsolated: options.isolated ?? false, sharedArrayBuffer: options.isolated ?? false }, callbacks, runtime })
  return { output, port, param, context, callbacks }
}

describe('AudioWorkletOutput', () => {
  it('builds node -> gain -> destination and uses bounded MessagePort PCM', async () => {
    const h = harness()
    await h.output.initialize(2, 0)
    expect(h.output.transport).toBe('message-port')
    h.output.enqueue({ data: Float32Array.of(1, 10, 2, 20), frames: 2, channels: 2, sampleRate: 48_000, timestamp: 0, duration: 42, epoch: 0 })
    expect(h.output.pendingMessageBlocks).toBe(1)
    h.port.respond({ type: 'consumed', sequence: 1, epoch: 0, frames: 2 })
    expect(h.callbacks.onConsumed).toHaveBeenCalledWith(2, 0)
    h.output.close()
  })

  it('selects SharedArrayBuffer only for confirmed isolated capability', async () => {
    const h = harness({ isolated: true })
    await h.output.initialize(1, 2)
    expect(h.output.transport).toBe('shared-array-buffer')
    expect(h.port.messages[0]).toMatchObject({ type: 'shared-init', epoch: 2 })
    h.output.setPlaybackRate(1.5, 2)
    h.output.play(2)
    expect(h.port.messages).toContainEqual({ type: 'playback', paused: false, rate: 1.5, epoch: 2 })
    h.output.reset(3)
    expect(h.port.messages).toContainEqual({ type: 'reset', epoch: 3 })
    h.output.close()
  })

  it('uses GainNode for smooth volume/mute and maps autoplay rejection', async () => {
    const h = harness({ resumeReject: true })
    await h.output.initialize(2, 0)
    h.output.setVolume(0.5)
    h.output.setMuted(true)
    expect(h.param.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, 0.005)
    await expect(h.output.resumeContext()).rejects.toMatchObject({ code: ErrorCodes.AUDIO_AUTOPLAY_BLOCKED })
    h.output.close()
  })

  it('closes a created AudioContext when AudioWorklet is unavailable', async () => {
    const h = harness({ workletUnavailable: true })
    await expect(h.output.initialize(2, 0)).rejects.toMatchObject({ code: ErrorCodes.AUDIO_WORKLET_UNAVAILABLE })
    expect(h.context.close).toHaveBeenCalledOnce()
  })

  /**
   * The shared path seeds the processor epoch through `shared-init`. The MessagePort path has
   * no such message, and the processor drops every `pcm` and `playback` whose epoch differs
   * from its own, so a session on any epoch but 0 rendered silence until it was reset.
   */
  it('seeds the processor epoch when the MessagePort transport is chosen', async () => {
    const h = harness()
    await h.output.initialize(2, 4)
    expect(h.port.messages).toEqual([{ type: 'reset', epoch: 4 }])
  })

  /**
   * `enqueue` past the pending limit is a hard `AUDIO_BUFFER_OVERFLOW`, and the processor
   * consumes nothing while paused, so producers have to be able to ask first.
   */
  it('refuses further blocks at the pending limit and accepts again once acknowledged', async () => {
    const h = harness()
    await h.output.initialize(1, 0)
    const limit = resolveCustomAudioOptions().maxMessagePortPendingBlocks
    for (let index = 0; index < limit; index += 1) {
      expect(h.output.canAccept(1)).toBe(true)
      h.output.enqueue({ data: Float32Array.of(0.5), frames: 1, channels: 1, sampleRate: 48_000, timestamp: index, duration: 21, epoch: 0 })
    }
    expect(h.output.pendingMessageBlocks).toBe(limit)
    expect(h.output.canAccept(1)).toBe(false)
    expect(() => h.output.enqueue({ data: Float32Array.of(0.5), frames: 1, channels: 1, sampleRate: 48_000, timestamp: limit, duration: 21, epoch: 0 }))
      .toThrowError(expect.objectContaining({ code: ErrorCodes.AUDIO_BUFFER_OVERFLOW }))
    h.port.respond({ type: 'consumed', sequence: 1, epoch: 0, frames: 1 })
    expect(h.output.canAccept(1)).toBe(true)
    h.output.close()
    expect(h.output.canAccept(1)).toBe(false)
  })
})
