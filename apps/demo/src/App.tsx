import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { gsap } from 'gsap'
import { MXPlayer, type MXPlayerComponentHandle } from '@mx-player-max/react'
import type { MXPlayer as SdkPlayer } from '@mx-player-max/sdk'
import type { PlaybackIntent, SourceDescriptor } from '@mx-player-max/types'
import type { TheaterModeAdapter } from '@mx-player-max/ui'
import { DiagnosticsPanel } from './components/DiagnosticsPanel'
import { IntegrationSection } from './components/IntegrationSection'
import {
  ArrowRightIcon,
  ChevronDownIcon,
  CloudIcon,
  FileUpIcon,
  GithubMark,
  MoonIcon,
  SunIcon,
} from './components/icons'
import { displayBuildVersion, REPOSITORY_URL, resolveDefaultMediaUrl, resolveSdkBaseUrl } from './deployment'
import { acceptMediaFile, FAQ_ITEMS, FEATURES, formatBytes, normalizeMediaUrl, REASONS, STEPS } from './landing'
import { initializeDemoReveal } from './reveal'

const BUILD_VERSION = displayBuildVersion(import.meta.env.VITE_APP_VERSION)
const THEME_KEY = 'mx-player-max:theme'

type DemoTheme = 'dark' | 'light'

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

function readStoredTheme(): DemoTheme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export default function App() {
  const defaultMediaUrl = resolveDefaultMediaUrl(import.meta.env.BASE_URL, window.location.href)
  const sdkBaseUrl = resolveSdkBaseUrl(import.meta.env.BASE_URL, window.location.href)
  const rootRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<MXPlayerComponentHandle>(null)
  const theaterMode = useMemo(() => new DemoTheaterMode(), [])
  const [theater, setTheater] = useState(false)
  const [theme, setTheme] = useState<DemoTheme>(readStoredTheme)
  const [url, setUrl] = useState(defaultMediaUrl)
  const [source, setSource] = useState<SourceDescriptor>(() => ({ kind: 'url', url: defaultMediaUrl }))
  const [intent, setIntent] = useState<PlaybackIntent>('normal')
  const [message, setMessage] = useState('Default CC0 sample')
  const [inputError, setInputError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [diagnosticPlayer, setDiagnosticPlayer] = useState<SdkPlayer | null>(null)
  const [diagnosticRevision, setDiagnosticRevision] = useState(0)

  useLayoutEffect(() => theaterMode.subscribe(setTheater), [theaterMode])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* private mode: keep the session value */ }
  }, [theme])

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
    theme,
    theaterMode,
    features: { theater: true, nextEpisode: false, statistics: true, about: true, preview: true },
  }), [theme, theaterMode])

  const playSource = (next: SourceDescriptor, label: string): void => {
    setSource(next)
    setMessage(label)
    setInputError('')
    setDiagnosticRevision((revision) => revision + 1)
  }

  const playFile = (file: File | undefined): void => {
    const outcome = acceptMediaFile(file)
    if (!outcome.ok) { setInputError(outcome.message); return }
    playSource({ kind: 'file', file: outcome.value }, `${outcome.value.name} · ${formatBytes(outcome.value.size)}`)
  }

  const playUrl = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const outcome = normalizeMediaUrl(url, window.location.href)
    if (!outcome.ok) { setInputError(outcome.message); return }
    playSource({ kind: 'url', url: outcome.value }, new URL(outcome.value).hostname)
  }

  const pickFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    playFile(file)
  }

  const attachSubtitle = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const track = await playerRef.current?.player?.addSubtitleTrack({ kind: 'file', file })
      if (track) await playerRef.current?.player?.selectSubtitleTrack(track.id)
      setMessage(`${file.name} subtitle attached`)
      setInputError('')
    } catch {
      setInputError('字幕文件无法挂载，请检查是否为 SRT 或 ASS 文本轨。')
    }
  }

  return (
    <div ref={rootRef} className={theater ? 'app-shell is-theater' : 'app-shell'}>
      <header className="topbar" data-demo-reveal>
        <div className="brand-block">
          <span className="brand-mark">MX</span>
          <span><strong>Player Max</strong><small>Modular web media engine</small></span>
        </div>
        <div className="runtime-status"><i aria-hidden="true" /><span>MX Player Max {BUILD_VERSION}</span></div>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-button"
            title="切换主题"
            aria-label="切换主题"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <SunIcon size={17} /> : <MoonIcon size={17} />}
          </button>
          <a className="github-link" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            <GithubMark /><span>Repository</span>
          </a>
        </div>
      </header>

      <main className="home-main">
        <section className="player-launcher" aria-labelledby="player-heading" data-demo-reveal>
          <h1 id="player-heading" className="sr-only">MX Player Max 播放工作台</h1>
          <div
            className={dragging ? 'player-stage is-dragging' : 'player-stage'}
            data-testid="player-stage"
            onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); playFile(event.dataTransfer.files[0]) }}
          >
            <MXPlayer ref={playerRef} className="player-mount" playerOptions={playerOptions} uiOptions={uiOptions} />
            {dragging && (
              <span className="stage-dropzone">
                <span className="empty-player-icon"><FileUpIcon size={34} /></span>
                <strong className="empty-player-title">松手即播</strong>
                <span className="empty-player-copy">本地文件只在这台机器上解析，不会上传</span>
              </span>
            )}
          </div>
          <div className="source-summary">
            <span>{source.kind === 'file' ? 'LOCAL FILE' : 'REMOTE URL'}</span>
            <strong>{message}</strong>
            <span>{intent.toUpperCase()}</span>
          </div>

          <form className="url-form" onSubmit={playUrl}>
            <CloudIcon size={18} />
            <label className="sr-only" htmlFor="media-url">远程媒体地址</label>
            <input
              id="media-url"
              value={url}
              onChange={(event) => { setUrl(event.target.value); setInputError('') }}
              placeholder="https://media.example.com/movie.mp4"
              inputMode="url"
              spellCheck={false}
            />
            <button type="submit" className="primary-button" disabled={!url.trim()}>
              播放 <ArrowRightIcon size={17} />
            </button>
          </form>

          <div className="launcher-actions">
            <label className="file-action">
              <FileUpIcon size={15} />打开本地媒体
              <input type="file" accept="video/*,audio/*,.mkv,.webm,.mp4,.mov" onChange={pickFile} />
            </label>
            <label className="file-action quiet">
              挂载字幕
              <input type="file" accept=".srt,.ass,.ssa,text/plain" onChange={(event) => { void attachSubtitle(event) }} />
            </label>
            <div className="mode-field">
              <label htmlFor="playback-intent">播放意图</label>
              <select
                id="playback-intent"
                value={intent}
                onChange={(event) => { setIntent(event.target.value as PlaybackIntent); setDiagnosticRevision((revision) => revision + 1) }}
              >
                <option value="normal">Normal / 原生优先</option>
                <option value="filters">Filters / 自定义管线</option>
                <option value="frame-access">Frame access / 自定义管线</option>
              </select>
            </div>
          </div>
          {inputError && <p className="input-error" role="alert">{inputError}</p>}
        </section>

        <section className="feature-strip" aria-label="播放器能力" data-demo-reveal>
          {FEATURES.map((feature) => (
            <div className="feature-item" key={feature.title}>
              <strong>{feature.title}</strong><span>{feature.text}</span>
            </div>
          ))}
        </section>

        <WhyChoose />
        <IntegrationSection sdkBaseUrl={sdkBaseUrl} version={BUILD_VERSION} />
        <HowItWorks />
        <DiagnosticsPanel player={diagnosticPlayer} resetKey={`${diagnosticRevision}:${intent}`} />
        <FAQ />
      </main>

      <footer className="site-footer" data-demo-reveal>
        <span>Native + WebCodecs + WASM · WebGPU / WebGL2 / Canvas2D</span>
        <span>MX Player Max {BUILD_VERSION} · PolyForm Noncommercial 1.0.0</span>
      </footer>
    </div>
  )
}

function WhyChoose() {
  return (
    <section className="why-choose" aria-labelledby="why-heading" data-demo-reveal>
      <div className="why-intro">
        <h2 id="why-heading">为什么是 MX Player Max</h2>
        <p>
          它不是一个页面播放器，而是一层可以复用的媒体能力：容器解析、后端选择、解码、渲染和音频时钟
          各自独立，可以单独替换或单独接入视频编辑器、监控回放、云游戏串流与在线转码预览。
        </p>
      </div>
      <div className="why-grid">
        {REASONS.map((reason) => (
          <article className="why-card" key={reason.title}>
            <strong>{reason.title}</strong><span>{reason.text}</span>
          </article>
        ))}
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section className="how-it-works" aria-labelledby="how-heading" data-demo-reveal>
      <div className="how-intro">
        <h2 id="how-heading">如何运作</h2>
        <p>从一个地址到画面上的一帧，播放器在你的浏览器里走完四步，媒体数据不经过任何中转服务。</p>
      </div>
      <ol className="how-steps">
        {STEPS.map((item) => (
          <li className="how-step" key={item.step}>
            <span className="how-step-index" aria-hidden="true">{item.step}</span>
            <div className="how-step-body"><strong>{item.title}</strong><span>{item.text}</span></div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function FAQ() {
  const [openQa, setOpenQa] = useState<number | null>(0)
  return (
    <section className="faq" aria-labelledby="faq-heading" data-demo-reveal>
      <h2 id="faq-heading">常见问题</h2>
      <div className="faq-list">
        {FAQ_ITEMS.map((item, index) => {
          const open = openQa === index
          return (
            <div className={open ? 'faq-item is-open' : 'faq-item'} key={item.q}>
              <button
                type="button"
                id={`faq-question-${index}`}
                className="faq-question"
                aria-expanded={open}
                aria-controls={`faq-panel-${index}`}
                onClick={() => setOpenQa(open ? null : index)}
              >
                <span>{item.q}</span>
                <span className={open ? 'faq-chevron is-open' : 'faq-chevron'}><ChevronDownIcon size={16} /></span>
              </button>
              <div className="faq-answer" id={`faq-panel-${index}`} role="region" aria-labelledby={`faq-question-${index}`}>
                <p>{item.a}</p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
