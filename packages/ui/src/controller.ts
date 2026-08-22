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
  type PlayerUiLocale,
  type PlayerUiOptions,
  type PlayerUiPlayer,
  type PlayerUiShareOptions,
  type TheaterModeAdapter,
} from './contracts'
import { detectPlayerUiLocale, playerUiLabels, resolvePlayerUiLocale } from './locales'
import { buildStatsRows, NETWORK_SAMPLE_COUNT, type StatsInput, type StatsRow } from './stats'
import { buildDebugInfo, buildEmbedCode, createCpn, resolveVideoUrl, resolveVideoUrlAtTime, shortMediaId } from './share'
import { buildTroubleshootReport } from './troubleshoot'
import { createPlayerIcon, type PlayerIconName } from './icons'
import { CleanupScope, isElement } from './lifecycle'

type OverlayName = 'settings' | 'about' | 'troubleshoot'
type SubtitleMenuPage = 'track' | 'font' | 'style'
type IconButton = HTMLButtonElement

interface MenuItemSpec {
  readonly id: string
  readonly label: string
  readonly icon: PlayerIconName
  readonly checkable?: boolean
  readonly checked?: boolean
  readonly separatorBefore?: boolean
  readonly run: () => void
}

interface MenuState {
  element: HTMLElement | null
  keydown: (() => void) | null
}

interface SubtitleMenuState {
  element: HTMLElement | null
  page: SubtitleMenuPage
  editing: boolean
  bar: HTMLElement | null
  guide: HTMLElement | null
}

/** Rolling download estimate, in bytes per sampling window, newest last. */
interface NetworkState {
  samples: number[]
  totalBytes: number
  lastBufferedEnd: number | null
}

interface StatsState {
  element: HTMLElement | null
  body: HTMLElement | null
  timer: ReturnType<typeof setInterval> | null
  cpn: string
  sessionEpoch: number
}

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

const DEFAULT_AUTO_HIDE_MS = 5_000
/** How long the lock affordance stays on screen after the chrome is locked away. */
const LOCK_CHROME_HIDE_MS = 5_000
const SEEK_STEP = 5_000_000
const PREVIEW_DELAY_MS = 100
const PREVIEW_WIDTH = 160
const PREVIEW_HEIGHT = 90
const PREVIEW_EDGE_INSET = (PREVIEW_WIDTH / 2) + 1
const INTERACTION_THROTTLE_MS = 80
const STATS_INTERVAL_MS = 1_000
const TOAST_DURATION_MS = 2_200
const MENU_EDGE_INSET = 6
/** A committed time this close to the scrub target retires the local drag position. */
const SCRUB_CONFIRM_WINDOW = 400_000
/** A scrub position never outlives an unanswered seek by more than this. */
const SCRUB_EXPIRY_MS = 1_200
/** Geometry of one subtitle menu row, mirrored from the stylesheet, for the body height. */
const SUBTITLE_ROW_HEIGHT = 34
const SUBTITLE_ROW_GAP = 4
/** Mixed-script sample so CJK and Latin coverage are both visible in the font list. */
const FONT_SAMPLE = 'ABCabc123'

interface SubtitleFontOption {
  readonly id: keyof Pick<PlayerUiLabels, 'fontSystem' | 'fontSans' | 'fontSerif' | 'fontKai' | 'fontRounded' | 'fontMono'>
  readonly stack: string
}

/**
 * Each stack keeps a CJK family ahead of the generic fallback, matching the MX-Player-Pro
 * font list: a subtitled release is usually Chinese or Japanese, and a Latin-only default
 * renders it in whatever the platform happens to pick.
 */
const SUBTITLE_FONTS: readonly SubtitleFontOption[] = [
  { id: 'fontSystem', stack: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Microsoft YaHei", "Yu Gothic", "Malgun Gothic", "PingFang SC", "Hiragino Sans GB", sans-serif' },
  { id: 'fontSans', stack: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif' },
  { id: 'fontSerif', stack: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, Georgia, serif' },
  { id: 'fontKai', stack: '"Kaiti SC", STKaiti, KaiTi, "Noto Serif SC", serif' },
  { id: 'fontRounded', stack: '"Yuanti SC", STYuanti, "Hiragino Maru Gothic ProN", Quicksand, sans-serif' },
  { id: 'fontMono', stack: 'ui-monospace, SFMono-Regular, Consolas, "Noto Sans Mono CJK SC", monospace' },
]

export class PlayerUiControllerImpl implements PlayerUiController {
  readonly #player: PlayerUiPlayer
  #options: PlayerUiOptions = {}
  #labels: PlayerUiLabels = DEFAULT_LABELS
  #locale: PlayerUiLocale = 'en'
  #features: Required<PlayerUiFeatureOptions> = { ...DEFAULT_FEATURES }
  #share: PlayerUiShareOptions | undefined
  #loop = false
  #loopRestarting = false
  #mini = false
  #menu: MenuState = { element: null, keydown: null }
  #network: NetworkState = { samples: [], totalBytes: 0, lastBufferedEnd: null }
  #stats: StatsState = { element: null, body: null, timer: null, cpn: '', sessionEpoch: -1 }
  #toastTimer: ReturnType<typeof setTimeout> | null = null
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
  #lockChromeTimer: ReturnType<typeof setTimeout> | null = null
  #scrubTimer: ReturnType<typeof setTimeout> | null = null
  /** Local drag position in microseconds, shown until the SDK confirms the seek. */
  #scrub: number | null = null
  #locked = false
  #lockChromeVisible = true
  #pointerActive = false
  #focusActive = false
  /** True while the most recent focus change followed a pointer press rather than a key. */
  #pointerFocus = false
  #sessionEpoch = 0
  #theaterUnsubscribe: (() => void) | null = null
  #seek: SeekState = { active: false, pointerId: null, pending: null, timer: null, epoch: 0, cleanup: null }
  #preview: PreviewState = { controller: null, timer: null, url: null, urls: [] }
  #subtitleDrag: SubtitleDragState = { active: false, pending: null, timer: null, cleanup: null }
  #subtitleMenu: SubtitleMenuState = { element: null, page: 'track', editing: false, bar: null, guide: null }
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
    lock: IconButton
    toast: HTMLElement
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
    if (this.#options.locale === 'auto') {
      this.#locale = this.#resolveLocale('auto')
      this.#labels = { ...playerUiLabels(this.#locale), ...(this.#options.labels ?? {}) }
    }
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
    this.#clearScrub()
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
    this.#closeSubtitleMenu(true, false)
    this.#closeOverlay(false)
    this.#detachInternal()
    this.#host = null
  }

  #setOptions(options: PlayerUiOptions): void {
    if (options === null || typeof options !== 'object') throw new PlayerUiError(UiErrorCodes.UI_INVALID_OPTIONS, 'Player UI options are invalid')
    const delay = options.autoHideDelayMs
    if (delay !== undefined && (!Number.isFinite(delay) || delay < 500 || delay > 30_000)) throw new PlayerUiError(UiErrorCodes.UI_INVALID_OPTIONS, 'The auto-hide delay is outside the supported range')
    this.#options = {
      ...(options.theme === undefined ? {} : { theme: options.theme }),
      ...(options.locale === undefined ? {} : { locale: options.locale }),
      ...(options.features === undefined ? {} : { features: { ...options.features } }),
      ...(options.labels === undefined ? {} : { labels: { ...options.labels } }),
      ...(options.share === undefined ? {} : { share: { ...options.share } }),
      ...(delay === undefined ? {} : { autoHideDelayMs: delay }),
      ...(options.nextEpisode === undefined ? {} : { nextEpisode: { ...options.nextEpisode } }),
      ...(options.theaterMode === undefined ? {} : { theaterMode: options.theaterMode }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    }
    this.#locale = this.#resolveLocale(options.locale)
    this.#labels = { ...playerUiLabels(this.#locale), ...(options.labels ?? {}) }
    this.#features = { ...DEFAULT_FEATURES, ...(options.features ?? {}) }
    this.#share = this.#options.share
  }

  /**
   * `auto` reads the host document and browser preferences; anything else is normalized so
   * `zh`, `zh-Hant-HK` and `ja-JP` all land on a shipped pack instead of silently using English.
   */
  #resolveLocale(requested: PlayerUiOptions['locale']): PlayerUiLocale {
    if (requested === undefined) return 'en'
    if (requested !== 'auto') return resolvePlayerUiLocale(requested)
    const doc = this.#host?.ownerDocument ?? (typeof document === 'undefined' ? null : document)
    const view = doc?.defaultView ?? null
    const preferences: (string | null | undefined)[] = []
    const documentLanguage = doc?.documentElement?.lang
    if (documentLanguage) preferences.push(documentLanguage)
    const navigatorLanguages = view?.navigator?.languages
    if (Array.isArray(navigatorLanguages)) preferences.push(...navigatorLanguages)
    const navigatorLanguage = view?.navigator?.language
    if (navigatorLanguage) preferences.push(navigatorLanguage)
    return detectPlayerUiLocale(preferences)
  }

  #buildRoot(document: Document): HTMLElement {
    const root = document.createElement('div')
    root.className = 'mxp-player-ui'
    root.tabIndex = 0
    root.setAttribute('role', 'region')
    root.setAttribute('aria-label', 'Media player')
    root.dataset.mxpTheme = this.#options.theme ?? 'dark'
    root.dataset.mxpVisible = 'true'
    root.dataset.mxpLoop = String(this.#loop)
    root.dataset.mxpMini = String(this.#mini)
    root.dataset.mxpLocked = 'false'
    root.dataset.mxpLockChrome = 'true'
    root.dataset.mxpLocale = this.#locale

    const status = document.createElement('div')
    status.className = 'mxp-status-layer'
    const statusMessage = document.createElement('div')
    statusMessage.className = 'mxp-status-message'
    statusMessage.setAttribute('role', 'status')
    statusMessage.setAttribute('aria-live', 'polite')
    status.append(statusMessage)
    root.append(status)

    const toast = document.createElement('div')
    toast.className = 'mxp-toast'
    toast.setAttribute('role', 'status')
    toast.setAttribute('aria-live', 'polite')
    toast.hidden = true
    root.append(toast)

    const controls = document.createElement('div')
    controls.className = 'mxp-control-shell'
    const progressWrap = document.createElement('div')
    progressWrap.className = 'mxp-progress-wrap'
    const progressTrack = document.createElement('div')
    progressTrack.className = 'mxp-progress-track'
    progressTrack.setAttribute('aria-hidden', 'true')
    const buffered = document.createElement('div')
    buffered.className = 'mxp-progress-buffered'
    // The played fill is one continuous bar up to the playhead, exactly like the MXAnime-CMS
    // rail. Buffered stays segmented so real gaps are never bridged.
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
    // The lock affordance sits outside the control shell: locking hides the shell, and the
    // toggle has to survive that to let the viewer out again.
    const lock = this.#iconButton(document, 'lock', this.#labels.lockControls, 'unlock')
    lock.classList.add('mxp-lock-toggle')
    lock.hidden = true
    root.append(lock, controls)

    this.#elements = { controls, status, statusMessage, progress, progressWrap, progressTrack, played, buffered, thumb, preview, previewImage, previewTime, time, play, next, mute, volume, subtitles, pip, theater, settings, fullscreen, lock, toast }
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
    elements.subtitles.addEventListener('click', () => this.#toggleSubtitleMenu())
    elements.pip.addEventListener('click', () => { void this.#togglePip() })
    elements.theater.addEventListener('click', () => { void this.#toggleTheater() })
    elements.settings.addEventListener('click', () => this.#openOverlay('settings', elements.settings))
    elements.fullscreen.addEventListener('click', () => { void this.#toggleFullscreen() })
    elements.lock.addEventListener('click', (event) => { event.stopPropagation(); this.#setLocked(!this.#locked) })
    // Input modality, tracked rather than read from `:focus-visible`, whose heuristics differ
    // between engines. A pointer press ahead of the focus change means the focus is a click's
    // leftover; any key press hands the modality back to the keyboard.
    root.addEventListener('pointerdown', () => { this.#pointerFocus = true }, true)
    const keyModality = (): void => { this.#pointerFocus = false }
    root.ownerDocument.addEventListener('keydown', keyModality, true)
    this.#scope.add(() => root.ownerDocument.removeEventListener('keydown', keyModality, true))
    root.addEventListener('keydown', (event) => this.#handleShortcut(event))
    root.addEventListener('pointerenter', () => this.#setPointerActive(true))
    root.addEventListener('pointermove', () => this.#setPointerActive(true))
    root.addEventListener('pointerleave', () => this.#setPointerActive(false))
    root.addEventListener('focusin', (event) => {
      // Focus on the root itself is not an interaction, so it must not pin the chrome open —
      // unlocking and closing a menu both park focus there. It does reveal the chrome, so tabbing
      // into the player brings the controls back and the next Tab can reach them.
      if (event.target === root) { this.#showControls(); return }
      // Focus a pointer left behind on a control does not pin the chrome either: clicking play and
      // sitting still still collapses it, exactly as in the MXAnime-CMS player. Keyboard focus does
      // pin it, so a focus ring never lands on hidden chrome.
      if (!this.#pointerFocus) this.#setFocusActive(true)
    })
    root.addEventListener('focusout', (event) => { const next = event.relatedTarget; if (!(next instanceof Node) || !root.contains(next)) this.#setFocusActive(false) })
    // The playback surface is a sibling of this root, not a descendant, and the root's centre is
    // pointer-transparent. The menu therefore listens on the shared host so a right-click on the
    // video or canvas reaches it just like one on the control bar.
    const host = this.#host
    if (host) {
      const contextmenu = (event: MouseEvent): void => this.#handleContextMenu(event)
      const pointermove = (): void => this.#observeHostPointer()
      host.addEventListener('contextmenu', contextmenu)
      host.addEventListener('pointermove', pointermove)
      this.#scope.add(() => {
        host.removeEventListener('contextmenu', contextmenu)
        host.removeEventListener('pointermove', pointermove)
      })
    }
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
        this.#clearScrub()
        this.#closeSubtitleMenu(true, false)
        this.#closeOverlay(false)
        this.#closeMenu(false)
        this.#resetNetwork()
        this.#subtitleResume = null
        this.#pendingSubtitleSelection = null
        this.#lastSubtitleTrackId = this.#player.selectedSubtitleTrack
      }
      this.#snapshot = snapshot
      this.#confirmScrub(snapshot)
      this.#observeSubtitlePause(snapshot)
      this.#applyLoop(snapshot)
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
      this.#renderSubtitleMenuIfOpen()
    }))
    this.#scope.add(this.#player.on('subtitlestylechange', () => {
      if (epoch !== this.#epoch || this.#destroyed || this.#subtitleDrag.active) return
      this.#renderSubtitleMenuIfOpen()
      this.#syncSubtitleGuide()
    }))
    this.#scope.add(this.#player.on('subtitlestatechange', () => { if (epoch === this.#epoch && !this.#destroyed) this.#render() }))
    this.#scope.add(this.#player.on('error', ({ error }) => { if (epoch === this.#epoch && !this.#destroyed) this.#reportSdkError(error) }))
    const document = root.ownerDocument
    const outside = (event: PointerEvent): void => {
      if (!this.#root) return
      const target = event.target
      const element = target instanceof Element ? target : null
      const inside = target instanceof Node && this.#root.contains(target)
      if (inside) {
        // A pointer inside the chrome but outside the subtitle surface dismisses the popup, the
        // same way the MX-Player-Pro menu gives way to any other control. While the editor is up
        // the popup stays: the editor is a mode layered on it, and its bar and guide belong to it.
        if (this.#subtitleMenu.element && !this.#subtitleMenu.editing && !isSubtitleSurface(element)) {
          this.#closeSubtitleMenu(false)
        }
        return
      }
      if (this.#menu.element) this.#closeMenu(false)
      if (this.#overlay) this.#closeOverlay(true)
      if (this.#subtitleMenu.element || this.#subtitleMenu.editing) this.#closeSubtitleMenu(true)
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
    root.dataset.mxpPresentation = snapshot.presentationMode
    const duration = finiteTime(snapshot.duration)
    this.#renderProgress()
    renderRangeSegments(elements.buffered, snapshot.buffered, duration)
    elements.volume.value = String(clamp(snapshot.volume, 0, 1))
    const playing = !snapshot.paused && snapshot.state !== 'ended'
    const held = this.#playbackHeld()
    elements.play.dataset.mxpActive = playing ? 'true' : 'false'
    elements.play.setAttribute('aria-pressed', String(playing))
    elements.play.disabled = held
    this.#setButtonLabel(elements.play, held ? this.#labels.subtitleHold : playing ? this.#labels.pause : (snapshot.state === 'ended' ? this.#labels.replay : this.#labels.play))
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
    elements.theater.dataset.mxpActive = String(theaterActive)
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
    this.#renderLock()
    this.#renderStatus()
    this.#renderStats()
    this.#scheduleHide()
  }

  /**
   * The rail is the playhead, not a history of what has been watched: one continuous fill up to
   * the current position, or to the local drag position while a seek is still in flight. Reading
   * `played` ranges instead left the fill frozen at the first island after any seek.
   */
  #renderProgress(): void {
    const elements = this.#elements
    const root = this.#root
    if (!elements || !root) return
    const snapshot = this.#snapshot
    const duration = finiteTime(snapshot.duration)
    const committed = finiteTime(snapshot.currentTime) ?? 0
    const current = this.#scrub ?? committed
    const ratio = duration === null || duration <= 0 ? 0 : clamp(current / duration, 0, 1)
    root.style.setProperty('--mxp-progress-pct', `${ratio * 100}%`)
    elements.progress.value = String(Math.round(ratio * 1000))
    elements.progress.setAttribute('aria-valuetext', `${formatTime(current)} / ${formatTime(snapshot.duration, this.#labels.unknownDuration)}`)
    elements.time.textContent = `${formatTime(snapshot.currentTime)} / ${formatTime(snapshot.duration, this.#labels.unknownDuration)}`
  }

  #renderLock(): void {
    const elements = this.#elements
    const root = this.#root
    if (!elements || !root) return
    const available = this.#canLock()
    elements.lock.hidden = !available
    if (!available) {
      if (this.#locked) this.#setLocked(false)
      return
    }
    elements.lock.setAttribute('aria-pressed', String(this.#locked))
    this.#setButtonLabel(elements.lock, this.#locked ? this.#labels.unlockControls : this.#labels.lockControls)
    this.#setButtonIcon(elements.lock, this.#locked ? 'lock' : 'unlock')
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
    // The subtitle menu and its editor deliberately hold the picture still, so every route to
    // playback is inert while one of them is open; the locked chrome is inert altogether.
    if (this.#locked || this.#playbackHeld()) { this.#showControls(); return Promise.resolve() }
    if (this.#snapshot.state === 'ended') return this.#run(async () => { await this.#player.seek(0); await this.#player.play() })
    if (this.#snapshot.state === 'playing' && !this.#snapshot.paused) { this.#player.pause(); return Promise.resolve() }
    return this.#run(() => this.#player.play())
  }

  /* ------------------------------------------------------------------ control lock */

  /** The lock only exists where the chrome is the only way out: fullscreen and theater mode. */
  #canLock(): boolean {
    if (!this.#features.lockControls) return false
    if (this.#snapshot.presentationMode === 'fullscreen') return true
    return this.#options.theaterMode?.getState() ?? false
  }

  #playbackHeld(): boolean {
    return this.#subtitleMenu.element !== null || this.#subtitleMenu.editing
  }

  #setLocked(locked: boolean): void {
    if (this.#locked === locked) return
    if (locked && !this.#canLock()) return
    this.#locked = locked
    const root = this.#root
    if (locked) {
      this.#closeMenu(false)
      this.#closeOverlay(false)
      this.#closeSubtitleMenu(true)
      this.#closeStats()
      this.#cancelSeek()
      this.#hidePreview()
      this.#pointerActive = false
      this.#focusActive = false
      this.#lockChromeVisible = true
      if (root) {
        root.dataset.mxpLocked = 'true'
        root.dataset.mxpVisible = 'false'
      }
      this.#scheduleLockChromeHide()
    } else {
      this.#clearLockChromeTimer()
      this.#lockChromeVisible = true
      if (root) root.dataset.mxpLocked = 'false'
    }
    this.#syncLockChrome()
    this.#renderLock()
    if (!locked) {
      this.#showControls()
      root?.focus()
    }
  }

  #clearLockChromeTimer(): void {
    if (this.#lockChromeTimer !== null) clearTimeout(this.#lockChromeTimer)
    this.#lockChromeTimer = null
  }

  #scheduleLockChromeHide(): void {
    this.#clearLockChromeTimer()
    if (!this.#locked) return
    this.#lockChromeTimer = setTimeout(() => {
      this.#lockChromeTimer = null
      if (!this.#locked || this.#destroyed) return
      this.#lockChromeVisible = false
      this.#syncLockChrome()
    }, LOCK_CHROME_HIDE_MS)
  }

  #showLockChrome(): void {
    if (!this.#locked) return
    this.#lockChromeVisible = true
    this.#syncLockChrome()
    this.#scheduleLockChromeHide()
  }

  /**
   * Pointer movement anywhere over the host reveals the chrome, or revives the lock affordance
   * while locked. The listener sits on the host because the UI root is pointer-transparent in the
   * middle: moving across the video or canvas never reaches the root itself.
   */
  #observeHostPointer(): void {
    if (this.#locked) { this.#showLockChrome(); return }
    this.#showControls()
  }

  #syncLockChrome(): void {
    const root = this.#root
    if (root) root.dataset.mxpLockChrome = String(this.#lockChromeVisible)
    this.#syncCursor()
  }

  /**
   * The cursor lives on the host: the UI root is pointer-transparent in the middle, so a
   * `cursor` there would never win over the media surface underneath.
   */
  #syncCursor(): void {
    const host = this.#host
    if (!host) return
    const hiddenByLock = this.#locked && !this.#lockChromeVisible
    const hiddenByIdle = this.#snapshot.presentationMode === 'fullscreen' && this.#root?.dataset.mxpVisible === 'false'
    if (hiddenByLock || hiddenByIdle) host.dataset.mxpCursor = 'hidden'
    else delete host.dataset.mxpCursor
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

  #closeOverlay(restoreFocus: boolean): void {
    this.#overlayKeydownCleanup?.()
    this.#overlayKeydownCleanup = null
    if (!this.#overlay || !this.#root) { this.#overlay = null; return }
    this.#root.querySelector('.mxp-overlay-backdrop')?.remove()
    const trigger = this.#focusBeforeOverlay ?? this.#overlayTrigger
    this.#overlay = null
    this.#overlayTrigger = null
    this.#focusBeforeOverlay = null
    if (restoreFocus && trigger && trigger.isConnected) trigger.focus()
    const activeElement = this.#root.ownerDocument.activeElement
    this.#focusActive = activeElement !== null && this.#root.contains(activeElement)
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

  /**
   * The subtitle menu freezes the picture for as long as it is open: picking a track or a font is
   * a comparison task and a moving image makes it harder. The pause is menu-owned, so a pause the
   * viewer made before opening survives the close.
   */
  #pauseForSubtitles(): void {
    if (this.#subtitleResume !== null) return
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
    panel.replaceChildren()
    const header = panel.ownerDocument.createElement('div'); header.className = 'mxp-panel-header'
    const title = panel.ownerDocument.createElement('h2'); title.className = 'mxp-panel-title'
    title.textContent = name === 'settings' ? this.#labels.settings : name === 'about' ? this.#labels.about : this.#labels.troubleshoot
    const close = this.#iconButton(panel.ownerDocument, 'close', this.#labels.close, 'close')
    close.addEventListener('click', () => this.#closeOverlay(true))
    header.append(title, close); panel.append(header)
    const content = panel.ownerDocument.createElement('div'); content.className = 'mxp-panel-content'; panel.append(content)
    if (name === 'settings') this.#renderSettings(content)
    else if (name === 'about') this.#renderAbout(content)
    else this.#renderTroubleshoot(content)
  }

  #renderSettings(content: HTMLElement): void {
    const section = this.#section(content, this.#labels.playbackRate)
    const rate = content.ownerDocument.createElement('select')
    rate.setAttribute('aria-label', this.#labels.playbackRate)
    for (const value of [0.5, 0.75, 1, 1.25, 1.5, 2]) { const option = content.ownerDocument.createElement('option'); option.value = String(value); option.textContent = `${value}x`; option.selected = Math.abs(this.#snapshot.playbackRate - value) < 0.001; rate.append(option) }
    rate.addEventListener('change', () => { void this.#run(() => { this.#player.setPlaybackRate(Number(rate.value)) }) })
    section.append(rate)
    if (this.#features.subtitles) { const subtitle = content.ownerDocument.createElement('button'); subtitle.type = 'button'; subtitle.textContent = this.#labels.subtitles; subtitle.addEventListener('click', () => { this.#closeOverlay(true); this.#toggleSubtitleMenu() }); section.append(subtitle) }
    if (this.#features.statistics) { const stats = content.ownerDocument.createElement('button'); stats.type = 'button'; stats.textContent = this.#labels.statistics; stats.addEventListener('click', () => { this.#closeOverlay(true); this.#setStatsOpen(true) }); section.append(stats) }
    if (this.#features.troubleshoot) { const help = content.ownerDocument.createElement('button'); help.type = 'button'; help.textContent = this.#labels.troubleshoot; help.addEventListener('click', () => this.#openOverlay('troubleshoot', help)); section.append(help) }
    if (this.#features.about) { const about = content.ownerDocument.createElement('button'); about.type = 'button'; about.textContent = this.#labels.about; about.addEventListener('click', () => this.#openOverlay('about', about)); section.append(about) }
  }

  #renderTroubleshoot(content: HTMLElement): void {
    const doc = content.ownerDocument
    const report = buildTroubleshootReport(this.#statsInput(), this.#labels, this.#userAgent())
    const findings = this.#section(content, this.#labels.troubleshootFindings)
    if (report.findings.length === 0) {
      const healthy = doc.createElement('p'); healthy.className = 'mxp-caption'; healthy.textContent = this.#labels.troubleshootHealthy
      findings.append(healthy)
    } else {
      const list = doc.createElement('ul'); list.className = 'mxp-finding-list'
      for (const finding of report.findings) {
        const item = doc.createElement('li')
        const code = doc.createElement('code'); code.textContent = finding.code
        const message = doc.createElement('span'); message.textContent = finding.message
        item.append(code, message)
        list.append(item)
      }
      findings.append(list)
    }
    const environment = this.#section(content, this.#labels.troubleshootEnvironment)
    const grid = doc.createElement('div'); grid.className = 'mxp-stat-grid'
    for (const [key, value] of report.environment) {
      const label = doc.createElement('span'); label.textContent = key
      const strong = doc.createElement('strong'); strong.textContent = value
      grid.append(label, strong)
    }
    environment.append(grid)
    const copy = doc.createElement('button'); copy.type = 'button'; copy.textContent = this.#labels.troubleshootCopyReport
    copy.addEventListener('click', () => { void this.#copyText(this.#debugInfo()) })
    environment.append(copy)
  }

  #renderAbout(content: HTMLElement): void {
    const text = content.ownerDocument.createElement('p'); text.className = 'mxp-caption'; text.textContent = '@mx-player-max/ui Phase 9'; content.append(text)
    const scope = content.ownerDocument.createElement('p'); scope.className = 'mxp-caption'; scope.textContent = 'Native and Custom playback controls through the public SDK contract.'; content.append(scope)
  }

  /* ---------------------------------------------------------------- subtitle menu */

  /**
   * The subtitle menu is an anchored popup rather than a modal panel, matching MX-Player-Pro: a
   * head of pages plus an edit affordance, and a body whose height is fixed by the track list so
   * switching pages never resizes the surface under the pointer.
   */
  #toggleSubtitleMenu(): void {
    if (this.#locked) return
    if (this.#subtitleMenu.element || this.#subtitleMenu.editing) { this.#closeSubtitleMenu(true); return }
    this.#closeOverlay(false)
    this.#closeMenu(false)
    this.#pauseForSubtitles()
    this.#subtitleMenu.page = 'track'
    this.#openSubtitleMenu()
  }

  #openSubtitleMenu(): void {
    const root = this.#root
    if (!root) return
    const menu = root.ownerDocument.createElement('div')
    menu.className = 'mxp-subtitle-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', this.#labels.subtitles)
    root.append(menu)
    this.#subtitleMenu.element = menu
    root.dataset.mxpSubtitleMenu = 'open'
    this.#renderSubtitleMenu()
    this.#render()
    this.#showControls()
    const first = menu.querySelector<HTMLElement>('button:not(:disabled)')
    first?.focus()
  }

  #renderSubtitleMenuIfOpen(): void {
    if (this.#subtitleMenu.element) this.#renderSubtitleMenu()
    this.#updateSubtitleEditReadout()
  }

  #renderSubtitleMenu(): void {
    const menu = this.#subtitleMenu.element
    if (!menu) return
    const doc = menu.ownerDocument
    const page = this.#subtitleMenu.page
    menu.replaceChildren()
    const head = doc.createElement('div')
    head.className = 'mxp-subtitle-menu-head'
    for (const [id, label] of [['track', this.#labels.subtitles], ['font', this.#labels.subtitleFont], ['style', this.#labels.subtitleStyle]] as const) {
      const tab = doc.createElement('button')
      tab.type = 'button'
      tab.className = 'mxp-subtitle-tab'
      tab.dataset.mxpPage = id
      tab.dataset.mxpActive = String(page === id)
      tab.setAttribute('aria-pressed', String(page === id))
      tab.textContent = label
      tab.addEventListener('click', () => { this.#subtitleMenu.page = id; this.#renderSubtitleMenu() })
      head.append(tab)
    }
    const edit = this.#iconButton(doc, 'subtitle-edit', this.#labels.subtitleEdit, 'settings')
    edit.classList.add('mxp-subtitle-head-icon')
    edit.dataset.mxpActive = String(this.#subtitleMenu.editing)
    edit.addEventListener('click', () => this.#openSubtitleEditor())
    head.append(edit)
    const body = doc.createElement('div')
    body.className = 'mxp-subtitle-menu-body'
    // The `off` row is always present, hence the + 1; the last row carries no trailing gap.
    const rows = this.#player.subtitleTracks.length + 1
    body.style.setProperty('--mxp-subtitle-body-height', `${rows * SUBTITLE_ROW_HEIGHT + (rows - 1) * SUBTITLE_ROW_GAP}px`)
    menu.append(head, body)
    if (page === 'font') this.#renderSubtitleFontPage(body)
    else if (page === 'style') this.#renderSubtitleStylePage(body)
    else this.#renderSubtitleTrackPage(body)
  }

  #renderSubtitleTrackPage(body: HTMLElement): void {
    const doc = body.ownerDocument
    const tracks = this.#player.subtitleTracks
    const selected = this.#player.selectedSubtitleTrack
    const off = doc.createElement('button')
    off.type = 'button'
    off.className = 'mxp-subtitle-track'
    off.dataset.mxpSelected = String(selected === null)
    off.dataset.mxpPending = String(this.#pendingSubtitleSelection?.id === null && this.#pendingSubtitleSelection.sessionEpoch === this.#sessionEpoch)
    off.setAttribute('aria-pressed', String(selected === null))
    off.textContent = this.#labels.subtitleOff
    off.addEventListener('click', () => { void this.#selectSubtitleTrack(null) })
    body.append(off)
    if (tracks.length === 0) {
      const empty = doc.createElement('span')
      empty.className = 'mxp-caption'
      empty.textContent = this.#labels.noSubtitles
      body.append(empty)
    }
    for (const track of tracks) body.append(this.#trackButton(track))
  }

  #renderSubtitleFontPage(body: HTMLElement): void {
    const doc = body.ownerDocument
    const current = this.#player.subtitleStyle.fontFamily
    for (const font of SUBTITLE_FONTS) {
      const option = doc.createElement('button')
      option.type = 'button'
      option.className = 'mxp-subtitle-font'
      option.dataset.mxpFont = font.id
      const selected = current === font.stack
      option.dataset.mxpSelected = String(selected)
      option.setAttribute('aria-pressed', String(selected))
      const name = doc.createElement('span')
      name.className = 'mxp-subtitle-font-name'
      const text = doc.createElement('span')
      text.textContent = this.#labels[font.id]
      name.append(text)
      if (selected) name.append(createPlayerIcon(doc, 'check'))
      const sample = doc.createElement('span')
      sample.className = 'mxp-subtitle-font-sample'
      sample.style.fontFamily = font.stack
      sample.textContent = FONT_SAMPLE
      option.append(name, sample)
      option.addEventListener('click', () => this.#setSubtitleStyle({ fontFamily: font.stack }))
      body.append(option)
    }
  }

  /**
   * Colour, outline and emphasis stay reachable here: the engine accepts them and the project
   * scope requires them, so the Pro two-page menu gains one page instead of losing fields.
   */
  #renderSubtitleStylePage(body: HTMLElement): void {
    const doc = body.ownerDocument
    const style = this.#player.subtitleStyle
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
    const toggles = doc.createElement('div')
    toggles.className = 'mxp-subtitle-toggles'
    toggles.append(
      this.#toggleControl(doc, this.#labels.bold, style.bold ?? false, (checked) => this.#setSubtitleStyle({ bold: checked })),
      this.#toggleControl(doc, this.#labels.italic, style.italic ?? false, (checked) => this.#setSubtitleStyle({ italic: checked })),
      this.#toggleControl(doc, this.#labels.underline, style.underline ?? false, (checked) => this.#setSubtitleStyle({ underline: checked })),
    )
    const reset = doc.createElement('button')
    reset.type = 'button'
    reset.className = 'mxp-subtitle-reset'
    reset.append(createPlayerIcon(doc, 'reset'), doc.createTextNode(this.#labels.reset))
    reset.addEventListener('click', () => { try { this.#player.resetSubtitleStyle() } catch { this.#reportUiError() } })
    body.append(
      this.#styleRange(doc, this.#labels.fontSize, style.fontSize ?? 36, 6, 256, 1, (value) => this.#setSubtitleStyle({ fontSize: value })),
      this.#styleRange(doc, this.#labels.horizontalPosition, style.x ?? 50, 5, 95, 1, (value) => this.#setSubtitleStyle({ x: value })),
      this.#styleRange(doc, this.#labels.subtitlePosition, style.y ?? 86, 8, 92, 1, (value) => this.#setSubtitleStyle({ y: value })),
      this.#styleRange(doc, this.#labels.outlineWidth, style.outlineWidth ?? 2, 0, 16, 0.5, (value) => this.#setSubtitleStyle({ outlineWidth: value })),
      this.#colorControl(doc, this.#labels.subtitleColor, style.color, '#ffffff', (value) => this.#setSubtitleStyle({ color: value })),
      this.#colorControl(doc, this.#labels.outlineColor, style.outlineColor, '#000000', (value) => this.#setSubtitleStyle({ outlineColor: value })),
      this.#labeledControl(doc, this.#labels.alignment, alignment),
      toggles,
      reset,
    )
  }

  /**
   * Closing the menu resumes the picture unless the editor is still up: the editor is a mode
   * layered on the menu and owns the same hold.
   */
  #closeSubtitleMenu(closeEditor = false, resumePlayback = true): void {
    const menu = this.#subtitleMenu.element
    const editing = this.#subtitleMenu.editing
    if (!menu && !editing) return
    const root = this.#root
    const active = root?.ownerDocument.activeElement ?? null
    const hadFocus = active !== null && menu !== null && menu.contains(active)
    menu?.remove()
    this.#subtitleMenu.element = null
    if (root) root.dataset.mxpSubtitleMenu = 'closed'
    if (closeEditor) this.#closeSubtitleEditor(false)
    // The hold belongs to the pair, so it is released only once neither surface is left.
    if (!this.#subtitleMenu.editing) this.#releaseSubtitleHold(resumePlayback)
    if (hadFocus && !this.#destroyed) this.#elements?.subtitles.focus()
    if (!this.#destroyed) {
      this.#render()
      this.#scheduleHide()
    }
  }

  /**
   * The editor keeps the menu open: the font list stays one click away while size and position
   * are dragged directly on the guide.
   */
  #openSubtitleEditor(): void {
    const root = this.#root
    if (!root || this.#subtitleMenu.editing) return
    this.#pauseForSubtitles()
    this.#subtitleMenu.editing = true
    this.#addSubtitleGuide()
    this.#addSubtitleEditBar()
    this.#render()
    this.#showControls()
  }

  #closeSubtitleEditor(releaseHold = true): void {
    if (!this.#subtitleMenu.editing) return
    this.#subtitleMenu.editing = false
    this.#cancelSubtitleDrag()
    const active = this.#root?.ownerDocument.activeElement ?? null
    const hadFocus = active !== null && (this.#subtitleMenu.guide?.contains(active) === true || this.#subtitleMenu.bar?.contains(active) === true)
    this.#subtitleMenu.guide?.remove()
    this.#subtitleMenu.guide = null
    this.#subtitleMenu.bar?.remove()
    this.#subtitleMenu.bar = null
    if (releaseHold && this.#subtitleMenu.element === null) this.#releaseSubtitleHold(true)
    // Focus has to leave the removed bar deliberately, otherwise it falls back to the document
    // and the player keyboard shortcuts stop responding.
    if (hadFocus && !this.#destroyed) {
      const fallback = this.#subtitleMenu.element?.querySelector<HTMLElement>('button:not(:disabled)') ?? this.#elements?.subtitles ?? this.#root
      fallback?.focus()
    }
    if (!this.#destroyed) this.#render()
  }

  #releaseSubtitleHold(resume: boolean): void {
    if (resume) this.#resumeAfterSubtitles()
    else this.#subtitleResume = null
  }

  #addSubtitleEditBar(): void {
    const root = this.#root
    if (!root) return
    this.#subtitleMenu.bar?.remove()
    const bar = root.ownerDocument.createElement('div')
    bar.className = 'mxp-subtitle-edit-bar'
    bar.setAttribute('role', 'group')
    bar.setAttribute('aria-label', this.#labels.subtitleEdit)
    root.append(bar)
    this.#subtitleMenu.bar = bar
    this.#renderSubtitleEditBar()
  }

  #renderSubtitleEditBar(): void {
    const bar = this.#subtitleMenu.bar
    if (!bar) return
    const doc = bar.ownerDocument
    bar.replaceChildren()
    const hint = doc.createElement('span')
    hint.className = 'mxp-subtitle-edit-hint'
    hint.textContent = this.#labels.subtitleEditHint
    const readout = doc.createElement('em')
    readout.className = 'mxp-subtitle-edit-readout'
    const reset = doc.createElement('button')
    reset.type = 'button'
    reset.append(createPlayerIcon(doc, 'reset'), doc.createTextNode(this.#labels.reset))
    reset.addEventListener('click', () => { try { this.#player.resetSubtitleStyle() } catch { this.#reportUiError() } })
    const done = doc.createElement('button')
    done.type = 'button'
    done.dataset.mxpAction = 'subtitle-edit-done'
    done.append(createPlayerIcon(doc, 'check'), doc.createTextNode(this.#labels.done))
    done.addEventListener('click', () => this.#closeSubtitleEditor())
    bar.append(hint, readout, reset, done)
    this.#updateSubtitleEditReadout()
  }

  /** Only the numbers move while dragging, so the buttons keep their identity and their focus. */
  #updateSubtitleEditReadout(): void {
    const readout = this.#subtitleMenu.bar?.querySelector<HTMLElement>('.mxp-subtitle-edit-readout')
    if (!readout) return
    const style = this.#player.subtitleStyle
    readout.textContent = `${Math.round(clamp(style.fontSize ?? 36, 6, 256))} px · ${Math.round(clamp(style.x ?? 50, 5, 95))}% / ${Math.round(clamp(style.y ?? 86, 8, 92))}%`
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
    this.#renderSubtitleMenuIfOpen()
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
        // Picking a track dismisses the menu, unless the editor is layered on top of it.
        if (this.#subtitleMenu.element && !this.#subtitleMenu.editing) this.#closeSubtitleMenu(true)
        else this.#renderSubtitleMenuIfOpen()
      }
    }
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

  /**
   * The guide stands in for the live cue while editing: it carries the current style so size,
   * position, colour and emphasis are judged in place, and it is the drag surface.
   */
  #addSubtitleGuide(): void {
    const root = this.#root
    if (!root) return
    this.#subtitleMenu.guide?.remove()
    const doc = root.ownerDocument
    const guide = doc.createElement('div')
    guide.className = 'mxp-subtitle-editor-guide'
    guide.dataset.mxpGuide = 'true'
    guide.title = this.#labels.subtitleEditHint
    const sample = doc.createElement('span')
    sample.className = 'mxp-subtitle-sample'
    sample.textContent = this.#labels.subtitleSample
    guide.append(sample)
    guide.addEventListener('pointerdown', (event) => { if (event.target !== guide && event.target !== sample) return; this.#beginSubtitleDrag(event, 'center') })
    for (const edge of ['top', 'bottom'] as const) {
      const handle = doc.createElement('span')
      handle.className = 'mxp-subtitle-handle'
      handle.dataset.mxpEdge = edge
      handle.title = this.#labels.fontSize
      handle.addEventListener('pointerdown', (event) => this.#beginSubtitleDrag(event, edge))
      guide.append(handle)
    }
    root.append(guide)
    this.#subtitleMenu.guide = guide
    this.#syncSubtitleGuide()
  }

  #section(parent: HTMLElement, titleText: string): HTMLElement {
    const section = parent.ownerDocument.createElement('div'); section.className = 'mxp-panel-section'; const label = parent.ownerDocument.createElement('span'); label.className = 'mxp-panel-label'; label.textContent = titleText; section.append(label); parent.append(section); return section
  }

  #setSubtitleStyle(patch: SubtitleCueStyle): void {
    try { this.#player.setSubtitleStyle({ ...this.#player.subtitleStyle, ...patch }) } catch { this.#reportUiError() }
  }

  #syncSubtitleGuide(): void {
    const guide = this.#subtitleMenu.guide
    if (!guide) return
    const style = this.#player.subtitleStyle
    guide.style.setProperty('--mxp-subtitle-x', `${clamp(style.x ?? 50, 5, 95)}%`)
    guide.style.setProperty('--mxp-subtitle-y', `${clamp(style.y ?? 86, 8, 92)}%`)
    guide.style.setProperty('--mxp-subtitle-size', `${clamp(style.fontSize ?? 36, 6, 256)}px`)
    guide.style.setProperty('--mxp-subtitle-family', style.fontFamily ?? 'inherit')
    guide.style.setProperty('--mxp-subtitle-color', style.color ?? '#ffffff')
    guide.style.setProperty('--mxp-subtitle-outline', style.outlineColor ?? '#000000')
    guide.style.setProperty('--mxp-subtitle-outline-width', `${clamp(style.outlineWidth ?? 2, 0, 16)}px`)
    guide.style.setProperty('--mxp-subtitle-weight', style.bold === true ? '800' : '650')
    guide.style.setProperty('--mxp-subtitle-style', style.italic === true ? 'italic' : 'normal')
    guide.style.setProperty('--mxp-subtitle-decoration', style.underline === true ? 'underline' : 'none')
  }

  /**
   * Vertical-only move and proportional resize, matching MX-Player-Pro. The line stays centred
   * horizontally, so a drag only rewrites `y`; a handle drag multiplies the font size by how much
   * further the pointer is from the box centre than where it grabbed, which is what makes both
   * edges behave symmetrically instead of one shrinking while the other grows.
   */
  #beginSubtitleDrag(event: PointerEvent, mode: 'center' | 'top' | 'bottom'): void {
    const captureTarget = event.currentTarget as HTMLElement
    const guide = mode === 'center' ? captureTarget : captureTarget.parentElement
    const root = this.#root
    if (!guide || !root) return
    event.preventDefault()
    event.stopPropagation()
    const style = this.#player.subtitleStyle
    const initialY = clamp(style.y ?? 86, 8, 92)
    const initialSize = clamp(style.fontSize ?? 36, 6, 256)
    const startY = event.clientY
    // Resize is measured against the guide's centre, so a handle grabbed exactly on it would
    // divide by zero on the first move.
    const box = guide.getBoundingClientRect()
    const centreY = box.top + (box.height / 2)
    const startDistance = Math.abs(event.clientY - centreY)
    if (mode !== 'center' && startDistance < 1) return
    this.#cancelSubtitleDrag()
    const pointerId = event.pointerId
    const epoch = this.#epoch
    const sessionEpoch = this.#sessionEpoch
    this.#subtitleDrag.active = true
    this.#showControls()
    captureTarget.setPointerCapture?.(pointerId)

    const move = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId || epoch !== this.#epoch || sessionEpoch !== this.#sessionEpoch || this.#destroyed) return
      if (mode === 'center') {
        const rect = root.getBoundingClientRect()
        if (rect.height <= 0) return
        const y = clamp(initialY + ((moveEvent.clientY - startY) / rect.height) * 100, 8, 92)
        guide.style.setProperty('--mxp-subtitle-y', `${y}%`)
        this.#queueSubtitleStyle({ y }, false)
        return
      }
      const fontSize = Math.round(clamp(initialSize * (Math.abs(moveEvent.clientY - centreY) / startDistance), 6, 256))
      guide.style.setProperty('--mxp-subtitle-size', `${fontSize}px`)
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
    this.#updateSubtitleEditReadout()
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
    if (this.#locked || this.#snapshot.duration === null || !this.#snapshot.capabilities.seek) return
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
      // A drag that ends off the rail leaves no pointerleave behind, so the thumbnail would stay.
      if (!withinRect(target.getBoundingClientRect(), up.clientX, up.clientY)) this.#hidePreview()
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
    // The rail follows the pointer straight away; the snapshot confirms or retires it later.
    this.#setScrub(this.#seek.pending)
    if (flush) { this.#flushSeek(); return }
    if (this.#seek.timer !== null) return
    this.#seek.timer = setTimeout(() => { this.#seek.timer = null; this.#flushSeek() }, INTERACTION_THROTTLE_MS)
  }

  #flushSeek(): void {
    if (this.#seek.pending === null) return
    const time = this.#seek.pending; this.#seek.pending = null; const epoch = this.#epoch
    void this.#run(async () => { if (epoch === this.#epoch) await this.#player.seek(time) })
  }

  #cancelSeek(): void { if (this.#seek.timer !== null) clearTimeout(this.#seek.timer); this.#seek.timer = null; this.#seek.cleanup?.(); this.#seek.cleanup = null; this.#seek.pending = null; this.#seek.active = false; this.#seek.pointerId = null; this.#clearScrub() }

  #setScrub(time: number): void {
    this.#scrub = time
    if (this.#scrubTimer !== null) clearTimeout(this.#scrubTimer)
    this.#scrubTimer = setTimeout(() => {
      this.#scrubTimer = null
      // A seek that is never confirmed must not strand the rail away from the real position.
      this.#scrub = null
      if (!this.#destroyed) this.#renderProgress()
    }, SCRUB_EXPIRY_MS)
    this.#renderProgress()
  }

  #clearScrub(): void {
    if (this.#scrubTimer !== null) clearTimeout(this.#scrubTimer)
    this.#scrubTimer = null
    if (this.#scrub === null) return
    this.#scrub = null
    if (!this.#destroyed && this.#root) this.#renderProgress()
  }

  #confirmScrub(snapshot: PlaybackSnapshot): void {
    if (this.#scrub === null || this.#seek.active || this.#seek.pending !== null) return
    const current = finiteTime(snapshot.currentTime)
    if (current === null) { this.#clearScrub(); return }
    if (Math.abs(current - this.#scrub) <= SCRUB_CONFIRM_WINDOW) this.#clearScrub()
  }

  #handleSeekKey(event: KeyboardEvent): void {
    if (this.#snapshot.duration === null) return
    if (event.key === 'Home') { event.preventDefault(); this.#queueSeek(0, true) }
    else if (event.key === 'End') { event.preventDefault(); this.#queueSeek(this.#snapshot.duration, true) }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); const direction = event.key === 'ArrowLeft' || event.key === 'PageDown' ? -1 : 1; this.#queueSeek((this.#snapshot.currentTime ?? 0) + direction * (event.key.startsWith('Page') ? 30_000_000 : SEEK_STEP), true) }
  }

  #previewAtPointer(event: PointerEvent): void {
    if (this.#locked || event.pointerType === 'touch' || !this.#features.preview || !this.#snapshot.capabilities.preview || this.#snapshot.duration === null) return
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

  /* ---------------------------------------------------------------- context menu */

  #handleContextMenu(event: MouseEvent): void {
    // A locked chrome hands the native menu back rather than opening a menu the viewer cannot use.
    if (!this.#features.contextMenu || this.#locked) return
    event.preventDefault()
    event.stopPropagation()
    // Right-clicking again moves the menu to the new position instead of leaving a stale copy.
    this.#openMenu(event.clientX, event.clientY)
  }

  /** Groups are rendered in order and separated by a rule; empty groups collapse away. */
  #menuItems(): readonly MenuItemSpec[] {
    const playback: MenuItemSpec[] = []
    if (this.#features.loop) playback.push({ id: 'loop', label: this.#labels.loop, icon: 'loop', checkable: true, checked: this.#loop, run: () => this.#toggleLoop() })
    if (this.#features.miniPlayer) playback.push({ id: 'mini', label: this.#mini ? this.#labels.exitMiniPlayer : this.#labels.miniPlayer, icon: 'mini', run: () => this.#toggleMiniPlayer() })
    const share: MenuItemSpec[] = []
    if (this.#features.share) {
      share.push({ id: 'copy-url', label: this.#labels.copyVideoUrl, icon: 'copyUrl', run: () => { void this.#copyText(resolveVideoUrl(this.#share, this.#pageUrl())) } })
      share.push({ id: 'copy-url-at-time', label: this.#labels.copyVideoUrlAtTime, icon: 'copyUrlAtTime', run: () => { void this.#copyText(resolveVideoUrlAtTime(this.#share, this.#pageUrl(), this.#snapshot.currentTime)) } })
      share.push({ id: 'copy-embed', label: this.#labels.copyEmbedCode, icon: 'copyEmbed', run: () => { void this.#copyText(buildEmbedCode(this.#share, this.#pageUrl())) } })
    }
    const debug: MenuItemSpec[] = []
    if (this.#features.troubleshoot) {
      debug.push({ id: 'copy-debug', label: this.#labels.copyDebugInfo, icon: 'copyDebug', run: () => { void this.#copyText(this.#debugInfo()) } })
      debug.push({ id: 'troubleshoot', label: this.#labels.troubleshoot, icon: 'troubleshoot', run: () => this.#openTroubleshoot() })
    }
    if (this.#features.statistics) debug.push({ id: 'stats', label: this.#labels.statistics, icon: 'statistics', run: () => this.#setStatsOpen(!this.#statsOpen()) })
    const items: MenuItemSpec[] = []
    for (const group of [playback, share, debug]) {
      const [first, ...rest] = group
      if (!first) continue
      items.push(items.length === 0 ? first : { ...first, separatorBefore: true })
      items.push(...rest)
    }
    return items
  }

  #openMenu(clientX: number, clientY: number): void {
    const root = this.#root
    if (!root) return
    this.#closeMenu(false)
    const items = this.#menuItems()
    if (items.length === 0) return
    const doc = root.ownerDocument
    const menu = doc.createElement('div')
    menu.className = 'mxp-context-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', this.#labels.contextMenu)
    menu.tabIndex = -1
    for (const item of items) {
      if (item.separatorBefore === true) {
        const separator = doc.createElement('div')
        separator.className = 'mxp-menu-separator'
        separator.setAttribute('role', 'separator')
        menu.append(separator)
      }
      menu.append(this.#menuButton(doc, item))
    }
    root.append(menu)
    this.#menu.element = menu
    this.#positionMenu(menu, clientX, clientY)
    this.#connectMenuKeyboard(doc)
    this.#showControls()
    const first = this.#menuButtons()[0]
    if (first) first.focus()
    else menu.focus()
  }

  #menuButton(doc: Document, item: MenuItemSpec): HTMLButtonElement {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'mxp-menu-item'
    button.dataset.mxpMenuItem = item.id
    button.setAttribute('role', item.checkable === true ? 'menuitemcheckbox' : 'menuitem')
    if (item.checkable === true) button.setAttribute('aria-checked', String(item.checked === true))
    const check = doc.createElement('span')
    check.className = 'mxp-menu-check'
    check.setAttribute('aria-hidden', 'true')
    if (item.checkable === true && item.checked === true) check.append(createPlayerIcon(doc, 'check'))
    const glyph = doc.createElement('span')
    glyph.className = 'mxp-menu-icon'
    glyph.setAttribute('aria-hidden', 'true')
    glyph.append(createPlayerIcon(doc, item.icon))
    const label = doc.createElement('span')
    label.className = 'mxp-menu-label'
    label.textContent = item.label
    button.append(check, glyph, label)
    // A checkable entry keeps the menu open so the new state is visible; the rest dismiss it.
    button.addEventListener('click', () => {
      item.run()
      if (item.checkable === true) this.#syncMenuChecks()
      else this.#closeMenu(true)
    })
    return button
  }

  #syncMenuChecks(): void {
    const menu = this.#menu.element
    const button = menu?.querySelector<HTMLButtonElement>('[data-mxp-menu-item="loop"]')
    if (!button) return
    button.setAttribute('aria-checked', String(this.#loop))
    const check = button.querySelector<HTMLElement>('.mxp-menu-check')
    if (check) check.replaceChildren(...(this.#loop ? [createPlayerIcon(button.ownerDocument, 'check')] : []))
  }

  #positionMenu(menu: HTMLElement, clientX: number, clientY: number): void {
    const root = this.#root
    if (!root) return
    const rootRect = root.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const maxLeft = Math.max(MENU_EDGE_INSET, rootRect.width - menuRect.width - MENU_EDGE_INSET)
    const maxTop = Math.max(MENU_EDGE_INSET, rootRect.height - menuRect.height - MENU_EDGE_INSET)
    menu.style.setProperty('--mxp-menu-left', `${clamp(clientX - rootRect.left, MENU_EDGE_INSET, maxLeft)}px`)
    menu.style.setProperty('--mxp-menu-top', `${clamp(clientY - rootRect.top, MENU_EDGE_INSET, maxTop)}px`)
  }

  #menuButtons(): HTMLButtonElement[] {
    const menu = this.#menu.element
    return menu === null ? [] : [...menu.querySelectorAll<HTMLButtonElement>('.mxp-menu-item:not(:disabled)')]
  }

  #connectMenuKeyboard(doc: Document): void {
    this.#menu.keydown?.()
    const keydown = (event: KeyboardEvent): void => {
      if (!this.#menu.element) return
      if (event.key === 'Escape') { event.preventDefault(); this.#closeMenu(true); return }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End' && event.key !== 'Tab') return
      event.preventDefault()
      this.#moveMenuFocus(event.key, event.shiftKey)
    }
    doc.addEventListener('keydown', keydown)
    this.#menu.keydown = (): void => doc.removeEventListener('keydown', keydown)
  }

  #moveMenuFocus(key: string, shift: boolean): void {
    const buttons = this.#menuButtons()
    if (buttons.length === 0) return
    const active = this.#menu.element?.ownerDocument.activeElement ?? null
    const index = buttons.findIndex((button) => button === active)
    const step = key === 'ArrowUp' || (key === 'Tab' && shift) ? -1 : 1
    const next = key === 'Home'
      ? 0
      : key === 'End'
        ? buttons.length - 1
        : index < 0
          ? (step > 0 ? 0 : buttons.length - 1)
          : (index + step + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  #closeMenu(restoreFocus: boolean): void {
    this.#menu.keydown?.()
    this.#menu.keydown = null
    const menu = this.#menu.element
    this.#menu.element = null
    if (!menu) return
    const root = this.#root
    const active = root?.ownerDocument.activeElement ?? null
    const hadFocus = active !== null && menu.contains(active)
    menu.remove()
    if (restoreFocus && hadFocus && root) root.focus()
    this.#scheduleHide()
  }

  /* ------------------------------------------------------- loop and mini player */

  #toggleLoop(): void {
    this.#loop = !this.#loop
    if (this.#root) this.#root.dataset.mxpLoop = String(this.#loop)
    if (this.#loop) this.#applyLoop(this.#snapshot)
  }

  /**
   * Repeat is driven from the public SDK contract rather than a media element attribute, so it
   * behaves identically on the native and custom pipelines. The guard keeps the burst of `ended`
   * snapshots that arrive before the seek lands from queueing several restarts.
   */
  #applyLoop(snapshot: PlaybackSnapshot): void {
    if (!this.#loop || snapshot.state !== 'ended' || this.#loopRestarting) return
    this.#loopRestarting = true
    const sessionEpoch = this.#sessionEpoch
    void this.#run(async () => {
      if (sessionEpoch !== this.#sessionEpoch) return
      await this.#player.seek(0)
      await this.#player.play()
    }).then(() => { this.#loopRestarting = false })
  }

  #toggleMiniPlayer(): void { this.#setMiniPlayer(!this.#mini) }

  /**
   * The miniplayer is an in-page docked surface, not a separate window: it only flips a data
   * attribute on the host and the UI root, which the stylesheet turns into a floating frame.
   */
  #setMiniPlayer(active: boolean): void {
    if (this.#mini === active) return
    this.#mini = active
    if (this.#host) {
      if (active) this.#host.dataset.mxpMini = 'true'
      else delete this.#host.dataset.mxpMini
    }
    if (this.#root) this.#root.dataset.mxpMini = String(active)
    this.#showControls()
  }

  /* ------------------------------------------------------------------- clipboard */

  async #copyText(value: string): Promise<void> {
    const clipboard = this.#view()?.navigator?.clipboard
    if (!clipboard || typeof clipboard.writeText !== 'function') { this.#showToast(this.#labels.copyFailed, 'error'); return }
    try {
      await clipboard.writeText(value)
      this.#showToast(this.#labels.copied, 'normal')
    } catch {
      this.#showToast(this.#labels.copyFailed, 'error')
      this.#reportUiError()
    }
  }

  #showToast(text: string, tone: 'normal' | 'error'): void {
    const toast = this.#elements?.toast
    if (!toast) return
    toast.textContent = text
    toast.dataset.mxpTone = tone
    toast.hidden = false
    if (this.#toastTimer !== null) clearTimeout(this.#toastTimer)
    this.#toastTimer = setTimeout(() => {
      this.#toastTimer = null
      const current = this.#elements?.toast
      if (current) { current.hidden = true; current.textContent = '' }
    }, TOAST_DURATION_MS)
  }

  /* -------------------------------------------------------------- stats for nerds */

  #statsOpen(): boolean { return this.#stats.element !== null }

  #setStatsOpen(open: boolean): void {
    if (open === this.#statsOpen()) return
    if (!open) { this.#closeStats(); return }
    const root = this.#root
    if (!root) return
    const doc = root.ownerDocument
    const panel = doc.createElement('section')
    panel.className = 'mxp-stats-overlay'
    panel.dataset.mxpStats = 'true'
    panel.setAttribute('aria-label', this.#labels.statistics)
    const close = doc.createElement('button')
    close.type = 'button'
    close.className = 'mxp-stats-close'
    close.textContent = '[X]'
    close.setAttribute('aria-label', this.#labels.close)
    close.addEventListener('click', () => this.#closeStats())
    const body = doc.createElement('div')
    body.className = 'mxp-stats-body'
    panel.append(close, body)
    root.append(panel)
    this.#stats.element = panel
    this.#stats.body = body
    this.#sampleNetwork()
    this.#renderStats()
    this.#stats.timer = setInterval(() => this.#tickStats(), STATS_INTERVAL_MS)
  }

  #closeStats(): void {
    if (this.#stats.timer !== null) clearInterval(this.#stats.timer)
    this.#stats.timer = null
    this.#stats.element?.remove()
    this.#stats.element = null
    this.#stats.body = null
  }

  #tickStats(): void {
    if (this.#destroyed || !this.#root) { this.#closeStats(); return }
    this.#sampleNetwork()
    this.#renderStats()
  }

  #renderStats(): void {
    const body = this.#stats.body
    if (!body) return
    const doc = body.ownerDocument
    body.replaceChildren(...buildStatsRows(this.#statsInput()).map((row) => this.#statsRow(doc, row)))
  }

  #statsRow(doc: Document, row: StatsRow): HTMLElement {
    const line = doc.createElement('div')
    line.className = 'mxp-stats-row'
    line.dataset.mxpStatsRow = row.key
    if (row.tone === 'warn') line.dataset.mxpTone = 'warn'
    const label = doc.createElement('span')
    label.className = 'mxp-stats-label'
    label.textContent = row.label
    const value = doc.createElement('span')
    value.className = 'mxp-stats-value'
    if (row.kind === 'meter') {
      const meter = doc.createElement('span')
      meter.className = 'mxp-stats-meter'
      const fill = doc.createElement('span')
      fill.className = 'mxp-stats-meter-fill'
      fill.style.setProperty('--mxp-stats-fill', `${(row.ratio ?? 0) * 100}%`)
      meter.append(fill)
      value.append(meter, this.#statsNumber(doc, row.value))
    } else if (row.kind === 'graph') {
      const graph = doc.createElement('span')
      graph.className = 'mxp-stats-graph'
      for (const sample of row.samples ?? []) {
        const bar = doc.createElement('span')
        bar.className = 'mxp-stats-bar'
        bar.style.setProperty('--mxp-stats-bar', `${Math.max(2, sample * 100)}%`)
        graph.append(bar)
      }
      value.append(graph, this.#statsNumber(doc, row.value))
    } else {
      value.textContent = row.value
    }
    line.append(label, value)
    return line
  }

  #statsNumber(doc: Document, text: string): HTMLElement {
    const element = doc.createElement('span')
    element.className = 'mxp-stats-number'
    element.textContent = text
    return element
  }

  #statsInput(): StatsInput {
    this.#ensureCpn()
    const root = this.#root
    const view = this.#view()
    return {
      labels: this.#labels,
      locale: this.#locale,
      snapshot: this.#snapshot,
      media: this.#telemetry(() => this.#player.media),
      selection: this.#telemetry(() => this.#player.selection),
      nativeStats: this.#telemetry(() => this.#player.nativeStats),
      customVideoStats: this.#telemetry(() => this.#player.customVideoStats),
      customAudioStats: this.#telemetry(() => this.#player.customAudioStats),
      audioClock: this.#telemetry(() => this.#player.audioClock),
      rendererKind: this.#telemetry(() => this.#player.rendererKind),
      rendererStats: this.#telemetry(() => this.#player.rendererStats),
      viewport: { width: root?.clientWidth ?? 0, height: root?.clientHeight ?? 0, devicePixelRatio: view?.devicePixelRatio ?? 1 },
      videoId: shortMediaId(this.#mediaSeed()),
      cpn: this.#stats.cpn,
      connectionKbps: this.#connectionKbps(),
      networkSamples: [...this.#network.samples],
      networkBytes: this.#network.totalBytes,
      now: Date.now(),
    }
  }

  /** Optional telemetry getters may be absent on a reduced player object. */
  #telemetry<T>(read: () => T | null | undefined): T | null {
    try { return read() ?? null } catch { return null }
  }

  #view(): (Window & typeof globalThis) | null {
    return this.#root?.ownerDocument.defaultView ?? this.#host?.ownerDocument.defaultView ?? null
  }

  #pageUrl(): string {
    const configured = this.#share?.pageUrl
    if (typeof configured === 'string' && configured.length > 0) return configured
    return this.#view()?.location?.href ?? ''
  }

  #userAgent(): string {
    return this.#view()?.navigator?.userAgent ?? 'unknown'
  }

  #debugInfo(): string {
    return buildDebugInfo(this.#statsInput(), this.#userAgent(), this.#pageUrl())
  }

  #openTroubleshoot(): void {
    const root = this.#root
    if (!root) return
    this.#openOverlay('troubleshoot', this.#elements?.settings ?? root)
  }

  #ensureCpn(): void {
    if (this.#stats.sessionEpoch === this.#sessionEpoch && this.#stats.cpn.length > 0) return
    this.#stats.sessionEpoch = this.#sessionEpoch
    this.#stats.cpn = createCpn(() => this.#random())
  }

  #random(): number {
    const crypto = this.#view()?.crypto
    if (crypto && typeof crypto.getRandomValues === 'function') {
      const buffer = new Uint32Array(1)
      crypto.getRandomValues(buffer)
      return (buffer[0] ?? 0) / 0x1_0000_0000
    }
    return Math.random()
  }

  /** A stable identity for the loaded media, preferring the address the host configured. */
  #mediaSeed(): string {
    const configured = this.#share?.videoUrl ?? this.#share?.pageUrl
    if (typeof configured === 'string' && configured.length > 0) return configured
    const media = this.#telemetry(() => this.#player.media)
    if (media) return `${media.container}|${media.mimeType ?? ''}|${media.size ?? 0}|${media.duration ?? 0}`
    return this.#pageUrl()
  }

  #estimatedBitrate(): number {
    const media = this.#telemetry(() => this.#player.media)
    if (!media) return 0
    let declared = 0
    for (const track of media.tracks) {
      const bitrate = track.bitrate
      if (typeof bitrate === 'number' && Number.isFinite(bitrate) && bitrate > 0) declared += bitrate
    }
    if (declared > 0) return declared
    const duration = media.duration
    if (media.size !== null && duration !== null && duration > 0) return (media.size * 8) / (duration / 1_000_000)
    return 0
  }

  /**
   * The public SDK contract exposes no byte counters, so download volume is derived: how far the
   * buffered horizon advanced since the previous sample, multiplied by the declared bitrate.
   */
  #sampleNetwork(): void {
    const ranges = this.#snapshot.buffered
    const last = ranges[ranges.length - 1]
    const end = last ? last.end : (this.#snapshot.currentTime ?? 0) + this.#snapshot.bufferedAhead
    const previous = this.#network.lastBufferedEnd
    this.#network.lastBufferedEnd = end
    const bitrate = this.#estimatedBitrate()
    const advanced = previous === null ? 0 : Math.max(0, end - previous)
    const bytes = bitrate > 0 ? (advanced / 1_000_000) * (bitrate / 8) : 0
    this.#network.samples.push(bytes)
    while (this.#network.samples.length > NETWORK_SAMPLE_COUNT) this.#network.samples.shift()
    this.#network.totalBytes += bytes
  }

  #resetNetwork(): void {
    this.#network = { samples: [], totalBytes: 0, lastBufferedEnd: null }
  }

  #connectionKbps(): number | null {
    const peak = this.#network.samples.reduce((largest, value) => value > largest ? value : largest, 0)
    if (peak > 0) return (peak * 8) / (STATS_INTERVAL_MS / 1000) / 1000
    const navigatorWithConnection = this.#view()?.navigator as (Navigator & { connection?: { downlink?: number } }) | undefined
    const downlink = navigatorWithConnection?.connection?.downlink
    return typeof downlink === 'number' && Number.isFinite(downlink) && downlink > 0 ? downlink * 1000 : null
  }

  #handleShortcut(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.#locked) { event.preventDefault(); this.#setLocked(false); return }
    if (this.#locked) return
    if (event.key === 'Escape' && this.#menu.element) { event.preventDefault(); this.#closeMenu(true); return }
    if (event.key === 'Escape' && (this.#subtitleMenu.element || this.#subtitleMenu.editing)) { event.preventDefault(); this.#closeSubtitleMenu(true); return }
    if (event.key === 'Escape' && this.#overlay) { event.preventDefault(); this.#closeOverlay(true); return }
    if (event.key === 'Escape' && this.#mini) { event.preventDefault(); this.#setMiniPlayer(false); return }
    if (this.#menu.element) return
    if (event.key === 'Tab' && this.#overlay) { this.#trapOverlayFocus(event); return }
    if (this.#overlay) return
    if (isTextInput(event.target)) return
    // Any handled key brings the chrome back, so a shortcut never acts on hidden controls.
    this.#showControls()
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

  #setPointerActive(active: boolean): void {
    if (this.#locked) { if (active) this.#showLockChrome(); return }
    this.#pointerActive = active
    if (active) { this.#showControls(); return }
    // Leaving the player collapses the chrome at once, as in the MXAnime-CMS player; a pinned
    // interaction (focus, menu, drag, overlay) still keeps it up.
    if (this.#hasInteraction() || this.#snapshot.state !== 'playing') { this.#scheduleHide(); return }
    this.#hideControlsNow()
  }

  #setFocusActive(active: boolean): void { this.#focusActive = active; if (active) this.#showControls(); else this.#scheduleHide() }
  #hasInteraction(): boolean { return this.#pointerActive || this.#focusActive || this.#overlay !== null || this.#menu.element !== null || this.#subtitleMenu.element !== null || this.#subtitleMenu.editing || this.#seek.active || this.#subtitleDrag.active }
  #showControls(): void { if (this.#locked) { this.#showLockChrome(); return } if (this.#root) this.#root.dataset.mxpVisible = 'true'; this.#syncCursor(); this.#scheduleHide(true) }

  #hideControlsNow(): void {
    if (this.#hideTimer !== null) clearTimeout(this.#hideTimer)
    this.#hideTimer = null
    if (this.#root) this.#root.dataset.mxpVisible = 'false'
    this.#hidePreview()
    this.#syncCursor()
  }

  /**
   * `restart` belongs to interaction only. `playbackchange` arrives several times a second, and it
   * also renders; re-arming the countdown from there would reset it on every snapshot and the
   * chrome would never collapse. A pending countdown is therefore left alone.
   */
  #scheduleHide(restart = false): void {
    this.#syncCursor()
    const blocked = !this.#root || this.#locked || this.#snapshot.state !== 'playing' || this.#hasInteraction()
    if (blocked || restart) {
      if (this.#hideTimer !== null) clearTimeout(this.#hideTimer)
      this.#hideTimer = null
      if (blocked) return
    }
    if (this.#hideTimer !== null) return
    this.#hideTimer = setTimeout(() => {
      this.#hideTimer = null
      if (this.#root && !this.#locked && this.#snapshot.state === 'playing' && !this.#hasInteraction()) {
        this.#root.dataset.mxpVisible = 'false'
        this.#hidePreview()
        this.#syncCursor()
      }
    }, this.#options.autoHideDelayMs ?? DEFAULT_AUTO_HIDE_MS)
  }

  #connectTheater(adapter: TheaterModeAdapter): void { this.#theaterUnsubscribe?.(); try { this.#theaterUnsubscribe = adapter.subscribe(() => this.#render()) } catch { this.#theaterUnsubscribe = null } }

  #detachInternal(removeHostClass = true): void {
    if (this.#hideTimer !== null) clearTimeout(this.#hideTimer)
    this.#hideTimer = null
    if (this.#toastTimer !== null) clearTimeout(this.#toastTimer)
    this.#toastTimer = null
    this.#clearLockChromeTimer()
    this.#locked = false
    this.#lockChromeVisible = true
    this.#pointerActive = false
    this.#focusActive = false
    this.#cancelSeek()
    this.#cancelSubtitleDrag()
    this.#clearPreview()
    this.#closeMenu(false)
    this.#closeSubtitleMenu(true, false)
    this.#closeStats()
    this.#setMiniPlayer(false)
    this.#scope.close()
    this.#scope = new CleanupScope()
    this.#theaterUnsubscribe?.()
    this.#theaterUnsubscribe = null
    this.#closeOverlay(false)
    this.#subtitleResume = null
    this.#pendingSubtitleSelection = null
    this.#root?.remove()
    if (this.#host) {
      delete this.#host.dataset.mxpMini
      delete this.#host.dataset.mxpCursor
      if (removeHostClass) this.#host.classList.remove('mxp-player-host')
    }
    this.#root = null
    this.#elements = null
    this.#attached = false
  }
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
function withinRect(rect: { left: number; right: number; top: number; bottom: number }, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}
/** The popup, its edit bar, the drag guide and the toggle are one interaction surface. */
function isSubtitleSurface(element: Element | null): boolean {
  if (!element) return false
  return Boolean(element.closest('.mxp-subtitle-menu, .mxp-subtitle-edit-bar, [data-mxp-guide="true"], [data-mxp-action="subtitles"]'))
}

export function createPlayerUiController(player: PlayerUiPlayer, options?: PlayerUiOptions): PlayerUiController { return new PlayerUiControllerImpl(player, options) }
