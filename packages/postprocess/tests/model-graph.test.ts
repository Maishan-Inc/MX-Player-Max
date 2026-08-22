import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  PACKED_CONVOLUTION_WGSL,
  PACKED_LAYER_NORM_WGSL,
  PACKED_PIXEL_SHUFFLE_X4_WGSL,
  RIFE_IFBLOCK_WGSL,
  Rt4kSrGraphExecutor,
  createRifeGraph,
  createRt4kSrGraph,
  digestHex,
  graphTensorNames,
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
    // head + 4 NAF blocks (norm, expand, fea, reduce) + tail (same four) + upsample.
    expect(graph.layers.length).toBe(22)
    // `rt4ksr_rep()` sets forget=False, so the high-frequency branch never reaches
    // the output and must not appear in the sequential graph.
    expect(graph.layers.some((layer) => layer.id.startsWith('hfb'))).toBe(false)
    expect(graph.layers.map((layer) => layer.id).slice(0, 5)).toEqual([
      'head', 'body.0-layernorm', 'body.0-expand', 'body.0-fea', 'body.0-reduce',
    ])
    const fea = graph.layers.find((layer) => layer.id === 'body.0-fea')
    expect(fea).toMatchObject({ kernel: 3, padMode: 'constant', padValues: 'module.body.0.conv1.expand_conv.bias', residualFrom: 'expandOut' })
    const reduce = graph.layers.find((layer) => layer.id === 'body.0-reduce')
    expect(reduce).toMatchObject({ kernel: 1, activation: 'gelu', activationAfterResidual: true, residualFrom: 'blockInput' })
    // The tail ResBlock has no trailing activation.
    expect(graph.layers.find((layer) => layer.id === 'tail-reduce')?.activation).toBe('none')
    expect(graph.layers.find((layer) => layer.id === 'head')?.activation).toBe('none')
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

  it('uploads only the tensors the graph binds', async () => {
    const { model } = await loadAsset('../assets/weights/rt4ksr/rt4ksr_x2.mxai')
    const names = graphTensorNames(createRt4kSrGraph(model))
    // 51 checkpoint tensors minus the six `hfb` convolutions and `gamma`, which
    // `forget=False` makes unreachable at inference.
    expect(names.size).toBe(44)
    expect([...names].some((name) => name.includes('.hfb.'))).toBe(false)
    expect(names.has('module.gamma')).toBe(false)
    const device = uploadDevice()
    const store = uploadTensorStore(device, model, names)
    expect(store.tensors.size).toBe(44)
    expect(device.queue.writeBuffer).toHaveBeenCalledTimes(44)
    store.close()
  })

  it('records the whole graph into a single submission', async () => {
    const { model } = await loadAsset('../assets/weights/rt4ksr/rt4ksr_x2.mxai')
    const device = executorDevice()
    const store = uploadTensorStore(device, model, graphTensorNames(createRt4kSrGraph(model)))
    const executor = Rt4kSrGraphExecutor.create({ device, model, tensorStore: store })
    const frame = await executor.process({ createView: () => ({}) } as unknown as GPUTexture, 8, 8, 0, 0)
    expect(frame.location).toBe('gpu')
    if (frame.location === 'gpu') frame.release()
    // Input pack, unshuffle, 22 graph layers and the output shuffle.
    expect(device.passes()).toBe(25)
    expect(device.createCommandEncoder).toHaveBeenCalledOnce()
    expect(device.queue.submit).toHaveBeenCalledOnce()
    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledOnce()
    executor.close()
    store.close()
  })
})

function uploadDevice(): GPUDevice & { queue: { writeBuffer: ReturnType<typeof vi.fn> } } {
  return {
    queue: { writeBuffer: vi.fn() },
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
  } as unknown as GPUDevice & { queue: { writeBuffer: ReturnType<typeof vi.fn> } }
}

interface ExecutorDevice extends GPUDevice {
  passes(): number
  createCommandEncoder: ReturnType<typeof vi.fn>
  queue: GPUQueue & { submit: ReturnType<typeof vi.fn>; onSubmittedWorkDone: ReturnType<typeof vi.fn> }
}

function executorDevice(): ExecutorDevice {
  let passes = 0
  const device = {
    passes: () => passes,
    queue: {
      writeBuffer: vi.fn(),
      submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(async () => undefined),
    },
    createShaderModule: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createBindGroup: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => {
        passes += 1
        return { setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn() }
      }),
      finish: vi.fn(() => ({})),
    })),
  }
  return device as unknown as ExecutorDevice
}
