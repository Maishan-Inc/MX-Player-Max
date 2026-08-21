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
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  FileUpIcon,
  GithubMark,
  LanguagesIcon,
  MoonIcon,
  SunIcon,
} from './components/icons'
import { displayBuildVersion, REPOSITORY_URL, resolveDefaultMediaUrl, resolveSdkBaseUrl } from './deployment'
import { acceptMediaFile, formatBytes, normalizeMediaUrl, type SourceRejection } from './landing'
import {
  DEMO_LANGUAGES,
  DEMO_LOCALE_STORAGE_KEY,
  demoCopy,
  detectDemoLocale,
  format,
  type DemoCopy,
  type DemoLocale,
} from './i18n'
import { initializeDemoReveal } from './reveal'

const BUILD_VERSION = displayBuildVersion(import.meta.env.VITE_APP_VERSION)
const THEME_KEY = 'mx-player-max:theme'

type DemoTheme = 'dark' | 'light'

/** Kept structural so the summary line re-renders in the newly picked language. */
type SourceLabel =
  | { readonly kind: 'default' }
  | { readonly kind: 'file'; readonly name: string; readonly size: number }
  | { readonly kind: 'host'; readonly host: string }
  | { readonly kind: 'subtitle'; readonly name: string }

type InputFault = SourceRejection | 'subtitle'

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

function readStoredLocale(): DemoLocale {
  let stored: string | null = null
  try { stored = localStorage.getItem(DEMO_LOCALE_STORAGE_KEY) } catch { stored = null }
  const preferences = typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language]
  return detectDemoLocale(stored, preferences)
}

function faultMessage(fault: InputFault, copy: DemoCopy): string {
  switch (fault) {
    case 'no-file': return copy.errors.noFile
    case 'not-media': return copy.errors.notMedia
    case 'empty-url': return copy.errors.emptyUrl
    case 'bad-url': return copy.errors.badUrl
    case 'bad-protocol': return copy.errors.badProtocol
    case 'subtitle': return copy.player.subtitleError
  }
}

function sourceMessage(label: SourceLabel, copy: DemoCopy): string {
  if (label.kind === 'default') return copy.player.defaultSample
  if (label.kind === 'host') return label.host
  if (label.kind === 'subtitle') return format(copy.player.subtitleAttached, { name: label.name })
  return `${label.name} · ${formatBytes(label.size) ?? copy.player.unknownSize}`
}

export default function App() {
  const defaultMediaUrl = resolveDefaultMediaUrl(import.meta.env.BASE_URL, window.location.href)
  const sdkBaseUrl = resolveSdkBaseUrl(import.meta.env.BASE_URL, window.location.href)
  const rootRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<MXPlayerComponentHandle>(null)
  const languageRef = useRef<HTMLDivElement>(null)
  const theaterMode = useMemo(() => new DemoTheaterMode(), [])
  const [theater, setTheater] = useState(false)
  const [theme, setTheme] = useState<DemoTheme>(readStoredTheme)
  const [locale, setLocale] = useState<DemoLocale>(readStoredLocale)
  const [languageOpen, setLanguageOpen] = useState(false)
  const [url, setUrl] = useState(defaultMediaUrl)
  const [mediaUrl, setMediaUrl] = useState(defaultMediaUrl)
  const [source, setSource] = useState<SourceDescriptor>(() => ({ kind: 'url', url: defaultMediaUrl }))
  const [intent, setIntent] = useState<PlaybackIntent>('normal')
  const [label, setLabel] = useState<SourceLabel>({ kind: 'default' })
  const [fault, setFault] = useState<InputFault | null>(null)
  const [dragging, setDragging] = useState(false)
  const [diagnosticPlayer, setDiagnosticPlayer] = useState<SdkPlayer | null>(null)
  const [diagnosticRevision, setDiagnosticRevision] = useState(0)

  const copy = demoCopy(locale)
  const activeLanguage = DEMO_LANGUAGES.find((language) => language.code === locale) ?? DEMO_LANGUAGES[0]

  useLayoutEffect(() => theaterMode.subscribe(setTheater), [theaterMode])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* private mode: keep the session value */ }
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = copy.htmlLang
    document.title = copy.documentTitle
    document.querySelector('meta[name="description"]')?.setAttribute('content', copy.documentDescription)
    try { localStorage.setItem(DEMO_LOCALE_STORAGE_KEY, locale) } catch { /* private mode: keep the session value */ }
  }, [locale, copy])

  useEffect(() => {
    if (!languageOpen) return
    const dismiss = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && languageRef.current?.contains(target)) return
      setLanguageOpen(false)
    }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setLanguageOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return (): void => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [languageOpen])

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
        // The compositing hint lives on the shell for the duration of the entrance only; see the
        // note beside `[data-demo-revealing]` in styles.css.
        scope.dataset.demoRevealing = 'true'
        gsap.fromTo('[data-demo-reveal]', { y: 12, autoAlpha: 0 }, {
          y: 0,
          autoAlpha: 1,
          duration: 0.55,
          stagger: 0.06,
          ease: 'power2.out',
          clearProps: 'transform,visibility,opacity',
          onComplete: () => { delete scope.dataset.demoRevealing },
        })
      }, scope)
      return (): void => { delete scope.dataset.demoRevealing; context.revert() }
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
    locale,
    theaterMode,
    features: { theater: true, nextEpisode: false, statistics: true, about: true, preview: true },
    share: { pageUrl: window.location.href, videoUrl: mediaUrl, title: copy.documentTitle },
  }), [theme, locale, theaterMode, mediaUrl, copy.documentTitle])

  const playSource = (next: SourceDescriptor, nextLabel: SourceLabel): void => {
    setSource(next)
    setLabel(nextLabel)
    setFault(null)
    setMediaUrl(next.kind === 'url' ? next.url : window.location.href)
    setDiagnosticRevision((revision) => revision + 1)
  }

  const playFile = (file: File | undefined): void => {
    const outcome = acceptMediaFile(file)
    if (!outcome.ok) { setFault(outcome.reason); return }
    playSource({ kind: 'file', file: outcome.value }, { kind: 'file', name: outcome.value.name, size: outcome.value.size })
  }

  const playUrl = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const outcome = normalizeMediaUrl(url, window.location.href)
    if (!outcome.ok) { setFault(outcome.reason); return }
    playSource({ kind: 'url', url: outcome.value }, { kind: 'host', host: new URL(outcome.value).hostname })
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
      setLabel({ kind: 'subtitle', name: file.name })
      setFault(null)
    } catch {
      setFault('subtitle')
    }
  }

  return (
    <div ref={rootRef} className={theater ? 'app-shell is-theater' : 'app-shell'}>
      <header className="topbar" data-demo-reveal>
        <div className="brand-block">
          {/* Case-sensitive wordmark: the inverted chip highlights the middle word only. */}
          <span className="brand-wordmark">MX <span className="brand-chip">Player</span> Max</span>
        </div>
        <div className="runtime-status"><i aria-hidden="true" /><span>MX Player Max {BUILD_VERSION}</span></div>
        <div className="topbar-actions">
          <div className="lang-switch" ref={languageRef}>
            <button
              type="button"
              className="lang-trigger"
              aria-haspopup="listbox"
              aria-expanded={languageOpen}
              aria-label={copy.nav.language}
              onClick={() => setLanguageOpen(!languageOpen)}
            >
              <LanguagesIcon size={15} />
              <span>{activeLanguage?.short}</span>
              <ChevronDownIcon size={11} />
            </button>
            {languageOpen && (
              <ul className="lang-menu" role="listbox" aria-label={copy.nav.language}>
                {DEMO_LANGUAGES.map((language) => (
                  <li key={language.code}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={language.code === locale}
                      lang={language.code}
                      onClick={() => { setLocale(language.code); setLanguageOpen(false) }}
                    >
                      <span>{language.name}</span>
                      {language.code === locale && <CheckIcon size={13} />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            title={copy.nav.theme}
            aria-label={copy.nav.theme}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <SunIcon size={17} /> : <MoonIcon size={17} />}
          </button>
          <a className="github-link" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            <GithubMark /><span>{copy.nav.repository}</span>
          </a>
        </div>
      </header>

      <main className="home-main">
        <section className="player-launcher" aria-labelledby="player-heading" data-demo-reveal>
          <h1 id="player-heading" className="sr-only">{copy.player.heading}</h1>
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
                <strong className="empty-player-title">{copy.player.dropTitle}</strong>
                <span className="empty-player-copy">{copy.player.dropCopy}</span>
              </span>
            )}
          </div>
          <div className="source-summary">
            <span>{source.kind === 'file' ? copy.player.localFile : copy.player.remoteUrl}</span>
            <strong>{sourceMessage(label, copy)}</strong>
            <span>{intent.toUpperCase()}</span>
          </div>

          <form className="url-form" onSubmit={playUrl}>
            <CloudIcon size={18} />
            <label className="sr-only" htmlFor="media-url">{copy.player.urlLabel}</label>
            <input
              id="media-url"
              value={url}
              onChange={(event) => { setUrl(event.target.value); setFault(null) }}
              placeholder={copy.player.urlPlaceholder}
              inputMode="url"
              spellCheck={false}
            />
            <button type="submit" className="primary-button" disabled={!url.trim()}>
              {copy.player.play} <ArrowRightIcon size={17} />
            </button>
          </form>

          <div className="launcher-actions">
            <label className="file-action">
              <FileUpIcon size={15} />{copy.player.openLocal}
              <input type="file" accept="video/*,audio/*,.mkv,.webm,.mp4,.mov" onChange={pickFile} />
            </label>
            <label className="file-action quiet">
              {copy.player.attachSubtitle}
              <input type="file" accept=".srt,.ass,.ssa,text/plain" onChange={(event) => { void attachSubtitle(event) }} />
            </label>
            <div className="mode-field">
              <label htmlFor="playback-intent">{copy.player.intentLabel}</label>
              <select
                id="playback-intent"
                value={intent}
                onChange={(event) => { setIntent(event.target.value as PlaybackIntent); setDiagnosticRevision((revision) => revision + 1) }}
              >
                <option value="normal">{copy.player.intentNormal}</option>
                <option value="filters">{copy.player.intentFilters}</option>
                <option value="frame-access">{copy.player.intentFrameAccess}</option>
              </select>
            </div>
          </div>
          {fault && <p className="input-error" role="alert">{faultMessage(fault, copy)}</p>}
        </section>

        <section className="feature-strip" aria-label={copy.player.featuresLabel} data-demo-reveal>
          {copy.features.map((feature) => (
            <div className="feature-item" key={feature.title}>
              <strong>{feature.title}</strong><span>{feature.text}</span>
            </div>
          ))}
        </section>

        <WhyChoose copy={copy} />
        <IntegrationSection sdkBaseUrl={sdkBaseUrl} version={BUILD_VERSION} copy={copy.integration} />
        <HowItWorks copy={copy} />
        <DiagnosticsPanel player={diagnosticPlayer} resetKey={`${diagnosticRevision}:${intent}`} copy={copy.diagnostics} />
        <FAQ copy={copy} />
      </main>

      <footer className="site-footer" data-demo-reveal>
        <span>{copy.footer.stack}</span>
        <span>{format(copy.footer.license, { version: BUILD_VERSION })}</span>
      </footer>
    </div>
  )
}

function WhyChoose({ copy }: { readonly copy: DemoCopy }) {
  return (
    <section className="why-choose" aria-labelledby="why-heading" data-demo-reveal>
      <div className="why-intro">
        <h2 id="why-heading">{copy.why.heading}</h2>
        <p>{copy.why.intro}</p>
      </div>
      <div className="why-grid">
        {copy.why.reasons.map((reason) => (
          <article className="why-card" key={reason.title}>
            <strong>{reason.title}</strong><span>{reason.text}</span>
          </article>
        ))}
      </div>
    </section>
  )
}

function HowItWorks({ copy }: { readonly copy: DemoCopy }) {
  return (
    <section className="how-it-works" aria-labelledby="how-heading" data-demo-reveal>
      <div className="how-intro">
        <h2 id="how-heading">{copy.how.heading}</h2>
        <p>{copy.how.intro}</p>
      </div>
      <ol className="how-steps">
        {copy.how.steps.map((item) => (
          <li className="how-step" key={item.step}>
            <span className="how-step-index" aria-hidden="true">{item.step}</span>
            <div className="how-step-body"><strong>{item.title}</strong><span>{item.text}</span></div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function FAQ({ copy }: { readonly copy: DemoCopy }) {
  const [openQa, setOpenQa] = useState<number | null>(0)
  return (
    <section className="faq" aria-labelledby="faq-heading" data-demo-reveal>
      <h2 id="faq-heading">{copy.faq.heading}</h2>
      <div className="faq-list">
        {copy.faq.items.map((item, index) => {
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
