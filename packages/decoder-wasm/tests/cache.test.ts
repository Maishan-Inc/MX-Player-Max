import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCacheStorageWasmCache, createMemoryWasmCache } from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WASM asset caches', () => {
  it('copies memory-cache bytes and tracks failures', async () => {
    const cache = createMemoryWasmCache()
    const input = new Uint8Array([1, 2, 3])
    await cache.set('asset', input)
    input[0] = 9

    const first = await cache.get('asset')
    expect(first).toEqual(new Uint8Array([1, 2, 3]))
    if (first !== null) first[1] = 9
    expect(await cache.get('asset')).toEqual(new Uint8Array([1, 2, 3]))

    cache.markFailure('asset')
    expect(cache.hasFailed('asset')).toBe(true)
    expect(cache.hasFailed('other')).toBe(false)
  })

  it('stores copied responses in one lazily opened Cache Storage cache', async () => {
    const responses = new Map<string, Response>()
    const browserCache = {
      match: vi.fn(async (request: RequestInfo | URL) => responses.get(String(request))?.clone()),
      put: vi.fn(async (request: RequestInfo | URL, response: Response) => {
        responses.set(String(request), response.clone())
      }),
    } as unknown as Cache
    const open = vi.fn(async () => browserCache)
    vi.stubGlobal('caches', { open } as unknown as CacheStorage)
    const cache = createCacheStorageWasmCache('phase-10-test')
    if (cache === null) throw new Error('Expected Cache Storage adapter')

    const input = new Uint8Array([4, 5, 6])
    await cache.set('asset', input)
    input[0] = 9
    const first = await cache.get('asset')
    expect(first).toEqual(new Uint8Array([4, 5, 6]))
    if (first !== null) first[1] = 9
    expect(await cache.get('asset')).toEqual(new Uint8Array([4, 5, 6]))
    expect(open).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith('phase-10-test')
  })

  it('returns null when Cache Storage is unavailable', () => {
    vi.stubGlobal('caches', undefined)
    expect(createCacheStorageWasmCache()).toBeNull()
  })
})
