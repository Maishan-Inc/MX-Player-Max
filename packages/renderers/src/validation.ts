import type {
  RendererColorMode,
  VideoFilterKind,
  VideoFilterOptions,
  VideoRotation,
  VideoTransformOptions,
} from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { rendererError } from './errors'

export const MAX_CANVAS_DIMENSION = 16_384

export interface NormalizedFilter {
  kind: VideoFilterKind
  amount: number
}

export interface ResolvedTransform {
  crop: { x: number; y: number; width: number; height: number } | null
  rotation: VideoRotation
  fit: 'contain' | 'cover' | 'fill'
  outputWidth: number | null
  outputHeight: number | null
  devicePixelRatio: number | null
}

export interface ValidatedFrame {
  width: number
  height: number
  colorMode: RendererColorMode
  hdr: boolean
  fullRange: boolean | null
}

export function normalizeFilter(filter: VideoFilterOptions | undefined): NormalizedFilter {
  if (filter === undefined || filter.kind === 'none') return { kind: 'none', amount: 0 }
  if (filter.kind !== 'grayscale' && filter.kind !== 'brightness' && filter.kind !== 'contrast' && filter.kind !== 'saturate') {
    throw rendererError(ErrorCodes.RENDERER_FILTER_UNSUPPORTED, 'The renderer filter kind is unsupported', false)
  }
  const amount = filter.amount ?? (filter.kind === 'grayscale' ? 1 : 1)
  if (!Number.isFinite(amount)) throw rendererError(ErrorCodes.RENDERER_FILTER_UNSUPPORTED, 'The renderer filter amount is invalid', false)
  const maximum = filter.kind === 'grayscale' ? 1 : 4
  return { kind: filter.kind, amount: clamp(amount, 0, maximum) }
}

export function normalizeTransform(transform: VideoTransformOptions | undefined): ResolvedTransform {
  const outputWidth = transform?.outputWidth
  const outputHeight = transform?.outputHeight
  if ((outputWidth === undefined) !== (outputHeight === undefined)) {
    throw rendererError(ErrorCodes.RENDERER_RESIZE_INVALID, 'Output width and height must be provided together', false)
  }
  if (outputWidth !== undefined && (!safePositiveInteger(outputWidth) || !safePositiveInteger(outputHeight))) {
    throw rendererError(ErrorCodes.RENDERER_RESIZE_INVALID, 'The renderer output size is invalid', false)
  }
  const rotation = transform?.rotation ?? 0
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    throw rendererError(ErrorCodes.RENDERER_RESIZE_INVALID, 'The renderer rotation is invalid', false)
  }
  const dpr = transform?.devicePixelRatio
  if (dpr !== undefined && (!Number.isFinite(dpr) || dpr <= 0 || dpr > 8)) {
    throw rendererError(ErrorCodes.RENDERER_RESIZE_INVALID, 'The renderer device pixel ratio is invalid', false)
  }
  const fit = transform?.fit ?? 'contain'
  if (fit !== 'contain' && fit !== 'cover' && fit !== 'fill') {
    throw rendererError(ErrorCodes.RENDERER_RESIZE_INVALID, 'The renderer fit mode is invalid', false)
  }
  const crop = transform?.crop
  if (crop !== undefined && (!safeNonNegativeInteger(crop.x) || !safeNonNegativeInteger(crop.y)
    || !safePositiveInteger(crop.width) || !safePositiveInteger(crop.height))) {
    throw rendererError(ErrorCodes.RENDERER_RESIZE_INVALID, 'The renderer crop rectangle is invalid', false)
  }
  return {
    crop: crop === undefined ? null : { ...crop },
    rotation,
    fit,
    outputWidth: outputWidth ?? null,
    outputHeight: outputHeight ?? null,
    devicePixelRatio: dpr ?? null,
  }
}

export function validateResize(width: number, height: number, dpr: number, maximum = MAX_CANVAS_DIMENSION): void {
  if (!safePositiveInteger(width) || !safePositiveInteger(height) || !Number.isFinite(dpr) || dpr <= 0) {
    throw rendererError(ErrorCodes.RENDERER_RESIZE_INVALID, 'Renderer dimensions are invalid', false)
  }
  if (width > maximum || height > maximum || width * dpr > maximum || height * dpr > maximum) {
    throw rendererError(ErrorCodes.RENDERER_RESIZE_INVALID, 'Renderer dimensions exceed the canvas limit', false)
  }
}

export function validateFrame(frame: VideoFrame, transform: ResolvedTransform): ValidatedFrame {
  if (!frame || typeof frame !== 'object') throw rendererError(ErrorCodes.RENDERER_FRAME_INVALID, 'The VideoFrame is invalid', false)
  const width = dimension(frame.displayWidth, frame.codedWidth)
  const height = dimension(frame.displayHeight, frame.codedHeight)
  if (width === null || height === null) throw rendererError(ErrorCodes.RENDERER_FRAME_INVALID, 'The VideoFrame dimensions are invalid', false)
  const crop = transform.crop
  const cropRight = crop === null ? 0 : crop.x + crop.width
  const cropBottom = crop === null ? 0 : crop.y + crop.height
  if (crop && (!Number.isSafeInteger(cropRight) || !Number.isSafeInteger(cropBottom) || cropRight > width || cropBottom > height)) {
    throw rendererError(ErrorCodes.RENDERER_RESIZE_INVALID, 'The renderer crop exceeds VideoFrame bounds', false)
  }
  const color = (frame as unknown as { colorSpace?: unknown }).colorSpace
  const cs = typeof color === 'object' && color !== null ? color as { primaries?: unknown; transfer?: unknown; fullRange?: unknown } : null
  const transfer = typeof cs?.transfer === 'string' ? cs.transfer.toLowerCase() : cs?.transfer
  const primaries = typeof cs?.primaries === 'string' ? cs.primaries.toLowerCase() : cs?.primaries
  // BT.2020 primaries alone do not prove HDR; without a known PQ/HLG
  // transfer function the renderer must keep the color mode conservative.
  const hdr = transfer === 'pq' || transfer === 'hlg'
  const colorMode: RendererColorMode = hdr
    ? 'hdr'
    : (primaries === 'bt709' || transfer === 'bt709' ? 'sdr-bt709' : transfer === 'srgb' || transfer === 'iec61966-2-1' ? 'sdr-srgb' : 'unknown')
  const fullRange = typeof cs?.fullRange === 'boolean' ? cs.fullRange : null
  return { width, height, colorMode, hdr, fullRange }
}

export function safeCloseFrame(frame: VideoFrame): void {
  try { frame.close() } catch { /* ownership cleanup is best effort */ }
}

function dimension(first: number, second: number): number | null {
  const value = Number.isSafeInteger(first) && first > 0 ? first : second
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function safePositiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
}

function safeNonNegativeInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)) }
