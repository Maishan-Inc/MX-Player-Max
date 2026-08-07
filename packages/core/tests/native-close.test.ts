import { describe, expect, it, vi } from 'vitest'
import { NativeMediaPipeline } from '../src/native/pipeline'
import { FakeVideo } from './fake-video'

describe('native pipeline close', () => {
  it('cancels frame callbacks and ignores old epoch events', async () => {
    const video = new FakeVideo()
    const onEvent = vi.fn()
    let active = true
    const pipeline = new NativeMediaPipeline(video as unknown as HTMLVideoElement, { isActive: () => active, onEvent })
    await pipeline.load({ kind: 'file', file: new Blob(['media']) as File }, 'video/webm')
    video.fireFrame()
    const beforeClose = pipeline.stats
    expect(beforeClose.mediaTime).toBe(1_500_000)
    active = false
    pipeline.close()
    video.dispatch('timeupdate')
    video.fireFrame()
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'timeupdate' }))
    expect(pipeline.stats.mediaTime).toBe(1_500_000)
  })
})

