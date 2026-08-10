import { describe, expect, it } from 'vitest'
import { selectWasmVariants } from '../src'
import { createCapabilities, createManifest } from './helpers'

describe('WASM variant selection', () => {
  it('uses threaded only when all isolation and thread capabilities are true', () => {
    const manifest = createManifest()
    expect(selectWasmVariants(manifest, createCapabilities())).toEqual(['simd', 'single'])
    expect(selectWasmVariants(manifest, createCapabilities({
      crossOriginIsolated: true,
      sharedArrayBuffer: true,
      wasmThreads: true,
    }))).toEqual(['threaded', 'simd', 'single'])
  })

  it('does not require SIMD when only single is declared', () => {
    const manifest = createManifest({ variants: { single: 'single.wasm' }, sha256: { single: manifestHash() } })
    expect(selectWasmVariants(manifest, createCapabilities({ wasmSimd: false }))).toEqual(['single'])
  })

  it('skips unavailable variants without mutating the manifest', () => {
    const manifest = createManifest({ variants: { simd: 'simd.wasm' }, sha256: { simd: manifestHash() } })
    expect(selectWasmVariants(manifest, createCapabilities({ wasmSimd: true }))).toEqual(['simd'])
    expect(manifest.variants).toEqual({ simd: 'simd.wasm' })
  })
})

function manifestHash(): string {
  return '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
}
