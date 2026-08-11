import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { gsap } from 'gsap'
import { MXPlayer, type MXPlayerComponentHandle } from '@mx-player-max/react'
import type { MXPlayer as SdkPlayer } from '@mx-player-max/sdk'
import type { PlaybackIntent, SourceDescriptor } from '@mx-player-max/types'
import type { TheaterModeAdapter } from '@mx-player-max/ui'
import { DiagnosticsPanel } from './components/DiagnosticsPanel'
import { initializeDemoReveal } from './reveal'

const DEFAULT_MEDIA = '/flower.webm'

class DemoTheaterMode implements TheaterModeAdapter {
  #active = false
  readonly #listeners = new Set<(active: boolean) => void>()

  getState(): boolean { return this.#active }
  setState(active: boolean): void {
    if (active === this.#active) return
    this.#active = active
    for (const listener of this.#listeners) listener(active)
  }
  subscribe(listener: (active: boolean) => void): () => void {
    this.#listeners.add(listener)
    return (): void => { this.#listeners.delete(listener) }
  }
}

export default function App() {
  const rootRef = useRef<HTMLElement>(null)
  const playerRef = useRef<MXPlayerComponentHandle>(null)
  const theaterMode = useMemo(() => new DemoTheaterMode(), [])
  const [theater, setTheater] = useState(false)
  const [url, setUrl] = useState(DEFAULT_MEDIA)
  const [source, setSource] = useState<SourceDescriptor>(() => ({
    kind: 'url',
    url: new URL(DEFAULT_MEDIA, window.location.href).href,
  }))
  const [intent, setIntent] = useState<PlaybackIntent>('normal')
  const [message, setMessage] = useState('Default CC0 sample')
  const [diagnosticPlayer, setDiagnosticPlayer] = useState<SdkPlayer | null>(null)
  const [diagnosticRevision, setDiagnosticRevision] = useState(0)

  useLayoutEffect(() => theaterMode.subscribe(setTheater), [theaterMode])

  useEffect(() => {
    let frame = 0
    const connect = (): void => {
      const player = playerRef.current?.player ?? null
      if (player) { setDiagnosticPlayer(player); return }
      frame = window.requestAnimationFrame(connect)
    }
    connect()
    return (): void => window.cancelAnimationFrame(frame)
  }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    return initializeDemoReveal(root, reduce, (scope, reducedMotion) => {
      const context = gsap.context(() => {
        if (reducedMotion) { gsap.set('[data-demo-reveal]', { autoAlpha: 1 }); return }
        gsap.fromTo('[data-demo-reveal]', { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.55, stagger: 0.06, ease: 'power2.out', clearProps: 'transform,visibility,opacity' })
      }, scope)
      return (): void => context.revert()
    })
  }, [])

  const playerOptions = useMemo(() => ({
    source,
    intent,
    native: { preload: 'metadata' as const, crossOrigin: 'anonymous' as const },
    subtitles: { enabled: true },
  }), [source, intent])

  const uiOptions = useMemo(() => ({
    theme: 'dark' as const,
    theaterMode,
    features: { theater: true, nextEpisode: false, statistics: true, about: true, preview: true },
  }), [theaterMode])

  const loadUrl = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    try {
      const parsed = new URL(url, window.location.href)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('protocol')
      setSource({ kind: 'url', url: parsed.href })
      setDiagnosticRevision((revision) => revision + 1)
      setMessage(parsed.hostname)
    } catch {
      setMessage('Enter a valid HTTP or HTTPS media URL')
    }
  }

  const loadFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    if (!file) return
    setSource({ kind: 'file', file })
    setDiagnosticRevision((revision) => revision + 1)
    setMessage(`${file.name} · ${formatBytes(file.size)}`)
    event.target.value = ''
  }

  const loadSubtitle = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const track = await playerRef.current?.player?.addSubtitleTrack({ kind: 'file', file })
      if (track) await playerRef.current?.player?.selectSubtitleTrack(track.id)
      setMessage(`${file.name} subtitle attached`)
    } catch {
      setMessage('Subtitle could not be attached')
    }
  }

  return (
    <main ref={rootRef} className={theater ? 'demo-shell is-theater' : 'demo-shell'}>
      <header className="topbar" data-demo-reveal>
        <div className="brand-block"><span className="brand-mark">MX</span><span><strong>Player Max</strong><small>Playback workbench</small></span></div>
        <div className="runtime-status"><i aria-hidden="true" /><span>Phase 12 public API workbench</span></div>
        <a href="https://github.com/" target="_blank" rel="noreferrer">Repository</a>
      </header>

      <section className="workbench" data-demo-reveal>
        <div className="player-column">
          <div className="player-stage" data-testid="player-stage">
            <MXPlayer ref={playerRef} className="player-mount" playerOptions={playerOptions} uiOptions={uiOptions} />
          </div>
          <div className="source-summary"><span>{source.kind === 'file' ? 'LOCAL FILE' : 'REMOTE URL'}</span><strong>{message}</strong><span>{intent.toUpperCase()}</span></div>
        </div>

        <aside className="control-rail" aria-label="Playback source controls">
          <div className="rail-heading"><span>Source</span><strong>Open media</strong></div>
          <form onSubmit={loadUrl} className="url-form">
            <label htmlFor="media-url">Remote media URL</label>
            <div className="field-row"><input id="media-url" value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} /><button type="submit">Load</button></div>
          </form>
          <div className="file-actions">
            <label className="file-action">Open local media<input type="file" accept="video/*,audio/*,.mkv,.webm,.mp4,.mov" onChange={loadFile} /></label>
            <label className="file-action quiet">Attach subtitles<input type="file" accept=".srt,.ass,.ssa,text/plain" onChange={(event) => { void loadSubtitle(event) }} /></label>
          </div>
          <div className="mode-field">
            <label htmlFor="playback-intent">Playback intent</label>
            <select id="playback-intent" value={intent} onChange={(event) => { setIntent(event.target.value as PlaybackIntent); setDiagnosticRevision((revision) => revision + 1) }}>
              <option value="normal">Normal / Native first</option>
              <option value="filters">Filters / Custom path</option>
              <option value="frame-access">Frame access / Custom path</option>
            </select>
          </div>
          <dl className="rail-notes">
            <div><dt>Controls</dt><dd>SDK snapshot driven</dd></div>
            <div><dt>Surface</dt><dd>Video or canvas</dd></div>
            <div><dt>Styles</dt><dd>External CSS export</dd></div>
          </dl>
        </aside>
      </section>

      <DiagnosticsPanel player={diagnosticPlayer} resetKey={`${diagnosticRevision}:${intent}`} />

      <footer data-demo-reveal><span>Native + WebCodecs + WebGPU/WebGL2/Canvas2D</span><span>Chrome · Firefox · macOS Safari verification tracked separately</span></footer>
    </main>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
