import type { MxaiElementType, MxaiModel, MxaiTensor } from '../assets/mxai'

/** Border handling for a convolution, matching what the upstream layer does. */
export type GpuPadMode = 'zero' | 'clamp' | 'constant'

/** Named slots the executor keeps alive so a later layer can add them back. */
export type GpuGraphSlot = 'blockInput' | 'expandOut'

/** A bounded inference layer understood by the fixed WGSL graph executor. */
export interface GpuGraphLayer {
  readonly id: string
  readonly kind: 'conv' | 'layernorm'
  readonly weight: string
  readonly bias?: string
  readonly inputChannels: number
  readonly outputChannels: number
  readonly kernel: number
  readonly stride: number
  readonly activation: 'none' | 'relu' | 'leaky-relu' | 'gelu'
  /** Negative slope for `leaky-relu`. RT4KSR's `lrelu` is 0.05, RIFE uses 0.2. */
  readonly leakySlope?: number
  readonly padMode: GpuPadMode
  /** Tensor supplying the per-channel border value when {@link padMode} is `constant`. */
  readonly padValues?: string
  /** Capture this layer's input, before it runs, into a slot. */
  readonly saveInput?: GpuGraphSlot
  /** Capture this layer's output into a slot. */
  readonly saveOutput?: GpuGraphSlot
  /** Add a previously captured slot to this layer's result. */
  readonly residualFrom?: GpuGraphSlot
  /** Apply {@link activation} after the residual add rather than before it. */
  readonly activationAfterResidual?: boolean
}

export interface GpuModelGraph {
  readonly model: string
  readonly layers: readonly GpuGraphLayer[]
  readonly outputScale: 1 | 2
  readonly tensorNames: readonly string[]
}

export interface GpuTensorBuffer {
  readonly name: string
  readonly buffer: GPUBuffer
  readonly byteLength: number
  readonly elementType: MxaiElementType
  readonly shape: readonly number[]
}

export interface GpuTensorStore {
  readonly model: MxaiModel
  readonly tensors: ReadonlyMap<string, GpuTensorBuffer>
  close(): void
}

/**
 * Build the RT4KSR inference graph exactly as `RT4KSR_Rep.forward` executes it
 * (upstream commit fd6627a4, `code/model/arch.py` + `code/model/modules.py`).
 *
 * `rt4ksr_rep()` hardcodes `forget=False`, so the gaussian high-frequency branch,
 * `hfb` and `gamma` never reach the output and are deliberately absent here. The
 * live chain is PixelUnshuffle(2) -> head -> 4 NAF blocks -> tail -> upsample ->
 * PixelShuffle(4); the two shuffles are run by the executor around this list.
 */
export function createRt4kSrGraph(model: MxaiModel): GpuModelGraph {
  if (model.model !== 'rt4ksr-x2') throw new Error(`Expected rt4ksr-x2 MXAI, received ${model.model}`)
  const tensors = model.tensors
  const layers: GpuGraphLayer[] = []
  // head: Conv2d(12, F, 3, padding=1), no activation.
  layers.push(conv(tensors, 'head.0', 'head', { kernel: 3, padMode: 'zero' }))
  for (let block = 0; block < 4; block += 1) layers.push(...naf(tensors, `body.${block}`, `body.${block}`, 'gelu'))
  // tail: Sequential(LayerNorm2d, ResBlock) with no trailing activation.
  layers.push(...naf(tensors, 'tail', 'tail', 'none', 'tail.0', 'tail.1'))
  // upsample: Conv2d(F, 3 * (2 * scale)^2, 3, padding=1) then PixelShuffle(4).
  layers.push(conv(tensors, 'upsample.0', 'upsample', { kernel: 3, padMode: 'zero' }))
  return { model: model.model, layers, outputScale: 2, tensorNames: [...tensors.keys()] }
}

/**
 * SimplifiedNAFBlock: LayerNorm2d -> ResBlock -> activation, with the block-level
 * residual disabled (`residual=False`). ResBlock itself is
 * `expand 1x1 -> border-pad with the expand bias -> fea 3x3 padding=0 + pre-pad
 * identity -> reduce 1x1 -> += block input`, and carries no internal activation.
 */
function naf(
  tensors: ReadonlyMap<string, MxaiTensor>,
  prefix: string,
  id: string,
  activation: GpuGraphLayer['activation'],
  normPrefix = `${prefix}.norm`,
  resPrefix = `${prefix}.conv1`,
): GpuGraphLayer[] {
  const norm = requireTensor(tensors, `module.${normPrefix}.weight`)
  const expand = `${resPrefix}.expand_conv`
  return [
    {
      id: `${id}-layernorm`,
      kind: 'layernorm',
      weight: norm.name,
      bias: requireTensor(tensors, `module.${normPrefix}.bias`).name,
      inputChannels: norm.shape[0] ?? 1,
      outputChannels: norm.shape[0] ?? 1,
      kernel: 1,
      stride: 1,
      activation: 'none',
      padMode: 'zero',
    },
    conv(tensors, expand, `${id}-expand`, { kernel: 1, padMode: 'zero', saveInput: 'blockInput', saveOutput: 'expandOut' }),
    conv(tensors, `${resPrefix}.fea_conv`, `${id}-fea`, { kernel: 3, padMode: 'constant', padValues: `module.${expand}.bias`, residualFrom: 'expandOut' }),
    conv(tensors, `${resPrefix}.reduce_conv`, `${id}-reduce`, {
      kernel: 1,
      padMode: 'zero',
      residualFrom: 'blockInput',
      ...(activation === 'none' ? {} : { activation, activationAfterResidual: true }),
    }),
  ]
}

interface ConvOptions {
  readonly kernel: number
  readonly padMode: GpuPadMode
  readonly padValues?: string
  readonly activation?: GpuGraphLayer['activation']
  readonly activationAfterResidual?: boolean
  readonly saveInput?: GpuGraphSlot
  readonly saveOutput?: GpuGraphSlot
  readonly residualFrom?: GpuGraphSlot
  readonly stride?: number
}

function conv(tensors: ReadonlyMap<string, MxaiTensor>, prefix: string, id: string, options: ConvOptions): GpuGraphLayer {
  const tensor = requireTensor(tensors, `module.${prefix}.weight`)
  if (tensor.shape.length !== 4) throw new Error(`RT4KSR tensor ${tensor.name} is not a 4D convolution weight`)
  if ((tensor.shape[2] ?? 0) !== options.kernel) throw new Error(`RT4KSR tensor ${tensor.name} has kernel ${tensor.shape[2]}, expected ${options.kernel}`)
  const biasName = `module.${prefix}.bias`
  return {
    id,
    kind: 'conv',
    weight: tensor.name,
    ...(tensors.has(biasName) ? { bias: biasName } : {}),
    inputChannels: tensor.shape[1] ?? 1,
    outputChannels: tensor.shape[0] ?? 1,
    kernel: options.kernel,
    stride: options.stride ?? 1,
    activation: options.activation ?? 'none',
    padMode: options.padMode,
    ...(options.padValues === undefined ? {} : { padValues: options.padValues }),
    ...(options.saveInput === undefined ? {} : { saveInput: options.saveInput }),
    ...(options.saveOutput === undefined ? {} : { saveOutput: options.saveOutput }),
    ...(options.residualFrom === undefined ? {} : { residualFrom: options.residualFrom }),
    ...(options.activationAfterResidual === true ? { activationAfterResidual: true } : {}),
  }
}

function requireTensor(tensors: ReadonlyMap<string, MxaiTensor>, name: string): MxaiTensor {
  const tensor = tensors.get(name)
  if (!tensor) throw new Error(`RT4KSR graph tensor is missing: ${name}`)
  return tensor
}

/**
 * RIFE 4.25's inference graph consists of the shared encoder and five
 * coarse-to-fine IFBlocks. Teacher/caltime tensors are intentionally omitted:
 * they are present in the upstream training archive but are not reachable
 * from `Model.inference`.
 */
export function createRifeGraph(model: MxaiModel): GpuModelGraph {
  if (model.model !== 'rife-v4.25' && model.model !== 'rife-v4.6') throw new Error(`Expected RIFE MXAI, received ${model.model}`)
  const tensors = model.tensors
  const layers: GpuGraphLayer[] = []
  discover(layers, tensors, 'encode.cnn0', 'encode-cnn0', 'leaky-relu')
  discover(layers, tensors, 'encode.cnn1', 'encode-cnn1', 'leaky-relu')
  discover(layers, tensors, 'encode.cnn2', 'encode-cnn2', 'leaky-relu')
  discover(layers, tensors, 'encode.cnn3', 'encode-cnn3', 'none', undefined, 2)
  for (let block = 0; block < 5; block += 1) {
    const prefix = `block${block}`
    discover(layers, tensors, `${prefix}.conv0.0.0`, `${prefix}-down0`, 'leaky-relu', undefined, 2)
    discover(layers, tensors, `${prefix}.conv0.1.0`, `${prefix}-down1`, 'leaky-relu', undefined, 2)
    for (let residual = 0; residual < 8; residual += 1) {
      discover(layers, tensors, `${prefix}.convblock.${residual}.conv`, `${prefix}-res${residual}`, 'leaky-relu', 'blockInput')
    }
    discover(layers, tensors, `${prefix}.lastconv.0`, `${prefix}-head`, 'none', undefined, 2)
  }
  return { model: model.model, layers, outputScale: 1, tensorNames: [...tensors.keys()] }
}

/** Every tensor the executor will bind while running `graph`, in no particular order. */
export function graphTensorNames(graph: GpuModelGraph): ReadonlySet<string> {
  const names = new Set<string>()
  for (const layer of graph.layers) {
    names.add(layer.weight)
    if (layer.bias !== undefined) names.add(layer.bias)
    if (layer.padValues !== undefined) names.add(layer.padValues)
  }
  return names
}

/**
 * Upload verified MXAI tensors exactly once for a stage lifetime.
 *
 * `names` restricts the upload to the tensors a graph actually binds. RT4KSR's
 * checkpoint carries the `hfb` block and `gamma`, which `forget=False` makes
 * unreachable, so filtering keeps them out of GPU memory entirely.
 */
export function uploadTensorStore(device: GPUDevice, model: MxaiModel, names?: ReadonlySet<string>): GpuTensorStore {
  const usage = bufferUsage()
  const tensors = new Map<string, GpuTensorBuffer>()
  try {
    for (const tensor of model.tensors.values()) {
      if (names && !names.has(tensor.name)) continue
      const bytes = tensor.elementType === 'f32' ? tensor.data : toFloat32Bytes(tensor)
      const size = Math.max(4, align4(bytes.byteLength))
      const buffer = device.createBuffer({ size, usage })
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      device.queue.writeBuffer(buffer, 0, copy)
      tensors.set(tensor.name, { name: tensor.name, buffer, byteLength: bytes.byteLength, elementType: tensor.elementType, shape: tensor.shape })
    }
  } catch (error) {
    for (const tensor of tensors.values()) destroyBuffer(tensor.buffer)
    throw error
  }
  return {
    model,
    tensors,
    close() {
      for (const tensor of tensors.values()) destroyBuffer(tensor.buffer)
      tensors.clear()
    },
  }
}

/**
 * Tensor-name driven layer discovery, used only by {@link createRifeGraph}. RIFE's
 * activations, padding and flow feedback are not verified against upstream and no
 * executor consumes this list yet, so a missing tensor is skipped rather than
 * treated as an error.
 */
function discover(
  layers: GpuGraphLayer[],
  tensors: ReadonlyMap<string, MxaiTensor>,
  prefix: string,
  id: string,
  activation: GpuGraphLayer['activation'],
  residualFrom?: GpuGraphSlot,
  stride = 1,
): void {
  const tensor = tensors.get(`module.${prefix}.weight`) ?? tensors.get(prefix) ?? null
  if (!tensor || tensor.shape.length !== 4) return
  const biasName = `module.${prefix}.bias`
  layers.push({
    id,
    kind: 'conv',
    weight: tensor.name,
    ...(tensors.has(biasName) ? { bias: biasName } : {}),
    inputChannels: tensor.shape[1] ?? 1,
    outputChannels: tensor.shape[0] ?? 1,
    kernel: tensor.shape[2] ?? 1,
    stride,
    activation,
    padMode: 'zero',
    ...(residualFrom === undefined ? {} : { residualFrom }),
  })
}

function toFloat32Bytes(tensor: MxaiTensor): Uint8Array {
  if (tensor.elementType === 'u32') return tensor.data.slice()
  const source = new DataView(tensor.data.buffer, tensor.data.byteOffset, tensor.data.byteLength)
  const output = new Uint8Array(tensor.shape.reduce((product, value) => product * value, 1) * 4)
  const target = new DataView(output.buffer)
  for (let index = 0; index < output.byteLength / 4; index += 1) target.setFloat32(index * 4, halfToFloat(source.getUint16(index * 2, true)), true)
  return output
}

function halfToFloat(value: number): number {
  const sign = (value & 0x8000) << 16
  const exponent = (value >>> 10) & 0x1f
  const fraction = value & 0x3ff
  if (exponent === 0) return (sign ? -1 : 1) * 2 ** -14 * (fraction / 1024)
  if (exponent === 31) return fraction === 0 ? (sign ? -Infinity : Infinity) : NaN
  return new DataView(new Uint32Array([sign | ((exponent + 112) << 23) | (fraction << 13)]).buffer).getFloat32(0, true)
}

function align4(value: number): number { return (value + 3) & ~3 }

function bufferUsage(): GPUBufferUsageFlags {
  const usage = (globalThis as typeof globalThis & { GPUBufferUsage?: Record<string, number> }).GPUBufferUsage
  return (usage?.STORAGE ?? 0x80) | (usage?.COPY_DST ?? 0x08)
}

function destroyBuffer(buffer: GPUBuffer): void {
  try { buffer.destroy() } catch { /* best effort */ }
}
