import type {
  EngineError,
  MediaPreviewImage,
  PlaybackSnapshot,
  SubtitleAlignment,
  SubtitleCueStyle,
  SubtitleTrack,
} from '@mx-player-max/types'
import {
  DEFAULT_FEATURES,
  DEFAULT_LABELS,
  PlayerUiError,
  UiErrorCodes,
  type NextEpisodeControlOptions,
  type PlayerUiController,
  type PlayerUiErrorSummary,
  type PlayerUiFeatureOptions,
  type PlayerUiLabels,
  type PlayerUiOptions,
  type PlayerUiPlayer,
  type TheaterModeAdapter,
} from './contracts'
import { createPlayerIcon, type PlayerIconName } from './icons'
import { CleanupScope, isElement } from './lifecycle'

type OverlayName = 'settings' | 'statistics' | 'about' | 'subtitles'
type IconButton = HTMLButtonElement

interface SeekState {
  active: boolean
  pointerId: number | null
  pending: number | null
  timer: ReturnType<typeof setTimeout> | null
  epoch: number
  cleanup: (() => void) | null
}

interface PreviewState {
  controller: AbortController | null
  timer: ReturnType<typeof setTimeout> | null
  url: string | null
  urls: string[]
}

interface SubtitleDragState {
  active: boolean
  pending: SubtitleCueStyle | null
  timer: ReturnType<typeof setTimeout> | null
  cleanup: (() => void) | null
}

interface SubtitleResumeToken {
  sessionEpoch: number
  pauseObserved: boolean
}

const DEFAULT_AUTO_HIDE_MS = 2_500
const SEEK_STEP = 5_000_000
const PREVIEW_DELAY_MS = 100
const PREVIEW_WIDTH = 160
const PREVIEW_HEIGHT = 90
const PREVIEW_EDGE_INSET = (PREVIEW_WIDTH / 2) + 1
const INTERACTION_THROTTLE_MS = 80

export class PlayerUiControllerImpl implements PlayerUiController {
  readonly #player: PlayerUiPlayer
  #options: PlayerUiOptions = {}
  #labels: PlayerUiLabels = DEFAULT_LABELS
  #features: Required<PlayerUiFeatureOptions> = { ...DEFAULT_FEATURES }
  #host: HTMLElement | null = null
  #root: HTMLElement | null = null
  #scope = new CleanupScope()
  #epoch = 0
  #attached = false
  #destroyed = false
  #snapshot: PlaybackSnapshot
  #overlay: OverlayName | null = null
  #overlayTrigger: HTMLElement | null = null
  #focusBeforeOverlay: HTMLElement | null = null
  #overlayKeydownCleanup: (() => void) | null = null
  #hideTimer: ReturnType<typeof setTimeout> | null = null
  #pointerActive = false
  #focusActive = false
  #sessionEpoch = 0
  #theaterUnsubscribe: (() => void) | null = null
  #seek: SeekState = { active: false, pointerId: null, pending: null, timer: null, epoch: 0, cleanup: null }
  #preview: PreviewState = { controller: null, timer: null, url: null, urls: [] }
  #subtitleDrag: SubtitleDragState = { active: false, pending: null, timer: null, cleanup: null }
  #subtitleResume: SubtitleResumeToken | null = null
  #lastSubtitleTrackId: string | null = null
  #pendingSubtitleSelection: { id: string | null, sessionEpoch: number } | null = null
  #elements: {
    controls: HTMLElement
    status: HTMLElement
    statusMessage: HTMLElement
    progress: HTMLInputElement
    progressWrap: HTMLElement
    progressTrack: HTMLElement
    played: HTMLElement
    buffered: HTMLElement
    thumb: HTMLElement
    preview: HTMLElement
    previewImage: HTMLImageElement
    previewTime: HTMLElement
    time: HTMLElement
    play: IconButton
    next: IconButton
    mute: IconButton
    volume: HTMLInputElement
    subtitles: IconButton
    pip: IconButton
    theater: IconButton
    settings: IconButton
    fullscreen: IconButton
  } | null = null

  constructor(player: PlayerUiPlayer, options: PlayerUiOptions = {}) {
    this.#player = player
    this.#snapshot = player.playback
    this.#sessionEpoch = this.#snapshot.sessionEpoch
    this.#lastSubtitleTrackId = player.selectedSubtitleTrack
    this.#setOptions(options)
  }

  get attached(): boolean { return this.#attached }

  attach(container: HTMLElement): void {
    this.#ensureAlive()
    if (!isElement(container)) throw new PlayerUiError(UiErrorCodes.UI_INVALID_CONTAINER, 'A player UI container is required')
    if (this.#attached && this.#host === container) {
      this.#sync()
      return
    }
    this.#detachInternal()
    this.#host = container
    this.#host.classList.add('mxp-player-host')
    this.#root = this.#buildRoot(container.ownerDocument ?? document)
    this.#host.appendChild(this.#root)
    this.#attached = true
    this.#subscribe()
    this.#sync()
  }

  update(options: PlayerUiOptions): void {
    this.#ensureAlive()
    this.#setOptions(options)
    this.#epoch += 1
    this.#clearPreview()
    if (this.#attached && this.#host) {
      const host = this.#host
      this.#detachInternal(false)
      this.#host = host
      this.#root = this.#buildRoot(host.ownerDocument ?? document)
      host.appendChild(this.#root)
      this.#attached = true
      this.#subscribe()
      this.#sync()
    }
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#epoch += 1
    this.#cancelSeek()
    this.#cancelSubtitleDrag()
    this.#clearPreview()
    this.#closeOverlay(false, false)
    this.#detachInternal()
    this.#host = null
  }

  #setOptions(options: PlayerUiOptions): void {
    if (options === null || typeof options !== 'object') throw new PlayerUiError(UiErrorCodes.UI_INVALID_OPTIONS, 'Player UI options are invalid')
    const delay = options.autoHideDelayMs
    if (delay !== undefined && (!Number.isFinite(delay) || delay < 500 || delay > 30_000)) throw new PlayerUiError(UiErrorCodes.UI_INVALID_OPTIONS, 'The auto-hide delay is outside the supported range')
    this.#options = {
      ...(options.theme === undefined ? {} : { theme: options.theme }),
      ...(options.features === undefined ? {} : { features: { ...options.features } }),
      ...(options.labels === undefined ? {} : { labels: { ...options.labels } }),
      ...(delay === undefined ? {} : { autoHideDelayMs: delay }),
      ...(options.nextEpisode === undefined ? {} : { nextEpisode: { ...options.nextEpisode } }),
      ...(options.theaterMode === undefined ? {} : { theaterMode: options.theaterMode }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    }
    this.#labels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) }
    this.#features = { ...DEFAULT_FEATURES, ...(options.features ?? {}) }
  }

  #buildRoot(document: Document): HTMLElement {
    const root = document.createElement('div')
    root.className = 'mxp-player-ui'
    root.tabIndex = 0
    root.setAttribute('role', 'region')
    root.setAttribute('aria-label', 'Media player')
    root.dataset.mxpTheme = this.#options.theme ?? 'dark'
    root.dataset.mxpVisible = 'true'

    const status = document.createElement('div')
    status.className = 'mxp-status-layer'
    const statusMessage = document.createElement('div')
    statusMessage.className = 'mxp-status-message'
    statusMessage.setAttribute('role', 'status')
    statusMessage.setAttribute('aria-live', 'polite')
    status.append(statusMessage)
    root.append(status)

    const controls = document.createElement('div')
    controls.className = 'mxp-control-shell'
    const progressWrap = document.createElement('div')
    progressWrap.className = 'mxp-progress-wrap'
    const progressTrack = document.createElement('div')
    progressTrack.className = 'mxp-progress-track'
    progressTrack.setAttribute('aria-hidden', 'true')
    const buffered = document.createElement('div')
    buffered.className = 'mxp-progress-buffered'
    const played = document.createElement('div')
    played.className = 'mxp-progress-played'
    const thumb = document.createElement('div')
    thumb.className = 'mxp-progress-thumb'
    progressTrack.append(buffered, played)
    const progress = document.createElement('input')
    progress.className = 'mxp-progress-input'
    progress.type = 'range'
    progress.min = '0'
    progress.max = '1000'
    progress.step = '1'
    progress.value = '0'
    progress.setAttribute('aria-label', this.#labels.seek)
    progressWrap.append(progressTrack, thumb, progress)

    const preview = document.createElement('div')
    preview.className = 'mxp-preview'
    preview.hidden = true
    const previewImage = document.createElement('img')
    previewImage.alt = ''
    const previewTime = document.createElement('span')
    previewTime.className = 'mxp-preview-time'
    preview.append(previewImage, previewTime)

    const row = document.createElement('div')
    row.className = 'mxp-control-row'
    const left = document.createElement('div')
    left.className = 'mxp-control-group'
    const right = document.createElement('div')
    right.className = 'mxp-control-group'
    const play = this.#iconButton(document, 'play', this.#labels.play, 'play')
    const next = this.#iconButton(document, 'next', this.#labels.nextEpisode, 'next')
    const mute = this.#iconButton(document, 'mute', this.#labels.mute, 'mute')
    const volume = document.createElement('input')
    volume.className = 'mxp-volume-slider'
    volume.type = 'range'; volume.min = '0'; volume.max = '1'; volume.step = '0.01'
    volume.setAttribute('aria-label', this.#labels.volume)
    const time = document.createElement('span')
    time.className = 'mxp-time-readout'
    const subtitles = this.#iconButton(document, 'subtitles', this.#labels.subtitles, 'captions')
    const pip = this.#iconButton(document, 'pip', this.#labels.pictureInPicture, 'pip')
    const theater = this.#iconButton(document, 'theater', this.#labels.theater, 'theater')
    theater.classList.add('mxp-theater-control')
    const settings = this.#iconButton(document, 'settings', this.#labels.settings, 'settings')
    const fullscreen = this.#iconButton(document, 'fullscreen', this.#labels.fullscreen, 'fullscreen')
    left.append(play, next, mute, volume)
    right.append(subtitles, pip, theater, settings, fullscreen)
    row.append(left, time, right)
    controls.append(progressWrap, preview, row)
    root.append(controls)

    this.#elements = { controls, status, statusMessage, progress, progressWrap, progressTrack, played, buffered, thumb, preview, previewImage, previewTime, time, play, next, mute, volume, subtitles, pip, theater, settings, fullscreen }
    this.#wireRoot(root)
    return root
  }

  #iconButton(document: Document, name: string, label: string, icon: PlayerIconName): IconButton {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `mxp-icon-button mxp-${name}-control`
    button.dataset.mxpAction = name
    button.setAttribute('aria-label', label)
    button.title = label
    const iconHost = document.createElement('span')
    iconHost.className = 'mxp-icon'
    iconHost.append(createPlayerIcon(document, icon))
    const tooltip = document.createElement('span')
    tooltip.className = 'mxp-tooltip'
    tooltip.setAttribute('role', 'tooltip')
    tooltip.setAttribute('aria-hidden', 'true')
    tooltip.textContent = label
    button.append(iconHost, tooltip)
    return button
  }

  #setButtonLabel(button: IconButton, label: string): void {
    button.setAttribute('aria-label', label)
    button.title = label
    const tooltip = button.querySelector<HTMLElement>('.mxp-tooltip')
    if (tooltip) tooltip.textContent = label
  }

  #setButtonIcon(button: IconButton, icon: PlayerIconName): void {
    const host = button.querySelector<HTMLElement>('.mxp-icon')
    if (host) host.replaceChildren(createPlayerIcon(button.ownerDocument, icon))
  }

  #wireRoot(root: HTMLElement): void {
    const elements = this.#elements
    if (!elements) return
    elements.play.addEventListener('click', () => { void this.#togglePlay() })
    elements.next.addEventListener('click', () => { void this.#requestNext() })
    elements.mute.addEventListener('click', () => { void this.#run(() => this.#player.setMuted(!this.#snapshot.muted)) })
    elements.volume.addEventListener('input', () => { void this.#run(() => this.#player.setVolume(clamp(Number(elements.volume.value), 0, 1))) })
    elements.progress.addEventListener('input', () => this.#queueSeek(this.#timeFromProgress(Number(elements.progress.value)), false))
    elements.progress.addEventListener('change', () => this.#flushSeek())
    elements.progress.addEventListener('keydown', (event) => this.#handleSeekKey(event))
    elements.progressWrap.addEventListener('pointerdown', (event) => this.#beginPointerSeek(event))
    elements.progressWrap.addEventListener('pointermove', (event) => this.#previewAtPointer(event))
    elements.progressWrap.addEventListener('pointerleave', () => this.#hidePreview())
    elements.subtitles.addEventListener('click', () => this.#openOverlay('subtitles', elements.subtitles))
    elements.pip.addEventListener('click', () => { void this.#togglePip() })
    elements.theater.addEventListener('click', () => { void this.#toggleTheater() })
    elements.settings.addEventListener('click', () => this.#openOverlay('settings', elements.settings))
    elements.fullscreen.addEventListener('click', () => { void this.#toggleFullscreen() })
    root.addEventListener('keydown', (event) => this.#handleShortcut(event))
    root.addEventListener('pointerenter', () => this.#setPointerActive(true))
    root.addEventListener('pointermove', () => this.#setPointerActive(true))
    root.addEventListener('pointerleave', () => this.#setPointerActive(false))
    root.addEventListener('focusin', () => this.#setFocusActive(true))
    root.addEventListener('focusout', (event) => { const next = event.relatedTarget; if (!(next instanceof Node) || !root.contains(next)) this.#setFocusActive(false) })
  }

  #subscribe(): void {
    const root = this.#root
    if (!root) return
    const epoch = this.#epoch
    this.#scope.add(this.#player.on('playbackchange', ({ snapshot }) => {
      if (epoch !== this.#epoch || this.#destroyed) return
      if (snapshot.sessionEpoch !== this.#sessionEpoch) {
        this.#sessionEpoch = snapshot.sessionEpoch
        this.#cancelSeek()
        this.#cancelSubtitleDrag()
        this.#clearPreview()
        this.#closeOverlay(false, false)
        this.#subtitleResume = null
        this.#pendingSubtitleSelection = null
        this.#lastSubtitleTrackId = this.#player.selectedSubtitleTrack
      }
      this.#snapshot = snapshot
      this.#observeSubtitlePause(snapshot)
      this.#render()
    }))
    this.#scope.add(this.#player.on('subtitletrackchange', () => {
      if (epoch !== this.#epoch || this.#destroyed) return
      const selected = this.#player.selectedSubtitleTrack
      if (selected !== null) this.#lastSubtitleTrackId = selected
      if (this.#pendingSubtitleSelection?.sessionEpoch === this.#sessionEpoch && this.#pendingSubtitleSelection.id === selected) {
        this.#pendingSubtitleSelection = null
      }
      this.#render()
      this.#renderOverlayIfOpen()
    }))
    this.#scope.add(this.#player.on('subtitlestylechange', () => {
      if (epoch === this.#epoch && !this.#destroyed && !this.#subtitleDrag.active) this.#renderOverlayIfOpen()
    }))
    this.#scope.add(this.#player.on('subtitlestatechange', () => { if (epoch === this.#epoch && !this.#destroyed) this.#render() }))
    this.#scope.add(this.#player.on('error', ({ error }) => { if (epoch === this.#epoch && !this.#destroyed) this.#reportSdkError(error) }))
    const document = root.ownerDocument
    const outside = (event: PointerEvent): void => {
      if (!this.#overlay || !this.#root) return
      const target = event.target
      if (target instanceof Node && !this.#root.contains(target)) this.#closeOverlay(true)
    }
    document.addEventListener('pointerdown', outside)
    this.#scope.add(() => document.removeEventListener('pointerdown', outside))
    const syncGuide = (): void => { if (epoch === this.#epoch && !this.#subtitleDrag.active) this.#syncSubtitleGuide() }
    document.addEventListener('fullscreenchange', syncGuide)
    this.#scope.add(() => document.removeEventListener('fullscreenchange', syncGuide))
    const view = document.defaultView
    view?.addEventListener('resize', syncGuide)
    if (view) this.#scope.add(() => view.removeEventListener('resize', syncGuide))
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(syncGuide)
      observer.observe(root)
      this.#scope.add(() => observer.disconnect())
    }
    if (this.#options.theaterMode) this.#connectTheater(this.#options.theaterMode)
  }

  #sync(): void {
    if (this.#destroyed || !this.#root) return
    try { this.#snapshot = this.#player.playback } catch { /* retain the last safe snapshot */ }
    this.#render()
    this.#scheduleHide()
  }

  #render(): void {
    const elements = this.#elements
    const root = this.#root
    if (!elements || !root) return
    const snapshot = this.#snapshot
    root.dataset.mxpState = snapshot.state
    if (snapshot.lastError) root.dataset.mxpErrorCode = snapshot.lastError.code
    else delete root.dataset.mxpErrorCode
    root.dataset.mxpVisible = this.#hasInteraction() || snapshot.state !== 'playing' ? 'true' : root.dataset.mxpVisible ?? 'true'
    const duration = finiteTime(snapshot.duration)
    const current = finiteTime(snapshot.currentTime) ?? 0
    const ratio = duration === null || duration <= 0 ? 0 : clamp(current / duration, 0, 1)
    root.style.setProperty('--mxp-progress-pct', `${ratio * 100}%`)
    renderRangeSegments(elements.played, snapshot.played, duration)
    renderRangeSegments(elements.buffered, snapshot.buffered, duration)
    elements.progress.value = String(Math.round(ratio * 1000))
    elements.progress.setAttribute('aria-valuetext', `${formatTime(snapshot.currentTime)} / ${formatTime(snapshot.duration, this.#labels.unknownDuration)}`)
    elements.volume.value = String(clamp(snapshot.volume, 0, 1))
    elements.time.textContent = `${formatTime(snapshot.currentTime)} / ${formatTime(snapshot.duration, this.#labels.unknownDuration)}`
    const playing = !snapshot.paused && snapshot.state !== 'ended'
    elements.play.dataset.mxpActive = playing ? 'true' : 'false'
    elements.play.setAttribute('aria-pressed', String(playing))
    this.#setButtonLabel(elements.play, playing ? this.#labels.pause : (snapshot.state === 'ended' ? this.#labels.replay : this.#labels.play))
    this.#setButtonIcon(elements.play, playing ? 'pause' : (snapshot.state === 'ended' ? 'replay' : 'play'))
    elements.mute.dataset.mxpActive = snapshot.muted ? 'true' : 'false'
    elements.mute.setAttribute('aria-pressed', String(snapshot.muted))
    this.#setButtonLabel(elements.mute, snapshot.muted ? this.#labels.unmute : this.#labels.mute)
    this.#setButtonIcon(elements.mute, snapshot.muted ? 'muted' : 'mute')
    this.#setCapability(elements.pip, this.#features.pictureInPicture, snapshot.capabilities.pictureInPicture)
    this.#setCapability(elements.fullscreen, this.#features.fullscreen, snapshot.capabilities.fullscreen)
    this.#setCapability(elements.progress, true, snapshot.capabilities.seek && duration !== null && duration > 0)
    this.#setCapability(elements.volume, this.#features.volume, snapshot.capabilities.volume)
    this.#setCapability(elements.theater, this.#features.theater, Boolean(this.#options.theaterMode))
    this.#setCapability(elements.subtitles, this.#features.subtitles, true)
    this.#setCapability(elements.settings, this.#features.settings, true)
    elements.pip.setAttribute('aria-pressed', String(snapshot.presentationMode === 'picture-in-picture'))
    elements.fullscreen.setAttribute('aria-pressed', String(snapshot.presentationMode === 'fullscreen'))
    elements.theater.setAttribute('aria-pressed', String(this.#options.theaterMode?.getState() ?? false))
    this.#setButtonLabel(elements.pip, snapshot.presentationMode === 'picture-in-picture' ? this.#labels.exitPictureInPicture : this.#labels.pictureInPicture)
    this.#setButtonLabel(elements.fullscreen, snapshot.presentationMode === 'fullscreen' ? this.#labels.exitFullscreen : this.#labels.fullscreen)
    this.#setButtonIcon(elements.fullscreen, snapshot.presentationMode === 'fullscreen' ? 'fullscreenExit' : 'fullscreen')
    const theaterActive = this.#options.theaterMode?.getState() ?? false
    this.#setButtonLabel(elements.theater, theaterActive ? this.#labels.exitTheater : this.#labels.theater)
    if (this.#features.nextEpisode) {
      const next = this.#options.nextEpisode
      const available = typeof next?.onRequest === 'function'
      elements.next.hidden = !available && next?.unavailableBehavior === 'hidden'
      elements.next.disabled = !available
    } else elements.next.hidden = true
    const subtitlesActive = this.#player.selectedSubtitleTrack !== null
    elements.subtitles.dataset.mxpActive = String(subtitlesActive)
    elements.subtitles.setAttribute('aria-pressed', String(subtitlesActive))
    this.#renderStatus()
    this.#scheduleHide()
  }

  #setCapability(element: HTMLInputElement | IconButton, enabledByOption: boolean, supported: boolean): void {
    element.hidden = !enabledByOption
    element.disabled = !enabledByOption || !supported
  }

  #renderStatus(): void {
    const elements = this.#elements
    if (!elements) return
    const snapshot = this.#snapshot
    let text = ''
    let tone = 'normal'
    if (snapshot.lastError) { text = this.#labels.error; tone = 'error' }
    else if (snapshot.state === 'loading') text = this.#labels.loading
    else if (snapshot.buffering) text = this.#labels.buffering
    else if (snapshot.seeking || snapshot.state === 'seeking') text = this.#labels.seeking
    elements.statusMessage.textContent = text
    elements.statusMessage.dataset.mxpTone = tone
    elements.statusMessage.hidden = text.length === 0
  }

  #togglePlay(): Promise<void> {
    if (this.#snapshot.state === 'ended') return this.#run(async () => { await this.#player.seek(0); await this.#player.play() })
    if (this.#snapshot.state === 'playing' && !this.#snapshot.paused) { this.#player.pause(); return Promise.resolve() }
    return this.#run(() => this.#player.play())
  }

  async #requestNext(): Promise<void> {
    const callback = this.#options.nextEpisode?.onRequest
    if (!callback) return
    const epoch = this.#epoch
    const button = this.#elements?.next
    if (button) button.disabled = true
    try { await callback(); if (epoch === this.#epoch) this.#showControls() }
    catch { if (epoch === this.#epoch) this.#reportUiError() }
    finally { if (epoch === this.#epoch && !this.#destroyed) this.#render() }
  }

  async #togglePip(): Promise<void> {
    if (this.#snapshot.presentationMode === 'picture-in-picture') return this.#run(() => this.#player.exitPictureInPicture())
    return this.#run(() => this.#player.requestPictureInPicture())
  }

  async #toggleFullscreen(): Promise<void> {
    if (this.#snapshot.presentationMode === 'fullscreen') return this.#run(() => this.#player.exitFullscreen())
    return this.#run(() => this.#player.requestFullscreen())
  }

  async #toggleTheater(): Promise<void> {
    const adapter = this.#options.theaterMode
    if (!adapter) return
    const epoch = this.#epoch
    try { await adapter.setState(!adapter.getState()); if (epoch === this.#epoch) this.#render() }
    catch { if (epoch === this.#epoch) this.#reportUiError() }
  }

  #run(action: () => void | Promise<void>): Promise<void> {
    const epoch = this.#epoch
    return Promise.resolve().then(() => {
      if (epoch !== this.#epoch || this.#destroyed) return
      return action()
    }).catch(() => { if (epoch === this.#epoch && !this.#destroyed) this.#reportUiError() })
  }

  #reportSdkError(error: EngineError): void {
    if (error && typeof error.code === 'string') this.#reportUiError()
  }

  #reportUiError(): void {
    const summary: PlayerUiErrorSummary = { code: UiErrorCodes.UI_OPERATION_FAILED, recoverable: true }
    try { this.#options.onError?.(summary) } catch { /* consumer callback is isolated */ }
  }

  #openOverlay(name: OverlayName, trigger: HTMLElement): void {
    if (this.#overlay === name) { this.#closeOverlay(true); return }
    const active = trigger.ownerDocument.activeElement
    const focusBeforeOpen = this.#focusBeforeOverlay
      ?? (active instanceof HTMLElement && active.isConnected ? active : trigger)
    this.#closeOverlay(false)
    this.#overlay = name
    this.#overlayTrigger = trigger
    this.#focusBeforeOverlay = focusBeforeOpen
    const root = this.#root
    if (!root) return
    if (name === 'subtitles') this.#pauseForSubtitles()
    const backdrop = root.ownerDocument.createElement('div')
    backdrop.className = 'mxp-overlay-backdrop'
    backdrop.dataset.mxpOverlay = name
    const panel = root.ownerDocument.createElement('section')
    panel.className = 'mxp-panel'
    panel.tabIndex = -1
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')
    backdrop.append(panel)
    root.append(backdrop)
    backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop) this.#closeOverlay(true) })
    this.#renderPanel(panel, name)
    const focusTarget = focusableElements(panel)[0]
    if (focusTarget) focusTarget.focus()
    else panel.focus()
    this.#connectOverlayKeyboard(root.ownerDocument)
    this.#showControls()
  }

  #closeOverlay(restoreFocus: boolean, resumePlayback = true): void {
    this.#overlayKeydownCleanup?.()
    this.#overlayKeydownCleanup = null
    if (!this.#overlay || !this.#root) { this.#overlay = null; return }
    const closedOverlay = this.#overlay
    this.#root.querySelector('.mxp-overlay-backdrop')?.remove()
    this.#root.querySelector(':scope > .mxp-subtitle-editor-guide')?.remove()
    const trigger = this.#focusBeforeOverlay ?? this.#overlayTrigger
    this.#overlay = null
    this.#overlayTrigger = null
    this.#focusBeforeOverlay = null
    if (restoreFocus && trigger && trigger.isConnected) trigger.focus()
    const activeElement = this.#root.ownerDocument.activeElement
    this.#focusActive = activeElement !== null && this.#root.contains(activeElement)
    if (closedOverlay === 'subtitles') {
      if (resumePlayback) this.#resumeAfterSubtitles()
      else this.#subtitleResume = null
    }
    this.#scheduleHide()
  }

  #connectOverlayKeyboard(document: Document): void {
    this.#overlayKeydownCleanup?.()
    const keydown = (event: KeyboardEvent): void => {
      const root = this.#root
      if (!this.#overlay || !root) return
      const target = event.target
      if (target instanceof Node && root.contains(target)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        this.#closeOverlay(true)
        return
      }
      if (event.key !== 'Tab') return
      const panel = root.querySelector<HTMLElement>('.mxp-panel')
      if (!panel) return
      event.preventDefault()
      const targetElement = focusableElements(panel)[0] ?? panel
      targetElement.focus()
    }
    document.addEventListener('keydown', keydown)
    this.#overlayKeydownCleanup = (): void => document.removeEventListener('keydown', keydown)
  }

  #pauseForSubtitles(): void {
    if (this.#snapshot.paused || this.#snapshot.state === 'ended' || this.#snapshot.state === 'error') return
    const token: SubtitleResumeToken = { sessionEpoch: this.#sessionEpoch, pauseObserved: false }
    this.#subtitleResume = token
    try {
      this.#player.pause()
      const snapshot = this.#player.playback
      if (snapshot.sessionEpoch === token.sessionEpoch && snapshot.paused) token.pauseObserved = true
    } catch {
      this.#subtitleResume = null
      this.#reportUiError()
    }
  }

  #observeSubtitlePause(snapshot: PlaybackSnapshot): void {
    const token = this.#subtitleResume
    if (!token) return
    if (snapshot.sessionEpoch !== token.sessionEpoch) { this.#subtitleResume = null; return }
    if (!token.pauseObserved && snapshot.paused && (snapshot.state === 'paused' || snapshot.state === 'ready')) {
      token.pauseObserved = true
      return
    }
    if (token.pauseObserved && (!snapshot.paused || (snapshot.state !== 'paused' && snapshot.state !== 'ready'))) {
      this.#subtitleResume = null
    }
  }

  #resumeAfterSubtitles(): void {
    const token = this.#subtitleResume
    this.#subtitleResume = null
    if (!token || !token.pauseObserved || token.sessionEpoch !== this.#sessionEpoch || this.#destroyed) return
    if (!this.#snapshot.paused || (this.#snapshot.state !== 'paused' && this.#snapshot.state !== 'ready')) return
    void this.#run(() => this.#player.play())
  }

  #renderOverlayIfOpen(): void {
    if (!this.#overlay || !this.#root) return
    const panel = this.#root.querySelector('.mxp-panel')
    if (panel instanceof HTMLElement) this.#renderPanel(panel, this.#overlay)
  }

  #renderPanel(panel: HTMLElement, name: OverlayName): void {
    this.#root?.querySelector(':scope > .mxp-subtitle-editor-guide')?.remove()
    panel.replaceChildren()
    const header = panel.ownerDocument.createElement('div'); header.className = 'mxp-panel-header'
    const title = panel.ownerDocument.createElement('h2'); title.className = 'mxp-panel-title'
    title.textContent = name === 'settings' ? this.#labels.settings : name === 'statistics' ? this.#labels.statistics : name === 'about' ? this.#labels.about : this.#labels.subtitles
    const close = this.#iconButton(panel.ownerDocument, 'close', this.#labels.close, 'close')
    close.addEventListener('click', () => this.#closeOverlay(true))
    header.append(title, close); panel.append(header)
    const content = panel.ownerDocument.createElement('div'); content.className = 'mxp-panel-content'; panel.append(content)
    if (name === 'settings') this.#renderSettings(content)
    else if (name === 'statistics') this.#renderStatistics(content)
    else if (name === 'about') this.#renderAbout(content)
    else this.#renderSubtitles(content)
  }

  #renderSettings(content: HTMLElement): void {
    const section = this.#section(content, this.#labels.playbackRate)
    const rate = content.ownerDocument.createElement('select')
    rate.setAttribute('aria-label', this.#labels.playbackRate)
    for (const value of [0.5, 0.75, 1, 1.25, 1.5, 2]) { const option = content.ownerDocument.createElement('option'); option.value = String(value); option.textContent = `${value}x`; option.selected = Math.abs(this.#snapshot.playbackRate - value) < 0.001; rate.append(option) }
    rate.addEventListener('change', () => { void this.#run(() => { this.#player.setPlaybackRate(Number(rate.value)) }) })
    section.append(rate)
    if (this.#features.subtitles) { const subtitle = content.ownerDocument.createElement('button'); subtitle.type = 'button'; subtitle.textContent = this.#labels.subtitles; subtitle.addEventListener('click', () => this.#openOverlay('subtitles', subtitle)); section.append(subtitle) }
    if (this.#features.statistics) { const stats = content.ownerDocument.createElement('button'); stats.type = 'button'; stats.textContent = this.#labels.statistics; stats.addEventListener('click', () => this.#openOverlay('statistics', stats)); section.append(stats) }
    if (this.#features.about) { const about = content.ownerDocument.createElement('button'); about.type = 'button'; about.textContent = this.#labels.about; about.addEventListener('click', () => this.#openOverlay('about', about)); section.append(about) }
  }

  #renderStatistics(content: HTMLElement): void {
    const grid = content.ownerDocument.createElement('div'); grid.className = 'mxp-stat-grid'
    const entries: Array<[string, string]> = [['State', this.#snapshot.state], ['Time', formatTime(this.#snapshot.currentTime)], ['Duration', formatTime(this.#snapshot.duration, this.#labels.unknownDuration)], ['Buffered ahead', formatTime(this.#snapshot.bufferedAhead)], ['Volume', `${Math.round(this.#snapshot.volume * 100)}%`], ['Rate', `${this.#snapshot.playbackRate}x`], ['Session', String(this.#snapshot.sessionEpoch)]]
    for (const [key, value] of entries) { const label = content.ownerDocument.createElement('span'); label.textContent = key; const strong = content.ownerDocument.createElement('strong'); strong.textContent = value; grid.append(label, strong) }
    content.append(grid)
  }

  #renderAbout(content: HTMLElement): void {
    const text = content.ownerDocument.createElement('p'); text.className = 'mxp-caption'; text.textContent = '@mx-player-max/ui Phase 9'; content.append(text)
    const scope = content.ownerDocument.createElement('p'); scope.className = 'mxp-caption'; scope.textContent = 'Native and Custom playback controls through the public SDK contract.'; content.append(scope)
  }

  #renderSubtitles(content: HTMLElement): void {
    const tracks = this.#player.subtitleTracks
    const section = this.#section(content, this.#labels.subtitleTracks)
    const off = content.ownerDocument.createElement('button')
    off.type = 'button'
    off.textContent = this.#labels.subtitleOff
    off.dataset.mxpSelected = String(this.#player.selectedSubtitleTrack === null)
    off.setAttribute('aria-pressed', String(this.#player.selectedSubtitleTrack === null))
    off.dataset.mxpPending = String(this.#pendingSubtitleSelection?.id === null && this.#pendingSubtitleSelection.sessionEpoch === this.#sessionEpoch)
    off.addEventListener('click', () => { void this.#selectSubtitleTrack(null) })
    section.append(off)
    if (tracks.length === 0) {
      const empty = content.ownerDocument.createElement('span')
      empty.className = 'mxp-caption'
      empty.textContent = this.#labels.noSubtitles
      section.append(empty)
    }
    for (const track of tracks) section.append(this.#trackButton(track))
    const styleSection = this.#section(content, this.#labels.subtitleStyle)
    this.#renderStyleControls(styleSection)
  }

  #trackButton(track: SubtitleTrack): HTMLButtonElement {
    const button = this.#root?.ownerDocument.createElement('button') ?? document.createElement('button')
    const selected = track.id === this.#player.selectedSubtitleTrack
    const pending = this.#pendingSubtitleSelection?.id === track.id && this.#pendingSubtitleSelection.sessionEpoch === this.#sessionEpoch
    button.type = 'button'
    button.className = 'mxp-subtitle-track'
    button.dataset.mxpSelected = String(selected)
    button.dataset.mxpPending = String(pending)
    const label = button.ownerDocument.createElement('span')
    label.textContent = track.name || track.language || track.id
    const state = button.ownerDocument.createElement('span')
    state.className = 'mxp-subtitle-track-status'
    state.textContent = `${this.#subtitleSourceLabel(track)} - ${track.state}`
    button.append(label, state)
    button.setAttribute('aria-pressed', String(selected))
    button.addEventListener('click', () => { void this.#selectSubtitleTrack(track.id) })
    return button
  }

  #subtitleSourceLabel(track: SubtitleTrack): string {
    if (track.source.kind === 'embedded') return this.#labels.embeddedTrack
    if (track.source.kind === 'file') return this.#labels.localTrack
    return this.#labels.remoteTrack
  }

  async #selectSubtitleTrack(id: string | null): Promise<void> {
    const epoch = this.#epoch
    const sessionEpoch = this.#sessionEpoch
    this.#pendingSubtitleSelection = { id, sessionEpoch }
    this.#renderOverlayIfOpen()
    try {
      await this.#player.selectSubtitleTrack(id)
      if (epoch !== this.#epoch || sessionEpoch !== this.#sessionEpoch || this.#destroyed) return
      if (id !== null) this.#lastSubtitleTrackId = id
    } catch {
      if (epoch === this.#epoch && sessionEpoch === this.#sessionEpoch && !this.#destroyed) this.#reportUiError()
    } finally {
      if (epoch === this.#epoch && sessionEpoch === this.#sessionEpoch && !this.#destroyed) {
        this.#pendingSubtitleSelection = null
        this.#render()
        this.#renderOverlayIfOpen()
      }
    }
  }

  #renderStyleControls(section: HTMLElement): void {
    const style = this.#player.subtitleStyle
    const doc = section.ownerDocument
    const family = doc.createElement('select')
    family.setAttribute('aria-label', this.#labels.fontFamily)
    const families = ['system-ui, sans-serif', 'Arial, sans-serif', 'Georgia, serif', 'ui-monospace, monospace', '"Trebuchet MS", sans-serif']
    if (style.fontFamily && !families.includes(style.fontFamily)) families.unshift(style.fontFamily)
    for (const value of families) {
      const option = doc.createElement('option')
      option.value = value
      option.textContent = value.split(',')[0] ?? value
      option.selected = style.fontFamily === value
      family.append(option)
    }
    family.addEventListener('change', () => this.#setSubtitleStyle({ fontFamily: family.value }))
    const alignment = doc.createElement('select')
    alignment.setAttribute('aria-label', this.#labels.alignment)
    const alignments: readonly SubtitleAlignment[] = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']
    for (const value of alignments) {
      const option = doc.createElement('option')
      option.value = value
      option.textContent = value.split('-').map(capitalize).join(' ')
      option.selected = style.alignment === value
      alignment.append(option)
    }
    alignment.addEventListener('change', () => this.#setSubtitleStyle({ alignment: alignment.value as SubtitleAlignment }))
    const size = this.#styleRange(doc, this.#labels.fontSize, style.fontSize ?? 36, 6, 256, 1, (value) => this.#setSubtitleStyle({ fontSize: value }))
    const x = this.#styleRange(doc, this.#labels.horizontalPosition, style.x ?? 50, 5, 95, 1, (value) => this.#setSubtitleStyle({ x: value }))
    const y = this.#styleRange(doc, this.#labels.subtitlePosition, style.y ?? 86, 8, 92, 1, (value) => this.#setSubtitleStyle({ y: value }))
    const outlineWidth = this.#styleRange(doc, this.#labels.outlineWidth, style.outlineWidth ?? 2, 0, 16, 0.5, (value) => this.#setSubtitleStyle({ outlineWidth: value }))
    const color = this.#colorControl(doc, this.#labels.subtitleColor, style.color, '#ffffff', (value) => this.#setSubtitleStyle({ color: value }))
    const outline = this.#colorControl(doc, this.#labels.outlineColor, style.outlineColor, '#000000', (value) => this.#setSubtitleStyle({ outlineColor: value }))
    const toggles = doc.createElement('div')
    toggles.className = 'mxp-subtitle-toggles'
    toggles.append(
      this.#toggleControl(doc, this.#labels.bold, style.bold ?? false, (checked) => this.#setSubtitleStyle({ bold: checked })),
      this.#toggleControl(doc, this.#labels.italic, style.italic ?? false, (checked) => this.#setSubtitleStyle({ italic: checked })),
      this.#toggleControl(doc, this.#labels.underline, style.underline ?? false, (checked) => this.#setSubtitleStyle({ underline: checked })),
    )
    const reset = doc.createElement('button')
    reset.type = 'button'
    reset.textContent = this.#labels.reset
    reset.addEventListener('click', () => { try { this.#player.resetSubtitleStyle() } catch { this.#reportUiError() } })
    section.append(this.#labeledControl(doc, this.#labels.fontFamily, family), this.#labeledControl(doc, this.#labels.alignment, alignment), size, x, y, outlineWidth, color, outline, toggles, reset)
    this.#addSubtitleGuide(section, style)
  }

  #labeledControl(doc: Document, labelText: string, control: HTMLElement): HTMLLabelElement {
    const label = doc.createElement('label')
    label.className = 'mxp-panel-section'
    const text = doc.createElement('span')
    text.className = 'mxp-panel-label'
    text.textContent = labelText
    label.append(text, control)
    return label
  }

  #colorControl(doc: Document, labelText: string, value: string | undefined, fallback: string, onChange: (value: string) => void): HTMLLabelElement {
    const input = doc.createElement('input')
    input.type = 'color'
    input.value = /^#[0-9a-f]{6}$/i.test(value ?? '') ? value ?? fallback : fallback
    input.setAttribute('aria-label', labelText)
    input.addEventListener('input', () => onChange(input.value))
    const label = this.#labeledControl(doc, labelText, input)
    label.classList.add('mxp-color-control')
    return label
  }

  #toggleControl(doc: Document, labelText: string, checked: boolean, onChange: (checked: boolean) => void): HTMLLabelElement {
    const label = doc.createElement('label')
    label.className = 'mxp-toggle-control'
    const input = doc.createElement('input')
    input.type = 'checkbox'
    input.checked = checked
    input.addEventListener('change', () => onChange(input.checked))
    const text = doc.createElement('span')
    text.textContent = labelText
    label.append(input, text)
    return label
  }

  #styleRange(doc: Document, labelText: string, value: number, min: number, max: number, step: number, onChange: (value: number) => void): HTMLLabelElement {
    const label = doc.createElement('label'); label.className = 'mxp-panel-section'; const text = doc.createElement('span'); text.className = 'mxp-panel-label'; text.textContent = labelText; const input = doc.createElement('input'); input.className = 'mxp-style-slider'; input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(clamp(value, min, max)); input.setAttribute('aria-label', labelText); input.addEventListener('input', () => onChange(Number(input.value))); label.append(text, input); return label
  }

  #addSubtitleGuide(section: HTMLElement, style: SubtitleCueStyle): void {
    const root = this.#root
    if (!root) return
    root.querySelector(':scope > .mxp-subtitle-editor-guide')?.remove()
    const guide = section.ownerDocument.createElement('div')
    guide.className = 'mxp-subtitle-editor-guide'
    guide.dataset.mxpGuide = 'true'
    guide.setAttribute('aria-hidden', 'true')
    guide.style.setProperty('--mxp-subtitle-x', `${clamp(style.x ?? 50, 5, 95)}%`)
    guide.style.setProperty('--mxp-subtitle-y', `${clamp(style.y ?? 86, 8, 92)}%`)
    guide.style.setProperty('--mxp-subtitle-guide-height', `${guideHeight(style.fontSize ?? 36)}px`)
    guide.addEventListener('pointerdown', (event) => { if (event.target === guide) this.#beginSubtitleDrag(event, 'center') })
    for (const edge of ['top', 'bottom'] as const) {
      const handle = section.ownerDocument.createElement('div')
      handle.className = 'mxp-subtitle-handle'
      handle.dataset.mxpEdge = edge
      handle.addEventListener('pointerdown', (event) => this.#beginSubtitleDrag(event, edge))
      guide.append(handle)
    }
    root.append(guide)
  }

  #section(parent: HTMLElement, titleText: string): HTMLElement {
    const section = parent.ownerDocument.createElement('div'); section.className = 'mxp-panel-section'; const label = parent.ownerDocument.createElement('span'); label.className = 'mxp-panel-label'; label.textContent = titleText; section.append(label); parent.append(section); return section
  }

  #setSubtitleStyle(patch: SubtitleCueStyle): void {
    try { this.#player.setSubtitleStyle({ ...this.#player.subtitleStyle, ...patch }) } catch { this.#reportUiError() }
  }

  #syncSubtitleGuide(): void {
    const guide = this.#root?.querySelector<HTMLElement>('[data-mxp-guide="true"]')
    if (!guide) return
    const style = this.#player.subtitleStyle
    guide.style.setProperty('--mxp-subtitle-x', `${clamp(style.x ?? 50, 5, 95)}%`)
    guide.style.setProperty('--mxp-subtitle-y', `${clamp(style.y ?? 86, 8, 92)}%`)
    guide.style.setProperty('--mxp-subtitle-guide-height', `${guideHeight(style.fontSize ?? 36)}px`)
  }

  #beginSubtitleDrag(event: PointerEvent, mode: 'center' | 'top' | 'bottom'): void {
    const captureTarget = event.currentTarget as HTMLElement
    const guide = mode === 'center' ? captureTarget : captureTarget.parentElement
    const root = this.#root
    if (!guide || !root) return
    event.preventDefault()
    event.stopPropagation()
    this.#cancelSubtitleDrag()
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const style = this.#player.subtitleStyle
    const initialX = clamp(style.x ?? 50, 5, 95)
    const initialY = clamp(style.y ?? 86, 8, 92)
    const initialSize = clamp(style.fontSize ?? 36, 6, 256)
    const epoch = this.#epoch
    const sessionEpoch = this.#sessionEpoch
    this.#subtitleDrag.active = true
    this.#showControls()
    captureTarget.setPointerCapture?.(pointerId)

    const move = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId || epoch !== this.#epoch || sessionEpoch !== this.#sessionEpoch || this.#destroyed) return
      const rect = root.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      if (mode === 'center') {
        const x = clamp(initialX + ((moveEvent.clientX - startX) / rect.width) * 100, 5, 95)
        const y = clamp(initialY + ((moveEvent.clientY - startY) / rect.height) * 100, 8, 92)
        guide.style.setProperty('--mxp-subtitle-x', `${x}%`)
        guide.style.setProperty('--mxp-subtitle-y', `${y}%`)
        this.#queueSubtitleStyle({ x, y }, false)
        return
      }
      const direction = mode === 'top' ? -1 : 1
      const fontSize = clamp(initialSize + direction * (moveEvent.clientY - startY) * 0.5, 6, 256)
      guide.style.setProperty('--mxp-subtitle-guide-height', `${guideHeight(fontSize)}px`)
      this.#queueSubtitleStyle({ fontSize }, false)
    }

    const cleanup = (): void => {
      try { captureTarget.releasePointerCapture?.(pointerId) } catch { /* pointer capture may already be gone */ }
      captureTarget.removeEventListener('pointermove', move)
      captureTarget.removeEventListener('pointerup', end)
      captureTarget.removeEventListener('pointercancel', end)
      if (this.#subtitleDrag.cleanup === cleanup) this.#subtitleDrag.cleanup = null
    }
    const end = (endEvent: PointerEvent): void => {
      if (endEvent.pointerId !== pointerId) return
      cleanup()
      this.#subtitleDrag.active = false
      this.#flushSubtitleStyle()
      this.#scheduleHide()
    }
    this.#subtitleDrag.cleanup = cleanup
    captureTarget.addEventListener('pointermove', move)
    captureTarget.addEventListener('pointerup', end)
    captureTarget.addEventListener('pointercancel', end)
  }

  #queueSubtitleStyle(patch: SubtitleCueStyle, flush: boolean): void {
    this.#subtitleDrag.pending = { ...(this.#subtitleDrag.pending ?? {}), ...patch }
    if (flush) { this.#flushSubtitleStyle(); return }
    if (this.#subtitleDrag.timer !== null) return
    this.#subtitleDrag.timer = setTimeout(() => {
      this.#subtitleDrag.timer = null
      this.#flushSubtitleStyle()
    }, INTERACTION_THROTTLE_MS)
  }

  #flushSubtitleStyle(): void {
    if (this.#subtitleDrag.timer !== null) clearTimeout(this.#subtitleDrag.timer)
    this.#subtitleDrag.timer = null
    const patch = this.#subtitleDrag.pending
    this.#subtitleDrag.pending = null
    if (!patch || this.#destroyed) return
    this.#setSubtitleStyle(patch)
  }

  #cancelSubtitleDrag(): void {
    if (this.#subtitleDrag.timer !== null) clearTimeout(this.#subtitleDrag.timer)
    this.#subtitleDrag.timer = null
    this.#subtitleDrag.pending = null
    this.#subtitleDrag.cleanup?.()
    this.#subtitleDrag.cleanup = null
    this.#subtitleDrag.active = false
  }

  #beginPointerSeek(event: PointerEvent): void {
    if (this.#snapshot.duration === null || !this.#snapshot.capabilities.seek) return
    this.#cancelSeek()
    const target = event.currentTarget as HTMLElement
    const pointerId = event.pointerId
    event.preventDefault()
    target.setPointerCapture?.(pointerId)
    this.#seek.active = true
    this.#seek.pointerId = pointerId
    this.#showControls()
    this.#queueSeek(this.#timeAtPointer(event), false)
    const move = (moveEvent: PointerEvent): void => { if (this.#seek.active && this.#seek.pointerId === pointerId) this.#queueSeek(this.#timeAtPointer(moveEvent), false) }
    const cleanup = (): void => {
      try { target.releasePointerCapture?.(pointerId) } catch { /* pointer capture may already be gone */ }
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
      if (this.#seek.cleanup === cleanup) this.#seek.cleanup = null
    }
    const end = (up: PointerEvent): void => {
      if (this.#seek.pointerId !== up.pointerId) return
      cleanup()
      this.#seek.active = false
      this.#seek.pointerId = null
      this.#flushSeek()
      this.#scheduleHide()
    }
    this.#seek.cleanup = cleanup
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }

  #timeAtPointer(event: PointerEvent): number {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect(); const ratio = rect.width <= 0 ? 0 : clamp((event.clientX - rect.left) / rect.width, 0, 1); return Math.round((this.#snapshot.duration ?? 0) * ratio)
  }

  #timeFromProgress(value: number): number { return Math.round((this.#snapshot.duration ?? 0) * clamp(value / 1000, 0, 1)) }

  #queueSeek(time: number, flush: boolean): void {
    if (this.#snapshot.duration === null || !Number.isFinite(time)) return
    this.#seek.pending = clamp(Math.round(time), 0, this.#snapshot.duration); this.#seek.epoch = this.#epoch
    if (flush) { this.#flushSeek(); return }
    if (this.#seek.timer !== null) return
    this.#seek.timer = setTimeout(() => { this.#seek.timer = null; this.#flushSeek() }, 80)
  }

  #flushSeek(): void {
    if (this.#seek.pending === null) return
    const time = this.#seek.pending; this.#seek.pending = null; const epoch = this.#epoch
    void this.#run(async () => { if (epoch === this.#epoch) await this.#player.seek(time) })
  }

  #cancelSeek(): void { if (this.#seek.timer !== null) clearTimeout(this.#seek.timer); this.#seek.timer = null; this.#seek.cleanup?.(); this.#seek.cleanup = null; this.#seek.pending = null; this.#seek.active = false; this.#seek.pointerId = null }

  #handleSeekKey(event: KeyboardEvent): void {
    if (this.#snapshot.duration === null) return
    if (event.key === 'Home') { event.preventDefault(); this.#queueSeek(0, true) }
    else if (event.key === 'End') { event.preventDefault(); this.#queueSeek(this.#snapshot.duration, true) }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); const direction = event.key === 'ArrowLeft' || event.key === 'PageDown' ? -1 : 1; this.#queueSeek((this.#snapshot.currentTime ?? 0) + direction * (event.key.startsWith('Page') ? 30_000_000 : SEEK_STEP), true) }
  }

  #previewAtPointer(event: PointerEvent): void {
    if (event.pointerType === 'touch' || !this.#features.preview || !this.#snapshot.capabilities.preview || this.#snapshot.duration === null) return
    const track = event.currentTarget as HTMLElement
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) { this.#hidePreview(); return }
    const rootRect = this.#root?.getBoundingClientRect()
    const rootWidth = rootRect && rootRect.width > 0 ? rootRect.width : rect.width
    const rootLeft = rootRect && rootRect.width > 0 ? rootRect.left : rect.left
    if (rootWidth < PREVIEW_WIDTH + 2) { this.#hidePreview(); return }
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    const time = Math.round((this.#snapshot.duration ?? 0) * ratio)
    const previewLeft = clamp(event.clientX - rootLeft, PREVIEW_EDGE_INSET, rootWidth - PREVIEW_EDGE_INSET)
    this.#showPreviewTime(time, previewLeft)
    if (this.#preview.timer !== null) clearTimeout(this.#preview.timer)
    this.#preview.timer = null
    this.#preview.controller?.abort()
    const controller = new AbortController()
    this.#preview.controller = controller
    const epoch = this.#epoch
    const sessionEpoch = this.#sessionEpoch
    this.#preview.timer = setTimeout(() => {
      this.#preview.timer = null
      if (epoch !== this.#epoch || sessionEpoch !== this.#sessionEpoch || controller.signal.aborted || this.#destroyed) return
      void this.#player.requestPreview({ time, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, signal: controller.signal }).then((image) => {
        if (!image || image.sessionEpoch !== sessionEpoch || epoch !== this.#epoch || sessionEpoch !== this.#sessionEpoch || controller.signal.aborted || this.#destroyed) return
        this.#setPreviewImage(image)
      }).catch(() => {
        if (epoch === this.#epoch && sessionEpoch === this.#sessionEpoch && !controller.signal.aborted) this.#clearPreviewImage()
      })
    }, PREVIEW_DELAY_MS)
  }

  #showPreviewTime(time: number, left: number): void { const elements = this.#elements; if (!elements) return; elements.preview.hidden = false; elements.previewTime.textContent = formatTime(time); elements.preview.style.setProperty('--mxp-preview-left', `${left}px`) }
  #setPreviewImage(image: MediaPreviewImage): void { const elements = this.#elements; if (!elements) return; this.#revokePreviewUrl(); const url = URL.createObjectURL(image.blob); this.#preview.url = url; this.#preview.urls.push(url); while (this.#preview.urls.length > 12) { const old = this.#preview.urls.shift(); if (old) URL.revokeObjectURL(old) }; elements.previewImage.src = url }
  #clearPreviewImage(): void { const elements = this.#elements; this.#revokePreviewUrl(); if (elements) elements.previewImage.removeAttribute('src') }
  #hidePreview(): void { const elements = this.#elements; if (elements) elements.preview.hidden = true; if (this.#preview.timer !== null) clearTimeout(this.#preview.timer); this.#preview.timer = null; this.#preview.controller?.abort(); this.#preview.controller = null; this.#clearPreviewImage() }
  #revokePreviewUrl(): void { if (this.#preview.url) { URL.revokeObjectURL(this.#preview.url); this.#preview.urls = this.#preview.urls.filter((value) => value !== this.#preview.url); this.#preview.url = null } }
  #clearPreview(): void { this.#hidePreview(); for (const url of this.#preview.urls) URL.revokeObjectURL(url); this.#preview.urls = [] }

  #handleShortcut(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.#overlay) { event.preventDefault(); this.#closeOverlay(true); return }
    if (event.key === 'Tab' && this.#overlay) { this.#trapOverlayFocus(event); return }
    if (this.#overlay) return
    if (isTextInput(event.target)) return
    if (event.key === ' ' || event.code === 'Space') { event.preventDefault(); void this.#togglePlay() }
    else if (event.key.toLowerCase() === 'f' && this.#features.fullscreen) { event.preventDefault(); void this.#toggleFullscreen() }
    else if (event.key.toLowerCase() === 'm' && this.#features.volume) { event.preventDefault(); void this.#run(() => this.#player.setMuted(!this.#snapshot.muted)) }
    else if (event.key.toLowerCase() === 'c' && this.#features.subtitles) { event.preventDefault(); void this.#toggleSubtitles() }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); this.#queueSeek((this.#snapshot.currentTime ?? 0) + (event.key === 'ArrowLeft' ? -SEEK_STEP : SEEK_STEP), true) }
    else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && this.#features.volume && this.#snapshot.capabilities.volume) {
      event.preventDefault()
      const direction = event.key === 'ArrowUp' ? 0.1 : -0.1
      void this.#run(() => this.#player.setVolume(clamp(this.#snapshot.volume + direction, 0, 1)))
    }
  }

  async #toggleSubtitles(): Promise<void> {
    const selected = this.#player.selectedSubtitleTrack
    if (selected !== null) {
      this.#lastSubtitleTrackId = selected
      await this.#selectSubtitleTrack(null)
      return
    }
    const available = this.#lastSubtitleTrackId !== null
      && this.#player.subtitleTracks.some((track) => track.id === this.#lastSubtitleTrackId)
    if (available) await this.#selectSubtitleTrack(this.#lastSubtitleTrackId)
  }

  #trapOverlayFocus(event: KeyboardEvent): void {
    const panel = this.#root?.querySelector('.mxp-panel')
    if (!(panel instanceof HTMLElement)) return
    const focusable = focusableElements(panel)
    if (focusable.length === 0) { event.preventDefault(); panel.focus(); return }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = panel.ownerDocument.activeElement
    if (event.shiftKey && active === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus() }
  }

  #setPointerActive(active: boolean): void { this.#pointerActive = active; if (active) this.#showControls(); else this.#scheduleHide() }
  #setFocusActive(active: boolean): void { this.#focusActive = active; if (active) this.#showControls(); else this.#scheduleHide() }
  #hasInteraction(): boolean { return this.#pointerActive || this.#focusActive || this.#overlay !== null || this.#seek.active || this.#subtitleDrag.active }
  #showControls(): void { if (this.#root) this.#root.dataset.mxpVisible = 'true'; this.#scheduleHide() }
  #scheduleHide(): void { if (this.#hideTimer !== null) clearTimeout(this.#hideTimer); this.#hideTimer = null; if (!this.#root || this.#snapshot.state !== 'playing' || this.#hasInteraction()) return; this.#hideTimer = setTimeout(() => { if (this.#root && this.#snapshot.state === 'playing' && !this.#hasInteraction()) this.#root.dataset.mxpVisible = 'false' }, this.#options.autoHideDelayMs ?? DEFAULT_AUTO_HIDE_MS) }

  #connectTheater(adapter: TheaterModeAdapter): void { this.#theaterUnsubscribe?.(); try { this.#theaterUnsubscribe = adapter.subscribe(() => this.#render()) } catch { this.#theaterUnsubscribe = null } }

  #detachInternal(removeHostClass = true): void { if (this.#hideTimer !== null) clearTimeout(this.#hideTimer); this.#hideTimer = null; this.#pointerActive = false; this.#focusActive = false; this.#cancelSeek(); this.#cancelSubtitleDrag(); this.#clearPreview(); this.#scope.close(); this.#scope = new CleanupScope(); this.#theaterUnsubscribe?.(); this.#theaterUnsubscribe = null; this.#closeOverlay(false, false); this.#subtitleResume = null; this.#pendingSubtitleSelection = null; this.#root?.remove(); if (removeHostClass && this.#host) this.#host.classList.remove('mxp-player-host'); this.#root = null; this.#elements = null; this.#attached = false }
  #ensureAlive(): void { if (this.#destroyed) throw new PlayerUiError(UiErrorCodes.UI_DESTROYED, 'The player UI has been destroyed') }
}

function finiteTime(value: number | null): number | null { return value !== null && Number.isFinite(value) && value >= 0 ? value : null }
function renderRangeSegments(container: HTMLElement, ranges: readonly { start: number; end: number }[], duration: number | null): void {
  container.replaceChildren()
  if (duration === null || duration <= 0) return
  for (const range of ranges) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) continue
    const start = clamp(range.start / duration, 0, 1)
    const end = clamp(range.end / duration, start, 1)
    if (end <= start) continue
    const segment = container.ownerDocument.createElement('span')
    segment.className = 'mxp-progress-segment'
    segment.style.setProperty('--mxp-range-start', `${start * 100}%`)
    segment.style.setProperty('--mxp-range-width', `${(end - start) * 100}%`)
    container.append(segment)
  }
}
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)) }
function formatTime(value: number | null, unknownLabel = '--:--'): string { if (value === null || !Number.isFinite(value) || value < 0) return unknownLabel; const total = Math.floor(value / 1_000_000); const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const seconds = total % 60; return `${hours > 0 ? `${hours}:` : ''}${hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)}:${String(seconds).padStart(2, '0')}` }
function isTextInput(target: EventTarget | null): boolean { if (!(target instanceof HTMLElement)) return false; const tag = target.tagName.toLowerCase(); return tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable || target.getAttribute('role') === 'menu' || target.getAttribute('role') === 'dialog' }
function focusableElements(container: HTMLElement): HTMLElement[] { return [...container.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hidden) }
function capitalize(value: string): string { return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}` }
function guideHeight(fontSize: number): number { return clamp(fontSize * 0.72, 18, 184) }

export function createPlayerUiController(player: PlayerUiPlayer, options?: PlayerUiOptions): PlayerUiController { return new PlayerUiControllerImpl(player, options) }
