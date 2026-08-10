import { describe, expect, it } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { isWasmDecoderManifest, normalizeWasmCodec, validateWasmDecoderManifest } from '../src'
import { createManifest } from './helpers'

describe('WASM manifest validation', () => {
  it('normalizes codec IDs and preserves audited metadata', () => {
    const manifest = validateWasmDecoderManifest(createManifest({ codec: ' AVC1 ' }))
    expect(manifest.codec).toBe('avc1')
    expect(manifest.review?.status).toBe('approved')
    expect(manifest.pixelFormats).toEqual(['i420'])
  })

  it('requires a paired hash for every declared variant', () => {
    expect(() => validateWasmDecoderManifest(createManifest({ sha256: { single: undefined } }))).toThrowError()
    expect(() => validateWasmDecoderManifest(createManifest({ variants: { single: 'single.wasm' }, sha256: { simd: 'bad' } }))).toThrowError()
  })

  it('rejects unknown variants, invalid sizes, and empty capabilities', () => {
    expect(() => validateWasmDecoderManifest(createManifest({ variants: { single: 'single.wasm', bogus: 'bad' } as never }))).toThrowError()
    expect(() => validateWasmDecoderManifest(createManifest({ sizeBytes: { single: 0 } }))).toThrowError()
    const empty = createManifest({ supportsVideo: false, supportsAudio: false })
    expect(() => validateWasmDecoderManifest(empty)).toThrowError()
  })

  it('rejects unknown metadata and returns deeply frozen normalized data', () => {
    expectCode(
      () => validateWasmDecoderManifest({ ...createManifest(), unexpected: true }),
      ErrorCodes.WASM_MANIFEST_INVALID,
    )
    expectCode(
      () => validateWasmDecoderManifest({
        ...createManifest(),
        review: { status: 'approved', unexpected: true },
      }),
      ErrorCodes.WASM_MANIFEST_INVALID,
    )

    const manifest = validateWasmDecoderManifest(createManifest())
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(Object.isFrozen(manifest.variants)).toBe(true)
    expect(Object.isFrozen(manifest.sha256)).toBe(true)
    expect(Object.isFrozen(manifest.profiles)).toBe(true)
    expect(Object.isFrozen(manifest.review)).toBe(true)
  })

  it('exposes a safe predicate and stable codec normalization', () => {
    expect(isWasmDecoderManifest(createManifest())).toBe(true)
    expect(isWasmDecoderManifest({})).toBe(false)
    expect(normalizeWasmCodec(' VP09 ')).toBe('vp09')
    expectCode(() => normalizeWasmCodec(' '), ErrorCodes.WASM_MANIFEST_INVALID)
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
