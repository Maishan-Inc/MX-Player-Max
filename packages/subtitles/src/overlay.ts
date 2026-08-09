import type { SubtitleCue, SubtitleCueStyle } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { SubtitleError } from './errors'
import { DEFAULT_SUBTITLE_STYLE, normalizeSubtitleStyle } from './style-store'

export type SubtitleOverlayTargetKind = 'native-video' | 'webgpu' | 'webgl2' | 'canvas2d'

export interface SubtitleOverlayOptions {
  getDevicePixelRatio?: () => number
  onError?: (error: SubtitleError) => void
}

export class SubtitleOverlay {
  readonly #options: SubtitleOverlayOptions
  #host: HTMLElement | null = null
  #root: HTMLElement | null = null
  #restorePosition: string | null = null
  #positionAdjusted = false
  #resizeObserver: ResizeObserver | null = null
  #fullscreenDocument: Document | null = null
  #window: Window | null = null
  #targetKind: SubtitleOverlayTargetKind | null = null
  #cues: readonly SubtitleCue[] = []
  #style: SubtitleCueStyle = normalizeSubtitleStyle(DEFAULT_SUBTITLE_STYLE)
  #dpr = 1
  #closed = false

  constructor(options: SubtitleOverlayOptions = {}) { this.#options = options }

  get attached(): boolean { return this.#root !== null && this.#host !== null }
  get host(): HTMLElement | null { return this.#host }
  get devicePixelRatio(): number { return this.#dpr }

  attach(host: HTMLElement, targetKind: SubtitleOverlayTargetKind): void {
    this.ensureOpen()
    if (!host || typeof host.appendChild !== 'function' || !host.ownerDocument) {
      const error = new SubtitleError(ErrorCodes.SUBTITLE_OVERLAY_INVALID, 'Subtitle overlay host is invalid', true)
      this.#options.onError?.(error)
      throw error
    }
    this.detach()
    const document = host.ownerDocument
    const root = document.createElement('div')
    root.setAttribute('data-mxp-subtitle-overlay', 'true')
    root.style.position = 'absolute'
    root.style.inset = '0'
    root.style.overflow = 'hidden'
    root.style.pointerEvents = 'none'
    root.style.zIndex = '2'
    root.style.contain = 'layout paint style'
    try { host.appendChild(root) } catch (cause) {
      const error = new SubtitleError(ErrorCodes.SUBTITLE_OVERLAY_UNAVAILABLE, 'Subtitle overlay could not be attached', true)
      this.#options.onError?.(error)
      throw error
    }
    this.#host = host
    this.#root = root
    this.#targetKind = targetKind
    this.#restorePosition = host.style.position ?? ''
    let hostPosition = this.#restorePosition
    try {
      if (hostPosition.length === 0 && typeof document.defaultView?.getComputedStyle === 'function') hostPosition = document.defaultView.getComputedStyle(host).position
    } catch { /* fall back to the inline position */ }
    this.#positionAdjusted = hostPosition.length === 0 || hostPosition === 'static'
    if (this.#positionAdjusted) host.style.position = 'relative'
    this.#fullscreenDocument = document
    this.#window = document.defaultView
    document.addEventListener('fullscreenchange', this.#refreshLayout)
    this.#window?.addEventListener('resize', this.#refreshLayout)
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(this.#refreshLayout)
      this.#resizeObserver.observe(host)
    }
    this.#refreshLayout()
    this.render(this.#cues, this.#style)
  }

  render(cues: readonly SubtitleCue[], style: SubtitleCueStyle = this.#style): void {
    this.ensureOpen()
    this.#cues = [...cues]
    this.#style = normalizeSubtitleStyle(style)
    const root = this.#root
    const host = this.#host
    if (!root || !host) return
    while (root.firstChild) root.removeChild(root.firstChild)
    const document = host.ownerDocument
    const groups = new Map<string, HTMLElement>()
    const groupCounts = new Map<string, number>()
    const ordered = [...this.#cues].sort(compareCue)
    for (const cue of ordered) {
      const cueStyle = normalizeSubtitleStyle({ ...this.#style, ...(cue.style ?? {}) })
      const key = `${cueStyle.x}:${cueStyle.y}:${cueStyle.alignment}`
      let group = groups.get(key)
      if (!group) {
        group = createGroup(document, cueStyle)
        groups.set(key, group)
        groupCounts.set(key, 0)
        root.appendChild(group)
      }
      const index = groupCounts.get(key) ?? 0
      groupCounts.set(key, index + 1)
      const node = createCueNode(document, cue, cueStyle, index)
      group.appendChild(node)
    }
  }

  clear(): void { this.render([], this.#style) }

  detach(): void {
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#fullscreenDocument?.removeEventListener('fullscreenchange', this.#refreshLayout)
    this.#window?.removeEventListener('resize', this.#refreshLayout)
    this.#fullscreenDocument = null
    this.#window = null
    if (this.#positionAdjusted && this.#host && this.#restorePosition !== null && this.#host.style.position === 'relative') this.#host.style.position = this.#restorePosition
    const root = this.#root
    if (root?.parentNode) {
      try { root.parentNode.removeChild(root) } catch { /* best effort */ }
    }
    this.#root = null
    this.#host = null
    this.#restorePosition = null
    this.#positionAdjusted = false
    this.#targetKind = null
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.detach()
    this.#cues = []
  }

  readonly #refreshLayout = (): void => {
    if (this.#closed || !this.#root) return
    const value = this.#options.getDevicePixelRatio?.() ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio)
    this.#dpr = Number.isFinite(value) && value > 0 ? Math.min(8, value) : 1
    this.#root.setAttribute('data-mxp-dpr', String(this.#dpr))
  }

  private ensureOpen(): void {
    if (this.#closed) throw new SubtitleError(ErrorCodes.SUBTITLE_CLOSED, 'Subtitle overlay is closed', false)
  }
}

function createGroup(document: Document, style: SubtitleCueStyle): HTMLElement {
  const group = document.createElement('div')
  group.style.position = 'absolute'
  group.style.left = `${style.x ?? DEFAULT_SUBTITLE_STYLE.x}%`
  group.style.top = `${style.y ?? DEFAULT_SUBTITLE_STYLE.y}%`
  group.style.width = '90%'
  group.style.transform = alignmentTransform(style.alignment ?? DEFAULT_SUBTITLE_STYLE.alignment)
  group.style.display = 'flex'
  group.style.flexDirection = 'column'
  group.style.gap = '0.18em'
  group.style.pointerEvents = 'none'
  group.style.alignItems = alignmentItems(style.alignment ?? DEFAULT_SUBTITLE_STYLE.alignment)
  return group
}

function createCueNode(document: Document, cue: SubtitleCue, style: SubtitleCueStyle, index: number): HTMLElement {
  const node = document.createElement('div')
  node.setAttribute('data-mxp-subtitle-cue', cue.cueId)
  node.style.position = 'relative'
  node.style.zIndex = String(1_000 + cue.layer)
  node.style.maxWidth = '100%'
  node.style.whiteSpace = 'pre-line'
  node.style.overflowWrap = 'anywhere'
  node.style.fontFamily = style.fontFamily ?? DEFAULT_SUBTITLE_STYLE.fontFamily
  node.style.fontSize = `${style.fontSize ?? DEFAULT_SUBTITLE_STYLE.fontSize}px`
  node.style.color = style.color ?? DEFAULT_SUBTITLE_STYLE.color
  node.style.fontWeight = style.bold ? '700' : '400'
  node.style.fontStyle = style.italic ? 'italic' : 'normal'
  node.style.textDecoration = style.underline ? 'underline' : 'none'
  const width = style.outlineWidth ?? DEFAULT_SUBTITLE_STYLE.outlineWidth
  const color = style.outlineColor ?? DEFAULT_SUBTITLE_STYLE.outlineColor
  node.style.textShadow = outlineShadow(width, color)
  node.textContent = cue.text
  if (index > 0) node.setAttribute('data-mxp-subtitle-index', String(index))
  return node
}

function alignmentTransform(alignment: NonNullable<SubtitleCueStyle['alignment']>): string {
  const horizontal = alignment.includes('right') ? '-100%' : alignment.includes('center') ? '-50%' : '0'
  const vertical = alignment.startsWith('top') ? '0' : alignment.startsWith('middle') ? '-50%' : '-100%'
  return `translate(${horizontal}, ${vertical})`
}

function alignmentItems(alignment: NonNullable<SubtitleCueStyle['alignment']>): string {
  if (alignment.includes('right')) return 'flex-end'
  if (alignment.includes('center')) return 'center'
  return 'flex-start'
}

function outlineShadow(width: number, color: string): string {
  if (width <= 0) return 'none'
  const values: string[] = []
  for (let x = -Math.ceil(width); x <= Math.ceil(width); x += 1) {
    for (let y = -Math.ceil(width); y <= Math.ceil(width); y += 1) {
      if (x === 0 && y === 0) continue
      values.push(`${x}px ${y}px 0 ${color}`)
    }
  }
  return values.join(', ')
}

function compareCue(left: SubtitleCue, right: SubtitleCue): number {
  return compareNumber(left.start, right.start) || compareNumber(left.end, right.end) || compareNumber(right.layer, left.layer) || compareString(left.cueId, right.cueId)
}

function compareNumber(left: number, right: number): number { return left < right ? -1 : left > right ? 1 : 0 }
function compareString(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }
