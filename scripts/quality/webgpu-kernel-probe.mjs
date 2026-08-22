/**
 * Real WGSL compile + execution gate.
 *
 * Runs every shipped postprocess kernel through a genuine Dawn/Tint compiler and
 * executes a storage round-trip, so WGSL defects stop being invisible to Vitest.
 *
 * The adapter is software (`isFallbackAdapter === true`), which makes this a
 * correctness gate only: timings here are never performance evidence, and
 * `shader-f16` is unavailable, so f16 kernels still need real hardware.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { reportFailures, withWebGpuPage } from './webgpu-harness.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const wgslPath = resolve(root, 'packages/postprocess/dist/gpu/wgsl.js')
const failures = []

let kernels
try {
  const module = await import(pathToFileURL(wgslPath).href)
  kernels = Object.fromEntries(Object.entries(module).filter(([, value]) => typeof value === 'string'))
} catch {
  console.error(`- ENVIRONMENT: ${wgslPath} is missing. Run "pnpm build" first.`)
  process.exit(1)
}

const report = await withWebGpuPage(async (page) => page.evaluate(async (sources) => {
  if (!navigator.gpu) return { fatal: `navigator.gpu is undefined (isSecureContext=${window.isSecureContext})` }
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return { fatal: 'requestAdapter() returned null' }
  const device = await adapter.requestDevice()
  const info = adapter.info ?? {}
  const out = {
    adapter: {
      vendor: info.vendor ?? null,
      architecture: info.architecture ?? null,
      isFallbackAdapter: info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
    },
    limits: {
      maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
    },
    features: {
      shaderF16: adapter.features.has('shader-f16'),
      float32Filterable: adapter.features.has('float32-filterable'),
    },
    compile: {},
    selfCheck: {},
  }

  for (const [name, code] of Object.entries(sources)) {
    device.pushErrorScope('validation')
    const module = device.createShaderModule({ code })
    const compilation = await module.getCompilationInfo()
    const scope = await device.popErrorScope()
    const errors = [...compilation.messages]
      .filter((message) => message.type === 'error')
      .map((message) => `line ${message.lineNum}: ${message.message.split('\n')[0]}`)
    if (errors.length === 0 && scope) errors.push(scope.message.split('\n')[0])
    if (errors.length > 0) out.compile[name] = errors
  }

  // Storage round-trip in the exact format the RT4KSR packed activations use.
  const module = device.createShaderModule({
    code: `
@group(0) @binding(0) var dst: texture_storage_2d_array<rgba16float, write>;
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  textureStore(dst, vec2<i32>(i32(gid.x), 0), i32(gid.z), vec4<f32>(1.0, 2.0, 3.0, 4.0));
}`,
  })
  device.pushErrorScope('validation')
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } })
  const texture = device.createTexture({
    size: { width: 64, height: 1, depthOrArrayLayers: 2 },
    format: 'rgba16float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: texture.createView({ dimension: '2d-array', arrayLayerCount: 2 }) }],
  })
  const readback = device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(64, 1, 2)
  pass.end()
  encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow: 512, rowsPerImage: 1 }, { width: 64, height: 1, depthOrArrayLayers: 2 })
  device.queue.submit([encoder.finish()])
  const scope = await device.popErrorScope()
  await device.queue.onSubmittedWorkDone()
  await readback.mapAsync(GPUMapMode.READ)
  const half = [...new Uint16Array(readback.getMappedRange().slice(0, 8))]
  readback.unmap()
  out.selfCheck = {
    validationError: scope?.message.split('\n')[0] ?? null,
    halfBits: half.map((value) => `0x${value.toString(16).toUpperCase().padStart(4, '0')}`),
    pass: half[0] === 0x3c00 && half[1] === 0x4000 && half[2] === 0x4200 && half[3] === 0x4400,
  }
  return out
}, kernels))

if (report.fatal) {
  failures.push(`ENVIRONMENT: ${report.fatal}`)
} else {
  const { adapter, limits, features, selfCheck, compile } = report
  console.log(`adapter: ${adapter.vendor}/${adapter.architecture}${adapter.isFallbackAdapter ? ' (software fallback)' : ''}`)
  console.log(`limits: maxTextureDimension2D=${limits.maxTextureDimension2D} maxComputeWorkgroupStorageSize=${limits.maxComputeWorkgroupStorageSize}`)
  console.log(`features: shader-f16=${features.shaderF16} float32-filterable=${features.float32Filterable}`)
  if (selfCheck.validationError) failures.push(`ENVIRONMENT: storage round-trip was rejected (${selfCheck.validationError})`)
  else if (!selfCheck.pass) failures.push(`ENVIRONMENT: rgba16float array round-trip returned ${selfCheck.halfBits.join(',')}, expected 0x3C00,0x4000,0x4200,0x4400`)
  else console.log('self-check: rgba16float 2d-array storage round-trip exact')
  const broken = Object.entries(compile)
  console.log(`kernels: ${Object.keys(kernels).length - broken.length}/${Object.keys(kernels).length} compile on real Dawn/Tint`)
  for (const [name, errors] of broken) for (const error of errors) failures.push(`KERNEL ${name}: ${error}`)
}

reportFailures(failures, `All ${Object.keys(kernels).length} shipped WGSL kernels compile and the compute round-trip is exact.`)
