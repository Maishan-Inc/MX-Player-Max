import type { WasmDecoderDeclaration, TrackInfo } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import type {
  WasmDecoderPlugin,
  WasmDecoderDeclarationOptions,
  WasmDecoderPluginDescriptor,
  WasmDecoderRegistryLike,
  WasmVariant,
} from './contracts'
import { createWasmError } from './errors'
import { normalizeWasmCodec, validateWasmDecoderManifest } from './manifest'
import { listWasmManifestVariants } from './variants'

const VARIANT_ORDER: readonly WasmVariant[] = ['threaded', 'simd', 'single']

export class WasmDecoderRegistry implements WasmDecoderRegistryLike {
  readonly #plugins = new Map<string, WasmDecoderPlugin>()

  register(plugin: WasmDecoderPlugin): void {
    const registered = normalizePlugin(plugin)
    if (this.#plugins.has(registered.id)) {
      throw createWasmError(ErrorCodes.WASM_PLUGIN_DUPLICATE, `WASM plugin ${registered.id} is already registered`, false)
    }
    this.#plugins.set(registered.id, registered)
  }

  unregister(id: string): boolean {
    return this.#plugins.delete(id)
  }

  list(): readonly WasmDecoderPluginDescriptor[] {
    return [...this.#plugins.values()]
      .sort(comparePlugins)
      .map(toDescriptor)
  }

  resolve(codec: string, track: TrackInfo): readonly WasmDecoderPlugin[] {
    const normalized = normalizeWasmCodec(codec)
    return [...this.#plugins.values()]
      .filter((plugin) => {
        try {
          const manifest = validateWasmDecoderManifest(plugin.manifest)
          if (manifest.codec !== normalized || !supportsTrackKind(manifest, track)) return false
          return plugin.supports(normalized, track)
        } catch {
          return false
        }
      })
      .sort(comparePlugins)
  }

  declarations(options: WasmDecoderDeclarationOptions = {}): readonly WasmDecoderDeclaration[] {
    const declarations: WasmDecoderDeclaration[] = []
    for (const plugin of [...this.#plugins.values()].sort(comparePlugins)) {
      const manifest = validateWasmDecoderManifest(plugin.manifest)
      if (options.requireApprovedReview === true && manifest.review?.status !== 'approved') continue
      declarations.push({
        codec: manifest.codec,
        supportsVideo: manifest.supportsVideo,
        supportsAudio: manifest.supportsAudio,
        variants: VARIANT_ORDER.filter((variant) => manifest.variants[variant] !== undefined),
      })
    }
    return declarations
  }
}

export function createWasmDecoderRegistry(plugins: readonly WasmDecoderPlugin[] = []): WasmDecoderRegistry {
  const registry = new WasmDecoderRegistry()
  for (const plugin of plugins) registry.register(plugin)
  return registry
}

function normalizePlugin(plugin: WasmDecoderPlugin): WasmDecoderPlugin {
  if (typeof plugin !== 'object' || plugin === null) {
    throw createWasmError(ErrorCodes.WASM_MANIFEST_INVALID, 'WASM plugin must be an object', false)
  }
  if (typeof plugin.id !== 'string' || plugin.id.trim().length === 0 || plugin.id.length > 256) {
    throw createWasmError(ErrorCodes.WASM_MANIFEST_INVALID, 'WASM plugin ID is invalid', false)
  }
  if (!Number.isFinite(plugin.priority)) {
    throw createWasmError(ErrorCodes.WASM_MANIFEST_INVALID, `WASM plugin ${plugin.id} priority is invalid`, false)
  }
  if (typeof plugin.supports !== 'function' || typeof plugin.create !== 'function') {
    throw createWasmError(ErrorCodes.WASM_MANIFEST_INVALID, `WASM plugin ${plugin.id} lifecycle is invalid`, false)
  }
  const id = plugin.id.trim()
  const priority = plugin.priority
  const manifest = validateWasmDecoderManifest(plugin.manifest)
  const supports = plugin.supports.bind(plugin)
  const create = plugin.create.bind(plugin)
  return Object.freeze({ id, priority, manifest, supports, create })
}

function comparePlugins(left: WasmDecoderPlugin, right: WasmDecoderPlugin): number {
  const priority = right.priority - left.priority
  return priority !== 0 ? priority : left.id.localeCompare(right.id)
}

function supportsTrackKind(
  manifest: Pick<WasmDecoderPlugin['manifest'], 'supportsVideo' | 'supportsAudio'>,
  track: TrackInfo,
): boolean {
  if (track.kind === 'video') return manifest.supportsVideo
  if (track.kind === 'audio') return manifest.supportsAudio
  return false
}

function toDescriptor(plugin: WasmDecoderPlugin): WasmDecoderPluginDescriptor {
  const manifest = validateWasmDecoderManifest(plugin.manifest)
  return {
    id: plugin.id,
    priority: plugin.priority,
    codec: manifest.codec,
    version: manifest.version,
    supportsVideo: manifest.supportsVideo,
    supportsAudio: manifest.supportsAudio,
    variants: listWasmManifestVariants(manifest),
  }
}
