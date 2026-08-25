import { MXPlayer } from '@mx-player-max/sdk'

export interface RenderSwitchResult {
  readonly status: 'passed' | 'failed' | 'unsupported'
  /** Backend and renderer on either side of the switch, which is the switch itself made observable. */
  readonly beforeBackend: string | null
  readonly beforeRenderer: string | null
  readonly afterBackend: string | null
  readonly afterRenderer: string | null
  readonly beforeSurface: 'video' | 'canvas' | null
  readonly afterSurface: 'video' | 'canvas' | null
  readonly beforeEpoch: number
  readonly afterEpoch: number
  readonly beforeTime: number
  readonly afterTime: number
  readonly afterState: string | null
  readonly nonEmptyPixels: number
  readonly subtitleTrackIds: readonly string[]
  readonly selectedSubtitleTrackId: string | null
  readonly errorCode: string | null
}

declare global {
  interface Window { __renderSwitch?: RenderSwitchResult }
}

const SAMPLE = '/quality-media/webm-vp8-p0-8bit-video-only.webm'
/** Matches the media acceptance harness: a GPU-less box needs far more than the shipped default. */
const OPERATION_TIMEOUT_MS = 30_000
const WAIT_MS = 25_000
/** A browser that cannot run the custom path at all has nothing to switch to. */
const CAPABILITY_CODES = new Set([
  'NATIVE_NOT_SUPPORTED',
  'CUSTOM_BACKEND_UNAVAILABLE',
  'WEBCODECS_NOT_SUPPORTED',
  'WEBCODECS_AUDIO_NOT_SUPPORTED',
  'STRATEGY_NO_VIABLE_BACKEND',
])

export async function runRenderSwitchAcceptance(): Promise<void> {
  const root = document.getElementById('root')
  if (!root) throw new Error('RENDER_SWITCH_ROOT_MISSING')
  root.innerHTML = '<main><button id="switch-start" type="button">Start render switch</button><div id="switch-host" style="width:320px;height:180px"></div></main>'
  const button = document.getElementById('switch-start')
  const host = document.getElementById('switch-host')
  if (!(button instanceof HTMLButtonElement) || !(host instanceof HTMLElement)) throw new Error('RENDER_SWITCH_TARGET_MISSING')
  document.body.dataset.status = 'waiting'
  button.addEventListener('click', () => { void execute(host) }, { once: true })
}

async function execute(host: HTMLElement): Promise<void> {
  document.body.dataset.status = 'running'
  let player: MXPlayer | null = null
  let before = { backend: null as string | null, renderer: null as string | null, surface: null as 'video' | 'canvas' | null, epoch: 0, time: 0 }
  try {
    /**
     * A video-only sample on purpose. The custom pipeline gates its video pump on the audio clock,
     * and a machine with no audio output device can never start one, so a sample with sound would
     * make this case untestable in exactly the environments that most need the coverage.
     */
    player = new MXPlayer({
      target: host,
      source: { kind: 'url', url: new URL(SAMPLE, location.href).href },
      intent: 'normal',
      native: { preload: 'auto', crossOrigin: 'anonymous' },
      customVideo: { renderer: 'canvas2d', maxDecodedFrames: 6, maxDecodeQueueSize: 6, operationTimeoutMs: OPERATION_TIMEOUT_MS },
      customAudio: { operationTimeoutMs: OPERATION_TIMEOUT_MS },
      subtitles: { enabled: true },
    })
    await player.ready

    const subtitleText = await fetch('/quality-subtitles/basic-timing.srt').then((response) => response.text())
    const track = await player.addSubtitleTrack({ kind: 'file', file: new File([subtitleText], 'basic-timing.srt', { type: 'text/plain' }), format: 'srt' })
    await player.selectSubtitleTrack(track.id)

    await player.play()
    await waitFor('native-position', () => (player?.playback.currentTime ?? 0) >= 500_000)
    before = {
      backend: player.selection?.backend.kind ?? null,
      renderer: player.rendererKind,
      surface: surfaceKind(host),
      epoch: player.playback.sessionEpoch,
      time: player.playback.currentTime ?? 0,
    }

    // The switch under test: no second load() from the host.
    await player.switchRenderMode({ pipeline: 'custom' })
    await waitFor('custom-position', () => (player?.playback.currentTime ?? 0) >= before.time)

    /**
     * The position advancing only proves the clock moved; the first frame can still be in flight.
     * Poll until the canvas has content so a zero here means "never drew", not "not drawn yet".
     */
    let pixels = 0
    await waitFor('custom-pixels', () => {
      pixels = countPixels(host.querySelector('canvas,video'))
      return pixels > 100
    })
    window.__renderSwitch = {
      status: 'passed',
      beforeBackend: before.backend, beforeRenderer: before.renderer, beforeSurface: before.surface,
      afterBackend: player.selection?.backend.kind ?? null, afterRenderer: player.rendererKind, afterSurface: surfaceKind(host),
      beforeEpoch: before.epoch, afterEpoch: player.playback.sessionEpoch,
      beforeTime: before.time, afterTime: player.playback.currentTime ?? 0,
      afterState: player.playback.state,
      nonEmptyPixels: pixels,
      subtitleTrackIds: player.listSubtitleTracks().map((entry) => entry.id),
      selectedSubtitleTrackId: player.selectedSubtitleTrack,
      errorCode: null,
    }
    document.body.dataset.status = 'passed'
  } catch (cause) {
    const code = typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : 'RENDER_SWITCH_FAILED'
    window.__renderSwitch = {
      status: CAPABILITY_CODES.has(code) ? 'unsupported' : 'failed',
      beforeBackend: before.backend, beforeRenderer: before.renderer, beforeSurface: before.surface,
      afterBackend: player?.selection?.backend.kind ?? null, afterRenderer: player?.rendererKind ?? null, afterSurface: surfaceKind(host),
      beforeEpoch: before.epoch, afterEpoch: player?.playback.sessionEpoch ?? 0,
      beforeTime: before.time, afterTime: player?.playback.currentTime ?? 0,
      afterState: player?.playback.state ?? null,
      nonEmptyPixels: 0,
      subtitleTrackIds: player?.listSubtitleTracks().map((entry) => entry.id) ?? [],
      selectedSubtitleTrackId: player?.selectedSubtitleTrack ?? null,
      errorCode: code,
    }
    document.body.dataset.status = window.__renderSwitch.status
  } finally {
    player?.destroy()
  }
}

function surfaceKind(host: HTMLElement): 'video' | 'canvas' | null {
  const surface = host.querySelector('canvas,video')
  return surface instanceof HTMLCanvasElement ? 'canvas' : surface instanceof HTMLVideoElement ? 'video' : null
}

async function waitFor(step: string, predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + WAIT_MS
  while (!predicate()) {
    if (performance.now() >= deadline) throw Object.assign(new Error(step), { code: `RENDER_SWITCH_TIMEOUT_${step}` })
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function countPixels(surface: Element | null): number {
  if (!(surface instanceof HTMLCanvasElement) && !(surface instanceof HTMLVideoElement)) return 0
  const canvas = surface instanceof HTMLCanvasElement ? surface : document.createElement('canvas')
  if (surface instanceof HTMLVideoElement) {
    canvas.width = surface.videoWidth
    canvas.height = surface.videoHeight
    canvas.getContext('2d')?.drawImage(surface, 0, 0)
  }
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || canvas.width === 0) return 0
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data
  let count = 0
  for (let index = 0; index < data.length; index += 4) {
    if ((data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0) > 0) count += 1
  }
  return count
}
