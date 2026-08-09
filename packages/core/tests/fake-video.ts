export interface FakeTimeRange { start: number; end: number }

export class FakeVideo {
  tagName = 'VIDEO'
  ownerDocument: FakeDocument | null = null
  parentNode: { removeChild: (node: unknown) => void } | null = null
  private crossOriginValue: string | null = null
  preload = ''
  playsInline = false
  playbackRate = 1
  volume = 1
  muted = false
  paused = true
  ended = false
  seeking = false
  readyState = 0
  duration = Number.NaN
  currentTime = 0
  bufferedRanges: FakeTimeRange[] = []
  playedRanges: FakeTimeRange[] = []
  error: { code?: number } | null = null
  private sourceValue = ''
  contentType = ''
  loaded = false
  playReject: unknown = null
  fullscreenReject: unknown = null
  pipReject: unknown = null
  private listeners = new Map<string, Set<(event?: unknown) => void>>()
  private frameCallbacks = new Map<number, (timestamp: number, metadata: VideoFrameCallbackMetadata) => void>()
  private nextFrameId = 1
  order: string[] = []

  get crossOrigin(): string | null { return this.crossOriginValue }
  set crossOrigin(value: string | null) { this.order.push('crossOrigin'); this.crossOriginValue = value }
  get src(): string { return this.sourceValue }
  set src(value: string) { this.order.push('src'); this.sourceValue = value }

  setAttribute(name: string, value: string): void {
    if (name === 'type') this.contentType = value
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
    if (name === 'type') this.contentType = ''
  }

  appendChild(): void {}

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    let values = this.listeners.get(type)
    if (!values) { values = new Set(); this.listeners.set(type, values) }
    values.add(listener)
  }

  removeEventListener(type: string, listener: (event?: unknown) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
  }

  load(): void {
    this.order.push('load')
    this.loaded = true
    this.readyState = 1
    this.duration = 12.5
    this.dispatch('loadedmetadata')
  }

  play(): Promise<void> {
    this.order.push('play')
    if (this.playReject !== null) return Promise.reject(this.playReject)
    this.paused = false
    this.dispatch('play')
    this.dispatch('playing')
    return Promise.resolve()
  }

  pause(): void {
    this.paused = true
    this.dispatch('pause')
  }

  fastSeek(value: number): void {
    this.currentTime = value
    this.seeking = false
    this.dispatch('seeked')
  }

  get buffered(): TimeRanges {
    const ranges = this.bufferedRanges
    return {
      length: ranges.length,
      start: (index: number) => ranges[index]?.start ?? 0,
      end: (index: number) => ranges[index]?.end ?? 0,
    } as TimeRanges
  }

  get played(): TimeRanges {
    const ranges = this.playedRanges
    return {
      length: ranges.length,
      start: (index: number) => ranges[index]?.start ?? 0,
      end: (index: number) => ranges[index]?.end ?? 0,
    } as TimeRanges
  }

  requestVideoFrameCallback(callback: (timestamp: number, metadata: VideoFrameCallbackMetadata) => void): number {
    const id = this.nextFrameId++
    this.frameCallbacks.set(id, callback)
    return id
  }

  cancelVideoFrameCallback(id: number): void { this.frameCallbacks.delete(id) }

  fireFrame(): void {
    const entry = this.frameCallbacks.entries().next().value as [number, (timestamp: number, metadata: VideoFrameCallbackMetadata) => void] | undefined
    if (!entry) return
    this.frameCallbacks.delete(entry[0])
    entry[1](1000, { presentedFrames: 4, mediaTime: 1.5 } as VideoFrameCallbackMetadata)
  }

  requestFullscreen(): Promise<void> { return this.fullscreenReject === null ? Promise.resolve() : Promise.reject(this.fullscreenReject) }
  requestPictureInPicture(): Promise<void> { return this.pipReject === null ? Promise.resolve() : Promise.reject(this.pipReject) }
  getVideoPlaybackQuality(): { totalVideoFrames: number; droppedVideoFrames: number } { return { totalVideoFrames: 5, droppedVideoFrames: 1 } }
}

export class FakeDocument {
  fullscreenEnabled = true
  pictureInPictureEnabled = true
  baseURI = 'https://example.test/'
  exitFullscreen = (): Promise<void> => Promise.resolve()
  exitPictureInPicture = (): Promise<void> => Promise.resolve()
  created: FakeVideo[] = []

  createElement(tag: string): FakeVideo {
    if (tag !== 'video') throw new Error('unexpected tag')
    const video = new FakeVideo()
    video.ownerDocument = this
    this.created.push(video)
    return video
  }

  querySelector(): FakeVideo | null { return null }
}
