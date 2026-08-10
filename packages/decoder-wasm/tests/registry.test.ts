import { describe, expect, it } from 'vitest'
import { ErrorCodes, type TrackInfo } from '@mx-player-max/types'
import { WasmDecoderRegistry, createWasmDecoderRegistry } from '../src'
import { createPlugin, createManifest, videoTrack } from './helpers'

describe('WASM decoder registry', () => {
  it('sorts plugins by priority then ID and exposes declarations', () => {
    const registry = createWasmDecoderRegistry([
      createPlugin('fallback', createManifest({ codec: 'avc1' }), { priority: -10 }),
      createPlugin('primary', createManifest({ codec: 'avc1' }), { priority: 10 }),
    ])
    expect(registry.list().map((plugin) => plugin.id)).toEqual(['primary', 'fallback'])
    expect(registry.resolve('AVC1', videoTrack).map((plugin) => plugin.id)).toEqual(['primary', 'fallback'])
    expect(registry.declarations()[0]).toMatchObject({ codec: 'avc1', supportsVideo: true, supportsAudio: false })
  })

  it('rejects duplicate plugin IDs and supports removal', () => {
    const registry = new WasmDecoderRegistry()
    registry.register(createPlugin('duplicate'))
    expectCode(() => registry.register(createPlugin('duplicate')), ErrorCodes.WASM_PLUGIN_DUPLICATE)
    expect(registry.unregister('duplicate')).toBe(true)
    expect(registry.unregister('duplicate')).toBe(false)
  })

  it('ignores a plugin whose supports predicate throws', () => {
    const registry = createWasmDecoderRegistry([
      createPlugin('broken', createManifest(), { supports: () => { throw new Error('broken') } }),
      createPlugin('working'),
    ])
    expect(registry.resolve('avc1', videoTrack).map((plugin) => plugin.id)).toEqual(['working'])
  })

  it('enforces manifest Codec and track-kind capabilities before plugin matching', () => {
    const audioTrack: TrackInfo = { id: 2, kind: 'audio', codecId: 'A_AAC', codec: 'avc1' }
    const subtitleTrack: TrackInfo = { id: 3, kind: 'subtitle', codecId: 'S_TEXT/UTF8' }
    const registry = createWasmDecoderRegistry([
      createPlugin('video', createManifest(), { supports: () => true }),
      createPlugin('audio', createManifest({ supportsVideo: false, supportsAudio: true }), { supports: () => true }),
      createPlugin('wrong-codec', createManifest({ codec: 'vp09' }), { supports: () => true }),
    ])

    expect(registry.resolve('avc1', videoTrack).map((plugin) => plugin.id)).toEqual(['video'])
    expect(registry.resolve('avc1', audioTrack).map((plugin) => plugin.id)).toEqual(['audio'])
    expect(registry.resolve('avc1', subtitleTrack)).toEqual([])
  })

  it('snapshots immutable plugin metadata during registration', () => {
    const manifest = createManifest()
    const registry = createWasmDecoderRegistry([createPlugin('snapshot', manifest)])

    const mutableVariants = manifest.variants as Partial<Record<'threaded' | 'simd' | 'single', string>>
    const mutableReview = manifest.review as { status: 'approved' | 'restricted' | 'pending' }
    mutableVariants.single = 'tampered.wasm'
    mutableReview.status = 'pending'

    const registered = registry.resolve('avc1', videoTrack)[0]
    expect(registered?.manifest.variants.single).toBe('single.wasm')
    expect(registered?.manifest.review?.status).toBe('approved')
    expect(registry.declarations({ requireApprovedReview: true })).toHaveLength(1)
  })
})

function expectCode(action: () => unknown, code: string): void {
  try {
    action()
    throw new Error('Expected action to throw')
  } catch (error) {
    expect(error).toMatchObject({ code })
  }
}
