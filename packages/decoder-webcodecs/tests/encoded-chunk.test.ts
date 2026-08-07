import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes, type DemuxPacket } from '@mx-player-max/types'
import { createEncodedVideoChunk, type EncodedVideoChunkFactory } from '../src/index'

describe('createEncodedVideoChunk', () => {
  it('constructs key and delta chunks without copying the packet view', () => {
    const create = vi.fn((init: EncodedVideoChunkInit) => init as unknown as EncodedVideoChunk)
    const factory: EncodedVideoChunkFactory = { create }
    const key = packet({ keyframe: true, timestamp: 10, duration: 20 })
    const delta = packet({ keyframe: false, timestamp: 30, duration: null })
    createEncodedVideoChunk(key, factory)
    createEncodedVideoChunk(delta, factory)
    expect(create.mock.calls[0]?.[0]).toMatchObject({ type: 'key', timestamp: 10, duration: 20, data: key.data })
    expect(create.mock.calls[1]?.[0]).toMatchObject({ type: 'delta', timestamp: 30, data: delta.data })
    expect('duration' in (create.mock.calls[1]?.[0] ?? {})).toBe(false)
  })

  it.each([
    ['negative timestamp', packet({ timestamp: -1 })],
    ['unsafe timestamp', packet({ timestamp: Number.MAX_SAFE_INTEGER + 1 })],
    ['negative duration', packet({ duration: -1 })],
    ['audio packet', packet({ kind: 'audio' })],
    ['empty data', packet({ data: new Uint8Array() })],
  ])('rejects %s with a stable code', (_label, value) => {
    expect(() => createEncodedVideoChunk(value, { create: (init) => init as unknown as EncodedVideoChunk })).toThrowError(expect.objectContaining({ code: ErrorCodes.WEBCODECS_CONFIG_INVALID }))
  })
})

function packet(overrides: Partial<DemuxPacket> = {}): DemuxPacket {
  return { trackId: 1, kind: 'video', timestamp: 0, duration: null, keyframe: true, data: Uint8Array.of(1, 2, 3), ...overrides }
}
