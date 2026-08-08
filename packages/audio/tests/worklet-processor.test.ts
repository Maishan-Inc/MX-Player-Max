import { describe, expect, it, vi } from 'vitest'
import {
  SHARED_AVAILABLE_FRAMES,
  SHARED_EPOCH,
  SHARED_PAUSED,
  SHARED_RENDERED_FRAMES,
  type AudioWorkletInputMessage,
  type AudioWorkletOutputMessage,
} from '../src/index'

interface ProcessorLike {
  port: { onmessage: ((event: MessageEvent<AudioWorkletInputMessage>) => void) | null; postMessage(message: AudioWorkletOutputMessage): void }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}

describe('AudioWorklet processor', () => {
  it('renders transferable PCM, acknowledges consumption and zero-fills underrun', async () => {
    let registered: (new() => ProcessorLike) | null = null
    class BaseProcessor {
      readonly port = { onmessage: null as ((event: MessageEvent<AudioWorkletInputMessage>) => void) | null, postMessage: vi.fn() }
    }
    vi.stubGlobal('AudioWorkletProcessor', BaseProcessor)
    vi.stubGlobal('registerProcessor', (_name: string, constructor: new() => ProcessorLike) => { registered = constructor })
    await import('../src/worklet-processor')
    if (!registered) throw new Error('processor was not registered')
    const processor = new registered()
    processor.port.onmessage?.({ data: { type: 'reset', epoch: 1 } } as MessageEvent<AudioWorkletInputMessage>)
    processor.port.onmessage?.({ data: { type: 'pcm', sequence: 1, epoch: 1, frames: 2, channels: 1, sampleRate: 48_000, data: Float32Array.of(0.25, 0.5).buffer } } as MessageEvent<AudioWorkletInputMessage>)
    processor.port.onmessage?.({ data: { type: 'playback', paused: false, rate: 1, epoch: 1 } } as MessageEvent<AudioWorkletInputMessage>)
    const channel = new Float32Array(4)
    expect(processor.process([], [[channel]])).toBe(true)
    expect([...channel]).toEqual([0.25, 0.5, 0, 0])
    expect(processor.port.postMessage).toHaveBeenCalledWith({ type: 'consumed', sequence: 1, epoch: 1, frames: 2 })
    expect(processor.port.postMessage).toHaveBeenCalledWith({ type: 'underrun', epoch: 1 })

    const accelerated = new registered()
    accelerated.port.onmessage?.({ data: { type: 'reset', epoch: 2 } } as MessageEvent<AudioWorkletInputMessage>)
    accelerated.port.onmessage?.({ data: { type: 'pcm', sequence: 1, epoch: 2, frames: 1, channels: 1, sampleRate: 48_000, data: Float32Array.of(1).buffer } } as MessageEvent<AudioWorkletInputMessage>)
    accelerated.port.onmessage?.({ data: { type: 'pcm', sequence: 2, epoch: 2, frames: 3, channels: 1, sampleRate: 48_000, data: Float32Array.of(2, 3, 4).buffer } } as MessageEvent<AudioWorkletInputMessage>)
    accelerated.port.onmessage?.({ data: { type: 'playback', paused: false, rate: 2, epoch: 2 } } as MessageEvent<AudioWorkletInputMessage>)
    const fastChannel = new Float32Array(2)
    accelerated.process([], [[fastChannel]])
    expect([...fastChannel]).toEqual([1, 3])
    expect(accelerated.port.postMessage).toHaveBeenCalledWith({ type: 'consumed', sequence: 1, epoch: 2, frames: 1 })
    expect(accelerated.port.postMessage).toHaveBeenCalledWith({ type: 'consumed', sequence: 2, epoch: 2, frames: 3 })

    const shared = new registered()
    const headerBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 8)
    const sampleBuffer = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 4)
    const header = new Int32Array(headerBuffer)
    const samples = new Float32Array(sampleBuffer)
    samples.set([0.25, 0.5])
    Atomics.store(header, SHARED_AVAILABLE_FRAMES, 2)
    Atomics.store(header, SHARED_EPOCH, 3)
    Atomics.store(header, SHARED_PAUSED, 0)
    shared.port.onmessage?.({ data: { type: 'shared-init', epoch: 3, channels: 1, capacityFrames: 4, header: headerBuffer, samples: sampleBuffer } } as MessageEvent<AudioWorkletInputMessage>)
    shared.port.onmessage?.({ data: { type: 'playback', paused: false, rate: 1, epoch: 3 } } as MessageEvent<AudioWorkletInputMessage>)
    const sharedChannel = new Float32Array(3)
    shared.process([], [[sharedChannel]])
    expect([...sharedChannel]).toEqual([0.25, 0.5, 0])
    expect(Atomics.load(header, SHARED_RENDERED_FRAMES)).toBe(2)
    expect(Atomics.load(header, SHARED_AVAILABLE_FRAMES)).toBe(0)
    expect(shared.port.postMessage).toHaveBeenCalledWith({ type: 'underrun', epoch: 3 })
    vi.unstubAllGlobals()
  })
})
