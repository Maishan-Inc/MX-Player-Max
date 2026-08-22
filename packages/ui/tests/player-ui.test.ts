// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  EngineEventListener,
  EngineEventMap,
  EngineEventName,
  MediaPreviewImage,
  MediaPreviewRequest,
  PlaybackSnapshot,
  SubtitleCueStyle,
  SubtitleState,
  SubtitleTrack,
} from '@mx-player-max/types'
import type { MXPlayer } from '@mx-player-max/sdk'
import { attachPlayerUi, createPlayerUi, PlayerUiError, UiErrorCodes } from '../src/index'

const initialSnapshot: PlaybackSnapshot = {
  sessionEpoch: 1,
  state: 'ready',
  paused: true,
  currentTime: 10_000_000,
  duration: 100_000_000,
  played: [{ start: 0, end: 10_000_000 }],
  buffered: [{ start: 0, end: 40_000_000 }],
  bufferedAhead: 30_000_000,
  volume: 0.8,
  muted: false,
  playbackRate: 1,
  seeking: false,
  buffering: false,
  presentationMode: 'inline',
  capabilities: { seek: true, volume: true, playbackRate: true, fullscreen: true, pictureInPicture: false, preview: true },
  ai: {
    tier: 'off',
    interpolation: { enabled: false, available: false, unavailableReason: 'renderer-path' },
    superResolution: { enabled: false, available: false, unavailableReason: 'renderer-path' },
  },
  lastError: null,
}

class FakePlayer {
  playback = initialSnapshot
  state = initialSnapshot.state
  subtitleTracks: readonly SubtitleTrack[] = [{ id: 'en', source: { kind: 'file', format: 'srt' }, format: 'srt', language: 'en', name: 'English', state: 'ready', cueCount: 2, diagnosticCount: 0 }]
  selectedSubtitleTrack: string | null = null
  subtitleState: SubtitleState = 'ready'
  subtitleStyle: SubtitleCueStyle = { fontFamily: 'system-ui, sans-serif', fontSize: 36, x: 50, y: 86, color: '#ffffff', outlineColor: '#000000', outlineWidth: 2 }
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
  requestPreview = vi.fn(async (request: MediaPreviewRequest): Promise<MediaPreviewImage | null> => ({ blob: new Blob(['x'], { type: 'image/webp' }), time: request.time, width: request.width ?? 160, height: request.height ?? 90, sessionEpoch: this.playback.sessionEpoch }))
  setSubtitleStyle = vi.fn((style: SubtitleCueStyle): void => { this.subtitleStyle = style })
  resetSubtitleStyle = vi.fn((): void => {})
  selectSubtitleTrack = vi.fn(async (id: string | null): Promise<void> => { this.selectedSubtitleTrack = id })
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

  listenerCount(event: EngineEventName): number {
    return this.#listeners.get(event)?.size ?? 0
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('@mx-player-max/ui lifecycle and controls (simulated DOM)', () => {
  it('supports repeat attach, remount, update, and idempotent destroy', () => {
    const player = new FakePlayer()
    const first = document.createElement('div')
    const second = document.createElement('div')
    document.body.append(first, second)
    const ui = createPlayerUi(player as unknown as MXPlayer)
    expect(ui.attached).toBe(false)
    ui.attach(first)
    ui.attach(first)
    expect(first.querySelectorAll('.mxp-player-ui')).toHaveLength(1)
    ui.attach(second)
    expect(first.querySelector('.mxp-player-ui')).toBeNull()
    expect(second.querySelectorAll('.mxp-player-ui')).toHaveLength(1)
    ui.update({ theme: 'light' })
    expect(second.querySelectorAll('.mxp-player-ui')).toHaveLength(1)
    expect(second.querySelector('.mxp-player-ui')?.getAttribute('data-mxp-theme')).toBe('light')
    ui.destroy()
    ui.destroy()
    expect(ui.attached).toBe(false)
    expect(() => ui.attach(first)).toThrowError(PlayerUiError)
  })

  it('renders snapshot state and only commits SDK-driven changes', async () => {
    const player = new FakePlayer()
    const host = document.createElement('div')
    document.body.append(host)
    const ui = attachPlayerUi(player as unknown as MXPlayer, host)
    const play = host.querySelector<HTMLButtonElement>('[data-mxp-action="play"]')!
    expect(play.getAttribute('aria-label')).toBe('Play')
    expect(play.querySelector('svg')).not.toBeNull()
    expect(play.querySelector('[role="tooltip"]')?.textContent).toBe('Play')
    play.click()
    await Promise.resolve()
    expect(player.play).toHaveBeenCalledOnce()
    expect(play.getAttribute('aria-label')).toBe('Play')
    player.playback = { ...player.playback, state: 'playing', paused: false }
    player.emit('playbackchange', { snapshot: player.playback, reason: 'state' })
    expect(play.getAttribute('aria-label')).toBe('Pause')
    expect(host.querySelector('[data-mxp-action="pip"]')?.getAttribute('disabled')).not.toBeNull()
    ui.destroy()
  })

  it('fills the rail to the playhead and keeps buffered gaps discrete', () => {
    const player = new FakePlayer()
    player.playback = {
      ...player.playback,
      played: [{ start: 0, end: 10_000_000 }, { start: 30_000_000, end: 40_000_000 }],
      buffered: [{ start: 0, end: 20_000_000 }, { start: 60_000_000, end: 80_000_000 }],
    }
    const host = document.createElement('div')
    document.body.append(host)
    const ui = attachPlayerUi(player as unknown as MXPlayer, host)
    const root = host.querySelector<HTMLElement>('.mxp-player-ui')!
    // One continuous fill to the current position: the `played` islands must not fragment it.
    expect(root.style.getPropertyValue('--mxp-progress-pct')).toBe('10%')
    expect(host.querySelectorAll('.mxp-progress-played .mxp-progress-segment')).toHaveLength(0)
    const buffered = [...host.querySelectorAll<HTMLElement>('.mxp-progress-buffered .mxp-progress-segment')]
    expect(buffered).toHaveLength(2)
    expect(buffered[1]?.style.getPropertyValue('--mxp-range-start')).toBe('60%')
    expect(buffered[1]?.style.getPropertyValue('--mxp-range-width')).toBe('20.000000000000007%')
    ui.destroy()
  })

  it('follows the pointer while dragging and retires the local position once the SDK confirms', async () => {
    vi.useFakeTimers()
    const player = new FakePlayer()
    const host = document.createElement('div')
    document.body.append(host)
    const ui = attachPlayerUi(player as unknown as MXPlayer, host)
    const root = host.querySelector<HTMLElement>('.mxp-player-ui')!
    const rail = host.querySelector<HTMLElement>('.mxp-progress-wrap')!
    rail.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 12, width: 200, height: 12, toJSON: () => ({}) })
    rail.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 4, clientX: 150, bubbles: true }))
    // The fill jumps to the pointer immediately, before any snapshot has come back.
    expect(root.style.getPropertyValue('--mxp-progress-pct')).toBe('75%')
    rail.dispatchEvent(new PointerEvent('pointerup', { pointerId: 4, clientX: 150, bubbles: true }))
    await vi.runAllTimersAsync()
    expect(player.seek).toHaveBeenCalledWith(75_000_000)
    player.playback = { ...player.playback, currentTime: 75_000_000 }
    player.emit('playbackchange', { snapshot: player.playback, reason: 'time' })
    expect(root.style.getPropertyValue('--mxp-progress-pct')).toBe('75%')
    // An unanswered seek must not strand the rail away from the real position.
    rail.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 5, clientX: 20, bubbles: true }))
    rail.dispatchEvent(new PointerEvent('pointerup', { pointerId: 5, clientX: 20, bubbles: true }))
    expect(root.style.getPropertyValue('--mxp-progress-pct')).toBe('10%')
    await vi.advanceTimersByTimeAsync(1_500)
    expect(root.style.getPropertyValue('--mxp-progress-pct')).toBe('75%')
    ui.destroy()
  })

  it('routes volume, mute, keyboard seek, and unknown duration safely', async () => {
    vi.useFakeTimers()
    const player = new FakePlayer()
    const host = document.createElement('div')
    document.body.append(host)
    const ui = attachPlayerUi(player as unknown as MXPlayer, host)
    host.querySelector<HTMLButtonElement>('[data-mxp-action="mute"]')!.click()
    const volume = host.querySelector<HTMLInputElement>('.mxp-volume-slider')!
    volume.value = '0.4'; volume.dispatchEvent(new Event('input', { bubbles: true }))
    const root = host.querySelector<HTMLElement>('.mxp-player-ui')!
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await vi.runAllTimersAsync()
    expect(player.setMuted).toHaveBeenCalledWith(true)
    expect(player.setVolume).toHaveBeenCalledWith(0.4)
    expect(player.seek).toHaveBeenCalledWith(15_000_000)
    player.playback = { ...player.playback, duration: null, currentTime: null, played: [], buffered: [] }
    player.emit('playbackchange', { snapshot: player.playback, reason: 'time' })
    expect(host.querySelector('.mxp-time-readout')?.textContent).toContain('Live')
    expect(host.querySelector<HTMLInputElement>('.mxp-progress-input')?.disabled).toBe(true)
    ui.destroy()
  })

  it('supports scoped shortcuts and ignores controls and open overlays', async () => {
    const player = new FakePlayer()
    player.selectedSubtitleTrack = 'en'
    const host = document.createElement('div')
    document.body.append(host)
    const ui = attachPlayerUi(player as unknown as MXPlayer, host)
    const root = host.querySelector<HTMLElement>('.mxp-player-ui')!
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(player.setVolume).toHaveBeenNthCalledWith(1, 0.9)
    expect(player.setVolume).toHaveBeenNthCalledWith(2, 0.7000000000000001)
    expect(player.setMuted).toHaveBeenCalledWith(true)
    expect(player.requestFullscreen).toHaveBeenCalledOnce()
    expect(player.selectSubtitleTrack).toHaveBeenCalledWith(null)
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(player.selectSubtitleTrack).toHaveBeenLastCalledWith('en')

    const mute = host.querySelector<HTMLButtonElement>('[data-mxp-action="mute"]')!
    mute.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
    expect(player.play).not.toHaveBeenCalled()
    host.querySelector<HTMLButtonElement>('[data-mxp-action="settings"]')!.click()
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))
    expect(player.setMuted).toHaveBeenCalledTimes(1)
    ui.destroy()
  })

  it('keeps one main overlay, hands over to the subtitle popup, and restores focus', () => {
    const player = new FakePlayer()
    const host = document.createElement('div')
    const outside = document.createElement('button')
    document.body.append(host, outside)
    const ui = attachPlayerUi(player as unknown as MXPlayer, host)
    const settings = host.querySelector<HTMLButtonElement>('[data-mxp-action="settings"]')!
    settings.focus(); settings.click()
    expect(host.querySelectorAll('.mxp-overlay-backdrop')).toHaveLength(1)
    expect(document.activeElement).toBe(host.querySelector<HTMLButtonElement>('[data-mxp-action="close"]'))
    const subtitles = host.querySelector<HTMLButtonElement>('[data-mxp-action="subtitles"]')!
    subtitles.click()
    // The subtitle popup is anchored chrome, not a modal: the settings overlay steps aside.
    expect(host.querySelector('.mxp-overlay-backdrop')).toBeNull()
    expect(host.querySelectorAll('.mxp-subtitle-menu')).toHaveLength(1)
    const focused = document.activeElement as HTMLElement
    focused.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(host.querySelector('.mxp-subtitle-menu')).toBeNull()
    expect(document.activeElement).toBe(subtitles)
    settings.focus(); settings.click()
    outside.focus()
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(host.querySelector('.mxp-overlay-backdrop')).toBeNull()
    expect(document.activeElement).toBe(settings)
    ui.destroy()
  })

  it('closes overlays on outside pointerdown and only auto-hides while playing', async () => {
    vi.useFakeTimers()
    const player = new FakePlayer()
    player.playback = { ...player.playback, state: 'playing', paused: false }
    const host = document.createElement('div')
    const outside = document.createElement('button')
    document.body.append(host, outside)
    const ui = attachPlayerUi(player as unknown as MXPlayer, host, { autoHideDelayMs: 500 })
    const root = host.querySelector<HTMLElement>('.mxp-player-ui')!
    await vi.advanceTimersByTimeAsync(500)
    expect(root.dataset.mxpVisible).toBe('false')
    root.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
    expect(root.dataset.mxpVisible).toBe('true')
    const settings = host.querySelector<HTMLButtonElement>('[data-mxp-action="settings"]')!
    settings.focus()
    root.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(500)
    expect(root.dataset.mxpVisible).toBe('true')
    outside.focus()
    await vi.advanceTimersByTimeAsync(500)
    expect(root.dataset.mxpVisible).toBe('false')
    settings.click()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(root.dataset.mxpVisible).toBe('true')
    player.playback = { ...player.playback, sessionEpoch: 2 }
    player.emit('playbackchange', { snapshot: player.playback, reason: 'load' })
    await vi.advanceTimersByTimeAsync(500)
    expect(root.dataset.mxpVisible).toBe('false')
    settings.click()
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(host.querySelector('.mxp-overlay-backdrop')).toBeNull()
    ui.destroy()
  })

  it('locks the chrome away where the player owns the screen and lets Escape out again', async () => {
    vi.useFakeTimers()
    const player = new FakePlayer()
    player.playback = { ...player.playback, state: 'playing', paused: false }
    const host = document.createElement('div')
    document.body.append(host)
    let theater = false
    const listeners = new Set<(active: boolean) => void>()
    const ui = attachPlayerUi(player as unknown as MXPlayer, host, {
      features: { theater: true },
      theaterMode: {
        getState: (): boolean => theater,
        setState: (active: boolean): void => { theater = active; for (const listener of listeners) listener(active) },
        subscribe: (listener: (active: boolean) => void): (() => void) => { listeners.add(listener); return (): void => { listeners.delete(listener) } },
      },
    })
    const root = host.querySelector<HTMLElement>('.mxp-player-ui')!
    const lock = host.querySelector<HTMLButtonElement>('[data-mxp-action="lock"]')!
    // Windowed playback keeps the escape hatch of the surrounding page, so no lock is offered.
    expect(lock.hidden).toBe(true)
    host.querySelector<HTMLButtonElement>('[data-mxp-action="theater"]')!.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(lock.hidden).toBe(false)
    expect(lock.getAttribute('aria-label')).toBe('Lock controls')

    lock.click()
    expect(root.dataset.mxpLocked).toBe('true')
    expect(root.dataset.mxpVisible).toBe('false')
    expect(lock.getAttribute('aria-label')).toBe('Unlock controls')
    root.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
    expect(player.play).not.toHaveBeenCalled()
    // The affordance itself fades out, and the cursor goes with it.
    expect(root.dataset.mxpLockChrome).toBe('true')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(root.dataset.mxpLockChrome).toBe('false')
    expect(host.dataset.mxpCursor).toBe('hidden')
    host.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    expect(root.dataset.mxpLockChrome).toBe('true')
    expect(host.dataset.mxpCursor).toBeUndefined()

    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(root.dataset.mxpLocked).toBe('false')
    expect(root.dataset.mxpVisible).toBe('true')
    ui.destroy()
  })

  it('pauses a playing subtitle session and resumes only in the same session', async () => {
    const player = new FakePlayer()
    player.playback = { ...player.playback, state: 'playing', paused: false }
    player.pause.mockImplementation((): void => {
      player.playback = { ...player.playback, state: 'paused', paused: true }
      player.emit('playbackchange', { snapshot: player.playback, reason: 'state' })
    })
    const host = document.createElement('div')
    document.body.append(host)
    const ui = attachPlayerUi(player as unknown as MXPlayer, host)
    host.querySelector<HTMLButtonElement>('[data-mxp-action="subtitles"]')!.click()
    expect(player.pause).toHaveBeenCalledOnce()
    host.querySelector<HTMLElement>('.mxp-player-ui')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await Promise.resolve()
    expect(player.play).toHaveBeenCalledOnce()

    player.play.mockClear()
    player.playback = { ...player.playback, sessionEpoch: 2, state: 'playing', paused: false }
    player.emit('playbackchange', { snapshot: player.playback, reason: 'load' })
    host.querySelector<HTMLButtonElement>('[data-mxp-action="subtitles"]')!.click()
    player.playback = { ...player.playback, sessionEpoch: 3, state: 'ready', paused: true }
    player.emit('playbackchange', { snapshot: player.playback, reason: 'load' })
    await Promise.resolve()
    expect(player.play).not.toHaveBeenCalled()
    ui.destroy()
  })

  it('disables unsupported presentation and preview features without invoking them', async () => {
    vi.useFakeTimers()
    const player = new FakePlayer()
    player.playback = {
      ...player.playback,
      capabilities: { ...player.playback.capabilities, fullscreen: false, pictureInPicture: false, preview: false },
    }
    const host = document.createElement('div')
    document.body.append(host)
    const ui = attachPlayerUi(player as unknown as MXPlayer, host)
    const fullscreen = host.querySelector<HTMLButtonElement>('[data-mxp-action="fullscreen"]')!
    const pip = host.querySelector<HTMLButtonElement>('[data-mxp-action="pip"]')!
    expect(fullscreen.disabled).toBe(true)
    expect(pip.disabled).toBe(true)
    fullscreen.click(); pip.click()
    const rail = host.querySelector<HTMLElement>('.mxp-progress-wrap')!
    rail.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 1, bubbles: true }))
    await vi.advanceTimersByTimeAsync(200)
    expect(player.requestFullscreen).not.toHaveBeenCalled()
    expect(player.requestPictureInPicture).not.toHaveBeenCalled()
    expect(player.requestPreview).not.toHaveBeenCalled()
    ui.destroy()
  })

  it('uses Phase 8 subtitle commands without parsing or persistence logic', async () => {
    const player = new FakePlayer()
    const host = document.createElement('div')
    document.body.append(host)
    const ui = attachPlayerUi(player as unknown as MXPlayer, host)
    const openSubtitles = (): HTMLElement => {
      host.querySelector<HTMLButtonElement>('[data-mxp-action="subtitles"]')!.click()
      return host.querySelector<HTMLElement>('.mxp-subtitle-menu')!
    }
    const track = openSubtitles().querySelector<HTMLButtonElement>('.mxp-subtitle-track[data-mxp-selected="false"]')!
    expect(track.textContent).toContain('Local file - ready')
    track.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(player.selectSubtitleTrack).toHaveBeenCalledWith('en')
    // Picking a track dismisses the popup, as in MX-Player-Pro.
    expect(host.querySelector('.mxp-subtitle-menu')).toBeNull()

    const fontMenu = openSubtitles()
    fontMenu.querySelector<HTMLButtonElement>('.mxp-subtitle-tab[data-mxp-page="font"]')!.click()
    const fonts = [...host.querySelectorAll<HTMLButtonElement>('.mxp-subtitle-font')]
    expect(fonts).toHaveLength(6)
    fonts[1]?.click()
    expect(player.setSubtitleStyle).toHaveBeenCalledWith(expect.objectContaining({ fontFamily: expect.stringContaining('Noto Sans SC') }))

    host.querySelector<HTMLButtonElement>('.mxp-subtitle-tab[data-mxp-page="style"]')!.click()
    const size = [...host.querySelectorAll<HTMLInputElement>('.mxp-style-slider')].find((input) => input.getAttribute('aria-label') === 'Font size')!
    size.value = '44'; size.dispatchEvent(new Event('input', { bubbles: true }))
    expect(player.setSubtitleStyle).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 44 }))
    const alignment = host.querySelector<HTMLSelectElement>('select[aria-label="Alignment"]')!
    alignment.value = 'top-left'; alignment.dispatchEvent(new Event('change', { bubbles: true }))
    const outline = [...host.querySelectorAll<HTMLInputElement>('.mxp-style-slider')].find((input) => input.getAttribute('aria-label') === 'Outline width')!
    outline.value = '4'; outline.dispatchEvent(new Event('input', { bubbles: true }))
    const bold = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) => input.parentElement?.textContent === 'Bold')!
    bold.checked = true; bold.dispatchEvent(new Event('change', { bubbles: true }))
    expect(player.setSubtitleStyle).toHaveBeenCalledWith(expect.objectContaining({ alignment: 'top-left' }))
    expect(player.setSubtitleStyle).toHaveBeenCalledWith(expect.objectContaining({ outlineWidth: 4 }))
    expect(player.setSubtitleStyle).toHaveBeenCalledWith(expect.objectContaining({ bold: true }))
    ui.destroy()
  })

  it('moves the subtitle vertically only and resizes it proportionally from the box centre', () => {
    const player = new FakePlayer()
    const host = document.createElement('div')
    document.body.append(host)
    const ui = attachPlayerUi(player as unknown as MXPlayer, host)
    host.querySelector<HTMLButtonElement>('[data-mxp-action="subtitles"]')!.click()
    host.querySelector<HTMLButtonElement>('[data-mxp-action="subtitle-edit"]')!.click()
    expect(host.querySelector('.mxp-subtitle-edit-bar')).not.toBeNull()
    const root = host.querySelector<HTMLElement>('.mxp-player-ui')!
    root.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, toJSON: () => ({}) })
    const guide = host.querySelector<HTMLElement>('[data-mxp-guide="true"]')!
    // A 900 px sideways drag must not move the line: it stays on the axis the style already sets.
    guide.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 50, bubbles: true }))
    guide.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 1_000, clientY: -1_000, bubbles: true }))
    guide.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 1_000, clientY: -1_000, bubbles: true }))
    expect(player.setSubtitleStyle).toHaveBeenLastCalledWith(expect.objectContaining({ x: 50, y: 8 }))

    // Both handles read the pointer's distance from the guide centre, so either edge dragged to
    // twice its grab distance doubles the size.
    guide.getBoundingClientRect = () => ({ x: 0, y: 60, left: 0, top: 60, right: 200, bottom: 100, width: 200, height: 40, toJSON: () => ({}) })
    const top = guide.querySelector<HTMLElement>('[data-mxp-edge="top"]')!
    top.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientY: 60, bubbles: true }))
    top.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientY: 40, bubbles: true }))
    top.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientY: 40, bubbles: true }))
    expect(player.setSubtitleStyle).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 72 }))
    player.subtitleStyle = { ...player.subtitleStyle, fontSize: 36 }
    const bottom = guide.querySelector<HTMLElement>('[data-mxp-edge="bottom"]')!
    bottom.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, clientY: 100, bubbles: true }))
    bottom.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, clientY: 120, bubbles: true }))
    bottom.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, clientY: 120, bubbles: true }))
    expect(player.setSubtitleStyle).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 72 }))
    // Dragging an edge onto the centre shrinks to the floor rather than dividing by zero.
    player.subtitleStyle = { ...player.subtitleStyle, fontSize: 36 }
    bottom.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 4, clientY: 100, bubbles: true }))
    bottom.dispatchEvent(new PointerEvent('pointermove', { pointerId: 4, clientY: 80, bubbles: true }))
    bottom.dispatchEvent(new PointerEvent('pointerup', { pointerId: 4, clientY: 80, bubbles: true }))
    expect(player.setSubtitleStyle).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 6 }))

    // Finishing leaves the popup up but takes the drag affordances away.
    host.querySelector<HTMLButtonElement>('[data-mxp-action="subtitle-edit-done"]')!.click()
    expect(host.querySelector('[data-mxp-guide="true"]')).toBeNull()
    expect(host.querySelector('.mxp-subtitle-edit-bar')).toBeNull()
    expect(host.querySelector('.mxp-subtitle-menu')).not.toBeNull()
    ui.destroy()
  })

  it('debounces previews, cancels on source replacement, and degrades when unsupported', async () => {
    vi.useFakeTimers()
    const player = new FakePlayer()
    player.requestPreview = vi.fn(async (): Promise<MediaPreviewImage | null> => null)
    const host = document.createElement('div')
    document.body.append(host)
    const ui = attachPlayerUi(player as unknown as MXPlayer, host)
    const root = host.querySelector<HTMLElement>('.mxp-player-ui')!
    root.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, toJSON: () => ({}) })
    const rail = host.querySelector<HTMLElement>('.mxp-progress-wrap')!
    rail.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 24, width: 200, height: 24, toJSON: () => ({}) })
    rail.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', pointerId: 1, clientX: 100, bubbles: true }))
    await vi.advanceTimersByTimeAsync(99)
    expect(player.requestPreview).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(player.requestPreview).toHaveBeenCalledWith(expect.objectContaining({ time: 50_000_000, width: 160, height: 90, signal: expect.any(AbortSignal) }))
    rail.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', pointerId: 1, clientX: 0, bubbles: true }))
    expect(host.querySelector<HTMLElement>('.mxp-preview')?.style.getPropertyValue('--mxp-preview-left')).toBe('81px')

    player.playback = { ...player.playback, sessionEpoch: 2, capabilities: { ...player.playback.capabilities, preview: false } }
    player.emit('playbackchange', { snapshot: player.playback, reason: 'load' })
    rail.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', pointerId: 2, clientX: 50, bubbles: true }))
    await vi.advanceTimersByTimeAsync(200)
    expect(player.requestPreview).toHaveBeenCalledTimes(1)
    ui.destroy()
  })

  it('removes listeners and rejects late DOM work after destroy', async () => {
    vi.useFakeTimers()
    const player = new FakePlayer()
    const host = document.createElement('div')
    document.body.append(host)
    const ui = attachPlayerUi(player as unknown as MXPlayer, host)
    expect(player.listenerCount('playbackchange')).toBe(1)
    const rail = host.querySelector<HTMLElement>('.mxp-progress-wrap')!
    rail.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 24, width: 200, height: 24, toJSON: () => ({}) })
    const removeListener = vi.spyOn(rail, 'removeEventListener')
    rail.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, clientX: 100, bubbles: true }))
    ui.destroy()
    expect(player.listenerCount('playbackchange')).toBe(0)
    expect(removeListener).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeListener).toHaveBeenCalledWith('pointerup', expect.any(Function))
    expect(removeListener).toHaveBeenCalledWith('pointercancel', expect.any(Function))
    await vi.runAllTimersAsync()
    expect(player.seek).not.toHaveBeenCalled()
    player.playback = { ...player.playback, state: 'error', lastError: { code: 'LATE', recoverable: false } }
    player.emit('playbackchange', { snapshot: player.playback, reason: 'error' })
    expect(host.querySelector('.mxp-player-ui')).toBeNull()
  })

  it('throws stable errors for invalid lifecycle calls', () => {
    const player = new FakePlayer()
    expect(() => createPlayerUi(player as unknown as MXPlayer, { autoHideDelayMs: 100 })).toThrowError(expect.objectContaining({ code: UiErrorCodes.UI_INVALID_OPTIONS }))
    const ui = createPlayerUi(player as unknown as MXPlayer)
    expect(() => ui.attach(null as unknown as HTMLElement)).toThrowError(expect.objectContaining({ code: UiErrorCodes.UI_INVALID_CONTAINER }))
  })
})
