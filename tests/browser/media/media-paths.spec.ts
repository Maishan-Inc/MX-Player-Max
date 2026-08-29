import { expect, test, type Page } from '@playwright/test'
import { decodesWithWebCodecs, hasWebCodecs, playsNatively, rendersAudio } from './capabilities'

/**
 * Every case that needs a particular decode capability probes the browser for it and skips when the
 * answer is no, then asserts unconditionally. Skipping on the acceptance harness's own
 * `status === 'unsupported'` instead would forgive the very codes a regression reports -- see
 * `capabilities.ts` for the two times that has already happened here.
 */
test.describe('real media SDK paths', () => {
  test('plays Native video with pixels, lifecycle, subtitles, seek and source replacement', async ({ page }) => {
    test.skip(!await playsNatively(page, 'webm-vp8-p0-8bit-opus.webm'), `Native VP8/Opus unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'native')
    expect(result).toMatchObject({ status: 'passed', mode: 'native', backend: 'html-video', surface: 'video', errorCode: null, sourceChanges: 1 })
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
    expect(result.meanLuma).toBeGreaterThan(1)
    expect(result.events).toEqual(expect.arrayContaining(['ready', 'statechange', 'timeupdate', 'buffering', 'subtitlecuechange', 'playbackchange']))
    expect(result.stateTransitions).toEqual(expect.arrayContaining(['playing', 'paused', 'seeking', 'ended']))
    expect(result.cueTimes.some((time) => time >= 300_000 && time <= 1_400_000)).toBe(true)
    expect(result.currentTime).toBeGreaterThan(0)
    expect(result.duration ?? 0).toBeGreaterThan(2_000_000)
    expect(result.presentedFrames).toBeGreaterThan(0)
    expect(result.width).toBe(320)
    expect(result.height).toBe(180)
    expect(result.cssWidth).toBe(480)
    expect(result.cssHeight).toBe(270)
    expect(result.devicePixelRatio).toBeGreaterThan(0)
  })

  test('plays WebCodecs canvas and preserves surface metrics', async ({ page }) => {
    test.skip(!await decodesWithWebCodecs(page, { video: 'vp8' }), `WebCodecs VP8 unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'webcodecs')
    expect(result).toMatchObject({ status: 'passed', mode: 'webcodecs', backend: 'webcodecs', surface: 'canvas', renderer: 'canvas2d', errorCode: null, sourceChanges: 1 })
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
    expect(result.meanLuma).toBeGreaterThan(1)
    expect(result.events).toEqual(expect.arrayContaining(['ready', 'statechange', 'subtitlecuechange', 'playbackchange']))
    expect(result.stateTransitions).toEqual(expect.arrayContaining(['playing', 'paused', 'seeking', 'ended']))
    expect(result.epoch).toBeGreaterThanOrEqual(2)
    expect(result.presentedFrames).toBeGreaterThan(0)
    expect(result.initialWidth).toBe(320)
    expect(result.initialHeight).toBe(180)
    expect(result.width).toBe(480)
    expect(result.height).toBe(270)
    expect(result.cssWidth).toBe(240)
    expect(result.cssHeight).toBe(135)
    expect(result.devicePixelRatio).toBe(2)
  })

  /**
   * The AudioWorklet module ships as a standalone asset, so a stray module import in it only
   * 404s in a production build. `pnpm test:browser` serves `apps/demo/dist`, which makes this
   * the gate that would have caught it. It also covers the transport handover: the existing
   * `webcodecs` mode uses a video-only sample, so nothing exercised the custom audio path.
   */
  test('plays the WebCodecs path with audio from the built assets', async ({ page }) => {
    test.skip(!await decodesWithWebCodecs(page, { video: 'vp8', audio: 'opus' }), `WebCodecs VP8/Opus unavailable in ${test.info().project.name}`)
    test.skip(!await rendersAudio(page), `Audio rendering unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'webcodecs-audio')
    expect(result).toMatchObject({ status: 'passed', mode: 'webcodecs-audio', backend: 'webcodecs', renderer: 'canvas2d', errorCode: null, engineErrorCode: null })
    expect(result.attemptErrorCodes).toEqual([])
    expect(result.audioClockSource).toBe('audio-context')
    expect(result.audioRenderedFrames).toBeGreaterThan(0)
    expect(result.presentedFrames).toBeGreaterThan(0)
    expect(result.stateTransitions).toEqual(expect.arrayContaining(['playing', 'paused', 'ended']))
  })

  /**
   * Matroska had a container adapter but no fixture, so nothing exercised it end to end. These
   * three cases pin the routes the corpus manifest claims for the two `.mkv` samples.
   *
   * The native ones probe by decoding the fixture rather than by asking `canPlayType`, because
   * Playwright WebKit answers `probably` for `video/x-matroska` and then never delivers metadata
   * for it at all -- the engine reports `NATIVE_METADATA_TIMEOUT`, which is indistinguishable by
   * code alone from an engine that has genuinely wedged, and so must never be forgiven blindly.
   */
  test('plays H.264/AAC in Matroska on the Native path', async ({ page }) => {
    test.skip(!await playsNatively(page, 'mkv-h264-baseline-8bit-aac.mkv'), `Native Matroska H.264/AAC unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'mkv-native')
    expect(result).toMatchObject({ status: 'passed', mode: 'mkv-native', backend: 'html-video', surface: 'video', errorCode: null })
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
    expect(result.stateTransitions).toEqual(expect.arrayContaining(['playing', 'paused', 'ended']))
  })

  test('plays H.264/AAC in Matroska through the custom pipeline', async ({ page }) => {
    test.skip(!await decodesWithWebCodecs(page, { video: 'avc1.42C01E', audio: 'mp4a.40.2' }), `WebCodecs H.264/AAC unavailable in ${test.info().project.name}`)
    test.skip(!await rendersAudio(page), `Audio rendering unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'mkv')
    expect(result).toMatchObject({ status: 'passed', mode: 'mkv', backend: 'webcodecs', renderer: 'canvas2d', surface: 'canvas', errorCode: null, engineErrorCode: null })
    expect(result.attemptErrorCodes).toEqual([])
    expect(result.audioClockSource).toBe('audio-context')
    expect(result.audioRenderedFrames).toBeGreaterThan(0)
    expect(result.presentedFrames).toBeGreaterThan(0)
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
  })

  test('plays VP8/Opus in Matroska through the custom pipeline', async ({ page }) => {
    test.skip(!await decodesWithWebCodecs(page, { video: 'vp8', audio: 'opus' }), `WebCodecs VP8/Opus unavailable in ${test.info().project.name}`)
    test.skip(!await rendersAudio(page), `Audio rendering unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'mkv-vp8')
    expect(result).toMatchObject({ status: 'passed', mode: 'mkv-vp8', backend: 'webcodecs', renderer: 'canvas2d', errorCode: null, engineErrorCode: null })
    expect(result.attemptErrorCodes).toEqual([])
    expect(result.audioRenderedFrames).toBeGreaterThan(0)
    expect(result.presentedFrames).toBeGreaterThan(0)
  })

  /**
   * Embedded subtitles had unit coverage but never a real container: every other acceptance mode
   * attaches an external file. This one selects the `S_TEXT/ASS` track the Matroska demuxer
   * published, so it covers track registration, the second demux pass that collects the subtitle
   * packets, and ASS cue rendering off the custom pipeline's clock.
   */
  test('renders the embedded ASS track of a Matroska sample', async ({ page }) => {
    test.skip(!await decodesWithWebCodecs(page, { video: 'avc1.42C01E', audio: 'mp4a.40.2' }), `WebCodecs H.264/AAC unavailable in ${test.info().project.name}`)
    test.skip(!await rendersAudio(page), `Audio rendering unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'mkv-embedded-subs')
    expect(result).toMatchObject({ status: 'passed', mode: 'mkv-embedded-subs', backend: 'webcodecs', renderer: 'canvas2d', errorCode: null, engineErrorCode: null })
    expect(result.attemptErrorCodes).toEqual([])
    expect(result.subtitleTrackIds).toHaveLength(1)
    expect(result.subtitleTrackIds[0]).toMatch(/^embedded-\d+$/)
    expect(result.selectedSubtitleTrackId).toBe(result.subtitleTrackIds[0])
    expect(result.cueTimes.length).toBeGreaterThan(0)
    expect(result.cueTimes.some((time) => time >= 400_000 && time <= 1_200_000)).toBe(true)
    expect(result.presentedFrames).toBeGreaterThan(0)
  })

  /**
   * The embedded-ASS sample declared a native route that no case played — the manifest cross-check
   * in `verify-media-manifest.mjs` is what surfaced it. On the media element the container's own
   * subtitle track is the browser's to expose, so this asserts the engine still publishes the track
   * it demuxed and plays the video, rather than asserting cues the element renders internally.
   */
  test('plays the embedded-subtitle Matroska sample on the Native path', async ({ page }) => {
    test.skip(!await playsNatively(page, 'mkv-h264-baseline-8bit-aac-embedded-ass.mkv'), `Native Matroska H.264/AAC unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'mkv-embedded-subs-native')
    expect(result).toMatchObject({ status: 'passed', mode: 'mkv-embedded-subs-native', backend: 'html-video', surface: 'video', errorCode: null })
    expect(result.subtitleTrackIds).toHaveLength(1)
    expect(result.subtitleTrackIds[0]).toMatch(/^embedded-\d+$/)
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
    expect(result.stateTransitions).toEqual(expect.arrayContaining(['playing', 'paused', 'ended']))
  })

  /**
   * The corpus claimed both a native and a WebCodecs route for all three MP4 samples, and none of
   * the three had ever been played by a case: the H.264 one appeared only in fault routes and in
   * the Range/MIME contract, and the AV1 and HEVC ones were referenced nowhere at all. Every one of
   * them was in fact unplayable, because the demuxer read sample entry children eight bytes early
   * and so published a bare codec id with no configuration record. These cases are the evidence
   * behind the routes the corpus claims, and they are what would catch that offset again.
   *
   * Each of them asserts both routes in one body, so both probes have to answer yes before it runs.
   * The WebCodecs probe goes first because it is instant and deterministic, while a native probe
   * against the H.264 MP4 in Playwright WebKit either loads in about 6 s or never loads at all --
   * a browser this case has nothing to say about, since it has no WebCodecs either way.
   */
  test('plays H.264/AAC in MP4 on both paths with the codec string read from avcC', async ({ page }) => {
    test.skip(!await decodesWithWebCodecs(page, { video: 'avc1.42C01E', audio: 'mp4a.40.2' }), `WebCodecs H.264/AAC unavailable in ${test.info().project.name}`)
    test.skip(!await playsNatively(page, 'mp4-h264-baseline-8bit-aac.mp4'), `Native H.264/AAC in MP4 unavailable in ${test.info().project.name}`)
    const native = await runAcceptance(page, 'mp4-native')
    expect(native).toMatchObject({ status: 'passed', mode: 'mp4-native', backend: 'html-video', surface: 'video', errorCode: null, videoCodec: 'avc1.42C01E' })
    expect(native.nonEmptyPixels).toBeGreaterThan(100)
    expect(native.stateTransitions).toEqual(expect.arrayContaining(['playing', 'paused', 'ended']))

    test.skip(!await rendersAudio(page), `Audio rendering unavailable in ${test.info().project.name}`)
    const custom = await runAcceptance(page, 'mp4')
    expect(custom).toMatchObject({ status: 'passed', mode: 'mp4', backend: 'webcodecs', renderer: 'canvas2d', surface: 'canvas', errorCode: null, engineErrorCode: null, videoCodec: 'avc1.42C01E' })
    expect(custom.attemptErrorCodes).toEqual([])
    expect(custom.audioClockSource).toBe('audio-context')
    expect(custom.audioRenderedFrames).toBeGreaterThan(0)
    expect(custom.presentedFrames).toBeGreaterThan(0)
    expect(custom.nonEmptyPixels).toBeGreaterThan(100)
  })

  /**
   * AV1 was always inside the engine's own WebCodecs codec scope, so the only thing standing
   * between it and playback was the codec string. A bare `av01` is rejected by both
   * `VideoDecoder.isConfigSupported` and `canPlayType`, exactly like a bare `vp09`, so this pins the
   * `av01.P.LLT.DD` derived from the `av1C` record. The level in this sample's record is 0, which is
   * why the string is `av01.0.00M.08` rather than the more commonly seen `av01.0.04M.08`.
   */
  test('plays AV1/AAC in MP4 on both paths with the codec string read from av1C', async ({ page }) => {
    test.skip(!await decodesWithWebCodecs(page, { video: 'av01.0.00M.08', audio: 'mp4a.40.2' }), `WebCodecs AV1 unavailable in ${test.info().project.name}`)
    test.skip(!await playsNatively(page, 'mp4-av1-main-8bit-aac.mp4'), `Native AV1 unavailable in ${test.info().project.name}`)
    const native = await runAcceptance(page, 'av1-native')
    expect(native).toMatchObject({ status: 'passed', mode: 'av1-native', backend: 'html-video', surface: 'video', errorCode: null, videoCodec: 'av01.0.00M.08' })
    expect(native.nonEmptyPixels).toBeGreaterThan(100)
    expect(native.stateTransitions).toEqual(expect.arrayContaining(['playing', 'paused', 'ended']))

    test.skip(!await rendersAudio(page), `Audio rendering unavailable in ${test.info().project.name}`)
    const custom = await runAcceptance(page, 'av1')
    expect(custom).toMatchObject({ status: 'passed', mode: 'av1', backend: 'webcodecs', renderer: 'canvas2d', surface: 'canvas', errorCode: null, engineErrorCode: null, videoCodec: 'av01.0.00M.08' })
    expect(custom.attemptErrorCodes).toEqual([])
    expect(custom.audioRenderedFrames).toBeGreaterThan(0)
    expect(custom.presentedFrames).toBeGreaterThan(0)
    expect(custom.nonEmptyPixels).toBeGreaterThan(100)
  })

  /**
   * The Matroska VP8 sample claimed a native route that no case had ever played — only its custom
   * route was covered. Both Chromium and Firefox do play VP8/Opus in Matroska on the media element.
   */
  test('plays VP8/Opus in Matroska on the Native path', async ({ page }) => {
    test.skip(!await playsNatively(page, 'mkv-vp8-p0-8bit-opus.mkv'), `Native Matroska VP8/Opus unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'mkv-vp8-native')
    expect(result).toMatchObject({ status: 'passed', mode: 'mkv-vp8-native', backend: 'html-video', surface: 'video', errorCode: null, videoCodec: 'vp8' })
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
    expect(result.stateTransitions).toEqual(expect.arrayContaining(['playing', 'paused', 'ended']))
  })

  /**
   * The corpus claims a `wasm` route for the video-only VP8 sample, but the WASM decoder is an
   * atomic fallback that only ranks when the WebCodecs candidate cannot be constructed, and every
   * browser here has WebCodecs. The mode therefore takes WebCodecs away for this one run, the same
   * way the standalone WASM acceptance route does, which is the only way that claim becomes real.
   * Until now the corpus entry was backed only by the decoder package's own 642x358 fixture, so the
   * sample the manifest names had never been through the WASM path at all.
   *
   * The probe asks whether the browser has WebCodecs at all rather than for a codec: libvpx decodes
   * into linear memory and then wraps the planes in a `VideoFrame`, so a browser with none of it
   * cannot finish the WASM path either. Playwright WebKit is such a browser, and the strategy layer
   * now withholds the candidate there rather than letting a session reach `ready` and fail on the
   * handover -- so the mode ends as `STRATEGY_NO_VIABLE_BACKEND`, with the reason kept in the trace
   * as a `wasm-custom` exclusion carrying `WASM_FRAME_OUTPUT_UNAVAILABLE`. Either way there is no
   * WASM playback to assert, which is what this skip is about.
   */
  test('plays the video-only VP8 sample through the libvpx WASM fallback', async ({ page }) => {
    test.skip(!await hasWebCodecs(page), `WebCodecs unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'wasm-vp8')
    expect(result).toMatchObject({ status: 'passed', mode: 'wasm-vp8', backend: 'wasm', renderer: 'canvas2d', surface: 'canvas', errorCode: null })
    // The WebCodecs candidate has to have been tried and rejected, or this proves nothing.
    expect(result.attemptErrorCodes).toContain('WEBCODECS_API_UNAVAILABLE')
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
    expect(result.presentedFrames).toBeGreaterThan(0)
    expect(result.stateTransitions).toEqual(expect.arrayContaining(['playing', 'ended']))
  })

  /**
   * HEVC is the one sample with no route at all, and the corpus now says so with an empty
   * `expectedPaths`. The engine keeps HEVC outside its WebCodecs scope on purpose and derives no
   * RFC 6381 string for it, so the demuxer publishes a bare `hvc1` that Chromium and Firefox reject
   * outright from `canPlayType`.
   *
   * That bare id is load-bearing rather than incidental. Both browsers mishandle this file when
   * given a full string: Chromium reports readyState 4 and advances the audio track while silently
   * dropping the video, and Firefox answers `probably` for `hvc1.2.4.L120.B0` and then fails with
   * MEDIA_ERR_DECODE. A per-browser `expectedPaths` would have encoded Firefox's claim as a route,
   * so the manifest records the measurement in `noRouteReason` instead and this case pins that
   * every path refuses the file cleanly, in whichever browser runs it.
   *
   * Nothing here needs a codec to work -- refusing is the whole behaviour -- but it does need a
   * browser that has WebCodecs, so that the engine's own codec scope is what withholds HEVC.
   * Playwright WebKit has none, so its refusal says nothing about that scope, and its media element
   * does not settle deterministically on a file it cannot play: this same fixture came back
   * `MEDIA_ERR_SRC_NOT_SUPPORTED` in one run and never settled in the next, which the engine reports
   * as `NATIVE_METADATA_TIMEOUT`. No assertion about which refusal arrives is stable there.
   */
  test('refuses HEVC on every path instead of playing it silently', async ({ page }) => {
    test.skip(!await hasWebCodecs(page), `WebCodecs unavailable in ${test.info().project.name}`)
    for (const mode of ['hevc-native', 'hevc'] as const) {
      const result = await runAcceptance(page, mode)
      expect(result).toMatchObject({ status: 'unsupported', mode, videoCodec: 'hvc1' })
      expect(result.nonEmptyPixels).toBe(0)
      expect(result.presentedFrames).toBe(0)
      expect(result.errorCode).toBe(mode === 'hevc-native' ? 'NATIVE_NOT_SUPPORTED' : 'STRATEGY_NO_VIABLE_BACKEND')
    }
  })

  /**
   * A bare `vp09` is what VP9 track metadata yields on its own, and neither WebCodecs nor
   * `canPlayType` accepts it — so this pins the browser fact that forces the demuxer to derive a
   * full `vp09.PP.LL.DD` string from the keyframe header.
   */
  test('rejects a bare VP9 codec string and accepts the derived one', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const support = await page.evaluate(async () => {
      const probe = async (codec: string): Promise<boolean> => {
        try { return (await VideoDecoder.isConfigSupported({ codec, codedWidth: 320, codedHeight: 180 })).supported === true } catch { return false }
      }
      const element = document.createElement('video')
      return {
        bare: await probe('vp09'),
        profile0: await probe('vp09.00.11.08'),
        profile2: await probe('vp09.02.11.10'),
        vp8: await probe('vp8'),
        bareContentType: element.canPlayType('video/webm; codecs="vp09, opus"'),
        derivedContentType: element.canPlayType('video/webm; codecs="vp09.00.11.08, opus"'),
      }
    })
    test.skip(!support.profile0, `VP9 decoding unavailable in ${test.info().project.name}`)
    expect(support.bare).toBe(false)
    expect(support.profile2).toBe(true)
    expect(support.vp8).toBe(true)
    expect(support.bareContentType).toBe('')
    expect(support.derivedContentType).not.toBe('')
  })

  /**
   * VP9 track metadata carries no profile, level or bit depth and WebM gives the track no
   * CodecPrivate, so the demuxer used to publish a bare `vp09` and both samples ended up with zero
   * candidates. These three cases are the evidence behind the `expectedPaths` the corpus now claims
   * for them. They deliberately skip on a browser-level VP9 probe rather than on an `unsupported`
   * result: a regression in the derivation reports exactly the `STRATEGY_NO_VIABLE_BACKEND` that
   * `unsupported` forgives, which would let these tests skip the thing they exist to check.
   */
  test('plays VP9 profile 0 through the custom pipeline with a derived codec string', async ({ page }) => {
    test.skip(!await decodesWithWebCodecs(page, { video: 'vp09.00.11.08', audio: 'opus' }), `WebCodecs VP9/Opus unavailable in ${test.info().project.name}`)
    test.skip(!await rendersAudio(page), `Audio rendering unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'vp9')
    expect(result).toMatchObject({ status: 'passed', mode: 'vp9', backend: 'webcodecs', renderer: 'canvas2d', errorCode: null, engineErrorCode: null, videoCodec: 'vp09.00.11.08' })
    expect(result.attemptErrorCodes).toEqual([])
    expect(result.audioRenderedFrames).toBeGreaterThan(0)
    expect(result.presentedFrames).toBeGreaterThan(0)
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
  })

  test('plays 10-bit VP9 profile 2 through the custom pipeline', async ({ page }) => {
    test.skip(!await decodesWithWebCodecs(page, { video: 'vp09.02.11.10', audio: 'opus' }), `WebCodecs 10-bit VP9/Opus unavailable in ${test.info().project.name}`)
    test.skip(!await rendersAudio(page), `Audio rendering unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'vp9-p2')
    expect(result).toMatchObject({ status: 'passed', mode: 'vp9-p2', backend: 'webcodecs', renderer: 'canvas2d', errorCode: null, engineErrorCode: null, videoCodec: 'vp09.02.11.10' })
    expect(result.attemptErrorCodes).toEqual([])
    expect(result.presentedFrames).toBeGreaterThan(0)
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
  })

  test('plays both VP9 profiles on the Native path', async ({ page }) => {
    for (const [mode, codec, sample] of [
      ['vp9-native', 'vp09.00.11.08', 'webm-vp9-p0-8bit-opus.webm'],
      ['vp9-p2-native', 'vp09.02.11.10', 'webm-vp9-p2-10bit-opus.webm'],
    ] as const) {
      test.skip(!await playsNatively(page, sample), `Native VP9 unavailable in ${test.info().project.name}`)
      const result = await runAcceptance(page, mode)
      expect(result).toMatchObject({ status: 'passed', mode, backend: 'html-video', surface: 'video', errorCode: null, videoCodec: codec })
      expect(result.nonEmptyPixels).toBeGreaterThan(100)
      expect(result.stateTransitions).toEqual(expect.arrayContaining(['playing', 'paused', 'ended']))
    }
  })

  /**
   * The corpus carried three Matroska samples and not one of them needed a derived codec string, so
   * "Matroska plus a keyframe-derived string" was the one combination in the matrix nothing covered.
   * EBML gives a VP9 track no CodecPrivate at all, which makes this the only sample where the
   * container adapter and the VP9 derivation have to work together.
   *
   * The container turned out not to narrow either route, which is a measurement rather than an
   * inheritance from the WebM VP9 entry: Chromium 151 answers the empty string for
   * `video/x-matroska; codecs="vp9,opus"` and `probably` for the derived `vp09.00.11.08`, and a media
   * element handed the file decodes 32 frames there and 35 in Firefox 153.
   *
   * `videoCodec` is asserted alongside playback because it is the only part of the result that names
   * the derivation. Removing it from the EBML adapter was measured here: the track comes back as a
   * bare `vp09`, the custom mode ends `STRATEGY_NO_VIABLE_BACKEND` and the native one
   * `NATIVE_NOT_SUPPORTED`, in both browsers -- so both cases turn red, which is the point of
   * skipping on a browser probe rather than on the harness's own `unsupported`.
   */
  test('plays VP9/Opus in Matroska through the custom pipeline with a derived codec string', async ({ page }) => {
    test.skip(!await decodesWithWebCodecs(page, { video: 'vp09.00.11.08', audio: 'opus' }), `WebCodecs VP9/Opus unavailable in ${test.info().project.name}`)
    test.skip(!await rendersAudio(page), `Audio rendering unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'mkv-vp9')
    expect(result).toMatchObject({ status: 'passed', mode: 'mkv-vp9', backend: 'webcodecs', renderer: 'canvas2d', surface: 'canvas', errorCode: null, engineErrorCode: null, videoCodec: 'vp09.00.11.08' })
    expect(result.attemptErrorCodes).toEqual([])
    expect(result.audioClockSource).toBe('audio-context')
    expect(result.audioRenderedFrames).toBeGreaterThan(0)
    expect(result.presentedFrames).toBeGreaterThan(0)
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
  })

  test('plays VP9/Opus in Matroska on the Native path', async ({ page }) => {
    test.skip(!await playsNatively(page, 'mkv-vp9-p0-8bit-opus.mkv'), `Native Matroska VP9/Opus unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'mkv-vp9-native')
    expect(result).toMatchObject({ status: 'passed', mode: 'mkv-vp9-native', backend: 'html-video', surface: 'video', errorCode: null, videoCodec: 'vp09.00.11.08' })
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
    expect(result.presentedFrames).toBeGreaterThan(0)
    expect(result.stateTransitions).toEqual(expect.arrayContaining(['playing', 'paused', 'ended']))
  })

  /**
   * AV1 had never met Matroska in the corpus, and the EBML adapter used to publish a bare `av01`
   * for a `V_AV1` track even though FFmpeg muxes the `av1C` record into the track's CodecPrivate —
   * the record held every field of the string and nothing read it. A bare `av01` is rejected by
   * both `canPlayType` and `VideoDecoder.isConfigSupported` in Chromium and Firefox (measured
   * 2026-08-29: both answer probably for `av01.0.00M.08` and the empty string for `av01`), so this
   * case pins the CodecPrivate derivation the same way the MKV VP9 cases pin the keyframe one.
   */
  test('plays AV1/Opus in Matroska through the custom pipeline with the codec string read from CodecPrivate', async ({ page }) => {
    test.skip(!await decodesWithWebCodecs(page, { video: 'av01.0.00M.08', audio: 'opus' }), `WebCodecs AV1/Opus unavailable in ${test.info().project.name}`)
    test.skip(!await rendersAudio(page), `Audio rendering unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'mkv-av1')
    expect(result).toMatchObject({ status: 'passed', mode: 'mkv-av1', backend: 'webcodecs', renderer: 'canvas2d', surface: 'canvas', errorCode: null, engineErrorCode: null, videoCodec: 'av01.0.00M.08' })
    expect(result.attemptErrorCodes).toEqual([])
    expect(result.audioClockSource).toBe('audio-context')
    expect(result.audioRenderedFrames).toBeGreaterThan(0)
    expect(result.presentedFrames).toBeGreaterThan(0)
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
  })

  test('plays AV1/Opus in Matroska on the Native path', async ({ page }) => {
    test.skip(!await playsNatively(page, 'mkv-av1-p0-8bit-opus.mkv'), `Native Matroska AV1/Opus unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'mkv-av1-native')
    expect(result).toMatchObject({ status: 'passed', mode: 'mkv-av1-native', backend: 'html-video', surface: 'video', errorCode: null, videoCodec: 'av01.0.00M.08' })
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
    expect(result.presentedFrames).toBeGreaterThan(0)
    expect(result.stateTransitions).toEqual(expect.arrayContaining(['playing', 'paused', 'ended']))
  })

  /**
   * 10-bit VP9 had WebM coverage only: the Matroska half of that dimension was empty until this
   * fixture. The track carries no CodecPrivate, so both routes depend on the keyframe-derived
   * `vp09.02.LL.10` — the 10-bit counterpart of the profile-0 case above.
   */
  test('plays 10-bit VP9 profile 2 in Matroska through the custom pipeline', async ({ page }) => {
    test.skip(!await decodesWithWebCodecs(page, { video: 'vp09.02.11.10', audio: 'opus' }), `WebCodecs 10-bit VP9/Opus unavailable in ${test.info().project.name}`)
    test.skip(!await rendersAudio(page), `Audio rendering unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'mkv-vp9-p2')
    expect(result).toMatchObject({ status: 'passed', mode: 'mkv-vp9-p2', backend: 'webcodecs', renderer: 'canvas2d', surface: 'canvas', errorCode: null, engineErrorCode: null, videoCodec: 'vp09.02.11.10' })
    expect(result.attemptErrorCodes).toEqual([])
    expect(result.audioRenderedFrames).toBeGreaterThan(0)
    expect(result.presentedFrames).toBeGreaterThan(0)
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
  })

  test('plays 10-bit VP9 profile 2 in Matroska on the Native path', async ({ page }) => {
    test.skip(!await playsNatively(page, 'mkv-vp9-p2-10bit-opus.mkv'), `Native Matroska 10-bit VP9/Opus unavailable in ${test.info().project.name}`)
    const result = await runAcceptance(page, 'mkv-vp9-p2-native')
    expect(result).toMatchObject({ status: 'passed', mode: 'mkv-vp9-p2-native', backend: 'html-video', surface: 'video', errorCode: null, videoCodec: 'vp09.02.11.10' })
    expect(result.nonEmptyPixels).toBeGreaterThan(100)
    expect(result.presentedFrames).toBeGreaterThan(0)
    expect(result.stateTransitions).toEqual(expect.arrayContaining(['playing', 'paused', 'ended']))
  })

  test('keeps Native video and WebCodecs canvas pixel statistics consistent', async ({ page }) => {
    test.skip(!await playsNatively(page, 'webm-vp8-p0-8bit-opus.webm'), `Native VP8/Opus unavailable in ${test.info().project.name}`)
    test.skip(!await decodesWithWebCodecs(page, { video: 'vp8' }), `WebCodecs VP8 unavailable in ${test.info().project.name}`)
    const native = await runAcceptance(page, 'native')
    const webcodecs = await runAcceptance(page, 'webcodecs')

    expect(native.status).toBe('passed')
    expect(webcodecs.status).toBe('passed')
    expect(Math.abs(native.meanLuma - webcodecs.meanLuma)).toBeLessThanOrEqual(20)
    expect(Math.abs(native.coloredPixelRatio - webcodecs.coloredPixelRatio)).toBeLessThanOrEqual(0.1)
  })

  test('serves correct Range and MIME contracts', async ({ request }) => {
    const response = await request.get('/quality-media/mp4-h264-baseline-8bit-aac.mp4', { headers: { Range: 'bytes=0-31' } })
    expect(response.status()).toBe(206)
    expect(response.headers()['content-range']).toBe('bytes 0-31/137736')
    expect(response.headers()['content-type']).toBe('video/mp4')
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
    expect((await response.body()).byteLength).toBe(32)
    expect((await request.get('/quality-media/missing.mp4')).status()).toBe(404)
  })

  test('reports an explicit error when the browser goes offline before media loading', async ({ page, context }) => {
    await page.goto('/?mediaAcceptance=native', { waitUntil: 'domcontentloaded' })
    await context.setOffline(true)
    try {
      await page.locator('#media-start').click({ noWaitAfter: true })
      await page.waitForFunction(() => /^(passed|failed|unsupported)$/.test(document.body.dataset.status ?? ''), undefined, { timeout: 45_000 })
      const result = await readAcceptance(page)
      expect(result).toMatchObject({ status: 'failed', errorCode: 'RANGE_RETRY_EXHAUSTED', nonEmptyPixels: 0 })
      expect(result.events).toContain('error')
    } finally {
      await context.setOffline(false)
    }
  })

  for (const fault of ['status-200', 'bad-content-range', 'truncated', 'corrupt', 'disconnect'] as const) {
    test(`reports an explicit error for ${fault}`, async ({ page }) => {
      const result = await runAcceptance(page, `fault-${fault}`)
      expect(result).toMatchObject({
        status: 'passed',
        errorCode: {
          'status-200': 'RANGE_UNSUPPORTED',
          'bad-content-range': 'RANGE_CONTENT_RANGE_INVALID',
          truncated: 'CONTAINER_TRUNCATED',
          corrupt: 'CONTAINER_INVALID',
          disconnect: 'RANGE_RETRY_EXHAUSTED',
        }[fault],
      })
      expect(result.nonEmptyPixels).toBe(0)
      expect(result.events).toContain('error')
    })
  }
})

async function runAcceptance(page: Page, mode: string): Promise<MediaAcceptanceResult> {
  await page.goto(`/?mediaAcceptance=${mode}`, { waitUntil: 'domcontentloaded' })
  await page.locator('#media-start').click({ noWaitAfter: true })
  // The scripted acceptance plays, seeks and replays the sample, and each of its steps has its own
  // budget. This has to outlast the sum of them so a step timeout surfaces as its own labelled code
  // rather than as an opaque Playwright timeout.
  await page.waitForFunction(() => /^(passed|failed|unsupported)$/.test(document.body.dataset.status ?? ''), undefined, { timeout: 120_000 })
  return readAcceptance(page)
}

async function readAcceptance(page: Page): Promise<MediaAcceptanceResult> {
  const result = await page.evaluate(() => (window as typeof window & { __mediaAcceptance?: MediaAcceptanceResult }).__mediaAcceptance)
  if (result === undefined) throw new Error('Media acceptance did not publish a result')
  return result
}

interface MediaAcceptanceResult {
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
  readonly subtitleTrackIds: readonly string[]
  readonly selectedSubtitleTrackId: string | null
  readonly videoCodec: string | null
  readonly audioClockSource: 'audio-context' | 'wall-clock' | null
  readonly audioRenderedFrames: number
  readonly engineErrorCode: string | null
  readonly attemptErrorCodes: readonly string[]
  readonly errorCode: string | null
}
