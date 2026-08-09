import { afterEach, describe, expect, it, vi } from 'vitest'
import { SubtitleOverlay, LocalSubtitleStyleStore, MemorySubtitleStyleStore, DEFAULT_SUBTITLE_STYLE, normalizeSubtitleStyle, subtitleStyleScope } from '../src/index'

class FakeNode {
  readonly children: FakeNode[] = []
  readonly style: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  parentNode: FakeNode | null = null
  textContent = ''
  firstChild: FakeNode | null = null
  ownerDocument: FakeDocument
  constructor(document: FakeDocument) { this.ownerDocument = document }
  appendChild(child: FakeNode): FakeNode { this.children.push(child); child.parentNode = this; this.firstChild = this.children[0] ?? null; return child }
  removeChild(child: FakeNode): FakeNode { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; this.firstChild = this.children[0] ?? null; return child }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  addEventListener(): void {}
  removeEventListener(): void {}
}

class FakeDocument {
  readonly defaultView = { addEventListener: vi.fn(), removeEventListener: vi.fn(), devicePixelRatio: 2 }
  createElement = vi.fn(() => new FakeNode(this))
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
}

class FakeStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('subtitle style store', () => {
  it('scopes styles and falls back after corrupted storage', () => {
    const storage = new FakeStorage()
    vi.stubGlobal('localStorage', storage)
    const store = new LocalSubtitleStyleStore(new MemorySubtitleStyleStore())
    store.save('example.test', { fontSize: 48, color: '#00FF00' })
    expect(store.load('example.test').fontSize).toBe(48)
    expect(store.load('other.test')).toMatchObject(DEFAULT_SUBTITLE_STYLE)
    storage.values.forEach((_value, key) => storage.values.set(key, JSON.stringify({ version: 1, style: { fontSize: 48, unexpected: true } })))
    expect(store.load('example.test')).toEqual(DEFAULT_SUBTITLE_STYLE)
    storage.values.forEach((_value, key) => storage.values.set(key, '{broken'))
    expect(store.load('example.test')).toMatchObject(DEFAULT_SUBTITLE_STYLE)
  })

  it('uses stable local/origin scopes and rejects unsafe font stack fragments', () => {
    expect(subtitleStyleScope({ kind: 'file', file: new Blob(['x']) as File })).toBe('local-file')
    expect(subtitleStyleScope({ kind: 'url', url: 'https://media.example.test/path/video?token=secret' })).toBe('https://media.example.test')
    vi.stubGlobal('document', { baseURI: 'https://app.example.test/player/' })
    expect(subtitleStyleScope({ kind: 'url', url: '../media/video.webm' })).toBe('https://app.example.test')
    expect(normalizeSubtitleStyle({ fontFamily: 'Arial; background: url(https://bad.test)' }).fontFamily).toBe(DEFAULT_SUBTITLE_STYLE.fontFamily)
  })
})

describe('subtitle overlay', () => {
  it('renders multiple cues as safe text nodes and cleans up on close', () => {
    const document = new FakeDocument()
    const host = new FakeNode(document)
    host.style.position = 'static'
    const overlay = new SubtitleOverlay({ getDevicePixelRatio: () => 2 })
    overlay.attach(host as unknown as HTMLElement, 'canvas2d')
    expect(host.style.position).toBe('relative')
    overlay.render([
      { cueId: 'one', trackId: 't', start: 0, end: 1, text: '<script>bad()</script>', layer: 0 },
      { cueId: 'two', trackId: 't', start: 0, end: 1, text: 'line 1\nline 2', layer: 1 },
    ])
    expect(host.children).toHaveLength(1)
    const root = host.children[0]
    expect(root?.attributes.get('data-mxp-dpr')).toBe('2')
    const allText = flattenText(root)
    expect(allText).toContain('<script>bad()</script>')
    expect(allText).toContain('line 1\nline 2')
    overlay.close()
    expect(host.children).toHaveLength(0)
    expect(host.style.position).toBe('static')
  })

  it('updates DPR on resize and detaches listeners before late layout callbacks', () => {
    let dpr = 1
    class FakeResizeObserver {
      static callback: (() => void) | null = null
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(callback: () => void) { FakeResizeObserver.callback = callback }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const document = new FakeDocument()
    const host = new FakeNode(document)
    const overlay = new SubtitleOverlay({ getDevicePixelRatio: () => dpr })
    overlay.attach(host as unknown as HTMLElement, 'webgpu')
    dpr = 3
    FakeResizeObserver.callback?.()
    expect(host.children[0]?.attributes.get('data-mxp-dpr')).toBe('3')
    overlay.close()
    FakeResizeObserver.callback?.()
    expect(host.children).toHaveLength(0)
    expect(document.removeEventListener).toHaveBeenCalledWith('fullscreenchange', expect.any(Function))
    expect(document.defaultView.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
  })

  it('anchors top, middle, and bottom alignments at distinct vertical origins', () => {
    const document = new FakeDocument()
    const host = new FakeNode(document)
    const overlay = new SubtitleOverlay()
    overlay.attach(host as unknown as HTMLElement, 'native-video')

    const renderAt = (alignment: 'top-left' | 'middle-center' | 'bottom-right'): string | undefined => {
      overlay.render([{ cueId: alignment, trackId: 't', start: 0, end: 1, text: alignment, layer: 0, style: { alignment } }])
      return host.children[0]?.children[0]?.style.transform
    }

    expect(renderAt('top-left')).toBe('translate(0, 0)')
    expect(renderAt('middle-center')).toBe('translate(-50%, -50%)')
    expect(renderAt('bottom-right')).toBe('translate(-100%, -100%)')
    overlay.close()
  })
})

function flattenText(node: FakeNode | undefined): string {
  if (!node) return ''
  return `${node.textContent}${node.children.map((child) => flattenText(child)).join('')}`
}
