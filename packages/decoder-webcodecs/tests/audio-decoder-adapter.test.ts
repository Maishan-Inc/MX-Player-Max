import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes, type DemuxPacket } from '@mx-player-max/types'
import {
  AudioDecoderAdapter,
  type AudioDecoderRuntime,
  type AudioDecoderRuntimeCallbacks,
  type EncodedAudioChunkFactory,
} from '../src/index'

class FakeRuntime implements AudioDecoderRuntime {
  state: AudioDecoderRuntime['state'] = 'unconfigured'
  decodeQueueSize = 0
  readonly configure = vi.fn((_config: AudioDecoderConfig) => { this.state = 'configured' })
  readonly decode = vi.fn((_chunk: EncodedAudioChunk) => { this.decodeQueueSize += 1 })
  readonly flush = vi.fn(async () => {})
  readonly reset = vi.fn(() => { this.state = 'unconfigured'; this.decodeQueueSize = 0 })
  readonly close = vi.fn(() => { this.state = 'closed' })
}

function setup() {
  const runtimes: FakeRuntime[] = []
  const callbackSets: AudioDecoderRuntimeCallbacks[] = []
  const onData = vi.fn()
  const onError = vi.fn()
  const onDequeue = vi.fn()
  const chunkFactory: EncodedAudioChunkFactory = { create: vi.fn((init) => init as unknown as EncodedAudioChunk) }
  const adapter = new AudioDecoderAdapter({
    callbacks: { onData, onError, onDequeue }, chunkFactory,
    runtimeFactory: (callbacks) => { callbackSets.push(callbacks); const runtime = new FakeRuntime(); runtimes.push(runtime); return runtime },
  })
  return { adapter, runtimes, callbackSets, onData, onError, onDequeue, chunkFactory }
}

describe('AudioDecoderAdapter', () => {
  it('configures verified audio and decodes compressed packets', async () => {
    const h = setup()
    await h.adapter.configure(config(), true, 2)
    h.adapter.decode(packet(), 2)
    expect(h.runtimes[0]?.configure).toHaveBeenCalledWith(config())
    expect(h.chunkFactory.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'key', data: packet().data }))
    expect(h.adapter.decodeQueueSize).toBe(1)
  })

  it('forwards AudioData/dequeue/error with the active epoch', async () => {
    const h = setup()
    await h.adapter.configure(config(), true, 4)
    const data = { close: vi.fn() } as unknown as AudioData
    h.callbackSets[0]?.output(data)
    h.callbackSets[0]?.dequeue()
    h.callbackSets[0]?.error(new Error('private'))
    expect(h.onData).toHaveBeenCalledWith(data, 4)
    expect(h.onDequeue).toHaveBeenCalledWith(4)
    expect(h.onError).toHaveBeenCalledWith(expect.objectContaining({ code: ErrorCodes.WEBCODECS_AUDIO_DECODE_FAILED }), 4)
  })

  it('assigns the new epoch before a synchronous runtime callback', async () => {
    const h = setup()
    h.runtimes[0]?.configure.mockImplementationOnce(() => { h.callbackSets[0]?.error(new Error('synchronous')) })
    await h.adapter.configure(config(), true, 9)
    expect(h.onError).toHaveBeenCalledWith(expect.objectContaining({ code: ErrorCodes.WEBCODECS_AUDIO_DECODE_FAILED }), 9)
  })

  it('requires reconfigure after reset and closes stale generation output', async () => {
    const h = setup()
    await h.adapter.configure(config(), true, 0)
    await h.adapter.reset(1)
    expect(() => h.adapter.decode(packet(), 1)).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_AUDIO_ABORTED }))
    await h.adapter.configure(config(), true, 1)
    const close = vi.fn()
    h.callbackSets[0]?.output({ close } as unknown as AudioData)
    expect(close).toHaveBeenCalledOnce()
    expect(h.onData).not.toHaveBeenCalled()
  })

  it('maps configure/decode/flush/reset failures and closes idempotently', async () => {
    const h = setup()
    h.runtimes[0]?.configure.mockImplementationOnce(() => { throw new Error('configure') })
    await expect(h.adapter.configure(config(), true, 0)).rejects.toMatchObject({ code: ErrorCodes.WEBCODECS_AUDIO_CONFIGURE_FAILED })
    const d = setup(); await d.adapter.configure(config(), true, 0)
    d.runtimes[0]?.decode.mockImplementationOnce(() => { throw new Error('decode') })
    expect(() => d.adapter.decode(packet(), 0)).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_AUDIO_DECODE_FAILED }))
    d.runtimes[0]?.flush.mockRejectedValueOnce(new Error('flush'))
    await expect(d.adapter.flush(0)).rejects.toMatchObject({ code: ErrorCodes.WEBCODECS_AUDIO_FLUSH_FAILED })
    d.adapter.close(); d.adapter.close()
    expect(d.runtimes[0]?.close).toHaveBeenCalledOnce()
  })
})

function config(): AudioDecoderConfig { return { codec: 'mp3', sampleRate: 48_000, numberOfChannels: 2 } }
function packet(): DemuxPacket { return { trackId: 2, kind: 'audio', timestamp: 0, duration: 20_000, keyframe: true, data: Uint8Array.of(1) } }
