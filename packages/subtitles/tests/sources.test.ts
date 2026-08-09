import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { inferSubtitleFormat, loadExternalSubtitle } from '../src/index'

describe('external subtitle sources', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads UTF-8 SRT through CORS with a bounded response', async () => {
    const fetchImpl = vi.fn(async () => new Response('1\n00:00:00,000 --> 00:00:01,000\nremote'))
    const result = await loadExternalSubtitle({ kind: 'url', url: 'https://media.example.test/captions.srt' }, { trackId: 'remote', fetchImpl })
    expect(result.cues[0]?.text).toBe('remote')
    expect(fetchImpl).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'https:' }), expect.objectContaining({ mode: 'cors', credentials: 'omit', redirect: 'error' }))
  })

  it('rejects insecure URLs and oversized responses', async () => {
    await expect(loadExternalSubtitle({ kind: 'url', url: 'http://example.test/a.srt' }, { trackId: 'x', fetchImpl: vi.fn() }))
      .rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_SOURCE_UNSUPPORTED })
    const fetchImpl = vi.fn(async () => new Response('too large'))
    await expect(loadExternalSubtitle({ kind: 'url', url: 'https://example.test/a.srt' }, { trackId: 'x', fetchImpl, sourceLimits: { maxResponseBytes: 2 } }))
      .rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_SOURCE_TOO_LARGE })
  })

  it('infers format from safe pathnames without exposing query strings', () => {
    expect(inferSubtitleFormat({ kind: 'url', url: 'https://example.test/subtitle.ASS?token=secret' })).toBe('ass')
    expect(inferSubtitleFormat({ kind: 'url', url: 'https://example.test/subtitle' })).toBeNull()
  })

  it('bounds zero-length response chunks independently of the byte budget', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array()) },
    })
    const fetchImpl = vi.fn(async () => new Response(body))
    await expect(loadExternalSubtitle(
      { kind: 'url', url: 'https://example.test/empty-chunks.srt' },
      { trackId: 'chunks', fetchImpl, sourceLimits: { maxResponseChunks: 3 } },
    )).rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_SOURCE_TOO_LARGE })
  })

  it('times out a response reader that ignores AbortSignal', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => Promise.resolve())
    const response = {
      ok: true,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}),
          cancel,
          releaseLock: vi.fn(),
        }),
      },
    } as unknown as Response
    const pending = loadExternalSubtitle(
      { kind: 'url', url: 'https://example.test/hanging.srt' },
      { trackId: 'timeout', fetchImpl: vi.fn(async () => response), sourceLimits: { operationTimeoutMs: 10 } },
    )
    const rejected = expect(pending).rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_NETWORK_FAILED })
    await vi.advanceTimersByTimeAsync(10)
    await rejected
    expect(cancel).toHaveBeenCalled()
  })

  it('times out a fetch implementation that ignores AbortSignal', async () => {
    vi.useFakeTimers()
    const pending = loadExternalSubtitle(
      { kind: 'url', url: 'https://example.test/hanging-fetch.srt' },
      { trackId: 'fetch-timeout', fetchImpl: () => new Promise<Response>(() => {}), sourceLimits: { operationTimeoutMs: 10 } },
    )
    const rejected = expect(pending).rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_NETWORK_FAILED })
    await vi.advanceTimersByTimeAsync(10)
    await rejected
  })

  it('rejects opaque and redirected responses without exposing their URL', async () => {
    const opaque = { type: 'opaque', ok: false, redirected: false } as Response
    await expect(loadExternalSubtitle(
      { kind: 'url', url: 'https://example.test/opaque.srt?secret=value' },
      { trackId: 'opaque', fetchImpl: vi.fn(async () => opaque) },
    )).rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_CORS_FAILED, message: expect.not.stringContaining('secret=value') })

    const redirected = { type: 'opaqueredirect', ok: false, redirected: false } as Response
    await expect(loadExternalSubtitle(
      { kind: 'url', url: 'https://example.test/redirect.srt?secret=value' },
      { trackId: 'redirect', fetchImpl: vi.fn(async () => redirected) },
    )).rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_SOURCE_UNSUPPORTED, message: expect.not.stringContaining('secret=value') })
  })

  it('does not start a URL read when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn(async () => new Response('should not load'))
    await expect(loadExternalSubtitle(
      { kind: 'url', url: 'https://example.test/aborted.srt' },
      { trackId: 'aborted', fetchImpl, signal: controller.signal },
    )).rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_ABORTED })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
