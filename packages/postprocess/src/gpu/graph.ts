import type { MxaiElementType, MxaiModel, MxaiTensor } from '../assets/mxai'

/** A bounded inference layer understood by the fixed WGSL graph executor. */
export interface GpuGraphLayer {
  readonly id: string
  readonly weight: string
  readonly bias?: string
  readonly inputChannels: number
  readonly outputChannels: number
  readonly kernel: number
  readonly stride: number
  readonly activation: 'none' | 'relu' | 'leaky-relu'
  readonly residual?: boolean
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
 * Build the deploy-time RT4KSR graph from the exact tensor names in the
 * checkpoint. The checkpoint is already the re-parameterised inference model;
 * no training-only branches are invented here.
 */
export function createRt4kSrGraph(model: MxaiModel): GpuModelGraph {
  if (model.model !== 'rt4ksr-x2') throw new Error(`Expected rt4ksr-x2 MXAI, received ${model.model}`)
  const tensors = model.tensors
  const layers: GpuGraphLayer[] = []
  addConv(layers, tensors, 'head.0', 'head')
  addConv(layers, tensors, 'hfb.0.expand_conv', 'hfb-expand')
  addConv(layers, tensors, 'hfb.0.fea_conv', 'hfb-fea')
  addConv(layers, tensors, 'hfb.0.reduce_conv', 'hfb-reduce', true)
  for (let block = 0; block < 4; block += 1) {
    const prefix = `body.${block}`
    addNormMarker(layers, tensors, prefix)
    addConv(layers, tensors, `${prefix}.conv1.expand_conv`, `${prefix}-expand`)
    addConv(layers, tensors, `${prefix}.conv1.fea_conv`, `${prefix}-fea`)
    addConv(layers, tensors, `${prefix}.conv1.reduce_conv`, `${prefix}-reduce`, true)
  }
  addNormMarker(layers, tensors, 'tail.0')
  addConv(layers, tensors, 'tail.1.expand_conv', 'tail-expand')
  addConv(layers, tensors, 'tail.1.fea_conv', 'tail-fea')
  addConv(layers, tensors, 'tail.1.reduce_conv', 'tail-reduce', true)
  addConv(layers, tensors, 'upsample.0', 'upsample', 'none')
  return {
    model: model.model,
    layers,
    outputScale: 2,
    tensorNames: [...tensors.keys()],
  }
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
  addConv(layers, tensors, 'encode.cnn0', 'encode-cnn0', 'leaky-relu')
  addConv(layers, tensors, 'encode.cnn1', 'encode-cnn1', 'leaky-relu')
  addConv(layers, tensors, 'encode.cnn2', 'encode-cnn2', 'leaky-relu')
  addConv(layers, tensors, 'encode.cnn3', 'encode-cnn3', 'none', false, 2)
  for (let block = 0; block < 5; block += 1) {
    const prefix = `block${block}`
    addConv(layers, tensors, `${prefix}.conv0.0.0`, `${prefix}-down0`, 'leaky-relu', false, 2)
    addConv(layers, tensors, `${prefix}.conv0.1.0`, `${prefix}-down1`, 'leaky-relu', false, 2)
    for (let residual = 0; residual < 8; residual += 1) {
      addConv(layers, tensors, `${prefix}.convblock.${residual}.conv`, `${prefix}-res${residual}`, 'leaky-relu', true)
    }
    addConv(layers, tensors, `${prefix}.lastconv.0`, `${prefix}-head`, 'none', false, 2)
  }
  return { model: model.model, layers, outputScale: 1, tensorNames: [...tensors.keys()] }
}

/** Upload verified MXAI tensors exactly once for a stage lifetime. */
export function uploadTensorStore(device: GPUDevice, model: MxaiModel): GpuTensorStore {
  const usage = bufferUsage()
  const tensors = new Map<string, GpuTensorBuffer>()
  try {
    for (const tensor of model.tensors.values()) {
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

function addConv(
  layers: GpuGraphLayer[],
  tensors: ReadonlyMap<string, MxaiTensor>,
  prefix: string,
  id: string,
  activation: 'none' | 'relu' | 'leaky-relu' | boolean = 'leaky-relu',
  residual = false,
  stride = 1,
): void {
  const weightName = `module.${prefix}.weight`
  const tensor = tensors.get(weightName) ?? tensors.get(prefix) ?? null
  if (!tensor || tensor.shape.length !== 4) return
  const biasName = `module.${prefix}.bias`
  const bias = tensors.has(biasName) ? biasName : undefined
  const value = typeof activation === 'boolean' ? 'leaky-relu' : activation
  layers.push({
    id,
    weight: tensor.name,
    ...(bias === undefined ? {} : { bias }),
    inputChannels: tensor.shape[1] ?? 1,
    outputChannels: tensor.shape[0] ?? 1,
    kernel: tensor.shape[2] ?? 1,
    stride,
    activation: value,
    ...(residual || activation === true ? { residual: true } : {}),
  })
}

function addNormMarker(layers: GpuGraphLayer[], tensors: ReadonlyMap<string, MxaiTensor>, prefix: string): void {
  const directWeight = tensors.get(`module.${prefix}.weight`)
  const directBias = tensors.get(`module.${prefix}.bias`)
  const weight = directWeight ?? tensors.get(`module.${prefix}.norm.weight`)
  const bias = directBias ?? tensors.get(`module.${prefix}.norm.bias`)
  if (!weight || !bias) return
  // A 1x1 identity convolution is the graph marker for the dedicated
  // LayerNorm pass. The executor uses the named tensors for its parameters.
  layers.push({ id: `${prefix}-layernorm`, weight: weight.name, bias: bias.name, inputChannels: weight.shape[0] ?? 1, outputChannels: weight.shape[0] ?? 1, kernel: 1, stride: 1, activation: 'none' })
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
