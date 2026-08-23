import type { MxaiElementType, MxaiModel, MxaiTensor } from '../assets/mxai'

/** Border handling for a convolution, matching what the upstream layer does. */
export type GpuPadMode = 'zero' | 'clamp' | 'constant'

/** Named slots the executor keeps alive so a later layer can add them back. */
export type GpuGraphSlot = 'blockInput' | 'expandOut'

export type GpuActivation = 'none' | 'relu' | 'leaky-relu' | 'gelu'

/**
 * A bounded inference layer understood by the fixed WGSL graph executor.
 *
 * This is the RT4KSR shape: a single-input linear chain with named slots for the
 * two residual joins its ResBlocks need. IFNet cannot be expressed this way — see
 * {@link GpuGraphNode} for the DAG the RIFE executor interprets.
 */
export interface GpuGraphLayer {
  readonly id: string
  readonly kind: 'conv' | 'layernorm'
  readonly weight: string
  readonly bias?: string
  readonly inputChannels: number
  readonly outputChannels: number
  readonly kernel: number
  readonly stride: number
  readonly activation: GpuActivation
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

/**
 * Shared shape of every node in the packed-tensor DAG.
 *
 * Sizes are symbolic: a node's output is `(frameWidth / divisor, frameHeight /
 * divisor)`. Every resolution IFNet visits is the padded frame size divided by a
 * power of two up to 64 — block 0 runs at 1/16 and `conv0` halves twice — so one
 * divisor per node is enough to infer the whole graph from the frame size, and no
 * node has to be rebuilt when the resolution changes.
 */
interface GpuNodeBase {
  readonly id: string
  /** Channel count of this node's output. */
  readonly channels: number
  readonly divisor: number
}

/** Pack one of the two source frames into a packed tensor, zero-padding the border. */
export interface GpuInputNode extends GpuNodeBase { readonly kind: 'input'; readonly source: 0 | 1 }

/** A constant plane. `'timestep'` is substituted with the synthesis phase at run time. */
export interface GpuFillNode extends GpuNodeBase { readonly kind: 'fill'; readonly value: number | 'timestep' }

export interface GpuConvNode extends GpuNodeBase {
  readonly kind: 'conv'
  readonly input: string
  readonly weight: string
  readonly bias: string
  readonly inputChannels: number
  readonly kernel: number
  readonly stride: number
  readonly activation: GpuActivation
  readonly leakySlope?: number
  /** Added before the activation. `ResConv`'s identity path, after beta folding. */
  readonly residual?: string
}

export interface GpuTransposedConvNode extends GpuNodeBase {
  readonly kind: 'transposed-conv'
  readonly input: string
  readonly weight: string
  readonly bias: string
  readonly inputChannels: number
  readonly kernel: number
  readonly stride: number
  readonly pad: number
  readonly activation: GpuActivation
  readonly leakySlope?: number
}

export interface GpuPixelShuffleNode extends GpuNodeBase { readonly kind: 'pixel-shuffle'; readonly input: string; readonly factor: number }

/** `F.interpolate(mode="bilinear", align_corners=False)`, with an optional value scale. */
export interface GpuResizeNode extends GpuNodeBase { readonly kind: 'resize'; readonly input: string; readonly valueScale: number }

/** Backward warp by two channels of `flow`, starting at `flowChannel`. */
export interface GpuWarpNode extends GpuNodeBase { readonly kind: 'warp'; readonly input: string; readonly flow: string; readonly flowChannel: number }

/** One contiguous channel range copied out of `source` into a gather's output. */
export interface GpuGatherSlot {
  readonly source: string
  readonly sourceOffset: number
  readonly channels: number
  readonly valueScale: number
}

/** Concatenation, channel slicing and per-slice scaling. At most eight slots. */
export interface GpuGatherNode extends GpuNodeBase { readonly kind: 'gather'; readonly slots: readonly GpuGatherSlot[] }

export interface GpuAddNode extends GpuNodeBase { readonly kind: 'add'; readonly left: string; readonly right: string }

/** `sigmoid(mask) * first + (1 - sigmoid(mask)) * second`, cropped to the frame size. */
export interface GpuBlendNode extends GpuNodeBase {
  readonly kind: 'blend'
  readonly first: string
  readonly second: string
  readonly mask: string
  readonly maskChannel: number
}

export type GpuGraphNode =
  | GpuInputNode
  | GpuFillNode
  | GpuConvNode
  | GpuTransposedConvNode
  | GpuPixelShuffleNode
  | GpuResizeNode
  | GpuWarpNode
  | GpuGatherNode
  | GpuAddNode
  | GpuBlendNode

/**
 * A model whose dataflow is a DAG rather than a chain: nodes may take several
 * inputs, slice channels, change resolution and feed results back into a later
 * stage. IFNet needs all four.
 */
export interface GpuNodeGraph {
  readonly model: string
  /** Topologically ordered: every node's inputs appear before it. */
  readonly nodes: readonly GpuGraphNode[]
  /** Id of the {@link GpuBlendNode} that writes the output frame. */
  readonly output: string
  /** The frame must be padded up to a multiple of this in both axes. */
  readonly sizeMultiple: number
  /** Every tensor name the graph binds, including the folded ones. */
  readonly tensorNames: readonly string[]
  /** Tensors synthesised while building the graph, keyed by their derived name. */
  readonly derivedTensors: ReadonlyMap<string, MxaiTensor>
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

/** `Model.inference` builds `scale_list` from `scale=1.0`; block `i` runs at `1 / scale_list[i]`. */
const RIFE_SCALES = [16, 8, 4, 2, 1] as const
/** `IFNet.__init__`: block 0 is the widest and each later block halves the width. */
const RIFE_BLOCK_CHANNELS = [192, 128, 96, 64, 32] as const
/** Every `nn.LeakyReLU` in IFNet_HDv3 is constructed with 0.2. */
const RIFE_LEAKY_SLOPE = 0.2

/**
 * Build the Practical-RIFE 4.25 IFNet inference graph as `IFNet.forward` executes
 * it with `fastmode=True, ensemble=False` (vendored `train_log/IFNet_HDv3.py` in
 * `assets/weights/rife/RIFEv4.25.zip`, warp from `model/warplayer.py`).
 *
 * `contextnet`, `unet`, `teacher` and `caltime` are unreachable from
 * `Model.inference` and are deliberately absent, so their tensors never reach GPU
 * memory. Each `ResConv`'s `beta` is folded into its convolution here rather than
 * uploaded, because `beta` is per-output-channel: `conv(x) * beta + x` equals
 * `conv'(x) + x` with `W' = W * beta[oc]` and `b' = b * beta[oc]`.
 */
export function createRifeGraph(model: MxaiModel): GpuNodeGraph {
  if (model.model !== 'rife-v4.25') throw new Error(`Expected rife-v4.25 MXAI, received ${model.model}`)
  const tensors = model.tensors
  const nodes: GpuGraphNode[] = []
  const derived = new Map<string, MxaiTensor>()
  const names = new Set<string>()
  const byId = new Map<string, GpuGraphNode>()
  const push = (node: GpuGraphNode): string => {
    nodes.push(node)
    byId.set(node.id, node)
    return node.id
  }
  const whole = (source: string, channels: number): GpuGatherSlot => ({ source, sourceOffset: 0, channels, valueScale: 1 })
  /**
   * `F.interpolate` is per-channel, so it commutes with concatenation and slicing.
   * Resizing each part before the concat, and slicing before the upsample, keeps the
   * wide 15/24/28-channel block inputs and the 13-channel `tmp` at the block's own
   * resolution instead of materialising them at full resolution, where IFNet already
   * holds around eighteen channel groups live. At `scale === 1` the resize is the
   * identity and is skipped entirely.
   */
  const resizeTo = (id: string, source: string, channels: number, divisor: number, valueScale: number): string => {
    if (byId.get(source)?.divisor === divisor && valueScale === 1) return source
    return push({ kind: 'resize', id, input: source, valueScale, channels, divisor })
  }

  interface ConvOptions {
    readonly inputChannels: number
    readonly channels: number
    readonly kernel: number
    readonly stride: number
    readonly divisor: number
    readonly activation: GpuActivation
    readonly residual?: string
  }

  const conv = (id: string, input: string, prefix: string, options: ConvOptions): string => {
    const weight = requireTensor(tensors, `module.${prefix}.weight`)
    const bias = requireTensor(tensors, `module.${prefix}.bias`)
    assertConvShape(weight, [options.channels, options.inputChannels, options.kernel, options.kernel])
    names.add(weight.name)
    names.add(bias.name)
    return push({
      kind: 'conv', id, input, weight: weight.name, bias: bias.name,
      inputChannels: options.inputChannels, channels: options.channels,
      kernel: options.kernel, stride: options.stride, divisor: options.divisor,
      activation: options.activation,
      ...(options.activation === 'leaky-relu' ? { leakySlope: RIFE_LEAKY_SLOPE } : {}),
      ...(options.residual === undefined ? {} : { residual: options.residual }),
    })
  }

  /** torch stores ConvTranspose2d weights as [inChannels, outChannels, kH, kW]. */
  const transposed = (id: string, input: string, prefix: string, options: ConvOptions & { readonly pad: number }): string => {
    const weight = requireTensor(tensors, `module.${prefix}.weight`)
    const bias = requireTensor(tensors, `module.${prefix}.bias`)
    assertConvShape(weight, [options.inputChannels, options.channels, options.kernel, options.kernel])
    names.add(weight.name)
    names.add(bias.name)
    return push({
      kind: 'transposed-conv', id, input, weight: weight.name, bias: bias.name,
      inputChannels: options.inputChannels, channels: options.channels,
      kernel: options.kernel, stride: options.stride, pad: options.pad, divisor: options.divisor,
      activation: options.activation,
    })
  }

  /** `Head`: conv s2 -> LReLU -> conv -> LReLU -> conv -> LReLU -> ConvTranspose2d, no trailing activation. */
  const encode = (image: string, index: 0 | 1): string => {
    let x = conv(`encode${index}.cnn0`, image, 'encode.cnn0', { inputChannels: 3, channels: 16, kernel: 3, stride: 2, divisor: 2, activation: 'leaky-relu' })
    x = conv(`encode${index}.cnn1`, x, 'encode.cnn1', { inputChannels: 16, channels: 16, kernel: 3, stride: 1, divisor: 2, activation: 'leaky-relu' })
    x = conv(`encode${index}.cnn2`, x, 'encode.cnn2', { inputChannels: 16, channels: 16, kernel: 3, stride: 1, divisor: 2, activation: 'leaky-relu' })
    return transposed(`encode.f${index}`, x, 'encode.cnn3', { inputChannels: 16, channels: 4, kernel: 4, stride: 2, pad: 1, divisor: 1, activation: 'none' })
  }

  /**
   * `IFBlock` body at `1 / scale`: `conv0` halves twice, eight `ResConv`s keep the
   * resolution, `lastconv` doubles it and `PixelShuffle(2)` doubles it again, so the
   * 13-channel result is back at `1 / scale` and is resized to full resolution.
   */
  const ifblock = (index: number, input: string, inputChannels: number): { flow: string; mask: string; feat: string } => {
    const scale = RIFE_SCALES[index] ?? 1
    const channels = RIFE_BLOCK_CHANNELS[index] ?? 32
    const id = `block${index}`
    let x = conv(`${id}.down0`, input, `${id}.conv0.0.0`, { inputChannels, channels: channels / 2, kernel: 3, stride: 2, divisor: scale * 2, activation: 'leaky-relu' })
    x = conv(`${id}.down1`, x, `${id}.conv0.1.0`, { inputChannels: channels / 2, channels, kernel: 3, stride: 2, divisor: scale * 4, activation: 'leaky-relu' })
    for (let residual = 0; residual < 8; residual += 1) {
      const folded = foldResConv(tensors, derived, `${id}.convblock.${residual}`, channels)
      names.add(folded.weight)
      names.add(folded.bias)
      x = push({
        kind: 'conv', id: `${id}.res${residual}`, input: x, residual: x,
        weight: folded.weight, bias: folded.bias,
        inputChannels: channels, channels, kernel: 3, stride: 1, divisor: scale * 4,
        activation: 'leaky-relu', leakySlope: RIFE_LEAKY_SLOPE,
      })
    }
    const last = transposed(`${id}.lastconv`, x, `${id}.lastconv.0`, { inputChannels: channels, channels: 52, kernel: 4, stride: 2, pad: 1, divisor: scale * 2, activation: 'none' })
    const shuffled = push({ kind: 'pixel-shuffle', id: `${id}.shuffle`, input: last, factor: 2, channels: 13, divisor: scale })
    /** `flow = tmp[:, :4] * scale`, `mask = tmp[:, 4:5]`, `feat = tmp[:, 5:]`. */
    const slice = (target: string, sourceOffset: number, count: number, valueScale: number): string => {
      if (scale === 1) return push({ kind: 'gather', id: target, channels: count, divisor: 1, slots: [{ source: shuffled, sourceOffset, channels: count, valueScale }] })
      const low = push({ kind: 'gather', id: `${target}.low`, channels: count, divisor: scale, slots: [{ source: shuffled, sourceOffset, channels: count, valueScale: 1 }] })
      return push({ kind: 'resize', id: target, input: low, valueScale, channels: count, divisor: 1 })
    }
    return {
      flow: slice(index === 0 ? `${id}.flow` : `${id}.delta`, 0, 4, scale),
      mask: slice(`${id}.mask`, 4, 1, 1),
      feat: slice(`${id}.feat`, 5, 8, 1),
    }
  }

  const img0 = push({ kind: 'input', id: 'img0', source: 0, channels: 3, divisor: 1 })
  const img1 = push({ kind: 'input', id: 'img1', source: 1, channels: 3, divisor: 1 })
  const timestep = push({ kind: 'fill', id: 'timestep', value: 'timestep', channels: 1, divisor: 1 })
  const f0 = encode(img0, 0)
  const f1 = encode(img1, 1)

  let flow = ''
  let mask = ''
  let feat = ''
  let warped0 = img0
  let warped1 = img1
  for (let index = 0; index < 5; index += 1) {
    const scale = RIFE_SCALES[index] ?? 1
    const id = `block${index}`
    let blockInput: string
    let blockChannels: number
    if (index === 0) {
      blockInput = push({ kind: 'gather', id: `${id}.x`, channels: 15, divisor: scale, slots: [
        whole(resizeTo(`${id}.in.img0`, img0, 3, scale, 1), 3),
        whole(resizeTo(`${id}.in.img1`, img1, 3, scale, 1), 3),
        whole(resizeTo(`${id}.in.f0`, f0, 4, scale, 1), 4),
        whole(resizeTo(`${id}.in.f1`, f1, 4, scale, 1), 4),
        whole(resizeTo(`${id}.in.timestep`, timestep, 1, scale, 1), 1),
      ] })
      blockChannels = 15
    } else {
      const wf0 = push({ kind: 'warp', id: `${id}.wf0`, input: f0, flow, flowChannel: 0, channels: 4, divisor: 1 })
      const wf1 = push({ kind: 'warp', id: `${id}.wf1`, input: f1, flow, flowChannel: 2, channels: 4, divisor: 1 })
      // The flow enters the block resized by 1/scale *and* multiplied by 1/scale.
      blockInput = push({ kind: 'gather', id: `${id}.x`, channels: 28, divisor: scale, slots: [
        whole(resizeTo(`${id}.in.warped0`, warped0, 3, scale, 1), 3),
        whole(resizeTo(`${id}.in.warped1`, warped1, 3, scale, 1), 3),
        whole(resizeTo(`${id}.in.wf0`, wf0, 4, scale, 1), 4),
        whole(resizeTo(`${id}.in.wf1`, wf1, 4, scale, 1), 4),
        whole(resizeTo(`${id}.in.timestep`, timestep, 1, scale, 1), 1),
        whole(resizeTo(`${id}.in.mask`, mask, 1, scale, 1), 1),
        whole(resizeTo(`${id}.in.feat`, feat, 8, scale, 1), 8),
        whole(resizeTo(`${id}.in.flow`, flow, 4, scale, 1 / scale), 4),
      ] })
      blockChannels = 28
    }
    const block = ifblock(index, blockInput, blockChannels)
    flow = index === 0 ? block.flow : push({ kind: 'add', id: `${id}.flow`, left: flow, right: block.flow, channels: 4, divisor: 1 })
    mask = block.mask
    feat = block.feat
    warped0 = push({ kind: 'warp', id: `${id}.warped0`, input: img0, flow, flowChannel: 0, channels: 3, divisor: 1 })
    warped1 = push({ kind: 'warp', id: `${id}.warped1`, input: img1, flow, flowChannel: 2, channels: 3, divisor: 1 })
  }
  const output = push({ kind: 'blend', id: 'output', first: warped0, second: warped1, mask, maskChannel: 0, channels: 3, divisor: 1 })

  const graph: GpuNodeGraph = { model: model.model, nodes, output, sizeMultiple: 64, tensorNames: [...names], derivedTensors: derived }
  validateNodeGraph(graph)
  return graph
}

/** Every node id `node` reads, deduplicated and in binding order. */
export function nodeGraphInputs(node: GpuGraphNode): readonly string[] {
  switch (node.kind) {
    case 'input':
    case 'fill':
      return []
    case 'conv':
      return node.residual === undefined || node.residual === node.input ? [node.input] : [node.input, node.residual]
    case 'transposed-conv':
    case 'pixel-shuffle':
    case 'resize':
      return [node.input]
    case 'warp':
      return node.flow === node.input ? [node.input] : [node.input, node.flow]
    case 'gather':
      return [...new Set(node.slots.map((slot) => slot.source))]
    case 'add':
      return node.left === node.right ? [node.left] : [node.left, node.right]
    case 'blend':
      return [...new Set([node.first, node.second, node.mask])]
  }
}

/**
 * Structural invariants the executor relies on and cannot recover from: unique
 * topologically ordered ids, agreeing resolutions across every multi-input node,
 * and channel arithmetic that matches each operator. A graph that violates any of
 * them would produce plausible-looking frames from misaligned tensors.
 */
export function validateNodeGraph(graph: GpuNodeGraph): void {
  const seen = new Map<string, GpuGraphNode>()
  const fail = (node: GpuGraphNode, detail: string): never => {
    throw new Error(`Node graph "${graph.model}" node ${node.id} (${node.kind}) ${detail}`)
  }
  const resolve = (node: GpuGraphNode, id: string): GpuGraphNode => seen.get(id) ?? fail(node, `reads undefined or later node ${id}`)
  const sameSize = (node: GpuGraphNode, id: string): GpuGraphNode => {
    const source = resolve(node, id)
    if (source.divisor !== node.divisor) fail(node, `reads ${id} at divisor ${source.divisor}, expected ${node.divisor}`)
    return source
  }
  for (const node of graph.nodes) {
    if (seen.has(node.id)) fail(node, 'has a duplicate id')
    if (node.channels < 1) fail(node, `has ${node.channels} channels`)
    if (!Number.isInteger(Math.log2(node.divisor)) || node.divisor < 1 || node.divisor > graph.sizeMultiple) fail(node, `has an unusable divisor ${node.divisor}`)
    switch (node.kind) {
      case 'conv': {
        const input = resolve(node, node.input)
        if (input.channels !== node.inputChannels) fail(node, `reads ${input.channels} channels, declares ${node.inputChannels}`)
        if (input.divisor * node.stride !== node.divisor) fail(node, `stride ${node.stride} from divisor ${input.divisor} does not reach ${node.divisor}`)
        if (node.residual !== undefined) {
          const residual = sameSize(node, node.residual)
          if (residual.channels !== node.channels) fail(node, `adds a ${residual.channels}-channel residual to ${node.channels} channels`)
        }
        break
      }
      case 'transposed-conv': {
        const input = resolve(node, node.input)
        if (input.channels !== node.inputChannels) fail(node, `reads ${input.channels} channels, declares ${node.inputChannels}`)
        if (input.divisor !== node.divisor * node.stride) fail(node, `stride ${node.stride} from divisor ${input.divisor} does not reach ${node.divisor}`)
        break
      }
      case 'pixel-shuffle': {
        const input = resolve(node, node.input)
        if (input.divisor !== node.divisor * node.factor) fail(node, `factor ${node.factor} from divisor ${input.divisor} does not reach ${node.divisor}`)
        if (input.channels !== node.channels * node.factor * node.factor) fail(node, `reads ${input.channels} channels, needs ${node.channels * node.factor * node.factor}`)
        break
      }
      case 'resize':
        resolve(node, node.input)
        break
      case 'warp': {
        const input = sameSize(node, node.input)
        if (input.channels !== node.channels) fail(node, `warps ${input.channels} channels into ${node.channels}`)
        const flow = sameSize(node, node.flow)
        if (node.flowChannel % 4 > 2 || node.flowChannel + 2 > flow.channels) fail(node, `reads flow channels ${node.flowChannel}..${node.flowChannel + 1} of ${flow.channels}`)
        break
      }
      case 'gather': {
        if (node.slots.length === 0 || node.slots.length > 8) fail(node, `has ${node.slots.length} slots, the kernel takes 1..8`)
        let total = 0
        for (const slot of node.slots) {
          const source = sameSize(node, slot.source)
          if (slot.channels < 1 || slot.sourceOffset + slot.channels > source.channels) fail(node, `slot reads ${slot.source}[${slot.sourceOffset}..${slot.sourceOffset + slot.channels}) of ${source.channels}`)
          total += slot.channels
        }
        if (total !== node.channels) fail(node, `gathers ${total} channels into ${node.channels}`)
        break
      }
      case 'add': {
        for (const operand of [node.left, node.right]) {
          const source = sameSize(node, operand)
          if (source.channels !== node.channels) fail(node, `adds ${source.channels} channels into ${node.channels}`)
        }
        break
      }
      case 'blend': {
        for (const operand of [node.first, node.second]) {
          const source = sameSize(node, operand)
          if (source.channels < node.channels) fail(node, `blends ${source.channels} channels into ${node.channels}`)
        }
        const mask = sameSize(node, node.mask)
        if (node.maskChannel >= mask.channels) fail(node, `reads mask channel ${node.maskChannel} of ${mask.channels}`)
        break
      }
      default:
        break
    }
    seen.set(node.id, node)
  }
  const output = seen.get(graph.output)
  if (!output || output.kind !== 'blend') throw new Error(`Node graph "${graph.model}" output ${graph.output} is not a blend node`)
  for (const name of graph.tensorNames) if (name.length === 0) throw new Error(`Node graph "${graph.model}" binds an empty tensor name`)
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
 * unreachable, so filtering keeps them out of GPU memory entirely; RIFE's carries
 * the `teacher` and `caltime` sub-networks, unreachable from `Model.inference`.
 *
 * `derived` supplies tensors that do not exist in the checkpoint — the RIFE graph's
 * beta-folded `ResConv` weights. A name present in `derived` wins over the
 * checkpoint, and a name in `names` that neither source has is a hard error rather
 * than a silently missing binding.
 */
export function uploadTensorStore(
  device: GPUDevice,
  model: MxaiModel,
  names?: ReadonlySet<string>,
  derived?: ReadonlyMap<string, MxaiTensor>,
): GpuTensorStore {
  const usage = bufferUsage()
  const tensors = new Map<string, GpuTensorBuffer>()
  const selected: MxaiTensor[] = []
  if (names) {
    for (const name of names) {
      const tensor = derived?.get(name) ?? model.tensors.get(name)
      if (!tensor) throw new Error(`Graph tensor is missing from the checkpoint: ${name}`)
      selected.push(tensor)
    }
  } else {
    selected.push(...model.tensors.values())
  }
  try {
    for (const tensor of selected) {
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

function assertConvShape(tensor: MxaiTensor, expected: readonly number[]): void {
  if (tensor.shape.length !== expected.length || expected.some((value, index) => tensor.shape[index] !== value)) {
    throw new Error(`Tensor ${tensor.name} has shape [${tensor.shape.join(', ')}], expected [${expected.join(', ')}]`)
  }
}

/**
 * Fold a `ResConv`'s `beta` into its convolution and register the results as
 * derived tensors.
 *
 * `ResConv.forward` is `LeakyReLU(0.2)(conv(x) * beta + x)` with `beta` shaped
 * `[1, c, 1, 1]`, so the scale is constant per output channel and distributes over
 * the convolution: `(W x + b) * beta = (W * beta) x + b * beta`. After folding, the
 * layer is exactly "convolution, add the input, activate" — which the shipped
 * `PACKED_CONVOLUTION_WGSL` already does with `actAfterResidual`. `beta` itself is
 * never uploaded.
 */
function foldResConv(
  tensors: ReadonlyMap<string, MxaiTensor>,
  derived: Map<string, MxaiTensor>,
  prefix: string,
  channels: number,
): { weight: string; bias: string } {
  const weight = requireTensor(tensors, `module.${prefix}.conv.weight`)
  const bias = requireTensor(tensors, `module.${prefix}.conv.bias`)
  const beta = requireTensor(tensors, `module.${prefix}.beta`)
  assertConvShape(weight, [channels, channels, 3, 3])
  assertConvShape(bias, [channels])
  assertConvShape(beta, [1, channels, 1, 1])
  const weightName = `${weight.name}*beta`
  const biasName = `${bias.name}*beta`
  if (!derived.has(weightName)) {
    const scales = readTensorFloats(beta)
    const source = readTensorFloats(weight)
    const stride = source.length / channels
    const foldedWeight = new Float32Array(source.length)
    for (let output = 0; output < channels; output += 1) {
      const scale = scales[output] ?? 1
      for (let index = 0; index < stride; index += 1) foldedWeight[output * stride + index] = (source[output * stride + index] ?? 0) * scale
    }
    const sourceBias = readTensorFloats(bias)
    const foldedBias = new Float32Array(channels)
    for (let output = 0; output < channels; output += 1) foldedBias[output] = (sourceBias[output] ?? 0) * (scales[output] ?? 1)
    derived.set(weightName, { name: weightName, shape: weight.shape, elementType: 'f32', data: new Uint8Array(foldedWeight.buffer) })
    derived.set(biasName, { name: biasName, shape: bias.shape, elementType: 'f32', data: new Uint8Array(foldedBias.buffer) })
  }
  return { weight: weightName, bias: biasName }
}

function readTensorFloats(tensor: MxaiTensor): Float32Array {
  if (tensor.elementType === 'u32') throw new Error(`Tensor ${tensor.name} is an integer tensor and cannot be folded`)
  const bytes = tensor.elementType === 'f32' ? tensor.data : toFloat32Bytes(tensor)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Float32Array(copy.buffer)
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
