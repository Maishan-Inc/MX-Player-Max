import { describe, expect, it } from 'vitest'
import { AudioSampleClock, MediaWallClock, VideoFrameScheduler } from '../src/index'

describe('media clocks and video scheduling', () => {
  it('anchors audio media time to rendered source sample frames', () => {
    let context = 1
    const clock = new AudioSampleClock(48_000, () => context)
    clock.setAnchor(1_000_000)
    clock.play()
    context = 2
    expect(clock.snapshot.mediaTime).toBe(1_000_000)
    clock.updateRenderedFrames(48_000)
    expect(clock.snapshot.mediaTime).toBe(2_000_000)
    clock.noteUnderrun(true)
    expect(clock.snapshot.underrun).toBe(true)
    clock.updateRenderedFrames(48_000)
    expect(clock.snapshot.underrun).toBe(true)
    clock.updateRenderedFrames(48_001)
    expect(clock.snapshot.underrun).toBe(false)
  })

  it('uses a pausable, seekable monotonic wall clock without polling', () => {
    let now = 100
    const clock = new MediaWallClock({ now: () => now })
    clock.seek(500_000, 2)
    clock.play()
    now += 250
    expect(clock.snapshot.mediaTime).toBe(750_000)
    clock.setPlaybackRate(2)
    now += 100
    expect(clock.snapshot.mediaTime).toBe(950_000)
    clock.pause()
    now += 1_000
    expect(clock.snapshot.mediaTime).toBe(950_000)
  })

  it('returns wait/present/drop and records late drops', () => {
    const scheduler = new VideoFrameScheduler({ earlyThreshold: 5_000, lateDropThreshold: 50_000 })
    const clock = new MediaWallClock({ now: () => 0 }).snapshot
    expect(scheduler.decide(10_000, clock).action).toBe('wait')
    expect(scheduler.decide(1_000, { ...clock, mediaTime: 1_000 }).action).toBe('present')
    expect(scheduler.decide(0, { ...clock, mediaTime: 60_000 }).action).toBe('drop')
    expect(scheduler.lateDrops).toBe(1)
  })
})
