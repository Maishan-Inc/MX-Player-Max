// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AiPostProcessRequest,
  AudioClockSnapshot,
  CustomAudioStats,
  CustomVideoStats,
  EngineEventListener,
  EngineEventMap,
  EngineEventName,
  MediaDescriptor,
  MediaPreviewImage,
  MediaPreviewRequest,
  NativePlaybackStats,
  PlaybackSelection,
  PlaybackSnapshot,
  SubtitleCueStyle,
  SubtitleState,
  SubtitleTrack,
} from '@mx-player-max/types'
import type { MXPlayer } from '@mx-player-max/sdk'
import { attachPlayerUi, PLAYER_UI_LOCALE_CODES, PLAYER_UI_LOCALES, matchPlayerUiLocale, playerUiLabels } from '../src/index'
import type { PlayerRenderMode, PlayerUiLabels } from '../src/contracts'
import { buildEmbedCode, createCpn, resolveVideoUrl, resolveVideoUrlAtTime, shortMediaId } from '../src/share'
import { buildStatsRows, formatColor, formatFrames, formatOptimalResolution, frameCounters, mysteryText, normalizeSamples } from '../src/stats'
import { buildTroubleshootReport } from '../src/troubleshoot'

const MEDIA: MediaDescriptor = {
  container: 'webm',
  mimeType: 'video/webm',
  duration: 100_000_000,
  size: 12_000_000,
  tracks: [
    { id: 398, kind: 'video', codecId: 'V_AV1', codec: 'av01.0.05M.08', width: 1280, height: 720, frameRate: 30, bitrate: 1_600_000, color: { primaries: 'bt709', transfer: 'bt1886', bitDepth: 8, hdrFormat: 'none' } },
    { id: 251, kind: 'audio', codecId: 'A_OPUS', codec: 'opus', sampleRate: 48_000, channels: 2, bitrate: 128_000 },
  ],
}

const SNAPSHOT: PlaybackSnapshot = {
  sessionEpoch: 1,
  state: 'playing',
  paused: false,
  currentTime: 8_790_000,
  duration: 100_000_000,
  played: [{ start: 0, end: 8_790_000 }],
  buffered: [{ start: 0, end: 36_000_000 }],
  bufferedAhead: 27_210_000,
  volume: 0.17,
  muted: false,
  playbackRate: 1,
  seeking: false,
  buffering: false,
  presentationMode: 'inline',
  capabilities: { seek: true, volume: true, playbackRate: true, fullscreen: true, pictureInPicture: false, preview: true },
  ai: {
    tier: 'medium',
    interpolation: { enabled: false, available: false, unavailableReason: 'not-implemented' },
    superResolution: { enabled: false, available: true, unavailableReason: null },
  },
  lastError: null,
}

const SELECTION = { backend: { id: 'native', kind: 'html-video', videoCodec: 'av01', audioCodec: 'opus', renderer: 'native', score: 90, reasons: [], requires: [] }, intent: 'normal' } as unknown as PlaybackSelection

class FakePlayer {
  playback: PlaybackSnapshot = SNAPSHOT
  state = SNAPSHOT.state
  media: MediaDescriptor | null = MEDIA
  selection: PlaybackSelection | null = SELECTION
  nativeStats: NativePlaybackStats | null = { presentedFrames: 300, droppedFrames: 5, mediaTime: 8_790_000, lastCallbackTime: null }
  customVideoStats: CustomVideoStats | null = null
  customAudioStats: CustomAudioStats | null = null
  audioClock: AudioClockSnapshot | null = null
  rendererKind = null
  rendererStats = null
  subtitleTracks: readonly SubtitleTrack[] = []
  selectedSubtitleTrack: string | null = null
  subtitleState: SubtitleState = 'ready'
  subtitleStyle: SubtitleCueStyle = { fontFamily: 'system-ui, sans-serif', fontSize: 36, x: 50, y: 86 }
  setAiPostProcess = vi.fn(async (_request: AiPostProcessRequest): Promise<void> => {})
  play = vi.fn(async (): Promise<void> => {})
  pause = vi.fn((): void => {})
  seek = vi.fn(async (_time: number): Promise<void> => {})
  setVolume = vi.fn((_volume: number): void => {})
  setMuted = vi.fn((_muted: boolean): void => {})
  setPlaybackRate = vi.fn((_rate: number): void => {})
  requestFullscreen = vi.fn(async (): Promise<void> => {})
  exitFullscreen = vi.fn(async (): Promise<void> => {})
  requestPictureInPicture = vi.fn(async (): Promise<void> => {})
  exitPictureInPicture = vi.fn(async (): Promise<void> => {})
  requestPreview = vi.fn(async (request: MediaPreviewRequest): Promise<MediaPreviewImage | null> => ({ blob: new Blob(['x']), time: request.time, width: 160, height: 90, sessionEpoch: 1 }))
  setSubtitleStyle = vi.fn((): void => {})
  resetSubtitleStyle = vi.fn((): void => {})
  selectSubtitleTrack = vi.fn(async (): Promise<void> => {})
  #listeners = new Map<EngineEventName, Set<(payload: unknown) => void>>()

  on<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): () => void {
    const listeners = this.#listeners.get(event) ?? new Set<(payload: unknown) => void>()
    listeners.add(listener as (payload: unknown) => void)
    this.#listeners.set(event, listeners)
    return (): void => this.off(event, listener)
  }

  off<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): void {
    this.#listeners.get(event)?.delete(listener as (payload: unknown) => void)
  }

  emit<K extends EngineEventName>(event: K, payload: EngineEventMap[K]): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(payload)
  }
}

function mount(player: FakePlayer, options: Parameters<typeof attachPlayerUi>[2] = {}): { host: HTMLElement; ui: ReturnType<typeof attachPlayerUi> } {
  const host = document.createElement('div')
  document.body.append(host)
  const ui = attachPlayerUi(player as unknown as MXPlayer, host, options)
  return { host, ui }
}

function openMenu(host: HTMLElement): HTMLElement {
  host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 24, clientY: 24 }))
  return host.querySelector<HTMLElement>('.mxp-context-menu')!
}

function itemIds(menu: HTMLElement): string[] {
  return [...menu.querySelectorAll<HTMLElement>('.mxp-menu-item')].map((item) => item.dataset.mxpMenuItem ?? '')
}

let clipboardText: string | null = null

beforeEach(() => {
  clipboardText = null
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value: string): Promise<void> => { clipboardText = value } },
  })
})

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.removeAttribute('lang')
  vi.useRealTimers()
})

describe('@mx-player-max/ui label packs', () => {
  it('ships a complete pack for every advertised locale', () => {
    expect([...PLAYER_UI_LOCALE_CODES]).toEqual(['en', 'zh-CN', 'zh-TW', 'ja'])
    const reference = Object.keys(PLAYER_UI_LOCALES.en).sort()
    expect(reference.length).toBeGreaterThan(70)
    for (const locale of PLAYER_UI_LOCALE_CODES) {
      const pack = PLAYER_UI_LOCALES[locale]
      expect(Object.keys(pack).sort()).toEqual(reference)
      for (const [key, value] of Object.entries(pack)) expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
    }
  })

  it('keeps the frame-counter placeholders in every pack', () => {
    for (const locale of PLAYER_UI_LOCALE_CODES) {
      expect(PLAYER_UI_LOCALES[locale].statsFrames).toContain('{dropped}')
      expect(PLAYER_UI_LOCALES[locale].statsFrames).toContain('{total}')
    }
  })

  it('normalizes script and region subtags', () => {
    expect(matchPlayerUiLocale('zh-Hans-CN')).toBe('zh-CN')
    expect(matchPlayerUiLocale('zh-Hant-TW')).toBe('zh-TW')
    expect(matchPlayerUiLocale('zh_HK')).toBe('zh-TW')
    expect(matchPlayerUiLocale('ja')).toBe('ja')
    expect(matchPlayerUiLocale('pt-BR')).toBeNull()
  })

  it('labels the controls in the requested locale and defaults to English', () => {
    const player = new FakePlayer()
    const { host, ui } = mount(player, { locale: 'ja' })
    expect(host.querySelector('[data-mxp-action="play"]')?.getAttribute('aria-label')).toBe('一時停止')
    ui.destroy()
    const fallback = mount(new FakePlayer())
    expect(fallback.host.querySelector('[data-mxp-action="settings"]')?.getAttribute('aria-label')).toBe('Settings')
    fallback.ui.destroy()
  })

  it('follows the document language when the locale is auto', () => {
    document.documentElement.lang = 'zh-TW'
    const { host, ui } = mount(new FakePlayer(), { locale: 'auto' })
    expect(host.querySelector<HTMLElement>('.mxp-player-ui')?.dataset.mxpLocale).toBe('zh-TW')
    expect(host.querySelector('[data-mxp-action="fullscreen"]')?.getAttribute('aria-label')).toBe('全螢幕')
    ui.destroy()
  })
})

describe('@mx-player-max/ui right-click menu', () => {
  it('replaces the browser menu with the eight documented entries in order', () => {
    const player = new FakePlayer()
    const { host, ui } = mount(player, { locale: 'zh-CN' })
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 12 })
    host.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    const menu = host.querySelector<HTMLElement>('.mxp-context-menu')!
    expect(menu.getAttribute('role')).toBe('menu')
    expect(menu.getAttribute('aria-label')).toBe('播放器菜单')
    expect(itemIds(menu)).toEqual(['loop', 'mini', 'copy-url', 'copy-url-at-time', 'copy-embed', 'copy-debug', 'troubleshoot', 'stats'])
    expect([...menu.querySelectorAll('.mxp-menu-item')].map((item) => item.textContent)).toEqual([
      '循环播放', '迷你播放器', '复制视频网址', '复制当前时间的视频网址', '复制嵌入代码', '复制调试信息', '排查播放问题', '详细统计信息',
    ])
    expect(menu.querySelectorAll('.mxp-menu-separator')).toHaveLength(2)
    // Every entry carries its own glyph, like the MX-Player-Pro menu.
    expect(menu.querySelectorAll('.mxp-menu-icon svg')).toHaveLength(8)
    ui.destroy()
  })

  // The playback surface is a sibling of the UI root, so the listener has to sit on the host.
  it('opens from a right-click on the playback surface, not only on the chrome', () => {
    const { host, ui } = mount(new FakePlayer())
    const surface = document.createElement('video')
    host.append(surface)
    surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))
    expect(host.querySelector('.mxp-context-menu')).not.toBeNull()
    ui.destroy()
  })

  it('moves to the new position on a second right-click and closes on Escape', () => {
    const { host, ui } = mount(new FakePlayer())
    openMenu(host)
    openMenu(host)
    expect(host.querySelectorAll('.mxp-context-menu')).toHaveLength(1)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(host.querySelector('.mxp-context-menu')).toBeNull()
    ui.destroy()
  })

  it('closes when a pointer goes down outside the player chrome', () => {
    const { host, ui } = mount(new FakePlayer())
    openMenu(host)
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(host.querySelector('.mxp-context-menu')).toBeNull()
    ui.destroy()
  })

  it('restores the browser menu when the feature is disabled', () => {
    const { host, ui } = mount(new FakePlayer(), { features: { contextMenu: false } })
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    host.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(host.querySelector('.mxp-context-menu')).toBeNull()
    ui.destroy()
  })

  it('omits entries whose feature is switched off and drops the empty separator', () => {
    const { host, ui } = mount(new FakePlayer(), { features: { share: false, troubleshoot: false, statistics: false } })
    const menu = openMenu(host)
    expect(itemIds(menu)).toEqual(['loop', 'mini'])
    expect(menu.querySelectorAll('.mxp-menu-separator')).toHaveLength(0)
    ui.destroy()
  })

  it('restores the browser menu when the feature is disabled', () => {
    const { host, ui } = mount(new FakePlayer(), { features: { contextMenu: false } })
    const root = host.querySelector<HTMLElement>('.mxp-player-ui')!
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    root.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(host.querySelector('.mxp-context-menu')).toBeNull()
    ui.destroy()
  })

  it('moves focus with the arrow keys', () => {
    const { host, ui } = mount(new FakePlayer())
    const menu = openMenu(host)
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('.mxp-menu-item')]
    expect(document.activeElement).toBe(buttons[0])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement).toBe(buttons[1])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement).toBe(buttons[0])
    ui.destroy()
  })
})

describe('@mx-player-max/ui loop and miniplayer', () => {
  it('keeps the menu open when loop is toggled and reflects the checked state', () => {
    const { host, ui } = mount(new FakePlayer())
    const menu = openMenu(host)
    const loop = menu.querySelector<HTMLButtonElement>('[data-mxp-menu-item="loop"]')!
    expect(loop.getAttribute('role')).toBe('menuitemcheckbox')
    expect(loop.getAttribute('aria-checked')).toBe('false')
    loop.click()
    expect(host.querySelector('.mxp-context-menu')).not.toBeNull()
    expect(loop.getAttribute('aria-checked')).toBe('true')
    expect(loop.querySelector('.mxp-menu-check svg')).not.toBeNull()
    expect(host.querySelector<HTMLElement>('.mxp-player-ui')?.dataset.mxpLoop).toBe('true')
    ui.destroy()
  })

  it('restarts playback once when a looping session ends', async () => {
    const player = new FakePlayer()
    const { host, ui } = mount(player)
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="loop"]')!.click()
    const ended: PlaybackSnapshot = { ...SNAPSHOT, state: 'ended', paused: true }
    player.playback = ended
    player.emit('playbackchange', { snapshot: ended, reason: 'state' })
    player.emit('playbackchange', { snapshot: ended, reason: 'state' })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(player.seek).toHaveBeenCalledTimes(1)
    expect(player.seek).toHaveBeenCalledWith(0)
    expect(player.play).toHaveBeenCalledTimes(1)
    ui.destroy()
  })

  it('never restarts when loop is off', async () => {
    const player = new FakePlayer()
    const { ui } = mount(player)
    const ended: PlaybackSnapshot = { ...SNAPSHOT, state: 'ended', paused: true }
    player.playback = ended
    player.emit('playbackchange', { snapshot: ended, reason: 'state' })
    await Promise.resolve()
    expect(player.seek).not.toHaveBeenCalled()
    ui.destroy()
  })

  it('docks the host and releases it again', () => {
    const { host, ui } = mount(new FakePlayer(), { locale: 'zh-CN' })
    const menu = openMenu(host)
    expect(menu.querySelector('[data-mxp-menu-item="mini"]')?.textContent).toBe('迷你播放器')
    menu.querySelector<HTMLButtonElement>('[data-mxp-menu-item="mini"]')!.click()
    expect(host.dataset.mxpMini).toBe('true')
    expect(host.querySelector('.mxp-context-menu')).toBeNull()
    expect(openMenu(host).querySelector('[data-mxp-menu-item="mini"]')?.textContent).toBe('退出迷你播放器')
    const root = host.querySelector<HTMLElement>('.mxp-player-ui')!
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(host.dataset.mxpMini).toBeUndefined()
    ui.destroy()
  })

  it('clears the docked state on destroy', () => {
    const { host, ui } = mount(new FakePlayer())
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="mini"]')!.click()
    expect(host.dataset.mxpMini).toBe('true')
    ui.destroy()
    expect(host.dataset.mxpMini).toBeUndefined()
  })
})

const SHARE = { pageUrl: 'https://example.test/watch?v=abc', videoUrl: 'https://media.example.test/movie.webm', embedUrl: 'https://example.test/embed/abc', title: 'Sample' }

describe('@mx-player-max/ui clipboard entries', () => {
  it('copies the video URL, the timed URL and the embed code', async () => {
    const { host, ui } = mount(new FakePlayer(), { share: SHARE })
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="copy-url"]')!.click()
    await vi.waitFor(() => expect(clipboardText).toBe(SHARE.videoUrl))
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="copy-url-at-time"]')!.click()
    await vi.waitFor(() => expect(clipboardText).toBe('https://media.example.test/movie.webm?t=8'))
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="copy-embed"]')!.click()
    await vi.waitFor(() => expect(clipboardText).toContain('src="https://example.test/embed/abc"'))
    ui.destroy()
  })

  it('confirms a copy with a localized toast', async () => {
    const { host, ui } = mount(new FakePlayer(), { locale: 'ja', share: SHARE })
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="copy-url"]')!.click()
    await vi.waitFor(() => expect(host.querySelector('.mxp-toast')?.textContent).toBe('クリップボードにコピーしました'))
    expect(host.querySelector<HTMLElement>('.mxp-toast')?.hidden).toBe(false)
    ui.destroy()
  })

  it('reports an unavailable clipboard instead of failing silently', async () => {
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined })
    const { host, ui } = mount(new FakePlayer(), { locale: 'zh-CN', share: SHARE })
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="copy-url"]')!.click()
    await vi.waitFor(() => expect(host.querySelector('.mxp-toast')?.textContent).toBe('剪贴板不可用'))
    expect(host.querySelector<HTMLElement>('.mxp-toast')?.dataset.mxpTone).toBe('error')
    ui.destroy()
  })

  it('copies a debug payload that names the engine state', async () => {
    const { host, ui } = mount(new FakePlayer(), { share: SHARE })
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="copy-debug"]')!.click()
    await vi.waitFor(() => expect(clipboardText).not.toBeNull())
    const payload = JSON.parse(clipboardText ?? '{}') as Record<string, unknown>
    expect(payload['ns']).toBe('mx-player-max')
    expect(payload['page']).toBe(SHARE.pageUrl)
    expect((payload['playback'] as Record<string, unknown>)['state']).toBe('playing')
    expect((payload['media'] as Record<string, unknown>)['container']).toBe('webm')
    ui.destroy()
  })
})

function statsRows(host: HTMLElement): Map<string, string> {
  const rows = new Map<string, string>()
  for (const row of host.querySelectorAll<HTMLElement>('.mxp-stats-row')) {
    rows.set(row.dataset.mxpStatsRow ?? '', row.querySelector('.mxp-stats-label')?.textContent ?? '')
  }
  return rows
}

describe('@mx-player-max/ui statistics overlay', () => {
  it('opens a non-modal sheet with the eleven localized rows', () => {
    const { host, ui } = mount(new FakePlayer(), { locale: 'zh-CN', share: SHARE })
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="stats"]')!.click()
    const overlay = host.querySelector<HTMLElement>('.mxp-stats-overlay')!
    expect(overlay.getAttribute('aria-modal')).toBeNull()
    expect(overlay.getAttribute('aria-label')).toBe('详细统计信息')
    const rows = statsRows(host)
    expect([...rows.keys()]).toEqual(['videoId', 'viewport', 'resolution', 'volume', 'codecs', 'color', 'connection', 'network', 'buffer', 'mystery', 'date'])
    expect(rows.get('resolution')).toBe('当前 / 最佳分辨率')
    expect(rows.get('buffer')).toBe('缓冲健康度')
    ui.destroy()
  })

  it('renders the measured values, a meter and a graph', () => {
    const { host, ui } = mount(new FakePlayer(), { share: SHARE })
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="stats"]')!.click()
    const value = (key: string): string => host.querySelector(`[data-mxp-stats-row="${key}"] .mxp-stats-value`)?.textContent ?? ''
    expect(value('resolution')).toContain('1280x720@30')
    expect(value('codecs')).toBe('av01.0.05M.08 (398) / opus (251)')
    expect(value('color')).toBe('bt709 / bt1886 8-bit')
    expect(value('volume')).toContain('17% / 17%')
    expect(value('viewport')).toContain('5 dropped of 305')
    expect(value('buffer')).toContain('27.21 s')
    expect(value('mystery')).toContain('t:8.79')
    expect(host.querySelector('[data-mxp-stats-row="buffer"] .mxp-stats-meter-fill')).not.toBeNull()
    expect(host.querySelector('[data-mxp-stats-row="network"] .mxp-stats-graph')).not.toBeNull()
    ui.destroy()
  })

  it('derives a stable video id and a per-session nonce', () => {
    const { host, ui } = mount(new FakePlayer(), { share: SHARE })
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="stats"]')!.click()
    const first = host.querySelector('[data-mxp-stats-row="videoId"] .mxp-stats-value')?.textContent ?? ''
    const [videoId, cpn] = first.split(' / ')
    expect(videoId).toBe(shortMediaId(SHARE.videoUrl))
    expect(cpn).toHaveLength(16)
    ui.destroy()
  })

  it('closes from the corner control and stops updating', () => {
    vi.useFakeTimers()
    const { host, ui } = mount(new FakePlayer(), { share: SHARE })
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="stats"]')!.click()
    host.querySelector<HTMLButtonElement>('.mxp-stats-close')!.click()
    expect(host.querySelector('.mxp-stats-overlay')).toBeNull()
    vi.advanceTimersByTime(5_000)
    expect(host.querySelector('.mxp-stats-overlay')).toBeNull()
    ui.destroy()
  })

  it('re-opens through the settings panel entry', () => {
    const { host, ui } = mount(new FakePlayer())
    host.querySelector<HTMLButtonElement>('[data-mxp-action="settings"]')!.click()
    const entry = [...host.querySelectorAll<HTMLButtonElement>('.mxp-panel button')].find((button) => button.textContent === 'Stats for nerds')
    expect(entry).toBeDefined()
    entry?.click()
    expect(host.querySelector('.mxp-stats-overlay')).not.toBeNull()
    expect(host.querySelector('.mxp-overlay-backdrop')).toBeNull()
    ui.destroy()
  })
})

describe('@mx-player-max/ui troubleshooting report', () => {
  it('reports a healthy session and a copy action', () => {
    const player = new FakePlayer()
    player.nativeStats = { presentedFrames: 300, droppedFrames: 0, mediaTime: 0, lastCallbackTime: null }
    const { host, ui } = mount(player, { locale: 'zh-CN', share: SHARE })
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="troubleshoot"]')!.click()
    const panel = host.querySelector<HTMLElement>('.mxp-panel')!
    expect(panel.querySelector('.mxp-panel-title')?.textContent).toBe('排查播放问题')
    expect(panel.textContent).toContain('没有检测到播放问题。')
    expect(panel.textContent).toContain('复制报告')
    ui.destroy()
  })

  it('names the dropped-frame and error findings with their codes', () => {
    const player = new FakePlayer()
    player.playback = { ...SNAPSHOT, lastError: { code: 'NATIVE_DECODE_FAILED', recoverable: false } }
    const { host, ui } = mount(player, { share: SHARE })
    openMenu(host).querySelector<HTMLButtonElement>('[data-mxp-menu-item="troubleshoot"]')!.click()
    const codes = [...host.querySelectorAll('.mxp-finding-list code')].map((code) => code.textContent)
    expect(codes).toContain('NATIVE_DECODE_FAILED')
    expect(codes).toContain('UI_DROPPED_FRAMES')
    expect(host.querySelector('.mxp-panel')?.textContent).toContain('userAgent')
    ui.destroy()
  })
})

describe('@mx-player-max/ui share and stats helpers', () => {
  it('falls back down the configured address chain', () => {
    expect(resolveVideoUrl(undefined, 'https://page.test/')).toBe('https://page.test/')
    expect(resolveVideoUrl({ pageUrl: 'https://page.test/a' }, 'https://ignored/')).toBe('https://page.test/a')
    expect(resolveVideoUrl(SHARE, 'https://ignored/')).toBe(SHARE.videoUrl)
  })

  it('writes whole seconds and keeps an unparsable address intact', () => {
    expect(resolveVideoUrlAtTime(SHARE, 'https://page.test/', 95_400_000)).toBe('https://media.example.test/movie.webm?t=95')
    expect(resolveVideoUrlAtTime({ videoUrl: 'not a url', timeParam: 'start' }, 'https://page.test/', 5_000_000)).toBe('not a url')
    expect(resolveVideoUrlAtTime({ videoUrl: 'https://a.test/v', timeParam: 'start' }, 'https://page.test/', null)).toBe('https://a.test/v?start=0')
  })

  it('escapes the embed attributes so injected markup cannot break out', () => {
    const code = buildEmbedCode({ embedUrl: 'https://a.test/e?x=1&y="2"', title: '<script>' }, 'https://page.test/')
    expect(code).toContain('src="https://a.test/e?x=1&amp;y=&quot;2&quot;"')
    expect(code).toContain('title="&lt;script&gt;"')
    expect(code).not.toContain('<script>')
    expect(code).toContain('allowfullscreen')
  })

  it('derives an eleven-character id that is stable per source and a sixteen-character nonce', () => {
    expect(shortMediaId('https://a.test/v')).toHaveLength(11)
    expect(shortMediaId('https://a.test/v')).toBe(shortMediaId('https://a.test/v'))
    expect(shortMediaId('https://a.test/w')).not.toBe(shortMediaId('https://a.test/v'))
    expect(createCpn(() => 0.5)).toHaveLength(16)
    expect(/^[A-Za-z0-9\-_]{16}$/.test(createCpn(() => 0.9))).toBe(true)
  })
})

describe('@mx-player-max/ui statistics model', () => {
  const labels: PlayerUiLabels = playerUiLabels('en')

  function input(overrides: Partial<Parameters<typeof buildStatsRows>[0]> = {}): Parameters<typeof buildStatsRows>[0] {
    return {
      labels,
      locale: 'en',
      snapshot: SNAPSHOT,
      media: MEDIA,
      selection: SELECTION,
      nativeStats: { presentedFrames: 300, droppedFrames: 5, mediaTime: 0, lastCallbackTime: null },
      customVideoStats: null,
      customAudioStats: null,
      audioClock: null,
      rendererKind: null,
      rendererStats: null,
      viewport: { width: 1563, height: 879, devicePixelRatio: 1 },
      videoId: 'AAAAAAAAAAA',
      cpn: 'BBBBBBBBBBBBBBBB',
      connectionKbps: 60_302,
      networkSamples: [0, 512, 1024],
      networkBytes: 1536,
      now: Date.UTC(2026, 7, 21, 10, 4, 16),
      ...overrides,
    }
  }

  it('counts native frames as presented plus dropped', () => {
    expect(frameCounters(input())).toEqual({ total: 305, dropped: 5 })
    expect(formatFrames({ total: 305, dropped: 5 }, labels)).toBe('5 dropped of 305')
    expect(formatFrames(null, labels)).toBe('n/a')
  })

  it('sums the custom pipeline and renderer drops', () => {
    const custom: CustomVideoStats = { decodedFrames: 900, deliveredFrames: 880, droppedFrames: 8, droppedStaleFrames: 2, droppedPreSeekFrames: 0, queuedFrames: 3, decodeQueueSize: 1, bufferedDuration: 500_000, endOfStream: false }
    const counters = frameCounters({ nativeStats: null, customVideoStats: custom, rendererStats: { kind: 'webgpu', state: 'ready', presentedFrames: 870, droppedFrames: 4, waitFrames: 0, invalidFrames: 0, fallbackCount: 0, width: 1280, height: 720, devicePixelRatio: 1, colorMode: 'sdr-bt709', colorRange: 'full', hdrPreserved: false, hdrReason: null, filter: 'none' } })
    expect(counters).toEqual({ total: 900, dropped: 14 })
  })

  it('scales the meters and normalizes the graph against the window peak', () => {
    const rows = buildStatsRows(input())
    const buffer = rows.find((row) => row.key === 'buffer')
    expect(buffer?.kind).toBe('meter')
    expect(buffer?.ratio).toBeCloseTo(27.21 / 30, 3)
    const network = rows.find((row) => row.key === 'network')
    expect(network?.samples).toEqual([0, 0.5, 1])
    expect(normalizeSamples([0, 0, 0])).toEqual([0, 0, 0])
  })

  it('warns when a playing session is nearly out of buffer', () => {
    const rows = buildStatsRows(input({ snapshot: { ...SNAPSHOT, bufferedAhead: 400_000 } }))
    expect(rows.find((row) => row.key === 'buffer')?.tone).toBe('warn')
  })

  it('reports the optimal resolution at the device pixel ratio', () => {
    const video = MEDIA.tracks[0]!
    expect(formatOptimalResolution({ width: 640, height: 360, devicePixelRatio: 2 }, video, 'n/a')).toBe('1280x720@30')
    expect(formatOptimalResolution({ width: 0, height: 0, devicePixelRatio: 1 }, video, 'n/a')).toBe('n/a')
    expect(formatColor(null, 'n/a')).toBe('n/a')
  })

  it('packs the debug token with state, time, buffer and backend', () => {
    const token = mysteryText(input())
    expect(token).toContain('html-video')
    expect(token).toContain('s:3')
    expect(token).toContain('t:8.79')
    expect(token).toContain('b:0.000-36.000')
    expect(token).toContain('e:1')
  })

  it('localizes the date row', () => {
    const zh = buildStatsRows(input({ labels: playerUiLabels('zh-CN'), locale: 'zh-CN' })).find((row) => row.key === 'date')
    const ja = buildStatsRows(input({ labels: playerUiLabels('ja'), locale: 'ja' })).find((row) => row.key === 'date')
    expect(zh?.label).toBe('日期')
    expect(ja?.label).toBe('日時')
    expect(zh?.value).not.toBe(ja?.value)
  })

  it('flags a WASM backend and a wall-clock custom session', () => {
    const wasm = { ...SELECTION, backend: { ...SELECTION.backend, kind: 'wasm' } } as PlaybackSelection
    const clock: AudioClockSnapshot = { source: 'wall-clock', mediaTime: 0, contextTime: null, renderedFrames: 0, sampleRate: null, playbackRate: 1, running: true, underrun: false, epoch: 1 }
    const custom: CustomVideoStats = { decodedFrames: 10, deliveredFrames: 10, droppedFrames: 0, droppedStaleFrames: 0, droppedPreSeekFrames: 0, queuedFrames: 0, decodeQueueSize: 0, bufferedDuration: 0, endOfStream: false }
    const report = buildTroubleshootReport(input({ selection: wasm, audioClock: clock, customVideoStats: custom, nativeStats: null }), labels, 'agent/1.0')
    const codes = report.findings.map((finding) => finding.code)
    expect(codes).toContain('UI_SOFTWARE_DECODE')
    expect(codes).toContain('UI_NO_AUDIO_CLOCK')
    expect(report.environment.find(([key]) => key === 'userAgent')?.[1]).toBe('agent/1.0')
  })
})

describe('@mx-player-max/ui AI post-processing toggles', () => {
  const openSettings = (host: HTMLElement): HTMLElement => {
    host.querySelector<HTMLButtonElement>('[data-mxp-action="settings"]')!.click()
    return host.querySelector<HTMLElement>('.mxp-panel')!
  }

  it('offers super resolution and interpolation as independent controls', () => {
    const { host, ui } = mount(new FakePlayer())
    const toggles = [...openSettings(host).querySelectorAll<HTMLInputElement>('.mxp-panel-toggle input')]
    expect(toggles.map((input) => input.getAttribute('aria-label'))).toEqual(['Super resolution', 'Frame interpolation'])
    // The engine reports super resolution as available and interpolation as not built.
    expect(toggles[0]?.disabled).toBe(false)
    expect(toggles[0]?.checked).toBe(false)
    expect(toggles[1]?.disabled).toBe(true)
    const captions = [...host.querySelectorAll('.mxp-panel .mxp-caption')].map((node) => node.textContent)
    expect(captions).toEqual(['Not available yet in this build.'])
    ui.destroy()
  })

  it('asks the engine to switch super resolution on', async () => {
    const player = new FakePlayer()
    const { host, ui } = mount(player)
    const input = openSettings(host).querySelector<HTMLInputElement>('.mxp-panel-toggle input')!
    input.checked = true
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    expect(player.setAiPostProcess).toHaveBeenCalledWith({ superResolution: true })
    ui.destroy()
  })

  it('explains the render path when the session cannot host AI', () => {
    const player = new FakePlayer()
    player.playback = {
      ...player.playback,
      ai: {
        tier: 'off',
        interpolation: { enabled: false, available: false, unavailableReason: 'renderer-path' },
        superResolution: { enabled: false, available: false, unavailableReason: 'renderer-path' },
      },
    }
    const { host, ui } = mount(player, { locale: 'zh-CN' })
    const panel = openSettings(host)
    expect([...panel.querySelectorAll<HTMLInputElement>('.mxp-panel-toggle input')].every((input) => input.disabled)).toBe(true)
    expect(panel.textContent).toContain('把渲染模式切换到 WebGPU 自定义管线后才能开启。')
    ui.destroy()
  })

  it('rebuilds the open panel when the engine reports an AI change', () => {
    const player = new FakePlayer()
    const { host, ui } = mount(player)
    openSettings(host)
    player.playback = {
      ...player.playback,
      ai: {
        tier: 'medium',
        interpolation: { enabled: false, available: false, unavailableReason: 'not-implemented' },
        superResolution: { enabled: true, available: true, unavailableReason: null },
      },
    }
    player.emit('playbackchange', { snapshot: player.playback, reason: 'ai' })
    expect(host.querySelector<HTMLInputElement>('.mxp-panel-toggle input')?.checked).toBe(true)
    ui.destroy()
  })

  it('omits the section when the feature is switched off', () => {
    const { host, ui } = mount(new FakePlayer(), { features: { aiPostProcess: false } })
    expect(openSettings(host).querySelector('.mxp-panel-toggle')).toBeNull()
    ui.destroy()
  })
})

describe('@mx-player-max/ui render mode selector', () => {
  const openSettings = (host: HTMLElement): HTMLElement => {
    host.querySelector<HTMLButtonElement>('[data-mxp-action="settings"]')!.click()
    return host.querySelector<HTMLElement>('.mxp-panel')!
  }

  function adapter(initial: PlayerRenderMode = 'native') {
    let mode = initial
    const listeners = new Set<(next: PlayerRenderMode) => void>()
    return {
      setState: vi.fn((next: PlayerRenderMode) => { mode = next; for (const listener of listeners) listener(next) }),
      getState: () => mode,
      subscribe: (listener: (next: PlayerRenderMode) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
  }

  it('offers the three render paths with the host mode selected', () => {
    const renderMode = adapter('custom-webgpu')
    const { host, ui } = mount(new FakePlayer(), { renderMode })
    const select = openSettings(host).querySelector<HTMLSelectElement>('[data-mxp-control="render-mode"]')!
    expect([...select.options].map((option) => option.value)).toEqual(['native', 'custom-webgpu', 'custom-fallback'])
    expect([...select.options].map((option) => option.textContent)).toEqual(['Native playback', 'WebGPU custom pipeline', 'WebGL2 custom pipeline'])
    expect(select.value).toBe('custom-webgpu')
    expect(host.querySelector('.mxp-panel')?.textContent).toContain('AI enhancement runs only on the WebGPU custom pipeline.')
    ui.destroy()
  })

  it('hands a picked mode to the host adapter', async () => {
    const renderMode = adapter()
    const { host, ui } = mount(new FakePlayer(), { renderMode })
    const select = openSettings(host).querySelector<HTMLSelectElement>('[data-mxp-control="render-mode"]')!
    select.value = 'custom-fallback'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    expect(renderMode.setState).toHaveBeenCalledWith('custom-fallback')
    ui.destroy()
  })

  it('follows a mode the host changed elsewhere', () => {
    const renderMode = adapter()
    const { host, ui } = mount(new FakePlayer(), { renderMode })
    openSettings(host)
    renderMode.setState('custom-webgpu')
    expect(host.querySelector<HTMLSelectElement>('[data-mxp-control="render-mode"]')?.value).toBe('custom-webgpu')
    ui.destroy()
  })

  it('stays out of the panel without an adapter or with the feature off', () => {
    const withoutAdapter = mount(new FakePlayer())
    expect(openSettings(withoutAdapter.host).querySelector('[data-mxp-control="render-mode"]')).toBeNull()
    withoutAdapter.ui.destroy()
    const switchedOff = mount(new FakePlayer(), { renderMode: adapter(), features: { renderMode: false } })
    expect(openSettings(switchedOff.host).querySelector('[data-mxp-control="render-mode"]')).toBeNull()
    switchedOff.ui.destroy()
  })

  it('localizes the section', () => {
    const { host, ui } = mount(new FakePlayer(), { renderMode: adapter(), locale: 'zh-CN' })
    const panel = openSettings(host)
    expect(panel.textContent).toContain('渲染模式')
    expect(panel.textContent).toContain('WebGPU 自定义管线')
    expect(panel.textContent).toContain('AI 增强只在 WebGPU 自定义管线下可用。')
    ui.destroy()
  })
})
