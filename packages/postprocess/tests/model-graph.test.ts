import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  PACKED_CONVOLUTION_WGSL,
  PACKED_LAYER_NORM_WGSL,
  PACKED_PIXEL_SHUFFLE_X4_WGSL,
  RIFE_IFBLOCK_WGSL,
  createRifeGraph,
  createRt4kSrGraph,
  digestHex,
  parseMxai,
  uploadTensorStore,
} from '../src/index'

async function loadAsset(relative: string) {
  const bytes = new Uint8Array(await readFile(new URL(relative, import.meta.url)))
  return { bytes, model: parseMxai(bytes) }
}

describe('real MXAI model graphs', () => {
  it('parses and hashes the checked-in RT4KSR inference tensors', async () => {
    const { bytes, model } = await loadAsset('../assets/weights/rt4ksr/rt4ksr_x2.mxai')
    expect(await digestHex(bytes)).toBe('c34a7654fe40f34f6ee0ba47c9c3bea504b18a7c9c045261bfd4733f2662fba0')
    expect(model.model).toBe('rt4ksr-x2')
    expect(model.tensors.size).toBe(51)
    expect(model.tensors.get('module.head.0.weight')?.shape).toEqual([24, 12, 3, 3])
    const graph = createRt4kSrGraph(model)
    expect(graph.layers.at(-1)?.id).toBe('upsample')
    expect(graph.layers.length).toBe(25)
  })

  it('parses and hashes the checked-in RIFE 4.25 tensors', async () => {
    const { bytes, model } = await loadAsset('../assets/weights/rife/rife_v4.25.mxai')
    expect(await digestHex(bytes)).toBe('665472509a3c9b50d9436d07e85754b8f1c4bb27ab48a3e531a6ebaec5bac56c')
    expect(model.model).toBe('rife-v4.25')
    expect(model.tensors.size).toBe(198)
    expect(model.tensors.get('module.block0.conv0.0.0.weight')?.shape).toEqual([96, 15, 3, 3])
    const graph = createRifeGraph(model)
    expect(graph.layers).toHaveLength(59)
    expect(graph.layers.some((layer) => layer.id === 'block4-head')).toBe(true)
  })

  it('uploads every tensor once and destroys all buffers on close', async () => {
    const { model } = await loadAsset('../assets/weights/rt4ksr/rt4ksr_x2.mxai')
    const buffers: Array<{ destroy: ReturnType<typeof vi.fn> }> = []
    const device = {
      queue: { writeBuffer: vi.fn() },
      createBuffer: vi.fn(() => {
        const buffer = { destroy: vi.fn() }
        buffers.push(buffer)
        return buffer
      }),
    } as unknown as GPUDevice
    const store = uploadTensorStore(device, model)
    expect(store.tensors.size).toBe(51)
    expect(device.queue.writeBuffer).toHaveBeenCalledTimes(51)
    store.close()
    expect(buffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true)
  })

  it('ships full-channel WGSL rather than four-channel-only convolution', () => {
    expect(PACKED_CONVOLUTION_WGSL).toContain('params.inputChannels')
    expect(PACKED_CONVOLUTION_WGSL).toContain('weights[index(')
    expect(PACKED_LAYER_NORM_WGSL).toContain('variance')
    expect(PACKED_PIXEL_SHUFFLE_X4_WGSL).toContain('params.scale')
    expect(RIFE_IFBLOCK_WGSL).toContain('exp(-textureLoad(mask')
  })
})
