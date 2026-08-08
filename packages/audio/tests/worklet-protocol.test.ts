import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { MessagePcmTransport, type AudioMessagePort, type AudioWorkletInputMessage, type AudioWorkletOutputMessage } from '../src/index'

class FakePort implements AudioMessagePort {
  readonly messages: AudioWorkletInputMessage[] = []
  readonly transfers: Transferable[][] = []
  listener: ((event: MessageEvent<AudioWorkletOutputMessage>) => void) | null = null
  readonly close = vi.fn()
  postMessage(message: AudioWorkletInputMessage, transfer: Transferable[] = []): void { this.messages.push(message); this.transfers.push(transfer) }
  addEventListener(_type: 'message', listener: (event: MessageEvent<AudioWorkletOutputMessage>) => void): void { this.listener = listener }
  removeEventListener(): void { this.listener = null }
  ack(message: AudioWorkletOutputMessage): void { this.listener?.({ data: message } as MessageEvent<AudioWorkletOutputMessage>) }
}

describe('bounded MessagePort PCM protocol', () => {
  it('uses sequence/epoch, transferable PCM and consumed acknowledgements', () => {
    const port = new FakePort()
    const onConsumed = vi.fn()
    const transport = new MessagePcmTransport(port, 2, { onConsumed, onUnderrun: vi.fn() })
    transport.enqueue({ data: Float32Array.of(1, 2), frames: 2, channels: 1, sampleRate: 48_000, timestamp: 0, duration: 42, epoch: 3 })
    const message = port.messages[0]
    expect(message).toMatchObject({ type: 'pcm', sequence: 1, epoch: 3, frames: 2 })
    expect(port.transfers[0]).toHaveLength(1)
    port.ack({ type: 'consumed', sequence: 1, epoch: 3, frames: 2 })
    expect(onConsumed).toHaveBeenCalledWith(2, 3)
    expect(transport.pendingBlocks).toBe(0)
  })

  it('bounds pending blocks and ignores stale acknowledgements', () => {
    const port = new FakePort()
    const onConsumed = vi.fn()
    const transport = new MessagePcmTransport(port, 1, { onConsumed, onUnderrun: vi.fn() })
    const block = { data: Float32Array.of(1), frames: 1, channels: 1, sampleRate: 48_000, timestamp: 0, duration: 21, epoch: 1 }
    transport.enqueue(block)
    expect(() => transport.enqueue(block)).toThrowError(expect.objectContaining({ code: ErrorCodes.AUDIO_BUFFER_OVERFLOW }))
    transport.reset(2)
    port.ack({ type: 'consumed', sequence: 1, epoch: 1, frames: 1 })
    expect(onConsumed).not.toHaveBeenCalled()
    transport.close()
    expect(port.close).toHaveBeenCalledOnce()
  })
})
