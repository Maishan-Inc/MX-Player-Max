export { createPassthroughSource } from './passthrough'
export { AiPipeline, createAiPipeline } from './chain'
export type { AiPipelineEvent, AiPipelineOptions } from './chain'

export type {
  DecodedFrameSource,
  FrameSource,
  PipelineFrame,
  SpatialStage,
  TemporalStage,
} from './types'

export {
  isAiModelManifest,
  validateAiModelManifest,
} from './assets/manifest'
export type { AiAssetReview, AiAssetReviewStatus, AiModelFormat, AiModelManifest, ModelPrecision } from './assets/manifest'
export {
  createCacheStorageAiModelCache,
  createMemoryAiModelCache,
  digestHex,
  loadAiModelAsset,
  resolveAssetUrl,
} from './assets/loader'
export type { AiModelAsset, AiModelCache, AiModelLoadOptions } from './assets/loader'
export { parseMxai } from './assets/mxai'
export type { MxaiElementType, MxaiModel, MxaiTensor } from './assets/mxai'
export { AI_MODEL_MANIFESTS, RIFE_V425_MANIFEST, RT4KSR_X2_MANIFEST } from './assets/catalog'

export { createFrameBudgetGovernor, DefaultFrameBudgetGovernor } from './governor/index'
export type { FrameBudgetGovernor, FrameBudgetGovernorOptions } from './governor/index'
export { TexturePool } from './gpu/texture-pool'
export type { PooledTexture, TexturePoolOptions } from './gpu/texture-pool'
export { PackedTexturePool } from './gpu/packed'
export type { PackedTexture } from './gpu/packed'
export { Rt4kSrGraphExecutor } from './gpu/rt4ksr'
export { WebGpuInterpolationStage, WebGpuSuperResolutionStage } from './gpu/stages'
export type { WebGpuStageOptions } from './gpu/stages'
export { createRifeGraph, createRt4kSrGraph, uploadTensorStore } from './gpu/graph'
export type { GpuGraphLayer, GpuModelGraph, GpuTensorBuffer, GpuTensorStore } from './gpu/graph'
export {
  BILINEAR_WARP_WGSL,
  CONVOLUTION_WGSL,
  PACKED_ADD_WGSL,
  PACKED_CONVOLUTION_WGSL,
  PACKED_INPUT_WGSL,
  PACKED_LAYER_NORM_WGSL,
  PACKED_PIXEL_SHUFFLE_X4_WGSL,
  PACKED_PIXEL_UNSHUFFLE_WGSL,
  RIFE_FLOW_WGSL,
  RIFE_IFBLOCK_WGSL,
  RT4KSR_RECONSTRUCTION_WGSL,
  UPSCALE_X2_WGSL,
} from './gpu/wgsl'
