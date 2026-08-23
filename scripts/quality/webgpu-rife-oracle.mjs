/**
 * Validate Practical-RIFE 4.25 against reference tensors captured from the upstream
 * IFNet forward pass (packages/postprocess/tools/generate_rife_reference.py).
 *
 * Two layers of checks run against the same fixture:
 *   - operator level: the three kernels whose semantics are easy to get subtly
 *     wrong (`Head` including `ConvTranspose2d`, `grid_sample`, `F.interpolate`),
 *     driven directly so a single-op regression cannot hide inside the graph;
 *   - graph level: the shipped `RifeGraphExecutor` run end to end from two 8-bit
 *     frames, with every IFNet stage the fixture records compared in place.
 *
 * `--mutate=leaky-slope` re-runs the graph level with every LeakyReLU slope moved
 * from 0.2 to 0.05 and *requires* the comparison to fail. Without that control a
 * green gate only proves the numbers agree with themselves.
 */
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reportFailures, withWebGpuPage } from './webgpu-harness.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixturePath = resolve(root, 'packages/postprocess/tests/fixtures/rife-reference.json')
const failures = []

const MUTATIONS = new Set(['leaky-slope'])
const flag = (name) => process.argv.slice(2).map((value) => new RegExp(`^--${name}=(.*)$`).exec(value)?.[1]).find((value) => value !== undefined) ?? null
const mutation = flag('mutate')
if (mutation !== null && !MUTATIONS.has(mutation)) {
  console.error(`- ENVIRONMENT: unknown --mutate=${mutation}; expected one of ${[...MUTATIONS].join(', ')}`)
  process.exit(1)
}
/** `--activation=rgba16float` measures the half-precision variant instead of the shipped default. */
const activationFormat = flag('activation')
if (activationFormat !== null && !['rgba16float', 'rgba32float'].includes(activationFormat)) {
  console.error(`- ENVIRONMENT: unknown --activation=${activationFormat}; expected rgba16float or rgba32float`)
  process.exit(1)
}

let reference
try {
  reference = JSON.parse(await readFile(fixturePath, 'utf8'))
} catch {
  console.error(`- ENVIRONMENT: ${fixturePath} is missing. Regenerate it with generate_rife_reference.py.`)
  process.exit(1)
}

/** What the gate still cannot prove here, with what each one needs. */
const UNCOVERED = {
  'f16 kernels': 'the fallback adapter has no shader-f16, so half-precision weight variants need real hardware',
  performance: 'SwiftShader is a CPU rasteriser; this gate is correctness only and records no timings',
  'non-multiple-of-64 frames': 'the fixture is 64x64, so the pad/crop wrapper is covered by unit tests rather than by this oracle',
}

/** Fixture stage as `{ channels, height, width, stride, values, stats }`. */
const stage = (name) => {
  const entry = reference.stages[name]
  if (!entry) throw new Error(`reference fixture has no stage "${name}"`)
  const [, channels, height, width] = entry.shape
  return { name, channels, height, width, stride: entry.sampleStride, values: entry.values, stats: entry.stats }
}

/** Node ids the executor retains, in the order they are reported. */
const GRAPH_STAGES = [
  'encode.f0',
  'encode.f1',
  ...[0, 1, 2, 3, 4].flatMap((block) => [`block${block}.flow`, `block${block}.mask`, `block${block}.feat`, `block${block}.warped0`, `block${block}.warped1`]),
]

/**
 * Per-stage tolerances. Each is roughly twenty times the delta measured here with
 * `rgba32float` activations, which leaves room for a different vendor's fp32
 * accumulation order over 56 convolutions without leaving room for a semantic
 * mistake: the `rgba16float` variant of the same graph misses every one of these by
 * one to three orders of magnitude (`--activation=rgba16float` prints it).
 *
 * `output` is the exception. It is stored as `rgba8unorm`, so its floor is half an
 * 8-bit step (1.96e-3) no matter how exact the graph is, and its budget is one step.
 */
const TOLERANCE = {
  'encode.f0': 5e-5,
  'encode.f1': 5e-5,
  'block0.flow': 1e-4,
  'block0.mask': 5e-5,
  'block0.feat': 5e-5,
  'block0.warped0': 1e-4,
  'block0.warped1': 1e-4,
  'block1.flow': 2e-4,
  'block1.mask': 1e-4,
  'block1.feat': 5e-5,
  'block1.warped0': 1e-4,
  'block1.warped1': 1e-4,
  'block2.flow': 2e-4,
  'block2.mask': 2e-4,
  'block2.feat': 1e-4,
  'block2.warped0': 2e-4,
  'block2.warped1': 2e-4,
  'block3.flow': 2e-4,
  'block3.mask': 2e-4,
  'block3.feat': 1e-4,
  'block3.warped0': 2e-4,
  'block3.warped1': 2e-4,
  'block4.flow': 3e-4,
  'block4.mask': 3e-3,
  'block4.feat': 3e-4,
  'block4.warped0': 3e-4,
  'block4.warped1': 3e-4,
  'mask.sigmoid': 1e-3,
  output: 4e-3,
}

const routes = {
  '/postprocess/': resolve(root, 'packages/postprocess/dist'),
  '/weights/': resolve(root, 'packages/postprocess/assets/weights'),
}

const report = await withWebGpuPage(async (page) => page.evaluate(async ({ stages, graphStages, timestep, mutate, activation }) => {
  if (!navigator.gpu) return { fatal: `navigator.gpu is undefined (isSecureContext=${window.isSecureContext})` }
  if (typeof Float16Array === 'undefined') return { fatal: 'Float16Array is unavailable in this browser build' }
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return { fatal: 'requestAdapter() returned null' }
  const device = await adapter.requestDevice()
  const { createGpuHelpers } = await import('/helpers.js')
  const { makeArray, readArray, readRgba8, uniform, storage, run } = createGpuHelpers(device)
  const { parseMxai } = await import('/postprocess/assets/mxai')
  const { PACKED_CONVOLUTION_WGSL, PACKED_RESIZE_WGSL, PACKED_TRANSPOSED_CONVOLUTION_WGSL, PACKED_WARP_WGSL } = await import('/postprocess/gpu/wgsl')
  const results = {}

  const model = parseMxai(new Uint8Array(await (await fetch('/weights/rife/rife_v4.25.mxai')).arrayBuffer()))
  const tensor = (name) => {
    const found = model.tensors.get(name)
    if (!found) throw new Error(`missing tensor ${name}`)
    return { shape: found.shape, data: new Float32Array(found.data.buffer, found.data.byteOffset, found.data.byteLength / 4) }
  }

  /** Reference accessor for a full-resolution NCHW stage. */
  const nchw = (target) => (x, y, c) => target.values[(c * target.height + y) * target.width + x]

  /**
   * Worst absolute difference between a GPU accessor and a fixture stage, sampled on
   * the fixture's own grid: the values were recorded as `dense[..., ::stride,
   * ::stride]`, so reading them as if they were dense would compare the wrong pixels.
   */
  const compare = (at, target, transform = (value) => value) => {
    const stride = target.stride
    const width = Math.ceil(target.width / stride)
    const height = Math.ceil(target.height / stride)
    let worst = 0
    let index = 0
    for (let c = 0; c < target.channels; c += 1) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          worst = Math.max(worst, Math.abs(transform(at(x * stride, y * stride, c)) - target.values[index]))
          index += 1
        }
      }
    }
    return worst
  }

  /** 16 aligned words; the LeakyReLU slope lives in the last float. */
  const convParams = (values, slope) => {
    const buffer = new ArrayBuffer(64)
    const view = new DataView(buffer)
    values.forEach((word, index) => view.setUint32(index * 4, word, true))
    view.setFloat32(56, slope, true)
    return uniform(new Uint8Array(buffer))
  }

  const conv = async (input, outChannels, name, { stride = 1, activation = 2, slope = 0.2 } = {}) => {
    const weight = tensor(`module.${name}.weight`)
    const bias = tensor(`module.${name}.bias`)
    const kernel = weight.shape[2]
    const output = makeArray(input.width / stride, input.height / stride, outChannels)
    const error = await run(PACKED_CONVOLUTION_WGSL, [
      { binding: 0, resource: input.view() },
      { binding: 1, resource: output.view() },
      { binding: 2, resource: { buffer: storage(weight.data) } },
      { binding: 3, resource: { buffer: storage(bias.data) } },
      { binding: 4, resource: convParams([input.width, input.height, output.width, output.height, weight.shape[1], outChannels, kernel, stride, input.groups, output.groups, activation, 0, 0, 0], slope) },
      { binding: 5, resource: input.view() },
      { binding: 6, resource: { buffer: storage(new Float32Array(4)) } },
    ], Math.ceil(output.width / 8), Math.ceil(output.height / 8), output.groups)
    return { output, error }
  }

  const transposed = async (input, outChannels, name, { stride = 2, pad = 1, activation = 0 } = {}) => {
    const weight = tensor(`module.${name}.weight`)
    const bias = tensor(`module.${name}.bias`)
    const kernel = weight.shape[2]
    const output = makeArray((input.width - 1) * stride - 2 * pad + kernel, (input.height - 1) * stride - 2 * pad + kernel, outChannels)
    const buffer = new ArrayBuffer(64)
    const view = new DataView(buffer)
    ;[input.width, input.height, output.width, output.height, weight.shape[0], outChannels, kernel, stride, input.groups, output.groups, activation, pad]
      .forEach((word, index) => view.setUint32(index * 4, word, true))
    view.setFloat32(48, 0.2, true)
    const error = await run(PACKED_TRANSPOSED_CONVOLUTION_WGSL, [
      { binding: 0, resource: input.view() },
      { binding: 1, resource: output.view() },
      { binding: 2, resource: { buffer: storage(weight.data) } },
      { binding: 3, resource: { buffer: storage(bias.data) } },
      { binding: 4, resource: uniform(new Uint8Array(buffer)) },
    ], Math.ceil(output.width / 8), Math.ceil(output.height / 8), output.groups)
    return { output, error }
  }

  // Operator level 1 — Head (`encode`): conv s2, LReLU, conv, LReLU, conv, LReLU, ConvTranspose.
  {
    const img0 = stages['img0']
    const encoded = stages['encode.f0']
    const source = makeArray(img0.width, img0.height, 3, nchw(img0))
    let error = null
    const cnn0 = await conv(source, 16, 'encode.cnn0', { stride: 2 })
    error = error ?? cnn0.error
    const cnn1 = await conv(cnn0.output, 16, 'encode.cnn1')
    error = error ?? cnn1.error
    const cnn2 = await conv(cnn1.output, 16, 'encode.cnn2')
    error = error ?? cnn2.error
    const cnn3 = await transposed(cnn2.output, 4, 'encode.cnn3')
    error = error ?? cnn3.error
    const worst = error ? 0 : compare(await readArray(cnn3.output), encoded)
    results['op.encode'] = { pass: !error && worst < 0.02, error, detail: `max |delta| = ${worst.toExponential(2)} over ${encoded.channels}x${encoded.height}x${encoded.width} (stride ${encoded.stride}), reference absMax ${encoded.stats.absMax}` }
  }

  // Operator level 2 — the backward warp: upstream normalises the flow into grid
  // coordinates and calls grid_sample(align_corners=True), which must reduce to
  // sampling at (x + flowX, y + flowY) with the border clamped.
  {
    const img0 = stages['img0']
    const finalFlow = stages['block4.flow']
    const finalWarped = stages['block4.warped0']
    const source = makeArray(img0.width, img0.height, 3, nchw(img0))
    const flow = makeArray(finalFlow.width, finalFlow.height, finalFlow.channels, nchw(finalFlow))
    const output = makeArray(img0.width, img0.height, 3)
    const buffer = new ArrayBuffer(32)
    const view = new DataView(buffer)
    ;[img0.width, img0.height, 3, output.groups, 0].forEach((word, index) => view.setUint32(index * 4, word, true))
    const error = await run(PACKED_WARP_WGSL, [
      { binding: 0, resource: source.view() },
      { binding: 1, resource: flow.view() },
      { binding: 2, resource: output.view() },
      { binding: 3, resource: uniform(new Uint8Array(buffer)) },
    ], Math.ceil(img0.width / 8), Math.ceil(img0.height / 8), output.groups)
    const worst = error ? 0 : compare(await readArray(output), finalWarped)
    results['op.warp'] = { pass: !error && worst < 5e-3, error, detail: `max |delta| = ${worst.toExponential(2)} against grid_sample over ${finalWarped.channels}x${finalWarped.height}x${finalWarped.width}` }
  }

  // Operator level 3 — bilinear resize in both directions, against torch's
  // align_corners=False grid.
  {
    const img0 = stages['img0']
    const resize = async (input, target, valueScale) => {
      const output = makeArray(target.width, target.height, target.channels)
      const buffer = new ArrayBuffer(32)
      const view = new DataView(buffer)
      ;[input.width, input.height, target.width, target.height, target.channels, output.groups]
        .forEach((word, index) => view.setUint32(index * 4, word, true))
      view.setFloat32(24, valueScale, true)
      const error = await run(PACKED_RESIZE_WGSL, [
        { binding: 0, resource: input.view() },
        { binding: 1, resource: output.view() },
        { binding: 2, resource: uniform(new Uint8Array(buffer)) },
      ], Math.ceil(target.width / 8), Math.ceil(target.height / 8), output.groups)
      if (error) return { error, worst: 0 }
      return { error: null, worst: compare(await readArray(output), target), output }
    }
    const source = makeArray(img0.width, img0.height, 3, nchw(img0))
    const down = await resize(source, stages['resize.down4'], 1)
    const up = down.output ? await resize(down.output, stages['resize.up2'], 1) : { error: 'downscale failed', worst: 0 }
    const worst = Math.max(down.worst, up.worst)
    results['op.resize'] = {
      pass: !down.error && !up.error && worst < 2e-3,
      error: down.error ?? up.error,
      detail: `max |delta| = ${worst.toExponential(2)} over a 1/4 downscale and a 2x upscale`,
    }
  }

  // Graph level — the shipped executor, from two 8-bit frames to the output frame.
  {
    const { RifeGraphExecutor } = await import('/postprocess/gpu/rife')
    const { createRifeGraph, uploadTensorStore } = await import('/postprocess/gpu/graph')
    const built = createRifeGraph(model)
    const graph = mutate === 'leaky-slope'
      ? { ...built, nodes: built.nodes.map((node) => (node.kind === 'conv' && node.leakySlope !== undefined ? { ...node, leakySlope: 0.05 } : node)) }
      : built
    const store = uploadTensorStore(device, model, new Set(built.tensorNames), built.derivedTensors)
    const executor = RifeGraphExecutor.create({ device, model, tensorStore: store, graph, ...(activation ? { activationFormat: activation } : {}) })
    const frameTexture = (target) => {
      const texture = device.createTexture({
        size: { width: target.width, height: target.height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      const bytes = new Uint8Array(target.width * target.height * 4)
      const at = nchw(target)
      for (let y = 0; y < target.height; y += 1) {
        for (let x = 0; x < target.width; x += 1) {
          const base = (y * target.width + x) * 4
          for (let c = 0; c < 3; c += 1) bytes[base + c] = Math.round(at(x, y, c) * 255)
          bytes[base + 3] = 255
        }
      }
      device.queue.writeTexture({ texture }, bytes, { bytesPerRow: target.width * 4, rowsPerImage: target.height }, { width: target.width, height: target.height })
      return texture
    }
    const img0 = stages['img0']
    const img1 = stages['img1']
    device.pushErrorScope('validation')
    let outcome = null
    try {
      const result = await executor.process({
        source0: frameTexture(img0),
        source1: frameTexture(img1),
        width: img0.width,
        height: img0.height,
        timestep,
        timestamp: 0,
        retain: graphStages,
      })
      const measured = {}
      for (const name of graphStages) {
        const retained = result.retained.get(name)
        if (!retained) throw new Error(`executor did not retain ${name}`)
        measured[name] = compare(await readArray(retained), stages[name])
        if (name === 'block4.mask') {
          measured['mask.sigmoid'] = compare(await readArray(retained), stages['mask.sigmoid'], (value) => 1 / (1 + Math.exp(-value)))
        }
        retained.release()
      }
      const frame = result.frame
      measured['output'] = compare(await readRgba8(frame.texture, frame.width, frame.height), stages['output'])
      frame.release()
      outcome = {
        measured,
        nodes: built.nodes.length,
        format: executor.activationFormat,
        textures: executor.activationTextures,
        bytes: executor.activationBytes,
      }
    } catch (cause) {
      outcome = { thrown: cause instanceof Error ? cause.message.split('\n')[0] : String(cause) }
    }
    const validation = await device.popErrorScope()
    executor.close()
    store.close()
    results['#graph'] = { ...outcome, ...(validation ? { validation: validation.message.split('\n')[0] } : {}) }
  }

  return results
}, {
  stages: Object.fromEntries(
    [...GRAPH_STAGES, 'img0', 'img1', 'resize.down4', 'resize.up2', 'mask.sigmoid', 'output'].map((name) => [name, stage(name)]),
  ),
  graphStages: GRAPH_STAGES,
  timestep: reference.config.timestep,
  mutate: mutation,
  activation: activationFormat,
}), { routes })

if (report.fatal) {
  failures.push(`ENVIRONMENT: ${report.fatal}`)
} else {
  console.log(`oracle: ${reference.model} from ${reference.upstream}`)
  console.log(`torch ${reference.torch}, scales ${reference.config.scaleList.join('/')}, timestep ${reference.config.timestep}, ${reference.config.inputSize}x${reference.config.inputSize} 8-bit input`)
  if (mutation !== null) console.log(`control: --mutate=${mutation} is applied; the graph comparison must fail`)
  const graph = report['#graph'] ?? {}
  delete report['#graph']
  for (const [name, entry] of Object.entries(report)) {
    if (entry.error) failures.push(`${name}: ${entry.error}`)
    else if (!entry.pass) failures.push(`${name}: ${entry.detail}`)
    else console.log(`pass        ${name} (${entry.detail})`)
  }

  const graphFailures = []
  if (graph.validation) graphFailures.push(`graph: WebGPU validation rejected the run — ${graph.validation}`)
  if (graph.thrown) graphFailures.push(`graph: the executor threw — ${graph.thrown}`)
  if (graph.measured) {
    console.log(`\ngraph: RifeGraphExecutor, ${graph.nodes} nodes in one submission`)
    console.log(`activations: ${graph.format}, ${graph.textures} pooled textures, ${(graph.bytes / 1024).toFixed(0)} KiB at ${reference.config.inputSize}x${reference.config.inputSize}`)
    for (const [name, worst] of Object.entries(graph.measured)) {
      const tolerance = TOLERANCE[name]
      if (tolerance === undefined) {
        graphFailures.push(`graph.${name}: no tolerance is recorded for this stage`)
        continue
      }
      const line = `${name.padEnd(16)} max |delta| = ${worst.toExponential(2)} (tolerance ${tolerance.toExponential(1)}, reference absMax ${reference.stages[name].stats.absMax})`
      if (worst < tolerance) console.log(`pass        ${line}`)
      else graphFailures.push(`graph.${line}`)
    }
  }

  if (mutation === null) {
    failures.push(...graphFailures)
  } else if (graphFailures.length === 0) {
    failures.push(`CONTROL: --mutate=${mutation} changed nothing the gate can see; the graph comparison is not sensitive to it`)
  } else {
    console.log(`\ncontrol: the mutation is detected — ${graphFailures.length} stage(s) moved outside tolerance`)
    for (const failure of graphFailures) console.log(`  ${failure}`)
  }

  console.log('\nnot covered by this gate:')
  for (const [name, reason] of Object.entries(UNCOVERED)) console.log(`  ${name}: ${reason}`)
}

reportFailures(failures, mutation === null
  ? 'RIFE 4.25 matches the upstream reference from the operator level through the whole IFNet graph.'
  : `The ${mutation} control is detected, so the RIFE graph comparison is sensitive to it.`)

