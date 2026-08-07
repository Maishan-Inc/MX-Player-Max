import { describe, expect, it } from 'vitest'
import { NativeMediaPipeline } from '../src/native/pipeline'
import { FakeVideo } from './fake-video'

describe('native video event mapping', () => {
  it('maps play, pause, seeking, ended and media errors', async () => {
    const video = new FakeVideo()
    const events: Array<{ type: string; [key: string]: unknown }> = []
    const pipeline = new NativeMediaPipeline(video as unknown as HTMLVideoElement, { isActive: () => true, onEvent: (event) => events.push(event) })
    await pipeline.load({ kind: 'file', file: new Blob(['media']) as File }, 'video/mp4')
    video.dispatch('play')
    video.dispatch('pause')
    video.dispatch('seeking')
    video.dispatch('seeked')
    video.ended = true
    video.dispatch('ended')
    video.error = { code: 3 }
    video.dispatch('error')
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['playing', 'paused', 'seeking', 'seeked', 'ended', 'error']))
    expect(events.find((event) => event.type === 'error')).toMatchObject({ error: { code: 'NATIVE_DECODE_FAILED' } })
    pipeline.close()
  })

  it.each([
    [1, 'NATIVE_ABORTED'],
    [2, 'NATIVE_NETWORK_FAILED'],
    [3, 'NATIVE_DECODE_FAILED'],
    [4, 'NATIVE_NOT_SUPPORTED'],
  ])('maps HTMLMediaElement error code %s to %s', async (mediaCode, engineCode) => {
    const video = new FakeVideo()
    const events: Array<{ type: string; [key: string]: unknown }> = []
    const pipeline = new NativeMediaPipeline(video as unknown as HTMLVideoElement, { isActive: () => true, onEvent: (event) => events.push(event) })
    await pipeline.load({ kind: 'file', file: new Blob(['media']) as File }, 'video/mp4')
    video.error = { code: mediaCode }
    video.dispatch('error')
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: engineCode } })
    pipeline.close()
  })
})
