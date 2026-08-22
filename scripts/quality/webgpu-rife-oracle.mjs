/**
 * Validate the RIFE 4.25 operator set against reference tensors captured from the
 * upstream IFNet forward pass (packages/postprocess/tools/generate_rife_reference.py).
 *
 * There is no RIFE graph executor yet. This gate covers the sub-networks whose
 * kernels exist, so the operators are proven before the graph is built on top of
 * them, and prints what is still uncovered.
 */
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reportFailures, withWebGpuPage } from './webgpu-harness.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixturePath = resolve(root, 'packages/postprocess/tests/fixtures/rife-reference.json')
const failures = []

let reference
try {
  reference = JSON.parse(await readFile(fixturePath, 'utf8'))
} catch {
  console.error(`- ENVIRONMENT: ${fixturePath} is missing. Regenerate it with generate_rife_reference.py.`)
  process.exit(1)
}

/** Stages the graph cannot run yet, with what each one still needs. */
const UNCOVERED = {
  'block0..4': 'IFBlock body: resize the concatenated input by 1/scale, conv0 (two strided 3x3), 8x ResConv, lastconv (transposed conv + PixelShuffle(2)), resize back by scale',
  'flow accumulation': 'flow = flow + delta across five blocks, with mask and feat carried forward and f0/f1 warped by the running flow',
  'graph IR': 'GpuGraphLayer is a single-input chain; IFNet needs multi-input concat, channel slicing, resize and warp nodes',
  output: 'depends on all of the above; PACKED_MASK_BLEND_WGSL is ready for the final sigmoid blend',
}

const stage = (name) => {
  const entry = reference.stages[name]
  if (!entry) throw new Error(`reference fixture has no stage "${name}"`)
  const [, channels, height, width] = entry.shape
  return { channels, height, width, stride: entry.sampleStride, values: entry.values, stats: entry.stats }
}

const routes = {
  '/postprocess/': resolve(root, 'packages/postprocess/dist'),
  '/weights/': resolve(root, 'packages/postprocess/assets/weights'),
}

const report = await withWebGpuPage(async (page) => page.evaluate(async ({ img0, encoded, finalFlow, finalWarped, resizeDown, resizeUp }) => {
  if (!navigator.gpu) return { fatal: `navigator.gpu is undefined (isSecureContext=${window.isSecureContext})` }
  if (typeof Float16Array === 'undefined') return { fatal: 'Float16Array is unavailable in this browser build' }
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return { fatal: 'requestAdapter() returned null' }
  const device = await adapter.requestDevice()
  const { createGpuHelpers } = await import('/helpers.js')
  const { makeArray, readArray, uniform, storage, run } = createGpuHelpers(device)
  const { parseMxai } = await import('/postprocess/assets/mxai')
  const { PACKED_CONVOLUTION_WGSL, PACKED_RESIZE_WGSL, PACKED_TRANSPOSED_CONVOLUTION_WGSL, PACKED_WARP_WGSL } = await import('/postprocess/gpu/wgsl')
  const results = {}

  const model = parseMxai(new Uint8Array(await (await fetch('/weights/rife/rife_v4.25.mxai')).arrayBuffer()))
  const tensor = (name) => {
    const found = model.tensors.get(name)
    if (!found) throw new Error(`missing tensor ${name}`)
    return { shape: found.shape, data: new Float32Array(found.data.buffer, found.data.byteOffset, found.data.byteLength / 4) }
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

  // Head (`encode`): conv s2 -> LReLU -> conv -> LReLU -> conv -> LReLU -> ConvTranspose.
  {
    const nchw = (tensorLike) => (x, y, c) => tensorLike.values[(c * tensorLike.height + y) * tensorLike.width + x]
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

    let worst = 0
    if (!error) {
      const at = await readArray(cnn3.output)
      const stride = encoded.stride
      const sampledWidth = Math.ceil(encoded.width / stride)
      const sampledHeight = Math.ceil(encoded.height / stride)
      let index = 0
      for (let c = 0; c < encoded.channels; c += 1) {
        for (let y = 0; y < sampledHeight; y += 1) {
          for (let x = 0; x < sampledWidth; x += 1) {
            worst = Math.max(worst, Math.abs(at(x * stride, y * stride, c) - encoded.values[index]))
            index += 1
          }
        }
      }
    }
    results.encode = { pass: !error && worst < 0.02, error, detail: `max |delta| = ${worst.toExponential(2)} over ${encoded.channels}x${encoded.height}x${encoded.width} (stride ${encoded.stride}), reference absMax ${encoded.stats.absMax}` }
  }

  // Backward warp: upstream normalises the flow into grid coordinates and calls
  // grid_sample(align_corners=True), which must reduce to sampling at (x + flow).
  {
    const nchw = (tensorLike) => (x, y, c) => tensorLike.values[(c * tensorLike.height + y) * tensorLike.width + x]
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
    let worst = 0
    if (!error) {
      const at = await readArray(output)
      const expected = nchw(finalWarped)
      for (let y = 0; y < finalWarped.height; y += 1) for (let x = 0; x < finalWarped.width; x += 1) for (let c = 0; c < finalWarped.channels; c += 1) {
        worst = Math.max(worst, Math.abs(at(x, y, c) - expected(x, y, c)))
      }
    }
    results.warp = { pass: !error && worst < 5e-3, error, detail: `max |delta| = ${worst.toExponential(2)} against grid_sample over ${finalWarped.channels}x${finalWarped.height}x${finalWarped.width}` }
  }

  // Bilinear resize in both directions, against torch's align_corners=False grid.
  {
    const nchw = (tensorLike) => (x, y, c) => tensorLike.values[(c * tensorLike.height + y) * tensorLike.width + x]
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
      const at = await readArray(output)
      const expected = nchw(target)
      let worst = 0
      for (let y = 0; y < target.height; y += 1) for (let x = 0; x < target.width; x += 1) for (let c = 0; c < target.channels; c += 1) {
        worst = Math.max(worst, Math.abs(at(x, y, c) - expected(x, y, c)))
      }
      return { error: null, worst, output }
    }
    const source = makeArray(img0.width, img0.height, 3, nchw(img0))
    const down = await resize(source, resizeDown, 1)
    const up = down.output ? await resize(down.output, resizeUp, 1) : { error: 'downscale failed', worst: 0 }
    const worst = Math.max(down.worst, up.worst)
    results.resize = {
      pass: !down.error && !up.error && worst < 2e-3,
      error: down.error ?? up.error,
      detail: `max |delta| = ${worst.toExponential(2)} over a 1/4 downscale and a 2x upscale`,
    }
  }

  return results
}, {
  img0: stage('img0'),
  encoded: stage('encode.f0'),
  finalFlow: stage('block4.flow'),
  finalWarped: stage('block4.warped0'),
  resizeDown: stage('resize.down4'),
  resizeUp: stage('resize.up2'),
}), { routes })

if (report.fatal) {
  failures.push(`ENVIRONMENT: ${report.fatal}`)
} else {
  console.log(`oracle: ${reference.model} from ${reference.upstream}`)
  console.log(`torch ${reference.torch}, scales ${reference.config.scaleList.join('/')}, timestep ${reference.config.timestep}, ${reference.config.inputSize}x${reference.config.inputSize} 8-bit input`)
  for (const [name, entry] of Object.entries(report)) {
    if (entry.error) failures.push(`${name}: ${entry.error}`)
    else if (!entry.pass) failures.push(`${name}: ${entry.detail}`)
    else console.log(`pass        ${name} (${entry.detail})`)
  }
  console.log('\nnot implemented yet:')
  for (const [name, reason] of Object.entries(UNCOVERED)) console.log(`  ${name}: ${reason}`)
}

reportFailures(failures, 'Every implemented RIFE sub-network matches the upstream reference.')
