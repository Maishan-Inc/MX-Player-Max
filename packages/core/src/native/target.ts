import { ErrorCodes } from '@mx-player-max/types'
import type { EngineErrorException } from './errors'
import { createEngineError } from './errors'

export interface ResolvedVideoTarget {
  video: HTMLVideoElement
  owned: boolean
  container: HTMLElement | null
}

export function resolveVideoTarget(target: string | HTMLElement): ResolvedVideoTarget {
  const resolved = typeof target === 'string' ? queryTarget(target) : target
  if (!isHtmlElement(resolved)) throw invalidTarget()
  if (isVideoElement(resolved)) return { video: resolved as HTMLVideoElement, owned: false, container: null }

  const doc = resolved.ownerDocument ?? (typeof document === 'undefined' ? null : document)
  if (!doc) throw invalidTarget()
  let video: HTMLVideoElement
  try {
    video = doc.createElement('video')
    resolved.appendChild(video)
  } catch (cause) {
    throw createEngineError(ErrorCodes.ENGINE_INVALID_TARGET, 'The playback target cannot host a video element', false, cause)
  }
  return { video, owned: true, container: resolved }
}

function queryTarget(selector: string): unknown {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') throw invalidTarget()
  try {
    return document.querySelector(selector)
  } catch (cause) {
    throw createEngineError(ErrorCodes.ENGINE_INVALID_TARGET, 'The playback target selector is invalid', false, cause)
  }
}

function isHtmlElement(value: unknown): value is HTMLElement {
  if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) return true
  if (!value || typeof value !== 'object') return false
  const candidate = value as { appendChild?: unknown; ownerDocument?: unknown; tagName?: unknown }
  return typeof candidate.appendChild === 'function' || typeof candidate.tagName === 'string'
}

function isVideoElement(value: unknown): value is HTMLVideoElement {
  if (typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement) return true
  return typeof value === 'object' && value !== null
    && String((value as { tagName?: unknown }).tagName ?? '').toLowerCase() === 'video'
}

function invalidTarget(): EngineErrorException {
  return createEngineError(ErrorCodes.ENGINE_INVALID_TARGET, 'The playback target was not found or is not an element', false)
}

