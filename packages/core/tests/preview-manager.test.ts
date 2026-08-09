import { describe, expect, it, vi } from 'vitest'
import { PREVIEW_TIMEOUT_MS, PreviewManager } from '../src/playback/preview-manager'

describe('safe preview provider manager', () => {
  it('applies defaults and publishes only a validated epoch result', async () => {
    const provider = vi.fn(async (request: { time: number; width: number; height: number; sessionEpoch: number }) => ({ blob: new Blob(['preview'], { type: 'image/webp' }), time: request.time, width: request.width, height: request.height }))
    const manager = new PreviewManager({ provider, epoch: 7, duration: 10_000 })
    await expect(manager.request({ time: 5_000 })).resolves.toMatchObject({ time: 5_000, width: 160, height: 90, sessionEpoch: 7 })
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({ duration: 10_000, sessionEpoch: 7, signal: expect.any(AbortSignal) }))
    expect(provider.mock.calls[0]?.[0]).not.toHaveProperty('source')
    manager.close()
  })

  it('rejects invalid caller input with the stable code', async () => {
    const manager = new PreviewManager({ epoch: 1, duration: null })
    await expect(manager.request({ time: -1 })).rejects.toMatchObject({ code: 'PREVIEW_INPUT_INVALID' })
    await expect(manager.request({ time: 0, width: 321 })).rejects.toMatchObject({ code: 'PREVIEW_INPUT_INVALID' })
  })

  it('quietly drops invalid, aborted, and stale provider output', async () => {
    let resolveFirst: ((value: { blob: Blob; time: number; width: number; height: number }) => void) | null = null
    const provider = vi.fn((request: { time: number; width: number; height: number }) => new Promise<{ blob: Blob; time: number; width: number; height: number }>((resolve) => {
      if (request.time === 1) resolveFirst = resolve
      else resolve({ blob: new Blob(['ok'], { type: 'image/png' }), time: request.time, width: request.width, height: request.height })
    }))
    const manager = new PreviewManager({ provider, epoch: 1, duration: 10 })
    const first = manager.request({ time: 1 })
    const second = manager.request({ time: 2 })
    resolveFirst?.({ blob: new Blob(['late'], { type: 'image/png' }), time: 1, width: 160, height: 90 })
    await expect(first).resolves.toBeNull()
    await expect(second).resolves.toMatchObject({ time: 2 })
    manager.close()
    await expect(manager.request({ time: 2 })).rejects.toMatchObject({ code: 'ENGINE_CLOSED' })
  })

  it('cleans caller abort listeners and turns synchronous provider failures into null', async () => {
    const caller = new AbortController()
    const remove = vi.spyOn(caller.signal, 'removeEventListener')
    const pending = new PreviewManager({
      epoch: 1,
      duration: 10,
      provider: () => new Promise(() => {}),
    })
    const request = pending.request({ time: 1, signal: caller.signal })
    caller.abort()
    await expect(request).resolves.toBeNull()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    pending.close()

    const throwing = new PreviewManager({
      epoch: 2,
      duration: 10,
      provider: () => { throw new Error('provider failed synchronously') },
    })
    await expect(throwing.request({ time: 1 })).resolves.toBeNull()
    throwing.close()
  })

  it('aborts provider work when the preview timeout expires', async () => {
    vi.useFakeTimers()
    let providerSignal: AbortSignal | null = null
    const manager = new PreviewManager({
      epoch: 3,
      duration: 10,
      provider: (request) => {
        providerSignal = request.signal
        return new Promise(() => {})
      },
    })
    const pending = manager.request({ time: 1 })

    await vi.advanceTimersByTimeAsync(PREVIEW_TIMEOUT_MS)
    await expect(pending).resolves.toBeNull()
    expect(providerSignal?.aborted).toBe(true)
    manager.close()
    vi.useRealTimers()
  })
})
