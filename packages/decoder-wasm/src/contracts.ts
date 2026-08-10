import type {
  CapabilitySnapshot,
  DemuxPacket,
  Micros,
  TrackInfo,
  WasmDecoderDeclaration,
} from '@mx-player-max/types'

export type WasmVariant = 'threaded' | 'simd' | 'single'

export interface WasmDecoderReview {
  readonly status: 'approved' | 'restricted' | 'pending'
  readonly notes?: string
}

export interface WasmDecoderManifest {
  readonly codec: string
  readonly version: string
  readonly variants: Readonly<Partial<Record<WasmVariant, string>>>
  readonly sha256: Readonly<Partial<Record<WasmVariant, string>>>
  readonly sizeBytes?: Readonly<Partial<Record<WasmVariant, number>>>
  readonly supportsVideo: boolean
  readonly supportsAudio: boolean
  readonly profiles?: readonly string[]
  readonly levels?: readonly string[]
  readonly pixelFormats?: readonly string[]
  readonly bitDepths?: readonly (8 | 10 | 12)[]
  readonly license: string
  readonly upstream: string
  readonly compiler: string
  readonly buildFlags: string
  readonly patentRisk: string
  readonly review?: WasmDecoderReview
}

/**
 * A decoder instance is deliberately opaque to the Manager. Concrete Codec
 * plugins own packet ABI and convert their output to the common decoder layer.
 */
export interface WasmDecoderInstance {
  readonly variant: WasmVariant
  readonly pluginId?: string
  readonly manifest?: WasmDecoderManifest
  decode(packet: Uint8Array, timestamp: Micros, key: boolean): void
  flush(): Promise<void>
  close(): void
}

export interface WasmDecoderCreateContext {
  readonly variant: WasmVariant
  readonly module: WebAssembly.Module
  readonly manifest: WasmDecoderManifest
  readonly track: TrackInfo
  readonly capabilities: CapabilitySnapshot
  readonly signal: AbortSignal
}

export interface WasmDecoderPlugin {
  readonly id: string
  readonly priority: number
  readonly manifest: WasmDecoderManifest
  supports(codec: string, track: TrackInfo): boolean
  create(context: WasmDecoderCreateContext): Promise<WasmDecoderInstance>
}

export interface WasmDecoderPluginDescriptor {
  readonly id: string
  readonly priority: number
  readonly codec: string
  readonly version: string
  readonly supportsVideo: boolean
  readonly supportsAudio: boolean
  readonly variants: readonly WasmVariant[]
}

export interface WasmDecoderAssetCache {
  get(key: string): Promise<Uint8Array | null>
  set(key: string, bytes: Uint8Array): Promise<void>
  markFailure(key: string): void
  hasFailed(key: string): boolean
}

export interface WasmDecoderRuntime {
  compile(bytes: Uint8Array): Promise<WebAssembly.Module>
}

export interface VerifiedWasmAsset {
  readonly manifest: WasmDecoderManifest
  readonly variant: WasmVariant
  readonly url: string
  readonly bytes: Uint8Array
}

export interface WasmAssetLoadOptions {
  readonly baseUrl: string
  readonly pluginId: string
  readonly manifest: WasmDecoderManifest
  readonly variant: WasmVariant
  readonly fetcher?: typeof fetch
  readonly cache?: WasmDecoderAssetCache
  readonly signal?: AbortSignal
}

export interface VerifiedWasmAssetLoaderOptions {
  readonly baseUrl: string
  readonly fetcher?: typeof fetch
  readonly cache?: WasmDecoderAssetCache
}

export interface VerifiedWasmAssetLoaderLike {
  load(
    pluginId: string,
    manifest: WasmDecoderManifest | unknown,
    variant: WasmVariant,
    options?: { readonly signal?: AbortSignal },
  ): Promise<VerifiedWasmAsset>
  close(): void
}

export interface WasmDecoderLoadOptions {
  readonly signal?: AbortSignal
}

export interface WasmDecoderDeclarationOptions {
  readonly requireApprovedReview?: boolean
}

export interface WasmDecoderRegistryLike {
  register(plugin: WasmDecoderPlugin): void
  unregister(id: string): boolean
  list(): readonly WasmDecoderPluginDescriptor[]
  resolve(codec: string, track: TrackInfo): readonly WasmDecoderPlugin[]
  declarations(options?: WasmDecoderDeclarationOptions): readonly WasmDecoderDeclaration[]
}

export interface WasmDecoderManagerOptions {
  readonly baseUrl: string
  readonly registry?: WasmDecoderRegistryLike
  readonly fetcher?: typeof fetch
  readonly cache?: WasmDecoderAssetCache
  readonly runtime?: WasmDecoderRuntime
  readonly requireApprovedReview?: boolean
}

export interface WasmDecoderManager {
  register(plugin: WasmDecoderPlugin): void
  unregister(id: string): boolean
  list(): readonly WasmDecoderPluginDescriptor[]
  declarations(): readonly WasmDecoderDeclaration[]
  load(
    codec: string,
    track: TrackInfo,
    capabilities: CapabilitySnapshot,
    options?: WasmDecoderLoadOptions,
  ): Promise<WasmDecoderInstance>
  close(): void
}

/** Public alias retained for callers that describe packet input explicitly. */
export type WasmDecoderPacket = DemuxPacket
