import { describe, expect, it, vi } from 'vitest'
import { NativePreviewController } from '../src/native/preview'

class FakePreviewVideo {
  muted = false
  preload = ''
  playsInline = false
  crossOrigin: string | null = null
  src = ''
  currentTime = 0
  readyState = 0
  seeking = false
  removed = false
  readonly load = vi.fn()
  readonly pause = vi.fn()
  readonly removeAttribute = vi.fn()
  readonly #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  setAttribute(): void {}
  remove(): void { this.removed = true }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.#listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
    listeners.add(listener)
    this.#listeners.set(type, listeners)
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.#listeners.get(type)?.delete(listener)
  }
  listenerCount(type: string): number { return this.#listeners.get(type)?.size ?? 0 }
}

class FakePreviewCanvas {
  width = 0
  height = 0
  removed = false
  remove(): void { this.removed = true }
  getContext(): null { return null }
  toBlob(callback: BlobCallback): void { callback(null) }
}

class FakePreviewDocument {
  readonly video = new FakePreviewVideo()
  readonly canvas = new FakePreviewCanvas()
  createElement(tag: string): FakePreviewVideo | FakePreviewCanvas {
    if (tag === 'video') return this.video
    if (tag === 'canvas') return this.canvas
    throw new Error('unexpected preview element')
  }
}

describe('isolated native preview controller', () => {
  it('removes media listeners when a metadata wait is cancelled and cleans owned surfaces', async () => {
    const document = new FakePreviewDocument()
    const preview = new NativePreviewController({
      source: { kind: 'url', url: 'https://media.test/video.webm' },
      contentType: 'video/webm; codecs="vp8, opus"',
      epoch: 1,
      duration: 10_000_000,
      ownerDocument: document as unknown as Document,
    })
    const caller = new AbortController()
    const request = preview.request({ time: 1_000_000, signal: caller.signal })
    expect(document.video.listenerCount('loadedmetadata')).toBe(1)
    expect(document.video.listenerCount('error')).toBe(1)

    caller.abort()
    await expect(request).resolves.toBeNull()
    expect(document.video.listenerCount('loadedmetadata')).toBe(0)
    expect(document.video.listenerCount('error')).toBe(0)

    preview.close()
    preview.close()
    expect(document.video.pause).toHaveBeenCalledOnce()
    expect(document.video.removeAttribute).toHaveBeenCalledWith('src')
    expect(document.video.load).toHaveBeenCalledTimes(2)
    expect(document.video.removed).toBe(true)
    expect(document.canvas.removed).toBe(true)
  })
})
