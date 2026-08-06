import type { CapabilitySnapshot, TrackInfo } from '@mx-player-max/types'

export type WasmVariant = 'threaded' | 'simd' | 'single'

export interface WasmDecoderManifest {
  codec: string
  version: string
  variants: Partial<Record<WasmVariant, string>>
  sha256: Partial<Record<WasmVariant, string>>
  license: string
}

export interface WasmDecoderManager {
  load(codec: string, track: TrackInfo, capabilities: CapabilitySnapshot): Promise<WasmDecoderInstance>
}

export interface WasmDecoderInstance {
  variant: WasmVariant
  decode(packet: Uint8Array, timestamp: number, key: boolean): void
  flush(): Promise<void>
  close(): void
}

