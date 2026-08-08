import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes, type DemuxPacket } from '@mx-player-max/types'
import { createEncodedAudioChunk, type EncodedAudioChunkFactory } from '../src/index'

describe('createEncodedAudioChunk', () => {
  it('keeps packet timing and the original Uint8Array view', () => {
    const create = vi.fn((init: EncodedAudioChunkInit) => init as unknown as EncodedAudioChunk)
    const value = packet()
    createEncodedAudioChunk(value, { create } as EncodedAudioChunkFactory)
    expect(create).toHaveBeenCalledWith({ type: 'key', timestamp: 10, duration: 20, data: value.data })
  })

  it.each([
    packet({ kind: 'video' }), packet({ timestamp: -1 }), packet({ duration: -1 }), packet({ data: new Uint8Array() }),
  ])('rejects invalid packet metadata', (value) => {
    expect(() => createEncodedAudioChunk(value, { create: (init) => init as unknown as EncodedAudioChunk }))
      .toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID }))
  })
})

function packet(overrides: Partial<DemuxPacket> = {}): DemuxPacket {
  return { trackId: 2, kind: 'audio', timestamp: 10, duration: 20, keyframe: true, data: Uint8Array.of(1, 2), ...overrides }
}
