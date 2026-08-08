import { describe, expect, it, vi } from 'vitest'
import {
  createMemoryAiModelCache,
  digestHex,
  loadAiModelAsset,
  parseMxai,
  validateAiModelManifest,
} from '../src/index'

const manifest = {
  model: 'rt4ksr-x2',
  version: 'test',
  tier: 'low',
  variants: { f32: 'model.bin' },
  sha256: { f32: '0000000000000000000000000000000000000000000000000000000000000000' },
  license: 'Apache-2.0',
  upstream: 'https://example.test/upstream@commit',
  buildFlags: 'test',
  patentRisk: 'low',
  requiredFeatures: [],
  review: { status: 'approved' },
} as const

describe('AI asset contracts', () => {
  it('validates an approved manifest and rejects malformed hashes', () => {
    expect(validateAiModelManifest(manifest).model).toBe('rt4ksr-x2')
    expect(() => validateAiModelManifest({ ...manifest, sha256: { f32: 'bad' } })).toThrow('SHA-256')
  })

  it('loads and caches a verified asset', async () => {
    const bytes = new TextEncoder().encode('model')
    const hash = await digestHex(bytes)
    const fetcher = vi.fn(async () => new Response(bytes, { status: 200 }))
    const cache = createMemoryAiModelCache()
    const value = await loadAiModelAsset({ ...manifest, sha256: { f32: hash } }, 'f32', {
      baseUrl: 'https://cdn.example.test/models/', fetcher, cache,
    })
    expect(value.bytes).toEqual(bytes)
    await loadAiModelAsset({ ...manifest, sha256: { f32: hash } }, 'f32', {
      baseUrl: 'https://cdn.example.test/models/', fetcher, cache,
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('remembers a hash failure', async () => {
    const fetcher = vi.fn(async () => new Response(new TextEncoder().encode('bad'), { status: 200 }))
    const cache = createMemoryAiModelCache()
    const options = { baseUrl: 'https://cdn.example.test/models/', fetcher, cache }
    await expect(loadAiModelAsset(manifest, 'f32', options)).rejects.toThrow('hash mismatch')
    await expect(loadAiModelAsset(manifest, 'f32', options)).rejects.toThrow('previously failed')
  })

  it('parses a bounded MXAI tensor table', () => {
    const model = new TextEncoder().encode('test-model')
    const name = new TextEncoder().encode('weight')
    const tableOffset = 20 + model.length + name.length
    const tableEnd = tableOffset + 48
    const bytes = new Uint8Array(tableEnd + 8)
    const view = new DataView(bytes.buffer)
    bytes.set([0x4d, 0x58, 0x41, 0x49], 0)
    view.setUint16(4, 1, true)
    view.setUint16(6, model.length, true)
    view.setUint8(8, 1)
    view.setUint32(12, 1, true)
    view.setUint32(16, tableOffset, true)
    bytes.set(model, 20)
    bytes.set(name, 20 + model.length)
    view.setUint32(tableOffset, 20 + model.length, true)
    view.setUint16(tableOffset + 4, name.length, true)
    view.setUint8(tableOffset + 6, 1)
    view.setUint8(tableOffset + 7, 1)
    view.setUint32(tableOffset + 8, tableEnd, true)
    view.setUint32(tableOffset + 12, 8, true)
    view.setUint32(tableOffset + 16, 2, true)
    view.setUint32(tableEnd, 0x3f800000, true)
    view.setUint32(tableEnd + 4, 0x40000000, true)
    const parsed = parseMxai(bytes)
    expect(parsed.model).toBe('test-model')
    expect(parsed.tensors.get('weight')?.shape).toEqual([2])
  })
})
