/**
 * In-page WebGPU helpers, served by webgpu-harness.mjs at `/helpers.js` so every
 * quality gate shares one implementation instead of duplicating buffer and
 * texture plumbing inside each `page.evaluate` call.
 *
 * Packed tensors follow the postprocess convention: NCHW channels are stored four
 * per `rgba16float` array layer, so layer = floor(channel / 4), lane = channel % 4.
 */
export function createGpuHelpers(device) {
  const ARRAY_USAGE = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST

  /** Allocate an rgba16float array texture, optionally filled from `valueAt(x, y, channel)`. */
  const makeArray = (width, height, channels, valueAt) => {
    const groups = Math.ceil(channels / 4)
    const texture = device.createTexture({ size: { width, height, depthOrArrayLayers: groups }, format: 'rgba16float', usage: ARRAY_USAGE })
    if (valueAt) {
      const data = new Float16Array(groups * height * width * 4)
      for (let layer = 0; layer < groups; layer += 1) {
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            for (let lane = 0; lane < 4; lane += 1) {
              const channel = layer * 4 + lane
              data[((layer * height + y) * width + x) * 4 + lane] = channel < channels ? valueAt(x, y, channel) : 0
            }
          }
        }
      }
      device.queue.writeTexture({ texture }, data.buffer, { bytesPerRow: width * 8, rowsPerImage: height }, { width, height, depthOrArrayLayers: groups })
    }
    return { texture, width, height, channels, groups, view: () => texture.createView({ dimension: '2d-array', arrayLayerCount: groups }) }
  }

  /** Read a packed texture back and return an `(x, y, channel) => number` accessor. */
  const readArray = async (target) => {
    const { width, height, groups } = target
    const padded = Math.ceil((width * 8) / 256) * 256
    const buffer = device.createBuffer({ size: padded * height * groups, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: target.texture }, { buffer, bytesPerRow: padded, rowsPerImage: height }, { width, height, depthOrArrayLayers: groups })
    device.queue.submit([encoder.finish()])
    await device.queue.onSubmittedWorkDone()
    await buffer.mapAsync(GPUMapMode.READ)
    const bytes = new Uint8Array(buffer.getMappedRange().slice(0))
    buffer.unmap()
    return (x, y, channel) => {
      const layer = Math.floor(channel / 4)
      const offset = (layer * height + y) * padded + x * 8
      return new Float16Array(bytes.buffer, bytes.byteOffset + offset, 4)[channel % 4]
    }
  }

  /** Read an rgba8unorm 2d texture back as an `(x, y, channel) => number` accessor in [0, 1]. */
  const readRgba8 = async (texture, width, height) => {
    const padded = Math.ceil((width * 4) / 256) * 256
    const buffer = device.createBuffer({ size: padded * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: padded, rowsPerImage: height }, { width, height })
    device.queue.submit([encoder.finish()])
    await device.queue.onSubmittedWorkDone()
    await buffer.mapAsync(GPUMapMode.READ)
    const bytes = new Uint8Array(buffer.getMappedRange().slice(0))
    buffer.unmap()
    return (x, y, channel) => bytes[y * padded + x * 4 + channel] / 255
  }

  const uniform = (values) => {
    const buffer = device.createBuffer({ size: Math.max(16, Math.ceil(values.byteLength / 16) * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(buffer, 0, values)
    return buffer
  }

  const storage = (values) => {
    const buffer = device.createBuffer({ size: Math.max(4, values.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(buffer, 0, values)
    return buffer
  }

  /** Compile, bind and dispatch once. Returns the validation error message, or null. */
  const run = async (code, entries, x, y, z) => {
    device.pushErrorScope('validation')
    const module = device.createShaderModule({ code })
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } })
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(x, y, z)
    pass.end()
    device.queue.submit([encoder.finish()])
    const error = await device.popErrorScope()
    await device.queue.onSubmittedWorkDone()
    return error?.message.split('\n')[0] ?? null
  }

  return { makeArray, readArray, readRgba8, uniform, storage, run }
}
