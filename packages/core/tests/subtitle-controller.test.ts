import { describe, expect, it } from 'vitest'
import type { AudioClockSnapshot, MediaDescriptor } from '@mx-player-max/types'
import type { SubtitleManagerEvent } from '@mx-player-max/subtitles'
import { CoreSubtitleController } from '../src/index'
import { FakeVideo } from './fake-video'

const media: MediaDescriptor = {
  container: 'webm',
  tracks: [],
  duration: 3_000_000,
  size: null,
  mimeType: 'video/webm',
}

function target(surface: FakeVideo | { tagName: string }): {
  video: HTMLVideoElement | null
  owned: boolean
  container: HTMLElement | null
  target: HTMLElement
} {
  return { video: surface.tagName.toLowerCase() === 'video' ? surface as unknown as HTMLVideoElement : null, owned: false, container: null, target: surface as unknown as HTMLElement }
}

function subtitleFile(): File {
  return new Blob(['1\n00:00:00,000 --> 00:00:02,000\nhello\n']) as File
}

function cueEvents(events: readonly SubtitleManagerEvent[]): Extract<SubtitleManagerEvent, { type: 'cuechange' }>[] {
  return events.filter((event): event is Extract<SubtitleManagerEvent, { type: 'cuechange' }> => event.type === 'cuechange')
}

class OverlayNode {
  readonly style: Record<string, string> = {}
  readonly children: OverlayNode[] = []
  parentNode: OverlayNode | null = null
  firstChild: OverlayNode | null = null
  parentElement: HTMLElement | null = null
  readonly ownerDocument: OverlayDocument
  constructor(document: OverlayDocument) { this.ownerDocument = document }
  appendChild(child: OverlayNode): OverlayNode { this.children.push(child); child.parentNode = this; this.firstChild = this.children[0] ?? null; return child }
  removeChild(child: OverlayNode): OverlayNode { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; this.firstChild = this.children[0] ?? null; return child }
  setAttribute(): void {}
}

class OverlayDocument {
  readonly defaultView = { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 }
  createElement = (): OverlayNode => new OverlayNode(this)
  addEventListener(): void {}
  removeEventListener(): void {}
}

describe('Core subtitle controller integration', () => {
  it('uses NativeMediaClock, refreshes after seek, and stops late updates on close', async () => {
    const video = new FakeVideo()
    const events: SubtitleManagerEvent[] = []
    const controller = new CoreSubtitleController({
      source: { kind: 'file', file: new Blob(['media']) as File },
      media,
      target: target(video),
      surface: video as unknown as HTMLVideoElement,
      rendererKind: null,
      subtitleOptions: { enabled: false },
      onEvent: (event) => events.push(event),
    })

    await controller.addTrack({ kind: 'file', file: subtitleFile(), format: 'srt' }, { id: 'external' })
    await controller.selectTrack('external')
    video.currentTime = 0.5
    video.dispatch('timeupdate')
    expect(cueEvents(events).at(-1)?.cues.map((cue) => cue.cueId)).toEqual(['external:1:0'])

    controller.seekStarted()
    video.currentTime = 0.25
    controller.seekCompleted()
    expect(cueEvents(events).at(-1)?.currentTime).toBe(250_000)
    expect(cueEvents(events).at(-1)?.epoch).toBeGreaterThan(0)

    controller.close()
    const countAfterClose = cueEvents(events).length
    video.currentTime = 1
    video.dispatch('timeupdate')
    expect(cueEvents(events)).toHaveLength(countAfterClose)
  })

  it('uses the Custom AudioContext clock and handles pause/rate/seek/EOS lifecycle', async () => {
    const canvas = { tagName: 'CANVAS' }
    let clock: AudioClockSnapshot = {
      source: 'audio-context',
      mediaTime: 0,
      contextTime: 0,
      renderedFrames: 0,
      sampleRate: 48_000,
      playbackRate: 1,
      running: false,
      underrun: false,
      epoch: 0,
    }
    const events: SubtitleManagerEvent[] = []
    const controller = new CoreSubtitleController({
      source: { kind: 'file', file: new Blob(['media']) as File },
      media,
      target: target(canvas),
      surface: canvas as unknown as HTMLCanvasElement,
      rendererKind: 'webgl2',
      subtitleOptions: { enabled: false },
      getCustomClock: () => clock,
      getCustomPlaying: () => clock.running,
      onEvent: (event) => events.push(event),
    })

    await controller.addTrack({ kind: 'file', file: subtitleFile(), format: 'srt' }, { id: 'custom' })
    await controller.selectTrack('custom')
    clock = { ...clock, mediaTime: 500_000, running: true, playbackRate: 1.5 }
    controller.rateChanged()
    controller.clockUpdate()
    expect(cueEvents(events).at(-1)?.currentTime).toBe(500_000)

    controller.pause()
    controller.seekStarted()
    clock = { ...clock, mediaTime: 250_000, epoch: 1, running: false }
    controller.seekCompleted()
    expect(cueEvents(events).at(-1)?.currentTime).toBe(250_000)

    clock = { ...clock, mediaTime: 2_000_000, running: false }
    controller.ended()
    expect(controller.state).toBe('ended')
    controller.close()
  })

  it('exposes the shared native host used by video and subtitle overlay for fullscreen', () => {
    const video = new FakeVideo()
    const document = new OverlayDocument()
    const host = new OverlayNode(document) as unknown as HTMLElement
    const controller = new CoreSubtitleController({
      source: { kind: 'file', file: new Blob(['media']) as File },
      media,
      target: { ...target(video), container: host },
      surface: video as unknown as HTMLVideoElement,
      rendererKind: null,
      onEvent: () => {},
    })

    expect(controller.fullscreenHost).toBe(host)
    controller.detachOverlay()
    expect(controller.fullscreenHost).toBeNull()
    controller.close()
  })

  it('keeps subtitle APIs usable and emits a recoverable warning without an overlay host', () => {
    const video = new FakeVideo()
    const events: SubtitleManagerEvent[] = []
    const controller = new CoreSubtitleController({
      source: { kind: 'file', file: new Blob(['media']) as File },
      media,
      target: target(video),
      surface: video as unknown as HTMLVideoElement,
      rendererKind: null,
      onEvent: (event) => events.push(event),
    })

    expect(events.some((event) => event.type === 'warning' && event.diagnostic.code === 'SUBTITLE_OVERLAY_UNAVAILABLE')).toBe(true)
    expect(controller.listTracks()).toEqual([])
    controller.close()
  })
})
