/**
 * Run the shipped RT4KSR graph on a real GPU and compare it against reference
 * tensors captured from the upstream PyTorch forward pass
 * (packages/postprocess/tools/generate_rt4ksr_reference.py).
 *
 * The reference input is quantised to 8 bit, so an rgba8unorm upload reproduces it
 * exactly and the whole pipeline — unshuffle, head, four NAF blocks, tail, upsample,
 * shuffle — can be compared end to end rather than op by op.
 */
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reportFailures, withWebGpuPage } from './webgpu-harness.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixturePath = resolve(root, 'packages/postprocess/tests/fixtures/rt4ksr-reference.json')
const failures = []

let reference
try {
  reference = JSON.parse(await readFile(fixturePath, 'utf8'))
} catch {
  console.error(`- ENVIRONMENT: ${fixturePath} is missing. Regenerate it with generate_rt4ksr_reference.py.`)
  process.exit(1)
}

const stage = (name) => {
  const entry = reference.stages[name]
  if (!entry) throw new Error(`reference fixture has no stage "${name}"`)
  const [, channels, height, width] = entry.shape
  return { channels, height, width, values: entry.values }
}

const routes = {
  '/postprocess/': resolve(root, 'packages/postprocess/dist'),
  '/weights/': resolve(root, 'packages/postprocess/assets/weights'),
}

const report = await withWebGpuPage(async (page) => page.evaluate(async ({ input, down, output }) => {
  if (!navigator.gpu) return { fatal: `navigator.gpu is undefined (isSecureContext=${window.isSecureContext})` }
  if (typeof Float16Array === 'undefined') return { fatal: 'Float16Array is unavailable in this browser build' }
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return { fatal: 'requestAdapter() returned null' }
  const device = await adapter.requestDevice()
  const { createGpuHelpers } = await import('/helpers.js')
  const { makeArray, readArray, readRgba8, uniform, run } = createGpuHelpers(device)
  const { parseMxai } = await import('/postprocess/assets/mxai')
  const { createRt4kSrGraph, uploadTensorStore } = await import('/postprocess/gpu/graph')
  const { Rt4kSrGraphExecutor } = await import('/postprocess/gpu/rt4ksr')
  const { PACKED_PIXEL_UNSHUFFLE_WGSL } = await import('/postprocess/gpu/wgsl')
  const results = {}

  /** NCHW accessor over a flattened reference tensor. */
  const nchw = (tensor) => (x, y, c) => tensor.values[(c * tensor.height + y) * tensor.width + x]

  // Standalone check: torch PixelUnshuffle(2) over the real LR input.
  {
    const source = makeArray(input.width, input.height, input.channels, nchw(input))
    const target = makeArray(down.width, down.height, down.channels)
    const params = uniform(new Uint32Array([input.width, input.height, input.channels, 2, target.groups]))
    const error = await run(PACKED_PIXEL_UNSHUFFLE_WGSL, [
      { binding: 0, resource: source.view() },
      { binding: 1, resource: target.view() },
      { binding: 2, resource: { buffer: params } },
    ], Math.ceil(down.width / 8), Math.ceil(down.height / 8), target.groups)
    let worst = 0
    if (!error) {
      const at = await readArray(target)
      const expected = nchw(down)
      for (let y = 0; y < down.height; y += 1) for (let x = 0; x < down.width; x += 1) for (let c = 0; c < down.channels; c += 1) {
        worst = Math.max(worst, Math.abs(at(x, y, c) - expected(x, y, c)))
      }
    }
    results.down = { pass: !error && worst < 2e-3, error, detail: `max |delta| = ${worst.toExponential(2)}` }
  }

  // End-to-end: the shipped executor, from an 8-bit frame to the 2x output.
  {
    const bytes = new Uint8Array(await (await fetch('/weights/rt4ksr/rt4ksr_x2.mxai')).arrayBuffer())
    const model = parseMxai(bytes)
    const store = uploadTensorStore(device, model)
    const graph = createRt4kSrGraph(model)
    const executor = Rt4kSrGraphExecutor.create({ device, model, tensorStore: store })

    const frameBytes = new Uint8Array(input.width * input.height * 4)
    const source = nchw(input)
    for (let y = 0; y < input.height; y += 1) for (let x = 0; x < input.width; x += 1) {
      for (let c = 0; c < 3; c += 1) frameBytes[(y * input.width + x) * 4 + c] = Math.round(source(x, y, c) * 255)
      frameBytes[(y * input.width + x) * 4 + 3] = 255
    }
    const frame = device.createTexture({
      size: { width: input.width, height: input.height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture({ texture: frame }, frameBytes, { bytesPerRow: input.width * 4, rowsPerImage: input.height }, { width: input.width, height: input.height })

    device.pushErrorScope('validation')
    let produced = null
    let thrown = null
    try {
      produced = await executor.process(frame, input.width, input.height, 0, 0)
    } catch (cause) {
      thrown = String(cause)
    }
    const validation = await device.popErrorScope()
    let worst = 0
    let clamped = 0
    if (produced && produced.location === 'gpu') {
      const readable = device.createTexture({ size: { width: produced.width, height: produced.height }, format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC })
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToTexture({ texture: produced.texture }, { texture: readable }, { width: produced.width, height: produced.height })
      device.queue.submit([encoder.finish()])
      const at = await readRgba8(readable, produced.width, produced.height)
      const expected = nchw(output)
      for (let y = 0; y < output.height; y += 1) for (let x = 0; x < output.width; x += 1) for (let c = 0; c < output.channels; c += 1) {
        const value = expected(x, y, c)
        if (value < 0 || value > 1) clamped += 1
        worst = Math.max(worst, Math.abs(at(x, y, c) - Math.min(1, Math.max(0, value))))
      }
      produced.release()
    }
    executor.close()
    store.close()
    results.fullGraph = {
      pass: !thrown && !validation && produced !== null && worst < 0.02,
      error: thrown ?? validation?.message.split('\n')[0] ?? null,
      detail: `${graph.layers.length} layers, max |delta| = ${worst.toExponential(2)} over ${output.channels}x${output.height}x${output.width}, ${clamped} reference samples outside [0,1]`,
    }
  }

  return results
}, { input: stage('input'), down: stage('down'), output: stage('output') }), { routes })

if (report.fatal) {
  failures.push(`ENVIRONMENT: ${report.fatal}`)
} else {
  console.log(`oracle: ${reference.model} from ${reference.upstream}`)
  console.log(`torch ${reference.torch}, act=${reference.config.actType}, ${reference.config.numBlocks} blocks, ${reference.config.inputSize}x${reference.config.inputSize} 8-bit input`)
  for (const [name, entry] of Object.entries(report)) {
    if (entry.error) failures.push(`${name}: ${entry.error}`)
    else if (!entry.pass) failures.push(`${name}: ${entry.detail}`)
    else console.log(`pass        ${name} (${entry.detail})`)
  }
}

reportFailures(failures, 'The shipped RT4KSR graph matches the upstream reference end to end.')
