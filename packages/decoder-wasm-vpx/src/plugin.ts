import {
  createWasmError,
  type WasmDecoderCreateContext,
  type WasmDecoderInstance,
  type WasmDecoderPlugin,
  type WasmVariant,
} from '@mx-player-max/decoder-wasm'
import { ErrorCodes, type DemuxPacket, type TrackInfo } from '@mx-player-max/types'
import { createVideoFrameFromMxwf, type MxwfFrameFactory } from './abi'
import { libvpxVp8Manifest } from './manifest'

interface MxwfExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  mxwf_abi_version(): number
  mxwf_alloc(byteLength: number): number
  mxwf_free(pointer: number): void
  mxwf_decoder_create(displayWidth: number, displayHeight: number, primaries: number, transfer: number, matrix: number, range: number): number
  mxwf_decoder_decode(handle: number, dataPointer: number, dataLength: number, timestampLo: number, timestampHi: number, durationLo: number, durationHi: number, flags: number): number
  mxwf_decoder_flush(handle: number): number
  mxwf_decoder_reset(handle: number): number
  mxwf_decoder_receive_frame(handle: number): number
  mxwf_frame_release(token: number): void
  mxwf_decoder_destroy(handle: number): void
  mxwf_debug_live_frames(): number
  mxwf_debug_live_bytes(): number
  _initialize?(): void
}

export interface LibvpxVp8PluginOptions {
  readonly frameFactory?: MxwfFrameFactory
}

export function createLibvpxVp8Plugin(options: LibvpxVp8PluginOptions = {}): WasmDecoderPlugin {
  return {
    id: 'libvpx-vp8-mxwf1',
    priority: 100,
    manifest: libvpxVp8Manifest,
    supports(codec, track) {
      return supportsVp8(codec, track)
    },
    async create(context) {
      if (context.signal.aborted) throw createWasmError(ErrorCodes.WASM_ABORTED, 'VP8 decoder initialization was aborted', true)
      let instance: WebAssembly.Instance
      try {
        instance = await context.runtime.instantiate(context.module)
      } catch {
        throw createWasmError(ErrorCodes.WASM_INSTANTIATE_FAILED, 'The libvpx WASM module could not be instantiated', true)
      }
      const exports = readExports(instance.exports)
      if (exports.mxwf_abi_version() !== 1) throw createWasmError(ErrorCodes.WASM_EXPORT_INVALID, 'The libvpx WASM ABI version is unsupported', false)
      try { exports._initialize?.() } catch {
        throw createWasmError(ErrorCodes.WASM_INSTANTIATE_FAILED, 'The libvpx WASM runtime could not be initialized', true)
      }
      const color = trackColor(context.track)
      const width = positiveDimension(context.track.width)
      const height = positiveDimension(context.track.height)
      const handle = exports.mxwf_decoder_create(width, height, color.primaries, color.transfer, color.matrix, color.range)
      if (handle === 0) throw createWasmError(ErrorCodes.WASM_PLUGIN_INIT_FAILED, 'The libvpx VP8 decoder could not be created', true)
      return new LibvpxVp8DecoderInstance(context, exports, handle, options.frameFactory)
    },
  }
}

class LibvpxVp8DecoderInstance implements WasmDecoderInstance {
  readonly variant: WasmVariant
  readonly #context: WasmDecoderCreateContext
  readonly #exports: MxwfExports
  readonly #frameFactory: MxwfFrameFactory | undefined
  #handle: number
  #decodeQueueSize = 0
  #closed = false

  constructor(context: WasmDecoderCreateContext, exports: MxwfExports, handle: number, frameFactory?: MxwfFrameFactory) {
    this.variant = context.variant
    this.#context = context
    this.#exports = exports
    this.#handle = handle
    this.#frameFactory = frameFactory
  }

  get decodeQueueSize(): number { return this.#closed ? 0 : this.#decodeQueueSize }

  decode(packet: DemuxPacket): void {
    this.#ensureOpen()
    validatePacket(packet)
    this.#decodeQueueSize += 1
    let pointer = 0
    try {
      pointer = this.#exports.mxwf_alloc(packet.data.byteLength)
      if (pointer === 0) throw decodeError('The libvpx WASM input allocation failed')
      assertMemoryRange(pointer, packet.data.byteLength, this.#exports.memory.buffer.byteLength)
      new Uint8Array(this.#exports.memory.buffer, pointer, packet.data.byteLength).set(packet.data)
      const timestamp = splitMicros(packet.timestamp)
      const duration = packet.duration === null ? { lo: 0, hi: 0 } : splitMicros(packet.duration)
      const flags = (packet.duration === null ? 0 : 1) | (packet.keyframe ? 2 : 0)
      const result = this.#exports.mxwf_decoder_decode(this.#handle, pointer, packet.data.byteLength, timestamp.lo, timestamp.hi, duration.lo, duration.hi, flags)
      if (result !== 0) throw decodeError('The libvpx VP8 packet could not be decoded')
      this.#drainFrames()
    } finally {
      if (pointer !== 0) this.#exports.mxwf_free(pointer)
      this.#decodeQueueSize = Math.max(0, this.#decodeQueueSize - 1)
      this.#context.callbacks.onDequeue()
    }
  }

  async flush(): Promise<void> {
    this.#ensureOpen()
    const result = this.#exports.mxwf_decoder_flush(this.#handle)
    if (result !== 0) throw decodeError('The libvpx VP8 decoder flush failed')
    this.#drainFrames()
  }

  async reset(): Promise<void> {
    this.#ensureOpen()
    if (this.#exports.mxwf_decoder_reset(this.#handle) !== 0) throw createWasmError(ErrorCodes.WASM_RESET_FAILED, 'The libvpx VP8 decoder reset failed', true)
    this.#decodeQueueSize = 0
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    const handle = this.#handle
    this.#handle = 0
    this.#decodeQueueSize = 0
    if (handle !== 0) this.#exports.mxwf_decoder_destroy(handle)
  }

  #drainFrames(): void {
    while (true) {
      const pointer = this.#exports.mxwf_decoder_receive_frame(this.#handle)
      if (pointer === 0) return
      const frame = createVideoFrameFromMxwf(
        this.#exports.memory,
        pointer,
        (token) => this.#exports.mxwf_frame_release(token),
        this.#frameFactory,
      )
      this.#context.callbacks.onFrame(frame)
    }
  }

  #ensureOpen(): void {
    if (this.#closed || this.#handle === 0) throw createWasmError(ErrorCodes.WASM_CLOSED, 'The libvpx VP8 decoder is closed', false)
  }
}

function readExports(value: WebAssembly.Exports): MxwfExports {
  const memory = value.memory
  if (!(memory instanceof WebAssembly.Memory)) throw invalidExport('The libvpx WASM memory export is invalid')
  const required = [
    'mxwf_abi_version', 'mxwf_alloc', 'mxwf_free', 'mxwf_decoder_create', 'mxwf_decoder_decode',
    'mxwf_decoder_flush', 'mxwf_decoder_reset', 'mxwf_decoder_receive_frame', 'mxwf_frame_release',
    'mxwf_decoder_destroy', 'mxwf_debug_live_frames', 'mxwf_debug_live_bytes',
  ] as const
  for (const name of required) if (typeof value[name] !== 'function') throw invalidExport(`The libvpx WASM export ${name} is invalid`)
  if (value._initialize !== undefined && typeof value._initialize !== 'function') throw invalidExport('The libvpx WASM initialize export is invalid')
  return value as MxwfExports
}

function supportsVp8(codec: string, track: TrackInfo): boolean {
  if (track.kind !== 'video') return false
  const normalized = codec.trim().toLowerCase()
  if (normalized !== 'vp8' && !/^vp08(?:\.0[01])?(?:\.|$)/.test(normalized)) return false
  if (!Number.isSafeInteger(track.width) || !Number.isSafeInteger(track.height) || (track.width ?? 0) <= 0 || (track.height ?? 0) <= 0) return false
  const bitDepth = track.color?.bitDepth ?? track.bitDepth ?? 8
  return bitDepth === 8 && (track.profile === undefined || track.profile === '0')
}

function positiveDimension(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0 || value > 16_384) throw createWasmError(ErrorCodes.WASM_PLUGIN_INIT_FAILED, 'The VP8 track dimensions are invalid', false)
  return value
}

function validatePacket(packet: DemuxPacket): void {
  if (packet.kind !== 'video' || packet.data.byteLength === 0 || !validMicros(packet.timestamp) || (packet.duration !== null && !validMicros(packet.duration))) throw decodeError('The VP8 packet metadata is invalid')
}

function validMicros(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function splitMicros(value: number): { lo: number; hi: number } {
  if (!validMicros(value)) throw decodeError('The VP8 packet timestamp is invalid')
  return { lo: value >>> 0, hi: Math.floor(value / 0x1_0000_0000) >>> 0 }
}

function trackColor(track: TrackInfo): { primaries: number; transfer: number; matrix: number; range: number } {
  const primaries = mapTrackPrimaries(track.color?.primaries)
  const transfer = mapTrackTransfer(track.color?.transfer)
  const matrix = mapTrackMatrix(track.color?.matrix)
  const range = track.color?.fullRange === undefined ? 0 : track.color.fullRange ? 2 : 1
  return { primaries, transfer, matrix, range }
}

function mapTrackPrimaries(value: TrackInfo['color'] extends infer _Color ? NonNullable<TrackInfo['color']>['primaries'] : never): number {
  if (value === 'bt709') return 1
  if (value === 'bt601') return 3
  if (value === 'bt2020') return 4
  return 0
}

function mapTrackTransfer(value: NonNullable<TrackInfo['color']>['transfer']): number {
  if (value === 'bt1886') return 2
  if (value === 'srgb') return 3
  if (value === 'pq') return 4
  if (value === 'hlg') return 5
  return 0
}

function mapTrackMatrix(value: NonNullable<TrackInfo['color']>['matrix']): number {
  if (value === 'bt709') return 2
  if (value === 'bt601') return 4
  if (value === 'bt2020nc') return 5
  return 0
}

function assertMemoryRange(offset: number, length: number, total: number): void {
  if (!Number.isSafeInteger(offset) || offset <= 0 || length <= 0 || offset > total || length > total - offset) throw decodeError('The libvpx WASM input range is invalid')
}

function invalidExport(message: string) {
  return createWasmError(ErrorCodes.WASM_EXPORT_INVALID, message, false)
}

function decodeError(message: string) {
  return createWasmError(ErrorCodes.WASM_DECODE_FAILED, message, true)
}
