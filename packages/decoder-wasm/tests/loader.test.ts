import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import {
  createMemoryWasmCache,
  digestWasmSha256,
  loadVerifiedWasmAsset,
  resolveWasmAssetUrl,
} from '../src'
import { HELLO_BYTES, HELLO_HASH, createManifest } from './helpers'

describe('verified WASM asset loader', () => {
  it('fetches, verifies, caches, and returns copied bytes', async () => {
    const fetcher = vi.fn(async () => new Response(HELLO_BYTES, { status: 200 }))
    const cache = createMemoryWasmCache()
    const manifest = createManifest({ variants: { single: 'single.wasm' }, sha256: { single: HELLO_HASH } })
    const first = await loadVerifiedWasmAsset(manifest, 'single', {
      baseUrl: 'https://cdn.example.test/wasm/', pluginId: 'loader-copy', fetcher, cache,
    })
    first.bytes[0] = 0
    const second = await loadVerifiedWasmAsset(manifest, 'single', {
      baseUrl: 'https://cdn.example.test/wasm/', pluginId: 'loader-copy', fetcher, cache,
    })
    expect(second.bytes).toEqual(HELLO_BYTES)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(await digestWasmSha256(HELLO_BYTES)).toBe(HELLO_HASH)
  })

  it('deduplicates concurrent requests for one asset key', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetcher = vi.fn(async () => {
      await gate
      return new Response(HELLO_BYTES, { status: 200 })
    })
    const options = {
      baseUrl: 'https://cdn.example.test/wasm/', pluginId: 'loader-dedupe', fetcher,
      cache: createMemoryWasmCache(),
    }
    const first = loadVerifiedWasmAsset(createManifest({ variants: { single: 'single.wasm' }, sha256: { single: HELLO_HASH } }), 'single', options)
    const second = loadVerifiedWasmAsset(createManifest({ variants: { single: 'single.wasm' }, sha256: { single: HELLO_HASH } }), 'single', options)
    release?.()
    await Promise.all([first, second])
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('remembers a hash failure and does not retry the same key', async () => {
    const fetcher = vi.fn(async () => new Response(new TextEncoder().encode('bad'), { status: 200 }))
    const options = {
      baseUrl: 'https://cdn.example.test/wasm/', pluginId: 'loader-bad-hash', fetcher,
      cache: createMemoryWasmCache(),
    }
    const manifest = createManifest({ variants: { single: 'single.wasm' }, sha256: { single: HELLO_HASH } })
    await expect(loadVerifiedWasmAsset(manifest, 'single', options)).rejects.toMatchObject({ code: ErrorCodes.WASM_HASH_MISMATCH })
    await expect(loadVerifiedWasmAsset(manifest, 'single', options)).rejects.toMatchObject({ code: ErrorCodes.WASM_HASH_MISMATCH })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('enforces the configured HTTP(S) base path', () => {
    expect(resolveWasmAssetUrl('https://cdn.example.test/wasm/', 'decoder.wasm')).toBe('https://cdn.example.test/wasm/decoder.wasm')
    expectCode(() => resolveWasmAssetUrl('https://cdn.example.test/wasm/', '../decoder.wasm'), ErrorCodes.WASM_URL_INVALID)
    expectCode(() => resolveWasmAssetUrl('https://cdn.example.test/wasm/', 'data:application/wasm;base64,AA=='), ErrorCodes.WASM_URL_INVALID)
    expectCode(() => resolveWasmAssetUrl('https://cdn.example.test/wasm/', 'https://other.example.test/decoder.wasm'), ErrorCodes.WASM_URL_INVALID)
    expectCode(() => resolveWasmAssetUrl('https://cdn.example.test/wasm/', 'https://user:secret@cdn.example.test/wasm/decoder.wasm'), ErrorCodes.WASM_URL_INVALID)
  })

  it('rejects redirected responses even when an injected fetcher follows them', async () => {
    const response = new Response(HELLO_BYTES, { status: 200 })
    Object.defineProperty(response, 'redirected', { value: true })
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      return response
    })

    await expect(loadVerifiedWasmAsset(
      createManifest({ variants: { single: 'single.wasm' }, sha256: { single: HELLO_HASH } }),
      'single',
      { baseUrl: 'https://cdn.example.test/wasm/', pluginId: 'loader-redirect', fetcher },
    )).rejects.toMatchObject({ code: ErrorCodes.WASM_URL_INVALID })
  })

  it('propagates cancellation as WASM_ABORTED', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn(async () => new Response(HELLO_BYTES, { status: 200 }))
    await expect(loadVerifiedWasmAsset(createManifest({ variants: { single: 'single.wasm' }, sha256: { single: HELLO_HASH } }), 'single', {
      baseUrl: 'https://cdn.example.test/wasm/', pluginId: 'loader-abort', fetcher, signal: controller.signal,
    })).rejects.toMatchObject({ code: ErrorCodes.WASM_ABORTED })
    expect(fetcher).not.toHaveBeenCalled()
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
