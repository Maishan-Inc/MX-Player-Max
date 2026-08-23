import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  PACKED_CONVOLUTION_WGSL,
  PACKED_GATHER_WGSL,
  PACKED_LAYER_NORM_WGSL,
  PACKED_PIXEL_SHUFFLE_X4_WGSL,
  RifeGraphExecutor,
  Rt4kSrGraphExecutor,
  createRifeGraph,
  createRt4kSrGraph,
  digestHex,
  graphTensorNames,
  nodeGraphInputs,
  parseMxai,
  uploadTensorStore,
  validateNodeGraph,
  withPackedActivationFormat,
  type GpuConvNode,
  type GpuGraphNode,
  type GpuNodeGraph,
} from '../src/index'

async function loadAsset(relative: string) {
  const bytes = new Uint8Array(await readFile(new URL(relative, import.meta.url)))
  return { bytes, model: parseMxai(bytes) }
}

const node = (graph: GpuNodeGraph, id: string): GpuGraphNode => {
  const found = graph.nodes.find((entry) => entry.id === id)
  if (!found) throw new Error(`graph has no node ${id}`)
  return found
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
    expect(graph.output).toBe('output')
    expect(node(graph, 'output').kind).toBe('blend')
    // block0 takes cat(img0, img1, f0, f1, timestep); later blocks add flow inside IFBlock.
    expect(node(graph, 'block0.x')).toMatchObject({ kind: 'gather', channels: 15, divisor: 16 })
    expect(node(graph, 'block4.x')).toMatchObject({ kind: 'gather', channels: 28, divisor: 1 })
    // Blocks 1..4 add their delta to the running flow; block 0 has nothing to add to.
    expect(graph.nodes.filter((entry) => entry.kind === 'add')).toHaveLength(4)
    expect(node(graph, 'block0.flow').kind).toBe('resize')
    expect(node(graph, 'block0.flow.low')).toMatchObject({ kind: 'gather', channels: 4, divisor: 16 })
    expect(node(graph, 'block4.flow').kind).toBe('add')
    // At scale 1 the upsample is the identity, so block 4 slices straight to full size.
    expect(node(graph, 'block4.mask')).toMatchObject({ kind: 'gather', divisor: 1 })
    // conv0 halves twice from 1/scale, so block 0's body runs at 1/64.
    expect(node(graph, 'block0.down1').divisor).toBe(64)
    expect(node(graph, 'block4.down1').divisor).toBe(4)
    expect(graph.sizeMultiple).toBe(64)
  })

  it('folds every ResConv beta into its convolution instead of uploading it', async () => {
    const { model } = await loadAsset('../assets/weights/rife/rife_v4.25.mxai')
    const graph = createRifeGraph(model)
    // 40 ResConvs across five blocks, each contributing a folded weight and bias.
    expect(graph.derivedTensors.size).toBe(80)
    expect([...graph.tensorNames].some((name) => name.endsWith('.beta'))).toBe(false)
    expect(graph.tensorNames).toHaveLength(118)

    const prefix = 'module.block4.convblock.0'
    const residual = node(graph, 'block4.res0') as GpuConvNode
    expect(residual.weight).toBe(`${prefix}.conv.weight*beta`)
    expect(residual.residual).toBe(residual.input)
    const folded = graph.derivedTensors.get(residual.weight)
    const source = model.tensors.get(`${prefix}.conv.weight`)
    const beta = model.tensors.get(`${prefix}.beta`)
    if (!folded || !source || !beta) throw new Error('the fold did not register its tensors')
    const foldedValues = new Float32Array(folded.data.buffer, folded.data.byteOffset, folded.data.byteLength / 4)
    const sourceValues = new Float32Array(source.data.buffer, source.data.byteOffset, source.data.byteLength / 4)
    const betaValues = new Float32Array(beta.data.buffer, beta.data.byteOffset, beta.data.byteLength / 4)
    const perOutput = sourceValues.length / 32
    for (const output of [0, 7, 31]) {
      for (const offset of [0, 5, perOutput - 1]) {
        // The fold is stored as f32, so compare against the f32-rounded product.
        expect(foldedValues[output * perOutput + offset]).toBe(Math.fround((sourceValues[output * perOutput + offset] ?? 0) * (betaValues[output] ?? 0)))
      }
    }
  })

  it('rejects a node graph whose channels or resolutions disagree', async () => {
    const { model } = await loadAsset('../assets/weights/rife/rife_v4.25.mxai')
    const graph = createRifeGraph(model)
    const rewrite = (id: string, patch: Record<string, unknown>): GpuNodeGraph => ({
      ...graph,
      nodes: graph.nodes.map((entry) => (entry.id === id ? { ...entry, ...patch } as GpuGraphNode : entry)),
    })
    expect(() => validateNodeGraph(rewrite('block0.x', { channels: 14 }))).toThrow(/gathers 15 channels into 14/)
    expect(() => validateNodeGraph(rewrite('block0.down0', { stride: 1 }))).toThrow(/does not reach/)
    expect(() => validateNodeGraph(rewrite('block0.shuffle', { factor: 4 }))).toThrow(/factor 4/)
    expect(() => validateNodeGraph(rewrite('img1', { id: 'img0' }))).toThrow(/duplicate id/)
    expect(() => validateNodeGraph(rewrite('block4.warped0', { flowChannel: 3 }))).toThrow(/flow channels 3\.\.4/)
    // Every node's inputs must already exist, which is what lets the executor stream.
    for (const entry of graph.nodes) expect(nodeGraphInputs(entry).every((input) => graph.nodes.some((other) => other.id === input))).toBe(true)
  })

  it('retargets packed activation storage without touching the frame output', () => {
    expect(withPackedActivationFormat(PACKED_CONVOLUTION_WGSL, 'rgba32float')).toContain('texture_storage_2d_array<rgba32float, write>')
    expect(withPackedActivationFormat(PACKED_CONVOLUTION_WGSL, 'rgba16float')).toBe(PACKED_CONVOLUTION_WGSL)
    expect(withPackedActivationFormat(PACKED_CONVOLUTION_WGSL, 'rgba32float')).not.toContain('rgba16float')
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
    // A packed storage texture is written a whole texel at a time, so a concat of
    // parts that are not multiples of four channels has to gather, not scatter.
    expect(PACKED_GATHER_WGSL).toContain('array<GatherSlot, 8>')
    expect(PACKED_GATHER_WGSL).toContain('entry.sourceOffset + channel - base')
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

  it('records the whole RIFE graph into a single submission and crops the output', async () => {
    const { model } = await loadAsset('../assets/weights/rife/rife_v4.25.mxai')
    const device = executorDevice()
    const graph = createRifeGraph(model)
    const store = uploadTensorStore(device, model, new Set(graph.tensorNames), graph.derivedTensors)
    const executor = RifeGraphExecutor.create({ device, model, tensorStore: store, graph })
    const source = { createView: () => ({}) } as unknown as GPUTexture
    // 100x50 pads to 128x64: IFNet needs a multiple of 64 in both axes.
    expect(executor.paddedSize(100, 50)).toEqual({ width: 128, height: 64 })
    expect(executor.paddedSize(1920, 1080)).toEqual({ width: 1920, height: 1088 })
    const result = await executor.process({ source0: source, source1: source, width: 100, height: 50, timestep: 0.5, timestamp: 1_000 })
    expect(result.frame.location).toBe('gpu')
    if (result.frame.location === 'gpu') {
      // The frame is cropped back to the source size, not the padded one.
      expect([result.frame.width, result.frame.height]).toEqual([100, 50])
      result.frame.release()
    }
    expect(result.retained.size).toBe(0)
    expect(device.passes()).toBe(graph.nodes.length)
    expect(device.createCommandEncoder).toHaveBeenCalledOnce()
    expect(device.queue.submit).toHaveBeenCalledOnce()
    expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledOnce()
    // The blend is the final pass and runs over the unpadded frame.
    expect(device.dispatches().at(-1)).toEqual([Math.ceil(100 / 8), Math.ceil(50 / 8), 1])
    // Every uniform block lands in its own aligned slot before the single submit.
    const offsets = device.queue.writeBuffer.mock.calls.filter((call) => call[0] === device.uniformBuffer()).map((call) => call[1])
    expect(new Set(offsets).size).toBe(offsets.length)
    expect(offsets.every((offset) => offset % 256 === 0)).toBe(true)
    executor.close()
    store.close()
  })

  it('retains named IFNet stages for the oracle and releases everything else', async () => {
    const { model } = await loadAsset('../assets/weights/rife/rife_v4.25.mxai')
    const device = executorDevice()
    const graph = createRifeGraph(model)
    const store = uploadTensorStore(device, model, new Set(graph.tensorNames), graph.derivedTensors)
    const executor = RifeGraphExecutor.create({ device, model, tensorStore: store, graph, activationFormat: 'rgba16float' })
    expect(executor.activationFormat).toBe('rgba16float')
    const source = { createView: () => ({}) } as unknown as GPUTexture
    const result = await executor.process({ source0: source, source1: source, width: 64, height: 64, timestep: 0.5, timestamp: 0, retain: ['block2.flow', 'encode.f0'] })
    expect([...result.retained.keys()].sort()).toEqual(['block2.flow', 'encode.f0'])
    for (const texture of result.retained.values()) texture.release()
    if (result.frame.location === 'gpu') result.frame.release()
    await expect(executor.process({ source0: source, source1: source, width: 64, height: 64, timestep: 0.5, timestamp: 0, retain: ['nope'] }))
      .rejects.toThrow('RIFE graph has no node nope')
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
  dispatches(): Array<[number, number, number]>
  uniformBuffer(): unknown
  createCommandEncoder: ReturnType<typeof vi.fn>
  queue: GPUQueue & { submit: ReturnType<typeof vi.fn>; onSubmittedWorkDone: ReturnType<typeof vi.fn>; writeBuffer: ReturnType<typeof vi.fn> }
}

function executorDevice(): ExecutorDevice {
  let passes = 0
  const dispatches: Array<[number, number, number]> = []
  const buffers: unknown[] = []
  const device = {
    passes: () => passes,
    dispatches: () => dispatches,
    // The graph executors allocate their single uniform buffer last, after every
    // tensor buffer, so it is the newest one when the first pass is recorded.
    uniformBuffer: () => buffers.at(-2),
    queue: {
      writeBuffer: vi.fn(),
      submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(async () => undefined),
    },
    createShaderModule: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createBindGroup: vi.fn(() => ({})),
    createBuffer: vi.fn(() => {
      const buffer = { destroy: vi.fn() }
      buffers.push(buffer)
      return buffer
    }),
    createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => {
        passes += 1
        return {
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          dispatchWorkgroups: vi.fn((x: number, y: number, z: number) => { dispatches.push([x, y, z]) }),
          end: vi.fn(),
        }
      }),
      finish: vi.fn(() => ({})),
    })),
  }
  return device as unknown as ExecutorDevice
}
