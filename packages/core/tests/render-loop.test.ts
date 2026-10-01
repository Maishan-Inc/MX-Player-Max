import { describe, expect, it, vi } from 'vitest'
import type { AudioClockSnapshot, DecodedVideoFrame } from '@mx-player-max/types'
import type { ManagedVideoRenderer } from '@mx-player-max/renderers'
import { CustomRenderLoop } from '../src/custom/render-loop'

function clock(mediaTime: number, epoch = 0): AudioClockSnapshot {
  return { source: 'wall-clock', mediaTime, contextTime: null, renderedFrames: 0, sampleRate: null, playbackRate: 1, running: true, underrun: false, epoch }
}

function value(timestamp: number, epoch = 0): DecodedVideoFrame {
  return { frame: { close: vi.fn() } as unknown as VideoFrame, timestamp, duration: 33_333, epoch }
}

function renderer() {
  const stats = { presentedFrames: 0 } as ManagedVideoRenderer['stats']
  return {
    kind: 'canvas2d' as const, state: 'ready' as const, capabilities: {} as ManagedVideoRenderer['capabilities'],
    stats, attach: vi.fn(async () => {}), render: vi.fn(() => { stats.presentedFrames += 1 }), resize: vi.fn(), close: vi.fn(),
    setFilter: vi.fn(), setTransform: vi.fn(), noteSchedule: vi.fn(),
  } as unknown as ManagedVideoRenderer
}

describe('CustomRenderLoop', () => {
  it('reports signed submission drift only for presented frames in the active epoch', async () => {
    const callbacks: Array<(time: number) => void> = []
    const onPresented = vi.fn()
    const output = renderer()
    const frames = [value(10_000, 2), value(0, 1), value(-100_000, 2)]
    const loop = new CustomRenderLoop({
      readVideoFrame: async () => frames.shift() ?? null,
      getClock: () => ({ ...clock(12_000, 2), source: 'audio-context' }), renderer: output,
      isActive: () => true, onPresented, onError: vi.fn(),
      requestAnimationFrame: (callback) => { callbacks.push(callback); return callbacks.length }, cancelAnimationFrame: vi.fn(),
    })
    loop.start()
    for (let index = 0; index < 3; index += 1) {
      callbacks.shift()?.(index * 16)
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    }
    expect(onPresented).toHaveBeenCalledExactlyOnceWith({ epoch: 2, timestamp: 10_000, mediaTime: 12_000, driftMicros: -2_000, clockSource: 'audio-context' })
    loop.close()
  })

  it('does not report presentation when the renderer drops or rejects a submission', async () => {
    for (const reject of [false, true]) {
      const callbacks: Array<(time: number) => void> = []
      const output = renderer()
      output.render = () => { if (reject) throw new Error('lost renderer') }
      const onPresented = vi.fn()
      const loop = new CustomRenderLoop({
        readVideoFrame: async () => value(0), getClock: () => clock(0), renderer: output,
        isActive: () => true, onPresented, onError: vi.fn(),
        requestAnimationFrame: (callback) => { callbacks.push(callback); return callbacks.length }, cancelAnimationFrame: vi.fn(),
      })
      loop.start(); callbacks.shift()?.(0)
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
      expect(onPresented).not.toHaveBeenCalled()
      loop.close()
    }
  })
  it('keeps one in-flight read, waits, presents, and drops late frames', async () => {
    const callbacks: Array<(time: number) => void> = []
    const output = renderer()
    const frames = [value(100_000), value(0)]
    const read = vi.fn(async () => frames.shift() ?? null)
    let mediaTime = 0
    const loop = new CustomRenderLoop({
      readVideoFrame: read, getClock: () => clock(mediaTime), renderer: output, isActive: () => true,
      requestAnimationFrame: (callback) => { callbacks.push(callback); return callbacks.length }, cancelAnimationFrame: vi.fn(),
    })
    loop.start()
    expect(read).not.toHaveBeenCalled()
    callbacks.shift()?.(0)
    await Promise.resolve()
    await Promise.resolve()
    expect(read).toHaveBeenCalledOnce()
    expect(output.noteSchedule).toHaveBeenCalledWith('wait')
    mediaTime = 100_000
    callbacks.shift()?.(16)
    await Promise.resolve()
    await Promise.resolve()
    expect(output.render).toHaveBeenCalledOnce()
    loop.stop()

    output.noteSchedule.mockClear()
    const lateCallbacks: Array<(time: number) => void> = []
    const late = value(0)
    const lateRead = vi.fn(async () => late)
    const lateLoop = new CustomRenderLoop({
      readVideoFrame: lateRead, getClock: () => clock(100_000), renderer: output, isActive: () => true,
      requestAnimationFrame: (callback) => { lateCallbacks.push(callback); return lateCallbacks.length }, cancelAnimationFrame: vi.fn(),
    })
    lateLoop.start()
    lateCallbacks.shift()?.(0)
    await Promise.resolve()
    await Promise.resolve()
    expect(output.noteSchedule).toHaveBeenCalledWith('drop')
    expect(late.frame.close).toHaveBeenCalledOnce()
    lateLoop.close()
  })

  it('closes stale and retained frames during pause, seek generation changes, and close', async () => {
    const callbacks: Array<(time: number) => void> = []
    let resolveRead!: (frame: DecodedVideoFrame) => void
    const output = renderer()
    const loop = new CustomRenderLoop({
      readVideoFrame: vi.fn(() => new Promise<DecodedVideoFrame>((resolve) => { resolveRead = resolve })),
      getClock: () => clock(0), renderer: output, isActive: () => true,
      requestAnimationFrame: (callback) => { callbacks.push(callback); return callbacks.length }, cancelAnimationFrame: vi.fn(),
    })
    loop.start()
    callbacks.shift()?.(0)
    loop.pause()
    const stale = value(0)
    resolveRead(stale)
    await Promise.resolve()
    await Promise.resolve()
    expect(stale.frame.close).toHaveBeenCalledOnce()
    loop.close()
  })

  it('does not observe one pending read from two generations', async () => {
    const callbacks: Array<(time: number) => void> = []
    const output = renderer()
    let resolveRead!: (frame: DecodedVideoFrame) => void
    const read = vi.fn(() => new Promise<DecodedVideoFrame>((resolve) => { resolveRead = resolve }))
    const loop = new CustomRenderLoop({
      readVideoFrame: read, getClock: () => clock(0), renderer: output, isActive: () => true,
      requestAnimationFrame: (callback) => { callbacks.push(callback); return callbacks.length }, cancelAnimationFrame: vi.fn(),
    })
    loop.start()
    callbacks.shift()?.(0)
    loop.pause()
    loop.start()
    callbacks.shift()?.(16)
    const pending = value(0)
    resolveRead(pending)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(read).toHaveBeenCalledOnce()
    expect(pending.frame.close).toHaveBeenCalledOnce()
    expect(output.render).not.toHaveBeenCalled()
    loop.close()
  })
})
