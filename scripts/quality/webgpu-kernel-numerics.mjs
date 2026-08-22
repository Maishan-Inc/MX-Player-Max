/**
 * Executes the packed postprocess kernels on a real GPU and compares the results
 * against CPU references. This is the numerical fixture the WGSL kernels never
 * had: the Vitest suite only asserts that shader source contains substrings.
 *
 * Two kinds of result are reported:
 *   - PASS/FAIL for behaviour with a single unambiguous answer (identity copies,
 *     addition, layer norm, 1x1 convolution channel routing, bind-group layouts).
 *   - "convention" findings for behaviour where the kernel is self-consistent but
 *     may disagree with the upstream PyTorch op. Those are reported, never
 *     asserted, because resolving them needs the upstream source (task P2).
 *
 * The adapter is software, so nothing here is performance evidence.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { reportFailures, withWebGpuPage } from './webgpu-harness.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const wgslPath = resolve(root, 'packages/postprocess/dist/gpu/wgsl.js')
const failures = []

let wgsl
try {
  wgsl = await import(pathToFileURL(wgslPath).href)
} catch {
  console.error(`- ENVIRONMENT: ${wgslPath} is missing. Run "pnpm build" first.`)
  process.exit(1)
}

const report = await withWebGpuPage(async (page) => page.evaluate(async (sources) => {
  if (!navigator.gpu) return { fatal: `navigator.gpu is undefined (isSecureContext=${window.isSecureContext})` }
  if (typeof Float16Array === 'undefined') return { fatal: 'Float16Array is unavailable in this browser build' }
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return { fatal: 'requestAdapter() returned null' }
  const device = await adapter.requestDevice()
  const results = {}

  const { createGpuHelpers } = await import('/helpers.js')
  const { makeArray, readArray, readRgba8, uniform, storage, run } = createGpuHelpers(device)

  const W = 32
  const H = 2

  // 1. The interpolation stage builds an explicit bind-group layout by hand, so a
  //    binding-number drift between layout and shader can only surface here.
  {
    const compute = GPUShaderStage.COMPUTE
    device.pushErrorScope('validation')
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: compute, texture: { sampleType: 'float' } },
        { binding: 1, visibility: compute, texture: { sampleType: 'float' } },
        { binding: 2, visibility: compute, texture: { sampleType: 'float' } },
        { binding: 3, visibility: compute, texture: { sampleType: 'float' } },
        { binding: 4, visibility: compute, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
        { binding: 6, visibility: compute, buffer: { type: 'uniform' } },
        { binding: 7, visibility: compute, buffer: { type: 'read-only-storage' } },
      ],
    })
    device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: device.createShaderModule({ code: sources.RIFE_FLOW_WGSL }), entryPoint: 'main' },
    })
    const error = await device.popErrorScope()
    results.rifeStageExplicitLayout = { pass: !error, error: error?.message.split('\n')[0] ?? null, detail: 'stage layout matches RIFE_FLOW_WGSL bindings' }
  }

  // 2. PACKED_INPUT copies an rgba8unorm frame into array layer 0 unchanged.
  {
    const source = device.createTexture({ size: { width: W, height: H }, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    const bytes = new Uint8Array(W * H * 4)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 7) % 256
    device.queue.writeTexture({ texture: source }, bytes, { bytesPerRow: W * 4, rowsPerImage: H }, { width: W, height: H })
    const output = makeArray(W, H, 4)
    const params = uniform(new Uint32Array([W, H, 0, 0]))
    const error = await run(sources.PACKED_INPUT_WGSL, [
      { binding: 0, resource: source.createView() },
      { binding: 1, resource: output.view() },
      { binding: 2, resource: { buffer: params } },
    ], Math.ceil(W / 8), Math.ceil(H / 8), 1)
    let worst = 0
    if (!error) {
      const at = await readArray(output)
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) for (let c = 0; c < 4; c += 1) {
        worst = Math.max(worst, Math.abs(at(x, y, c) - bytes[(y * W + x) * 4 + c] / 255))
      }
    }
    results.packedInputCopy = { pass: !error && worst < 2e-3, error, detail: `max |delta| = ${worst.toExponential(2)}` }
  }

  // 3. PACKED_ADD sums every channel of two packed tensors.
  {
    const left = makeArray(W, H, 8, (x, _y, c) => x + c)
    const right = makeArray(W, H, 8, (_x, y, c) => 100 * (y + 1) + c)
    const output = makeArray(W, H, 8)
    const params = uniform(new Uint32Array([W, H, output.groups, 0]))
    const error = await run(sources.PACKED_ADD_WGSL, [
      { binding: 0, resource: left.view() },
      { binding: 1, resource: right.view() },
      { binding: 2, resource: output.view() },
      { binding: 3, resource: { buffer: params } },
    ], Math.ceil(W / 8), Math.ceil(H / 8), output.groups)
    let worst = 0
    if (!error) {
      const at = await readArray(output)
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) for (let c = 0; c < 8; c += 1) {
        worst = Math.max(worst, Math.abs(at(x, y, c) - (x + c + 100 * (y + 1) + c)))
      }
    }
    results.packedAdd = { pass: !error && worst < 0.05, error, detail: `max |delta| = ${worst.toExponential(2)}` }
  }

  // 4. PACKED_LAYER_NORM normalises across all channels of a pixel. The uniform
  //    buffer is deliberately sized the way Rt4kSrGraphExecutor sizes it, so an
  //    undersized binding shows up here rather than at runtime.
  {
    const channels = 8
    const value = (x, y, c) => 1 + 0.25 * c + 0.5 * x - 0.75 * y
    const input = makeArray(W, H, channels, value)
    const output = makeArray(W, H, channels)
    const scale = new Float32Array([1, 1, 2, 0.5, 1.5, 1, 0.25, 2])
    const shift = new Float32Array([0, 1, 0, -1, 0.5, 0, -0.5, 1])
    const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const view = new DataView(new ArrayBuffer(32))
    view.setUint32(0, W, true); view.setUint32(4, H, true)
    view.setUint32(8, channels, true); view.setUint32(12, output.groups, true)
    view.setFloat32(16, 1e-6, true)
    device.queue.writeBuffer(params, 0, view.buffer)
    const error = await run(sources.PACKED_LAYER_NORM_WGSL, [
      { binding: 0, resource: input.view() },
      { binding: 1, resource: output.view() },
      { binding: 2, resource: { buffer: storage(scale) } },
      { binding: 3, resource: { buffer: storage(shift) } },
      { binding: 4, resource: { buffer: params } },
    ], Math.ceil(W / 8), Math.ceil(H / 8), output.groups)
    let worst = 0
    if (!error) {
      const at = await readArray(output)
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
        const all = Array.from({ length: channels }, (_, c) => value(x, y, c))
        const mean = all.reduce((sum, v) => sum + v, 0) / channels
        const variance = Math.max(all.reduce((sum, v) => sum + v * v, 0) / channels - mean * mean, 0)
        for (let c = 0; c < channels; c += 1) {
          const expected = (all[c] - mean) / Math.sqrt(variance + 1e-6) * scale[c] + shift[c]
          worst = Math.max(worst, Math.abs(at(x, y, c) - expected))
        }
      }
    }
    results.packedLayerNorm = { pass: !error && worst < 0.05, error, detail: `max |delta| = ${worst.toExponential(2)}, 32-byte uniform accepted` }
  }

  // 5. PACKED_CONVOLUTION with a 1x1 identity kernel and ReLU: verifies the
  //    weight index layout, the four-lane packing and the activation branch
  //    without involving padding (padding convention is left to the oracle).
  {
    const channels = 4
    const value = (x, _y, c) => c - 1.5 + 0.25 * (x % 3)
    const input = makeArray(W, H, channels, value)
    const output = makeArray(W, H, channels)
    const weights = new Float32Array(channels * channels)
    for (let out = 0; out < channels; out += 1) weights[out * channels + out] = 1
    const params = uniform(new Uint32Array([W, H, W, H, channels, channels, 1, 1, input.groups, output.groups, 1, 0, 0, 0, 0, 0]))
    const error = await run(sources.PACKED_CONVOLUTION_WGSL, [
      { binding: 0, resource: input.view() },
      { binding: 1, resource: output.view() },
      { binding: 2, resource: { buffer: storage(weights) } },
      { binding: 3, resource: { buffer: storage(new Float32Array(channels)) } },
      { binding: 4, resource: { buffer: params } },
      { binding: 5, resource: input.view() },
      { binding: 6, resource: { buffer: storage(new Float32Array(channels)) } },
    ], Math.ceil(W / 8), Math.ceil(H / 8), output.groups)
    let worst = 0
    if (!error) {
      const at = await readArray(output)
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) for (let c = 0; c < channels; c += 1) {
        worst = Math.max(worst, Math.abs(at(x, y, c) - Math.max(value(x, y, c), 0)))
      }
    }
    results.packedConvolutionIdentityRelu = { pass: !error && worst < 0.02, error, detail: `max |delta| = ${worst.toExponential(2)}` }
  }

  // 6. Pixel unshuffle must follow torch.nn.PixelUnshuffle ordering, because the
  //    RT4KSR head weights were trained against it.
  {
    const width = 8, height = 2, scale = 2, channels = 3
    const block = scale * scale
    const outWidth = width / scale, outHeight = height / scale, outChannels = channels * block
    const value = (x, y, c) => c * 100 + y * 10 + x
    const input = makeArray(width, height, channels, value)
    const output = makeArray(outWidth, outHeight, outChannels)
    const params = uniform(new Uint32Array([width, height, channels, scale, output.groups]))
    const error = await run(sources.PACKED_PIXEL_UNSHUFFLE_WGSL, [
      { binding: 0, resource: input.view() },
      { binding: 1, resource: output.view() },
      { binding: 2, resource: { buffer: params } },
    ], Math.ceil(outWidth / 8), Math.ceil(outHeight / 8), output.groups)
    let worst = 0
    if (!error) {
      const at = await readArray(output)
      for (let x = 0; x < outWidth; x += 1) for (let channel = 0; channel < outChannels; channel += 1) {
        const plane = channel % block
        const expected = value(x * scale + (plane % scale), Math.floor(plane / scale), Math.floor(channel / block))
        worst = Math.max(worst, Math.abs(at(x, 0, channel) - expected))
      }
    }
    results.pixelUnshuffleTorchOrder = { pass: !error && worst < 0.05, error, detail: `max |delta| = ${worst.toExponential(2)} vs torch channel-major` }
  }

  // 7. Pixel shuffle x4 — the mirror requirement at the output end.
  {
    const inWidth = 2, inHeight = 1, scale = 4, channels = 3
    const block = scale * scale
    const inChannels = channels * block
    const outWidth = inWidth * scale, outHeight = inHeight * scale
    const value = (_x, _y, c) => c / inChannels
    const input = makeArray(inWidth, inHeight, inChannels, value)
    const output = device.createTexture({ size: { width: outWidth, height: outHeight }, format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC })
    const params = uniform(new Uint32Array([inWidth, inHeight, outWidth, outHeight, channels, scale, input.groups, 0]))
    const error = await run(sources.PACKED_PIXEL_SHUFFLE_X4_WGSL, [
      { binding: 0, resource: input.view() },
      { binding: 1, resource: output.createView() },
      { binding: 2, resource: { buffer: params } },
    ], Math.ceil(outWidth / 8), Math.ceil(outHeight / 8), 1)
    let worst = 0
    if (!error) {
      const padded = 256
      const buffer = device.createBuffer({ size: padded * outHeight, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow: padded, rowsPerImage: outHeight }, { width: outWidth, height: outHeight })
      device.queue.submit([encoder.finish()])
      await device.queue.onSubmittedWorkDone()
      await buffer.mapAsync(GPUMapMode.READ)
      const bytes = new Uint8Array(buffer.getMappedRange().slice(0))
      buffer.unmap()
      for (let y = 0; y < outHeight; y += 1) for (let x = 0; x < outWidth; x += 1) for (let c = 0; c < channels; c += 1) {
        const plane = (y % scale) * scale + (x % scale)
        worst = Math.max(worst, Math.abs(bytes[y * padded + x * 4 + c] / 255 - value(0, 0, c * block + plane)))
      }
    }
    results.pixelShuffleTorchOrder = { pass: !error && worst < 0.01, error, detail: `max |delta| = ${worst.toExponential(2)} vs torch channel-major` }
  }


  return results
}, {
  RIFE_FLOW_WGSL: wgsl.RIFE_FLOW_WGSL,
  PACKED_INPUT_WGSL: wgsl.PACKED_INPUT_WGSL,
  PACKED_ADD_WGSL: wgsl.PACKED_ADD_WGSL,
  PACKED_LAYER_NORM_WGSL: wgsl.PACKED_LAYER_NORM_WGSL,
  PACKED_CONVOLUTION_WGSL: wgsl.PACKED_CONVOLUTION_WGSL,
  PACKED_PIXEL_UNSHUFFLE_WGSL: wgsl.PACKED_PIXEL_UNSHUFFLE_WGSL,
  PACKED_PIXEL_SHUFFLE_X4_WGSL: wgsl.PACKED_PIXEL_SHUFFLE_X4_WGSL,
}))

if (report.fatal) {
  failures.push(`ENVIRONMENT: ${report.fatal}`)
} else {
  for (const [name, entry] of Object.entries(report)) {
    if (entry.convention !== undefined) {
      console.log(`convention  ${name}: kernel matches "${entry.convention}" (torch op would be "${entry.torch}")`)
      continue
    }
    if (entry.error) failures.push(`${name}: rejected by WebGPU validation — ${entry.error}`)
    else if (!entry.pass) failures.push(`${name}: ${entry.detail}`)
    else console.log(`pass        ${name}${entry.detail ? ` (${entry.detail})` : ''}`)
  }
}

reportFailures(failures, 'All executable kernel checks match their CPU reference.')
