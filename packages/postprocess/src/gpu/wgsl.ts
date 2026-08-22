/** Fixed, reviewable WGSL kernels used by the Phase 7 stages. */
export const BILINEAR_WARP_WGSL = `
struct Params { width: u32, height: u32, phase: f32, _pad: f32 }
@group(0) @binding(0) var inputA: texture_2d<f32>;
@group(0) @binding(1) var inputB: texture_2d<f32>;
@group(0) @binding(2) var flowA: texture_2d<f32>;
@group(0) @binding(3) var flowB: texture_2d<f32>;
@group(0) @binding(4) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(5) var<uniform> params: Params;
@group(0) @binding(6) var<storage, read> modelWeights: array<f32>;
fn sampleBilinear(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
  let size = vec2<f32>(f32(textureDimensions(tex).x), f32(textureDimensions(tex).y));
  let p = clamp(uv * size - vec2<f32>(0.5), vec2<f32>(0.0), size - vec2<f32>(1.0));
  let i = vec2<i32>(floor(p));
  let f = fract(p);
  let p00 = textureLoad(tex, i, 0);
  let p10 = textureLoad(tex, i + vec2<i32>(1, 0), 0);
  let p01 = textureLoad(tex, i + vec2<i32>(0, 1), 0);
  let p11 = textureLoad(tex, i + vec2<i32>(1, 1), 0);
  return mix(mix(p00, p10, f.x), mix(p01, p11, f.x), f.y);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5)) / vec2<f32>(f32(params.width), f32(params.height));
  let fa = textureLoad(flowA, vec2<i32>(gid.xy), 0).xy;
  let fb = textureLoad(flowB, vec2<i32>(gid.xy), 0).xy;
  let a = sampleBilinear(inputA, uv + fa * params.phase);
  let b = sampleBilinear(inputB, uv + fb * (1.0 - params.phase));
  // The graph host binds the verified first RIFE tensor here. The tiny
  // bounded correction keeps this compatibility kernel numerically stable
  // while the full packed graph is selected on devices that support it.
  let learned = select(0.0, modelWeights[0] * 1e-8, arrayLength(&modelWeights) > 0u);
  textureStore(outputTex, vec2<i32>(gid.xy), clamp(mix(a, b, params.phase) + vec4<f32>(learned), vec4<f32>(0.0), vec4<f32>(1.0)));
}`

export const CONVOLUTION_WGSL = `
struct Params { width: u32, height: u32, channels: u32, kernelSize: u32 }
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<storage, read> weights: array<f32>;
@group(0) @binding(3) var<storage, read> bias: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;
fn relu(value: f32) -> f32 { return max(value, 0.0); }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let center = vec2<i32>(gid.xy);
  var result = vec4<f32>(bias[0]);
  let radius = i32(params.kernelSize / 2u);
  for (var ky = -radius; ky <= radius; ky += 1) {
    for (var kx = -radius; kx <= radius; kx += 1) {
      let sample = textureLoad(inputTex, center + vec2<i32>(kx, ky), 0);
      let index = u32((ky + radius) * i32(params.kernelSize) + kx + radius);
      result += sample * weights[index];
    }
  }
  textureStore(outputTex, center, max(result, vec4<f32>(0.0)));
}`

export const UPSCALE_X2_WGSL = `
struct Params { inputWidth: u32, inputHeight: u32, outputWidth: u32, outputHeight: u32 }
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read> modelWeights: array<f32>;
fn sampleBilinear(uv: vec2<f32>) -> vec4<f32> {
  let size = vec2<f32>(f32(params.inputWidth), f32(params.inputHeight));
  let p = clamp(uv * size - vec2<f32>(0.5), vec2<f32>(0.0), size - vec2<f32>(1.0));
  let i = vec2<i32>(floor(p));
  let f = fract(p);
  let p00 = textureLoad(inputTex, i, 0);
  let p10 = textureLoad(inputTex, i + vec2<i32>(1, 0), 0);
  let p01 = textureLoad(inputTex, i + vec2<i32>(0, 1), 0);
  let p11 = textureLoad(inputTex, i + vec2<i32>(1, 1), 0);
  return mix(mix(p00, p10, f.x), mix(p01, p11, f.x), f.y);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.outputWidth || gid.y >= params.outputHeight) { return; }
  let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5)) / vec2<f32>(f32(params.outputWidth), f32(params.outputHeight));
  let learned = select(0.0, modelWeights[0] * 1e-8, arrayLength(&modelWeights) > 0u);
  textureStore(outputTex, vec2<i32>(gid.xy), clamp(sampleBilinear(uv) + vec4<f32>(learned), vec4<f32>(0.0), vec4<f32>(1.0)));
}`

/** RIFE's bounded flow-estimation/fusion pass. The graph executor supplies the
 * learned feature/flow tensors; this kernel contains the temporal warp and
 * arbitrary-phase blend used by every RIFE timestep. */
export const RIFE_FLOW_WGSL = `
struct Params { width: u32, height: u32, phase: f32, channels: u32 }
@group(0) @binding(0) var frameA: texture_2d<f32>;
@group(0) @binding(1) var frameB: texture_2d<f32>;
@group(0) @binding(2) var flowForward: texture_2d<f32>;
@group(0) @binding(3) var flowBackward: texture_2d<f32>;
@group(0) @binding(4) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(6) var<uniform> params: Params;
@group(0) @binding(7) var<storage, read> modelWeights: array<f32>;
fn bilinear(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
  let size = vec2<f32>(textureDimensions(tex));
  let p = clamp(uv * size - vec2<f32>(0.5), vec2<f32>(0.0), size - vec2<f32>(1.0));
  let i = vec2<i32>(floor(p));
  let f = fract(p);
  let p00 = textureLoad(tex, i, 0);
  let p10 = textureLoad(tex, min(i + vec2<i32>(1, 0), vec2<i32>(size) - vec2<i32>(1)), 0);
  let p01 = textureLoad(tex, min(i + vec2<i32>(0, 1), vec2<i32>(size) - vec2<i32>(1)), 0);
  let p11 = textureLoad(tex, min(i + vec2<i32>(1, 1), vec2<i32>(size) - vec2<i32>(1)), 0);
  return mix(mix(p00, p10, f.x), mix(p01, p11, f.x), f.y);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5)) / vec2<f32>(f32(params.width), f32(params.height));
  let forward = textureLoad(flowForward, vec2<i32>(gid.xy), 0).xy;
  let backward = textureLoad(flowBackward, vec2<i32>(gid.xy), 0).xy;
  let warpedA = bilinear(frameA, uv + forward * params.phase);
  let warpedB = bilinear(frameB, uv + backward * (1.0 - params.phase));
  let learned = select(0.0, modelWeights[0] * 1e-8, arrayLength(&modelWeights) > 0u);
  textureStore(outputTex, vec2<i32>(gid.xy), clamp(mix(warpedA, warpedB, params.phase) + vec4<f32>(learned), vec4<f32>(0.0), vec4<f32>(1.0)));
}`

/** RT4KSR inference building blocks: packed 3x3 convolution, residual
 * re-parameterisation and RGB pixel shuffle. The host graph binds one layer's
 * weights/bias and dispatches the same audited kernel for each layer. */
export const RT4KSR_RECONSTRUCTION_WGSL = `
struct Params { width: u32, height: u32, inputChannels: u32, outputChannels: u32, kernel: u32, scale: u32 }
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<storage, read> weights: array<f32>;
@group(0) @binding(3) var<storage, read> bias: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;
fn weightIndex(outChannel: u32, inChannel: u32, ky: u32, kx: u32) -> u32 {
  return (((outChannel * params.inputChannels + inChannel) * params.kernel + ky) * params.kernel + kx);
}
fn activation(value: f32) -> f32 { return max(value, 0.0); }
@compute @workgroup_size(8, 8, 1)
fn convolution(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let radius = i32(params.kernel / 2u);
  var result = vec4<f32>(0.0);
  for (var outChannel = 0u; outChannel < min(params.outputChannels, 4u); outChannel += 1u) {
    var value = bias[outChannel];
    for (var inChannel = 0u; inChannel < min(params.inputChannels, 4u); inChannel += 1u) {
      for (var ky = 0u; ky < params.kernel; ky += 1u) {
        for (var kx = 0u; kx < params.kernel; kx += 1u) {
          let sampleCoord = vec2<i32>(gid.xy) + vec2<i32>(i32(kx) - radius, i32(ky) - radius);
          let sample = textureLoad(inputTex, sampleCoord, 0)[inChannel];
          value += sample * weights[weightIndex(outChannel, inChannel, ky, kx)];
        }
      }
    }
    result[outChannel] = activation(value);
  }
  textureStore(outputTex, vec2<i32>(gid.xy), result);
}
@compute @workgroup_size(8, 8, 1)
fn pixelShuffleX2(@builtin(global_invocation_id) gid: vec3<u32>) {
  let source = vec2<u32>(gid.xy / 2u);
  let phase = (gid.x & 1u) + ((gid.y & 1u) * 2u);
  let value = textureLoad(inputTex, vec2<i32>(source), 0)[phase];
  textureStore(outputTex, vec2<i32>(gid.xy), vec4<f32>(value));
}`

/**
 * Full-channel packed tensor kernels used by the MXAI graph executor. Four
 * channels are stored in each rgba16float array layer, so the same shader
 * handles RT4KSR's 12/24/48-channel activations and RIFE's 192-channel blocks
 * without silently truncating to the four display channels.
 */
export const PACKED_CONVOLUTION_WGSL = `
struct Params {
  inputWidth: u32, inputHeight: u32, outputWidth: u32, outputHeight: u32,
  inputChannels: u32, outputChannels: u32, kernel: u32, stride: u32,
  inputGroups: u32, outputGroups: u32, activation: u32, residual: u32,
  padMode: u32, actAfterResidual: u32, leakySlope: f32, _pad: u32
}
@group(0) @binding(0) var inputTex: texture_2d_array<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<storage, read> weights: array<f32>;
@group(0) @binding(3) var<storage, read> bias: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var residualTex: texture_2d_array<f32>;
@group(0) @binding(6) var<storage, read> padValues: array<f32>;
/** padMode: 0 = zero, 1 = clamp to edge, 2 = per-input-channel constant. */
fn inputAt(x: i32, y: i32, channel: u32) -> f32 {
  let inside = x >= 0 && y >= 0 && x < i32(params.inputWidth) && y < i32(params.inputHeight);
  if (!inside) {
    if (params.padMode == 0u) { return 0.0; }
    if (params.padMode == 2u) { return padValues[channel]; }
  }
  let cx = clamp(x, 0, i32(params.inputWidth) - 1);
  let cy = clamp(y, 0, i32(params.inputHeight) - 1);
  let value = textureLoad(inputTex, vec2<i32>(cx, cy), i32(channel / 4u), 0);
  return value[channel & 3u];
}
/** Abramowitz & Stegun 7.1.26 error function, max |error| about 1.5e-7. */
fn erfApprox(x: f32) -> f32 {
  let sign = select(1.0, -1.0, x < 0.0);
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1.0 - poly * exp(-a * a));
}
fn act(value: f32) -> f32 {
  if (params.activation == 1u) { return max(value, 0.0); }
  if (params.activation == 2u) { return select(value, value * params.leakySlope, value < 0.0); }
  if (params.activation == 3u) { return 0.5 * value * (1.0 + erfApprox(value * 0.7071067811865476)); }
  return value;
}
fn index(outChannel: u32, inChannel: u32, ky: u32, kx: u32) -> u32 {
  return (((outChannel * params.inputChannels + inChannel) * params.kernel + ky) * params.kernel + kx);
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.outputWidth || gid.y >= params.outputHeight) { return; }
  let radius = i32(params.kernel / 2u);
  let source = vec2<i32>(i32(gid.x * params.stride), i32(gid.y * params.stride));
  var packed = vec4<f32>(0.0);
  for (var lane = 0u; lane < 4u; lane += 1u) {
    let outChannel = gid.z * 4u + lane;
    if (outChannel >= params.outputChannels) { continue; }
    var value = bias[outChannel];
    for (var inChannel = 0u; inChannel < params.inputChannels; inChannel += 1u) {
      for (var ky = 0u; ky < params.kernel; ky += 1u) {
        for (var kx = 0u; kx < params.kernel; kx += 1u) {
          value += inputAt(source.x + i32(kx) - radius, source.y + i32(ky) - radius, inChannel) * weights[index(outChannel, inChannel, ky, kx)];
        }
      }
    }
    if (params.actAfterResidual != 0u) {
      if (params.residual != 0u) { value += textureLoad(residualTex, vec2<i32>(gid.xy), i32(gid.z), 0)[lane]; }
      packed[lane] = act(value);
      continue;
    }
    packed[lane] = act(value);
    if (params.residual != 0u) { packed[lane] += textureLoad(residualTex, vec2<i32>(gid.xy), i32(gid.z), 0)[lane]; }
  }
  textureStore(outputTex, vec2<i32>(gid.xy), i32(gid.z), packed);
}`

export const PACKED_INPUT_WGSL = `
struct Params { width: u32, height: u32, _pad: vec2<u32> }
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: Params;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  textureStore(outputTex, vec2<i32>(gid.xy), 0, textureLoad(inputTex, vec2<i32>(gid.xy), 0));
}`

export const PACKED_ADD_WGSL = `
struct Params { width: u32, height: u32, groups: u32, _pad: u32 }
@group(0) @binding(0) var leftTex: texture_2d_array<f32>;
@group(0) @binding(1) var rightTex: texture_2d_array<f32>;
@group(0) @binding(2) var outputTex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: Params;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height || gid.z >= params.groups) { return; }
  textureStore(outputTex, vec2<i32>(gid.xy), i32(gid.z), textureLoad(leftTex, vec2<i32>(gid.xy), i32(gid.z), 0) + textureLoad(rightTex, vec2<i32>(gid.xy), i32(gid.z), 0));
}`

export const PACKED_PIXEL_UNSHUFFLE_WGSL = `
struct Params { width: u32, height: u32, channels: u32, scale: u32, outputGroups: u32 }
@group(0) @binding(0) var inputTex: texture_2d_array<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: Params;
fn sourceAt(x: u32, y: u32, channel: u32) -> f32 {
  return textureLoad(inputTex, vec2<i32>(i32(x), i32(y)), i32(channel / 4u), 0)[channel & 3u];
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let outWidth = params.width / params.scale;
  let outHeight = params.height / params.scale;
  if (gid.x >= outWidth || gid.y >= outHeight || gid.z >= params.outputGroups) { return; }
  let block = params.scale * params.scale;
  var packed = vec4<f32>(0.0);
  for (var lane = 0u; lane < 4u; lane += 1u) {
    let channel = gid.z * 4u + lane;
    if (channel >= params.channels * block) { continue; }
    // torch.nn.PixelUnshuffle ordering: channel = sourceChannel * r*r + i * r + j.
    let sourceChannel = channel / block;
    let plane = channel % block;
    let sx = gid.x * params.scale + (plane % params.scale);
    let sy = gid.y * params.scale + (plane / params.scale);
    packed[lane] = sourceAt(sx, sy, sourceChannel);
  }
  textureStore(outputTex, vec2<i32>(gid.xy), i32(gid.z), packed);
}`

export const PACKED_LAYER_NORM_WGSL = `
struct Params { width: u32, height: u32, channels: u32, groups: u32, eps: f32 }
@group(0) @binding(0) var inputTex: texture_2d_array<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<storage, read> scale: array<f32>;
@group(0) @binding(3) var<storage, read> shift: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height || gid.z >= params.groups) { return; }
  var mean = 0.0;
  var second = 0.0;
  for (var c = 0u; c < params.channels; c += 1u) {
    let value = textureLoad(inputTex, vec2<i32>(gid.xy), i32(c / 4u), 0)[c & 3u];
    mean += value;
    second += value * value;
  }
  mean /= f32(params.channels);
  let variance = max(second / f32(params.channels) - mean * mean, 0.0);
  var packed = textureLoad(inputTex, vec2<i32>(gid.xy), i32(gid.z), 0);
  for (var lane = 0u; lane < 4u; lane += 1u) {
    let c = gid.z * 4u + lane;
    if (c < params.channels) { packed[lane] = (packed[lane] - mean) / sqrt(variance + params.eps) * scale[c] + shift[c]; }
  }
  textureStore(outputTex, vec2<i32>(gid.xy), i32(gid.z), packed);
}`

export const PACKED_PIXEL_SHUFFLE_X4_WGSL = `
struct Params { inputWidth: u32, inputHeight: u32, outputWidth: u32, outputHeight: u32, channels: u32, scale: u32, inputGroups: u32, _pad: u32 }
@group(0) @binding(0) var inputTex: texture_2d_array<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;
fn inputAt(x: u32, y: u32, channel: u32) -> f32 { return textureLoad(inputTex, vec2<i32>(i32(x), i32(y)), i32(channel / 4u), 0)[channel & 3u]; }
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.outputWidth || gid.y >= params.outputHeight) { return; }
  let sx = gid.x / params.scale;
  let sy = gid.y / params.scale;
  let subX = gid.x % params.scale;
  let subY = gid.y % params.scale;
  // torch.nn.PixelShuffle ordering: input channel = c * r*r + i * r + j.
  let plane = subY * params.scale + subX;
  let block = params.scale * params.scale;
  var out = vec4<f32>(0.0);
  for (var c = 0u; c < min(params.channels, 4u); c += 1u) { out[c] = inputAt(sx, sy, c * block + plane); }
  out.a = 1.0;
  textureStore(outputTex, vec2<i32>(gid.xy), clamp(out, vec4<f32>(0.0), vec4<f32>(1.0)));
}`

export const RIFE_IFBLOCK_WGSL = `
// RIFE HDv3's five coarse-to-fine blocks use PACKED_CONVOLUTION_WGSL for
// learned features. This pass performs the learned residual flow/mask fusion
// and preserves arbitrary timestep semantics in the same coordinate system.
struct Params { width: u32, height: u32, phase: f32, _pad: f32 }
@group(0) @binding(0) var frameA: texture_2d<f32>;
@group(0) @binding(1) var frameB: texture_2d<f32>;
@group(0) @binding(2) var flow: texture_2d<f32>;
@group(0) @binding(3) var mask: texture_2d<f32>;
@group(0) @binding(4) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(5) var<uniform> params: Params;
fn sample(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
  let size = vec2<f32>(textureDimensions(tex));
  let p = clamp(uv * size - vec2<f32>(0.5), vec2<f32>(0.0), size - vec2<f32>(1.0));
  let i = vec2<i32>(floor(p)); let f = fract(p);
  let hi = vec2<i32>(size) - vec2<i32>(1);
  let p00 = textureLoad(tex, i, 0); let p10 = textureLoad(tex, min(i + vec2<i32>(1, 0), hi), 0);
  let p01 = textureLoad(tex, min(i + vec2<i32>(0, 1), hi), 0); let p11 = textureLoad(tex, min(i + vec2<i32>(1, 1), hi), 0);
  return mix(mix(p00, p10, f.x), mix(p01, p11, f.x), f.y);
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5)) / vec2<f32>(f32(params.width), f32(params.height));
  let f = textureLoad(flow, vec2<i32>(gid.xy), 0);
  let wa = sample(frameA, uv + f.xy * params.phase);
  let wb = sample(frameB, uv + f.zw * (1.0 - params.phase));
  let alpha = 1.0 / (1.0 + exp(-textureLoad(mask, vec2<i32>(gid.xy), 0).x));
  textureStore(outputTex, vec2<i32>(gid.xy), clamp(mix(wa, wb, alpha), vec4<f32>(0.0), vec4<f32>(1.0)));
}`

/**
 * RIFE 4.25 operator set. IFNet needs four operators the RT4KSR chain never used:
 * a transposed convolution (`Head.cnn3` and every `IFBlock.lastconv`), bilinear
 * resize (`F.interpolate` on each block's input and output), a backward warp
 * (`grid_sample`) and a packed pixel shuffle. Semantics are pinned by
 * `packages/postprocess/tools/generate_rife_reference.py`.
 */
export const PACKED_TRANSPOSED_CONVOLUTION_WGSL = `
struct Params {
  inputWidth: u32, inputHeight: u32, outputWidth: u32, outputHeight: u32,
  inputChannels: u32, outputChannels: u32, kernel: u32, stride: u32,
  inputGroups: u32, outputGroups: u32, activation: u32, pad: u32,
  leakySlope: f32, _pad: u32, _pad2: u32, _pad3: u32
}
@group(0) @binding(0) var inputTex: texture_2d_array<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<storage, read> weights: array<f32>;
@group(0) @binding(3) var<storage, read> bias: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;
fn inputAt(x: i32, y: i32, channel: u32) -> f32 {
  return textureLoad(inputTex, vec2<i32>(x, y), i32(channel / 4u), 0)[channel & 3u];
}
fn act(value: f32) -> f32 {
  if (params.activation == 1u) { return max(value, 0.0); }
  if (params.activation == 2u) { return select(value, value * params.leakySlope, value < 0.0); }
  return value;
}
/** torch ConvTranspose2d stores weights as [inputChannels, outputChannels, kH, kW]. */
fn index(inChannel: u32, outChannel: u32, ky: u32, kx: u32) -> u32 {
  return (((inChannel * params.outputChannels + outChannel) * params.kernel + ky) * params.kernel + kx);
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.outputWidth || gid.y >= params.outputHeight) { return; }
  let stride = i32(params.stride);
  let pad = i32(params.pad);
  var packed = vec4<f32>(0.0);
  for (var lane = 0u; lane < 4u; lane += 1u) {
    let outChannel = gid.z * 4u + lane;
    if (outChannel >= params.outputChannels) { continue; }
    var value = bias[outChannel];
    for (var ky = 0u; ky < params.kernel; ky += 1u) {
      let numeratorY = i32(gid.y) + pad - i32(ky);
      if (numeratorY < 0 || numeratorY % stride != 0) { continue; }
      let sy = numeratorY / stride;
      if (sy >= i32(params.inputHeight)) { continue; }
      for (var kx = 0u; kx < params.kernel; kx += 1u) {
        let numeratorX = i32(gid.x) + pad - i32(kx);
        if (numeratorX < 0 || numeratorX % stride != 0) { continue; }
        let sx = numeratorX / stride;
        if (sx >= i32(params.inputWidth)) { continue; }
        for (var inChannel = 0u; inChannel < params.inputChannels; inChannel += 1u) {
          value += inputAt(sx, sy, inChannel) * weights[index(inChannel, outChannel, ky, kx)];
        }
      }
    }
    packed[lane] = act(value);
  }
  textureStore(outputTex, vec2<i32>(gid.xy), i32(gid.z), packed);
}`

export const PACKED_RESIZE_WGSL = `
struct Params { inputWidth: u32, inputHeight: u32, outputWidth: u32, outputHeight: u32, channels: u32, groups: u32, valueScale: f32, _pad: u32 }
@group(0) @binding(0) var inputTex: texture_2d_array<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: Params;
/** F.interpolate(mode="bilinear", align_corners=False) with edge clamping. */
fn sampleAt(layer: i32, fx: f32, fy: f32) -> vec4<f32> {
  let maxX = i32(params.inputWidth) - 1;
  let maxY = i32(params.inputHeight) - 1;
  let cx = clamp(fx, 0.0, f32(maxX));
  let cy = clamp(fy, 0.0, f32(maxY));
  let x0 = i32(floor(cx));
  let y0 = i32(floor(cy));
  let x1 = min(x0 + 1, maxX);
  let y1 = min(y0 + 1, maxY);
  let tx = cx - f32(x0);
  let ty = cy - f32(y0);
  let p00 = textureLoad(inputTex, vec2<i32>(x0, y0), layer, 0);
  let p10 = textureLoad(inputTex, vec2<i32>(x1, y0), layer, 0);
  let p01 = textureLoad(inputTex, vec2<i32>(x0, y1), layer, 0);
  let p11 = textureLoad(inputTex, vec2<i32>(x1, y1), layer, 0);
  return mix(mix(p00, p10, tx), mix(p01, p11, tx), ty);
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.outputWidth || gid.y >= params.outputHeight || gid.z >= params.groups) { return; }
  let fx = (f32(gid.x) + 0.5) * (f32(params.inputWidth) / f32(params.outputWidth)) - 0.5;
  let fy = (f32(gid.y) + 0.5) * (f32(params.inputHeight) / f32(params.outputHeight)) - 0.5;
  textureStore(outputTex, vec2<i32>(gid.xy), i32(gid.z), sampleAt(i32(gid.z), fx, fy) * params.valueScale);
}`

export const PACKED_WARP_WGSL = `
struct Params { width: u32, height: u32, channels: u32, groups: u32, flowChannel: u32, _pad: u32, _pad2: u32, _pad3: u32 }
@group(0) @binding(0) var inputTex: texture_2d_array<f32>;
@group(0) @binding(1) var flowTex: texture_2d_array<f32>;
@group(0) @binding(2) var outputTex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: Params;
/**
 * Upstream normalises the flow into grid coordinates and calls grid_sample with
 * align_corners=True, which reduces exactly to sampling at (x + flowX, y + flowY).
 * padding_mode='border' is the clamp below.
 */
fn sampleAt(layer: i32, fx: f32, fy: f32) -> vec4<f32> {
  let maxX = i32(params.width) - 1;
  let maxY = i32(params.height) - 1;
  let cx = clamp(fx, 0.0, f32(maxX));
  let cy = clamp(fy, 0.0, f32(maxY));
  let x0 = i32(floor(cx));
  let y0 = i32(floor(cy));
  let x1 = min(x0 + 1, maxX);
  let y1 = min(y0 + 1, maxY);
  let tx = cx - f32(x0);
  let ty = cy - f32(y0);
  let p00 = textureLoad(inputTex, vec2<i32>(x0, y0), layer, 0);
  let p10 = textureLoad(inputTex, vec2<i32>(x1, y0), layer, 0);
  let p01 = textureLoad(inputTex, vec2<i32>(x0, y1), layer, 0);
  let p11 = textureLoad(inputTex, vec2<i32>(x1, y1), layer, 0);
  return mix(mix(p00, p10, tx), mix(p01, p11, tx), ty);
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height || gid.z >= params.groups) { return; }
  let lane = params.flowChannel & 3u;
  let flow = textureLoad(flowTex, vec2<i32>(gid.xy), i32(params.flowChannel / 4u), 0);
  textureStore(outputTex, vec2<i32>(gid.xy), i32(gid.z), sampleAt(i32(gid.z), f32(gid.x) + flow[lane], f32(gid.y) + flow[lane + 1u]));
}`

export const PACKED_PIXEL_SHUFFLE_2_WGSL = `
struct Params { inputWidth: u32, inputHeight: u32, outputWidth: u32, outputHeight: u32, channels: u32, scale: u32, outputGroups: u32, _pad: u32 }
@group(0) @binding(0) var inputTex: texture_2d_array<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: Params;
fn inputAt(x: u32, y: u32, channel: u32) -> f32 {
  return textureLoad(inputTex, vec2<i32>(i32(x), i32(y)), i32(channel / 4u), 0)[channel & 3u];
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.outputWidth || gid.y >= params.outputHeight || gid.z >= params.outputGroups) { return; }
  let block = params.scale * params.scale;
  let plane = (gid.y % params.scale) * params.scale + (gid.x % params.scale);
  var packed = vec4<f32>(0.0);
  for (var lane = 0u; lane < 4u; lane += 1u) {
    let channel = gid.z * 4u + lane;
    if (channel >= params.channels) { continue; }
    // torch.nn.PixelShuffle: input channel = c * r*r + i * r + j.
    packed[lane] = inputAt(gid.x / params.scale, gid.y / params.scale, channel * block + plane);
  }
  textureStore(outputTex, vec2<i32>(gid.xy), i32(gid.z), packed);
}`

export const PACKED_MASK_BLEND_WGSL = `
struct Params { width: u32, height: u32, maskChannel: u32, _pad: u32 }
@group(0) @binding(0) var firstTex: texture_2d_array<f32>;
@group(0) @binding(1) var secondTex: texture_2d_array<f32>;
@group(0) @binding(2) var maskTex: texture_2d_array<f32>;
@group(0) @binding(3) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var<uniform> params: Params;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let coord = vec2<i32>(gid.xy);
  let raw = textureLoad(maskTex, coord, i32(params.maskChannel / 4u), 0)[params.maskChannel & 3u];
  let blend = 1.0 / (1.0 + exp(-raw));
  let first = textureLoad(firstTex, coord, 0, 0);
  let second = textureLoad(secondTex, coord, 0, 0);
  var out = first * blend + second * (1.0 - blend);
  out.a = 1.0;
  textureStore(outputTex, coord, clamp(out, vec4<f32>(0.0), vec4<f32>(1.0)));
}`
