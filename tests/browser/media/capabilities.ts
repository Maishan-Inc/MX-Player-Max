import type { Page } from '@playwright/test'

/**
 * Browser capability probes for the media acceptance cases.
 *
 * Every case in this directory drives the real engine against a real fixture, so a browser that
 * cannot decode the fixture at all has to skip rather than fail. The trap is picking the wrong
 * question to ask. Two shapes have already burned this suite:
 *
 * - Skipping on the acceptance harness's own `status === 'unsupported'` forgives whatever the
 *   engine happened to report, and a regression reports exactly those codes. The VP9 derivation
 *   and the broken AudioWorklet asset both first presented as tests skipping instead of turning
 *   red, which is why these probes ask the browser instead of the result.
 * - Asking `canPlayType` is not asking the browser. Playwright's WebKit answers `probably` for
 *   every type put to it -- `video/x-matroska`, HEVC, even a bare `vp09` -- and its media element
 *   then refuses or stalls on most of those files. A native-route probe therefore has to decode:
 *   load the very fixture the case plays into a bare media element and require decoded video out
 *   of the other side.
 */

/**
 * A browser that is merely slow must never be read as one that cannot decode, so this sits far
 * above the slowest real load measured here (Firefox, Matroska VP8/Opus, 631 ms). The browsers
 * that cannot play a fixture answer with an `error` event inside 1.5 s; the one case that neither
 * loads nor errors is Playwright WebKit on Matroska, and no timeout would rescue it.
 */
const NATIVE_PROBE_TIMEOUT_MS = 15_000
/** An audio context with no output device neither resolves nor rejects `resume()`, so bound it. */
const AUDIO_PROBE_TIMEOUT_MS = 2_000

export interface WebCodecsRequirement {
  /** RFC 6381 codec string, as the demuxer would publish it for the fixture. */
  readonly video: string
  /** Omitted for the video-only fixtures, whose cases never touch `AudioDecoder`. */
  readonly audio?: string
}

/**
 * Whether the media element can actually produce decoded video for a corpus fixture.
 *
 * `videoWidth` is part of the answer, not decoration: Chromium reaches `readyState 4` on the HEVC
 * sample while silently dropping the video track, and reports a zero width when it does.
 */
export async function playsNatively(page: Page, sample: string): Promise<boolean> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  return page.evaluate(async ([url, timeoutMs]) => {
    const element = document.createElement('video')
    element.muted = true
    element.preload = 'auto'
    element.crossOrigin = 'anonymous'
    element.src = url
    try {
      const loaded = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs)
        const settle = (value: boolean): void => { clearTimeout(timer); resolve(value) }
        element.addEventListener('loadeddata', () => settle(true), { once: true })
        element.addEventListener('error', () => settle(false), { once: true })
        element.load()
      })
      return loaded && element.videoWidth > 0 && element.videoHeight > 0
    } finally {
      element.removeAttribute('src')
      element.load()
    }
  }, [`/quality-media/${sample}`, NATIVE_PROBE_TIMEOUT_MS] as const)
}

/**
 * Whether the browser's own WebCodecs implementation accepts the codecs a custom-pipeline case
 * needs. The API being absent entirely counts as a no: Playwright's WebKit ships no `VideoDecoder`
 * at all, so every custom route there is a browser gap rather than an engine defect.
 */
export async function decodesWithWebCodecs(page: Page, requirement: WebCodecsRequirement): Promise<boolean> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  return page.evaluate(async ({ video, audio }: WebCodecsRequirement) => {
    if (typeof VideoDecoder === 'undefined') return false
    try {
      if ((await VideoDecoder.isConfigSupported({ codec: video, codedWidth: 320, codedHeight: 180 })).supported !== true) return false
    } catch { return false }
    if (audio === undefined) return true
    if (typeof AudioDecoder === 'undefined') return false
    try {
      return (await AudioDecoder.isConfigSupported({ codec: audio, sampleRate: 48_000, numberOfChannels: 2 })).supported === true
    } catch { return false }
  }, requirement)
}

/**
 * Whether the browser implements WebCodecs at all, as opposed to accepting a particular codec.
 *
 * Two kinds of case need this rather than a codec probe. The WASM fallback case needs it because
 * libvpx decodes into linear memory and then wraps the planes in a `VideoFrame`, and because that
 * fallback only ranks once a WebCodecs candidate has been built and rejected -- which is the thing
 * the case asserts. The HEVC refusal case needs it because a browser with no WebCodecs refuses HEVC
 * for a reason that has nothing to do with the engine's own codec scope, so the case would be
 * asserting a coincidence.
 */
export async function hasWebCodecs(page: Page): Promise<boolean> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  return page.evaluate(() => typeof VideoDecoder !== 'undefined'
    && typeof AudioDecoder !== 'undefined'
    && typeof VideoFrame !== 'undefined')
}

/**
 * Whether the browser can actually render audio. A machine with no audio output device leaves an
 * `AudioContext` permanently `suspended`, and `resume()` there neither resolves nor rejects, so the
 * bounded race below is the only way to ask. The custom pipeline gates its video pump on the audio
 * clock, so on such a box no custom session with an audio track can ever reach `playing`.
 *
 * The bound stays short on purpose. On this workspace Firefox is bimodal about it: measured over one
 * session, `resume()` resolved within 1 ms in five consecutive launches and then failed to settle
 * inside 25 s in three consecutive launches, with nothing observable changing in between. Since the
 * failing mode never settles at all, a longer bound buys no accuracy and only costs the run time.
 *
 * Playwright's WebKit has no `AudioContext` constructor at all -- not even the `webkit`-prefixed
 * one -- so the construction is inside the guard. It used to sit outside, and the resulting
 * `ReferenceError` escaped the evaluate and failed four cases instead of skipping them.
 */
export async function rendersAudio(page: Page): Promise<boolean> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  return page.evaluate(async (timeoutMs) => {
    if (typeof AudioContext === 'undefined') return false
    let context: AudioContext
    try { context = new AudioContext() } catch { return false }
    try {
      await Promise.race([context.resume().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, timeoutMs))])
      return context.state === 'running'
    } catch { return false } finally { void context.close().catch(() => undefined) }
  }, AUDIO_PROBE_TIMEOUT_MS)
}
