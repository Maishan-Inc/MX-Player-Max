import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import {
  createMemoryWasmCache,
  createWasmDecoderManager,
  createWasmDecoderRegistry,
  type WasmDecoderRuntime,
} from '../src'
import { HELLO_BYTES, HELLO_HASH, createCapabilities, createInstance, createManifest, createPlugin, videoTrack } from './helpers'

describe('WASM decoder Manager', () => {
  it('falls back from threaded to simd after module compilation failure', async () => {
    const compile = vi.fn<NonNullable<WasmDecoderRuntime['compile']>>()
      .mockRejectedValueOnce(new Error('threaded failed'))
      .mockResolvedValueOnce({} as WebAssembly.Module)
    const create = vi.fn(async ({ variant }: { variant: 'threaded' | 'simd' | 'single' }) => createInstance(variant))
    const manager = createWasmDecoderManager({
      baseUrl: 'https://cdn.example.test/wasm/',
      registry: createWasmDecoderRegistry([createPlugin('fallback-test', createManifest(), { create: create as never })]),
      fetcher: vi.fn(async () => new Response(HELLO_BYTES, { status: 200 })),
      runtime: { compile },
    })
    const instance = await manager.load('avc1', videoTrack, createCapabilities({ crossOriginIsolated: true, sharedArrayBuffer: true, wasmThreads: true }))
    expect(instance.variant).toBe('simd')
    expect(compile).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledOnce()
    manager.close()
  })

  it('does not fetch threaded in a non-isolated environment', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new Response(HELLO_BYTES, { status: 200, headers: { 'x-url': String(input) } }))
    const manager = createWasmDecoderManager({
      baseUrl: 'https://cdn.example.test/wasm/',
      registry: createWasmDecoderRegistry([createPlugin('non-isolated', createManifest())]),
      fetcher,
      runtime: { compile: async () => ({}) as WebAssembly.Module },
    })
    const instance = await manager.load('avc1', videoTrack, createCapabilities())
    expect(instance.variant).toBe('simd')
    expect(fetcher).toHaveBeenCalledWith('https://cdn.example.test/wasm/simd.wasm', expect.anything())
    expect(fetcher).not.toHaveBeenCalledWith('https://cdn.example.test/wasm/threaded.wasm', expect.anything())
    manager.close()
  })

  it('tries the next plugin after plugin initialization failure', async () => {
    const firstCreate = vi.fn(async () => { throw new Error('plugin failed') })
    const secondClose = vi.fn()
    const manager = createWasmDecoderManager({
      baseUrl: 'https://cdn.example.test/wasm/',
      registry: createWasmDecoderRegistry([
        createPlugin('first', createManifest({ version: 'first' }), { priority: 10, create: firstCreate as never }),
        createPlugin('second', createManifest({ version: 'second' }), { priority: 0, create: async ({ variant }) => createInstance(variant, secondClose) }),
      ]),
      fetcher: vi.fn(async () => new Response(HELLO_BYTES, { status: 200 })),
      runtime: { compile: async () => ({}) as WebAssembly.Module },
    })
    const instance = await manager.load('avc1', videoTrack, createCapabilities({ wasmSimd: false }))
    expect(instance.pluginId).toBe('second')
    instance.close()
    expect(secondClose).toHaveBeenCalledOnce()
  })

  it('enforces the review gate without fetching unapproved assets', async () => {
    const fetcher = vi.fn(async () => new Response(HELLO_BYTES, { status: 200 }))
    const manager = createWasmDecoderManager({
      baseUrl: 'https://cdn.example.test/wasm/',
      registry: createWasmDecoderRegistry([createPlugin('pending', createManifest({ review: { status: 'pending' } }))]),
      fetcher,
      runtime: { compile: async () => ({}) as WebAssembly.Module },
    })
    await expect(manager.load('avc1', videoTrack, createCapabilities())).rejects.toMatchObject({ code: ErrorCodes.WASM_REVIEW_REQUIRED })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('hides unapproved plugins from strategy declarations by default', () => {
    const registry = createWasmDecoderRegistry([
      createPlugin('approved', createManifest({ codec: 'avc1' })),
      createPlugin('pending', createManifest({ codec: 'vp09', review: { status: 'pending' } })),
    ])
    const guarded = createWasmDecoderManager({ baseUrl: 'https://cdn.example.test/wasm/', registry })
    const internal = createWasmDecoderManager({
      baseUrl: 'https://cdn.example.test/wasm/',
      registry,
      requireApprovedReview: false,
    })

    expect(guarded.declarations().map((declaration) => declaration.codec)).toEqual(['avc1'])
    expect(internal.declarations().map((declaration) => declaration.codec)).toEqual(['avc1', 'vp09'])
    guarded.close()
    internal.close()
  })

  it('reports WASM_VARIANT_UNAVAILABLE when no approved plugin has a compatible variant', async () => {
    const fetcher = vi.fn(async () => new Response(HELLO_BYTES, { status: 200 }))
    const manager = createWasmDecoderManager({
      baseUrl: 'https://cdn.example.test/wasm/',
      registry: createWasmDecoderRegistry([createPlugin('threaded-only', createManifest({
        variants: { threaded: 'threaded.wasm' },
        sha256: { threaded: HELLO_HASH },
      }))]),
      fetcher,
    })

    await expect(manager.load('avc1', videoTrack, createCapabilities({ wasmSimd: false })))
      .rejects.toMatchObject({ code: ErrorCodes.WASM_VARIANT_UNAVAILABLE })
    expect(fetcher).not.toHaveBeenCalled()
    manager.close()
  })

  it('closes an invalid plugin instance before falling back', async () => {
    const invalidClose = vi.fn()
    const invalidCreate = vi.fn(async () => ({
      variant: 'simd',
      decode: () => {},
      flush: async () => {},
      close: invalidClose,
    }))
    const manager = createWasmDecoderManager({
      baseUrl: 'https://cdn.example.test/wasm/',
      registry: createWasmDecoderRegistry([
        createPlugin('invalid', createManifest({
          version: 'invalid', variants: { single: 'single.wasm' }, sha256: { single: HELLO_HASH },
        }), { priority: 10, create: invalidCreate as never }),
        createPlugin('valid', createManifest({
          version: 'valid', variants: { single: 'single.wasm' }, sha256: { single: HELLO_HASH },
        })),
      ]),
      fetcher: vi.fn(async () => new Response(HELLO_BYTES, { status: 200 })),
      runtime: { compile: async () => ({}) as WebAssembly.Module },
    })

    const instance = await manager.load('avc1', videoTrack, createCapabilities({ wasmSimd: false }))
    expect(instance.pluginId).toBe('valid')
    expect(invalidClose).toHaveBeenCalledOnce()
    manager.close()
  })

  it('closes managed instances and rejects future operations', async () => {
    const onClose = vi.fn()
    const manager = createWasmDecoderManager({
      baseUrl: 'https://cdn.example.test/wasm/',
      registry: createWasmDecoderRegistry([createPlugin('close-test', createManifest({ variants: { single: 'single.wasm' }, sha256: { single: HELLO_HASH } }), { create: async ({ variant }) => createInstance(variant, onClose) })]),
      fetcher: vi.fn(async () => new Response(HELLO_BYTES, { status: 200 })),
      runtime: { compile: async () => ({}) as WebAssembly.Module },
    })
    const instance = await manager.load('avc1', videoTrack, createCapabilities({ wasmSimd: false }))
    manager.close()
    manager.close()
    expect(onClose).toHaveBeenCalledOnce()
    await expect(instance.flush()).rejects.toMatchObject({ code: ErrorCodes.WASM_CLOSED })
    expect(() => manager.list()).not.toThrow()
    expectCode(() => manager.register(createPlugin('after-close')), ErrorCodes.WASM_CLOSED)
  })

  it('scopes failed asset memory to one Manager session', async () => {
    const cache = createMemoryWasmCache()
    const manifest = createManifest({
      version: 'session-scope',
      variants: { single: 'single.wasm' },
      sha256: { single: HELLO_HASH },
    })
    const failing = createWasmDecoderManager({
      baseUrl: 'https://cdn.example.test/wasm/',
      registry: createWasmDecoderRegistry([createPlugin('session-scope', manifest)]),
      cache,
      fetcher: vi.fn(async () => new Response(new TextEncoder().encode('bad'), { status: 200 })),
      runtime: { compile: async () => ({}) as WebAssembly.Module },
    })
    await expect(failing.load('avc1', videoTrack, createCapabilities({ wasmSimd: false }))).rejects.toMatchObject({ code: ErrorCodes.WASM_ALL_VARIANTS_FAILED })
    failing.close()

    const succeeding = createWasmDecoderManager({
      baseUrl: 'https://cdn.example.test/wasm/',
      registry: createWasmDecoderRegistry([createPlugin('session-scope', manifest)]),
      cache,
      fetcher: vi.fn(async () => new Response(HELLO_BYTES, { status: 200 })),
      runtime: { compile: async () => ({}) as WebAssembly.Module },
    })
    await expect(succeeding.load('avc1', videoTrack, createCapabilities({ wasmSimd: false }))).resolves.toMatchObject({ variant: 'single' })
    succeeding.close()
  })

  it('lets a waiting caller abort independently from a shared asset request', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetcher = vi.fn(async () => {
      await gate
      return new Response(HELLO_BYTES, { status: 200 })
    })
    const manager = createWasmDecoderManager({
      baseUrl: 'https://cdn.example.test/wasm/',
      registry: createWasmDecoderRegistry([createPlugin('abort-share', createManifest({
        version: 'abort-share', variants: { single: 'single.wasm' }, sha256: { single: HELLO_HASH },
      }))]),
      fetcher,
      runtime: { compile: async () => ({}) as WebAssembly.Module },
    })
    const first = manager.load('avc1', videoTrack, createCapabilities({ wasmSimd: false }))
    const controller = new AbortController()
    const second = manager.load('avc1', videoTrack, createCapabilities({ wasmSimd: false }), { signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    const result = await Promise.race([
      second.then(() => 'resolved', () => 'rejected'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 50)),
    ])
    expect(result).toBe('rejected')
    release?.()
    await first
    manager.close()
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
