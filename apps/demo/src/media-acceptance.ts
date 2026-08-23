import { MXPlayer } from '@mx-player-max/sdk'
import type { EngineEventName, Micros } from '@mx-player-max/types'

export interface MediaAcceptanceResult {
  readonly status: 'passed' | 'failed' | 'unsupported'
  readonly mode: string
  readonly backend: string | null
  readonly renderer: string | null
  readonly surface: 'video' | 'canvas' | null
  readonly nonEmptyPixels: number
  readonly meanLuma: number
  readonly coloredPixelRatio: number
  readonly events: readonly string[]
  readonly stateTransitions: readonly string[]
  readonly cueTimes: readonly number[]
  readonly currentTime: number
  readonly duration: number | null
  readonly bufferedAhead: number
  readonly presentedFrames: number
  readonly droppedFrames: number | null
  readonly epoch: number
  readonly width: number
  readonly height: number
  readonly initialWidth: number
  readonly initialHeight: number
  readonly cssWidth: number
  readonly cssHeight: number
  readonly devicePixelRatio: number
  readonly sourceChanges: number
  /**
   * `audio-context` proves the AudioWorklet module loaded and is driving the clock.
   * A worklet that fails to load takes the whole custom candidate down, so these two
   * fields are what distinguish "custom path works" from "custom path works silently".
   */
  readonly audioClockSource: 'audio-context' | 'wall-clock' | null
  readonly audioRenderedFrames: number
  /** The first code the engine reported, kept even when a scripted step timed out after it. */
  readonly engineErrorCode: string | null
  /** Per-candidate failure codes from the decision trace; empty when nothing was rejected. */
  readonly attemptErrorCodes: readonly string[]
  readonly errorCode: string | null
}

declare global {
  interface Window { __mediaAcceptance?: MediaAcceptanceResult }
}

const SAMPLE = '/quality-media/webm-vp8-p0-8bit-opus.webm'
const CUSTOM_SAMPLE = '/quality-media/webm-vp8-p0-8bit-video-only.webm'
const MP4_SAMPLE = '/quality-media/mp4-h264-baseline-8bit-aac.mp4'
const MKV_SAMPLE = '/quality-media/mkv-h264-baseline-8bit-aac.mkv'
const MKV_VP8_SAMPLE = '/quality-media/mkv-vp8-p0-8bit-opus.mkv'
/**
 * `webcodecs` runs a video-only sample, so it never touched the AudioWorklet and could
 * not catch a worklet asset that only breaks in a production build. `webcodecs-audio`
 * takes the same custom path with an Opus track for exactly that reason.
 *
 * The `mkv-*` modes are the Matroska coverage: the container had a demuxer but no fixture,
 * so nothing exercised it. `mkv-native` proves Chrome plays H.264/AAC in Matroska on the
 * media element, and the two custom modes prove the demuxer feeds WebCodecs with two
 * different codec pairs.
 */
const CUSTOM_MODES = new Set(['webcodecs', 'webcodecs-audio', 'mkv', 'mkv-vp8'])
/**
 * The engine defaults every worker, configure, flush and seek operation to a 10 s budget, which
 * suits a real machine. Firefox on a GPU-less CI box runs the custom path roughly 60% slower than
 * Chromium and intermittently blew that budget mid-script, surfacing as `WEBCODECS_WORKER_FAILED`
 * or `CUSTOM_SEEK_FAILED` — a timing artifact of the harness, not a decode defect. Raising it here
 * keeps the acceptance deterministic without touching the shipped default.
 */
const OPERATION_TIMEOUT_MS = 30_000
/** Codes that mean the browser genuinely cannot run the path, as opposed to a defect. */
const CAPABILITY_CODES = new Set([
  'NATIVE_NOT_SUPPORTED',
  'CUSTOM_BACKEND_UNAVAILABLE',
  'WEBCODECS_NOT_SUPPORTED',
  'WEBCODECS_AUDIO_NOT_SUPPORTED',
  'STRATEGY_NO_VIABLE_BACKEND',
])

export async function runMediaAcceptance(mode: string): Promise<void> {
  const root = document.getElementById('root')
  if (!root) throw new Error('MEDIA_ACCEPTANCE_ROOT_MISSING')
  root.innerHTML = '<main><button id="media-start" type="button">Start media acceptance</button><div id="media-host" style="width:320px;height:180px"></div></main>'
  const button = document.getElementById('media-start')
  const host = document.getElementById('media-host')
  if (!(button instanceof HTMLButtonElement) || !(host instanceof HTMLElement)) throw new Error('MEDIA_ACCEPTANCE_TARGET_MISSING')
  document.body.dataset.status = 'waiting'
  button.addEventListener('click', () => { void execute(mode, host) }, { once: true })
}

async function execute(mode: string, host: HTMLElement): Promise<void> {
  document.body.dataset.status = 'running'
  const events: string[] = []
  const stateTransitions: string[] = []
  const cueTimes: number[] = []
  /**
   * A scripted step that times out surfaces as `MEDIA_ACCEPTANCE_FAILED`, which says
   * nothing about why. The engine almost always reported a real code first, so keep it.
   */
  const engineErrors: string[] = []
  let sourceChanges = 0
  let observedEpoch = 0
  let player: MXPlayer | null = null
  try {
    const intent = CUSTOM_MODES.has(mode) ? 'frame-access' : 'normal'
    const fault = mode.startsWith('fault-') ? `?fault=${mode.slice('fault-'.length)}` : ''
    const sample = mode === 'webcodecs' ? CUSTOM_SAMPLE
      : mode === 'fault-corrupt' ? MP4_SAMPLE
      : mode === 'mkv-vp8' ? MKV_VP8_SAMPLE
      : mode === 'mkv' || mode === 'mkv-native' ? MKV_SAMPLE
      : SAMPLE
    player = new MXPlayer({
      target: host,
      source: { kind: 'url', url: new URL(`${sample}${fault}`, location.href).href },
      intent,
      native: { preload: 'auto', crossOrigin: 'anonymous' },
      customVideo: { renderer: 'canvas2d', maxDecodedFrames: 6, maxDecodeQueueSize: 6, operationTimeoutMs: OPERATION_TIMEOUT_MS },
      customAudio: { operationTimeoutMs: OPERATION_TIMEOUT_MS },
      subtitles: { enabled: true },
    })
    trackEvents(player, events, stateTransitions, cueTimes, engineErrors)
    await player.ready
    if (mode.startsWith('fault-')) throw new Error('FAULT_ROUTE_UNEXPECTEDLY_LOADED')
    const subtitleText = await fetch('/quality-subtitles/basic-timing.srt').then((response) => response.text())
    const subtitleFile = new File([subtitleText], 'basic-timing.srt', { type: 'text/plain' })
    const track = await player.addSubtitleTrack({ kind: 'file', file: subtitleFile, format: 'srt' })
    await player.selectSubtitleTrack(track.id)
    await player.play()
    await waitFor(() => player?.playback.currentTime !== null && (player?.playback.currentTime ?? 0) >= 500_000, 15_000)
    const cueTime = player.playback.currentTime ?? 0
    await waitFor(() => cueTimes.length > 0, 3_000)
    await player.pause()
    const paused = player.playback.currentTime
    await delay(150)
    if (Math.abs((player.playback.currentTime ?? 0) - (paused ?? 0)) > 100_000) throw new Error('PAUSE_DID_NOT_HOLD')
    await player.seek(1_500_000)
    await player.seek(700_000)
    observedEpoch = Math.max(observedEpoch, player.audioClock?.epoch ?? player.playback.sessionEpoch)
    await player.play()
    await waitFor(() => player?.playback.state === 'ended', 15_000)
    const initialSize = surfaceSize(host.querySelector('canvas,video'))
    await player.load({
      target: host,
      source: { kind: 'url', url: new URL(`${sample}?source=second`, location.href).href },
      intent,
      native: { preload: 'auto', crossOrigin: 'anonymous' },
      customVideo: { renderer: 'canvas2d', maxDecodedFrames: 6, maxDecodeQueueSize: 6, operationTimeoutMs: OPERATION_TIMEOUT_MS },
      customAudio: { operationTimeoutMs: OPERATION_TIMEOUT_MS },
      subtitles: { enabled: true },
    })
    sourceChanges += 1
    if (mode === 'webcodecs') player.setVideoTransform({ outputWidth: 240, outputHeight: 135, devicePixelRatio: 2 })
    await player.play()
    await waitFor(() => (player?.playback.currentTime ?? 0) >= 250_000, 10_000)
    player.pause()
    const surface = host.querySelector('canvas,video')
    if (surface instanceof HTMLVideoElement) { surface.style.width = '480px'; surface.style.height = '270px' }
    const pixels = await observePixels(surface)
    const size = surfaceSize(surface)
    const bounds = surface?.getBoundingClientRect()
    const stats = player.rendererStats
    window.__mediaAcceptance = {
      status: 'passed', mode, backend: player.selection?.backend.kind ?? null, renderer: player.rendererKind,
      surface: surface instanceof HTMLCanvasElement ? 'canvas' : surface instanceof HTMLVideoElement ? 'video' : null,
      nonEmptyPixels: pixels.nonEmptyPixels, meanLuma: pixels.meanLuma, coloredPixelRatio: pixels.coloredPixelRatio,
      events: [...new Set(events)], stateTransitions, cueTimes: cueTimes.length > 0 ? cueTimes : [cueTime],
      currentTime: player.playback.currentTime ?? 0, duration: player.playback.duration,
      bufferedAhead: player.playback.bufferedAhead,
      presentedFrames: stats?.presentedFrames ?? player.nativeStats?.presentedFrames ?? 0,
      droppedFrames: stats?.droppedFrames ?? player.nativeStats?.droppedFrames ?? null,
      epoch: Math.max(observedEpoch, player.audioClock?.epoch ?? player.playback.sessionEpoch),
      width: size.width, height: size.height, initialWidth: initialSize.width, initialHeight: initialSize.height,
      cssWidth: bounds?.width ?? 0, cssHeight: bounds?.height ?? 0, devicePixelRatio: stats?.devicePixelRatio ?? devicePixelRatio,
      sourceChanges,
      audioClockSource: player.audioClock?.source ?? null,
      audioRenderedFrames: player.audioClock?.renderedFrames ?? 0,
      engineErrorCode: engineErrors[0] ?? null,
      attemptErrorCodes: attemptErrors(player),
      errorCode: null,
    }
    document.body.dataset.status = 'passed'
  } catch (cause) {
    const code = errorCode(cause)
    const attemptErrorCodes = attemptErrors(player)
    /**
     * `STRATEGY_ALL_CANDIDATES_FAILED` is the engine's summary code, so on its own it
     * cannot tell a missing browser capability from a broken asset. Classifying it as
     * `unsupported` unconditionally let a broken AudioWorklet asset skip its own test, so
     * defer to the per-candidate codes and only forgive genuine capability gaps.
     */
    const unsupported = CAPABILITY_CODES.has(code)
      || code === 'STRATEGY_ALL_CANDIDATES_FAILED' && attemptErrorCodes.length > 0 && attemptErrorCodes.every((entry) => CAPABILITY_CODES.has(entry))
    const faultPassed = mode.startsWith('fault-') && code !== 'MEDIA_ACCEPTANCE_FAILED'
    window.__mediaAcceptance = {
      status: faultPassed ? 'passed' : unsupported ? 'unsupported' : 'failed',
      mode, backend: player?.selection?.backend.kind ?? null, renderer: player?.rendererKind ?? null, surface: null,
      nonEmptyPixels: 0, meanLuma: 0, coloredPixelRatio: 0, events: [...new Set(events)], stateTransitions, cueTimes,
      currentTime: player?.playback.currentTime ?? 0,
      duration: player?.playback.duration ?? null, bufferedAhead: player?.playback.bufferedAhead ?? 0,
      presentedFrames: player?.rendererStats?.presentedFrames ?? player?.nativeStats?.presentedFrames ?? 0,
      droppedFrames: player?.rendererStats?.droppedFrames ?? player?.nativeStats?.droppedFrames ?? null,
      epoch: player?.audioClock?.epoch ?? player?.playback.sessionEpoch ?? 0, width: 0, height: 0,
      initialWidth: 0, initialHeight: 0, cssWidth: 0, cssHeight: 0, devicePixelRatio, sourceChanges,
      audioClockSource: player?.audioClock?.source ?? null,
      audioRenderedFrames: player?.audioClock?.renderedFrames ?? 0,
      engineErrorCode: engineErrors[0] ?? null,
      attemptErrorCodes,
      errorCode: code,
    }
    document.body.dataset.status = window.__mediaAcceptance.status
  }
}

function trackEvents(player: MXPlayer, events: string[], stateTransitions: string[], cueTimes: number[], engineErrors: string[]): void {
  const names: readonly EngineEventName[] = ['ready', 'statechange', 'timeupdate', 'buffering', 'backendchange', 'subtitlecuechange', 'playbackchange', 'error']
  for (const name of names) player.on(name, (payload) => {
    events.push(name)
    if (name === 'statechange' && 'current' in payload && typeof payload.current === 'string') stateTransitions.push(payload.current)
    if (name === 'subtitlecuechange' && 'cues' in payload && payload.cues.length > 0) cueTimes.push(payload.currentTime)
    if (name === 'error' && 'error' in payload && typeof payload.error.code === 'string') engineErrors.push(payload.error.code)
  })
}

async function observePixels(surface: Element | null): Promise<{ nonEmptyPixels: number; meanLuma: number; coloredPixelRatio: number }> {
  if (!(surface instanceof HTMLCanvasElement) && !(surface instanceof HTMLVideoElement)) return { nonEmptyPixels: 0, meanLuma: 0, coloredPixelRatio: 0 }
  const canvas = surface instanceof HTMLCanvasElement ? surface : document.createElement('canvas')
  if (surface instanceof HTMLVideoElement) {
    canvas.width = surface.videoWidth
    canvas.height = surface.videoHeight
    canvas.getContext('2d')?.drawImage(surface, 0, 0)
  }
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { nonEmptyPixels: 0, meanLuma: 0, coloredPixelRatio: 0 }
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data
  let count = 0
  let luma = 0
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] ?? 0
    const green = data[index + 1] ?? 0
    const blue = data[index + 2] ?? 0
    if (red + green + blue > 0) count += 1
    luma += red * 0.2126 + green * 0.7152 + blue * 0.0722
  }
  const pixels = Math.max(1, canvas.width * canvas.height)
  return { nonEmptyPixels: count, meanLuma: luma / pixels, coloredPixelRatio: count / pixels }
}

function surfaceSize(surface: Element | null): { width: number; height: number } {
  if (surface instanceof HTMLCanvasElement) return { width: surface.width, height: surface.height }
  if (surface instanceof HTMLVideoElement) return { width: surface.videoWidth, height: surface.videoHeight }
  return { width: 0, height: 0 }
}

function attemptErrors(player: MXPlayer | null): string[] {
  return (player?.decisionTrace?.attempts ?? [])
    .map((attempt) => attempt.errorCode)
    .filter((value): value is string => typeof value === 'string')
}

function errorCode(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string') return cause.code
  return 'MEDIA_ACCEPTANCE_FAILED'
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error('MEDIA_ACCEPTANCE_TIMEOUT')
    await delay(20)
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
