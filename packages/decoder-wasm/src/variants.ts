import type { CapabilitySnapshot } from '@mx-player-max/types'
import type { WasmDecoderManifest, WasmVariant } from './contracts'
import { validateWasmDecoderManifest } from './manifest'

const VARIANT_ORDER: readonly WasmVariant[] = ['threaded', 'simd', 'single']

export function selectWasmVariants(
  rawManifest: WasmDecoderManifest,
  capabilities: CapabilitySnapshot,
): readonly WasmVariant[] {
  const manifest = validateWasmDecoderManifest(rawManifest)
  const selected: WasmVariant[] = []
  if (
    capabilities.crossOriginIsolated
    && capabilities.sharedArrayBuffer
    && capabilities.wasmThreads
    && manifest.variants.threaded !== undefined
  ) selected.push('threaded')
  if (capabilities.wasmSimd && manifest.variants.simd !== undefined) selected.push('simd')
  if (manifest.variants.single !== undefined) selected.push('single')
  return selected
}

export function listWasmManifestVariants(rawManifest: WasmDecoderManifest): readonly WasmVariant[] {
  const manifest = validateWasmDecoderManifest(rawManifest)
  return VARIANT_ORDER.filter((variant) => manifest.variants[variant] !== undefined)
}
