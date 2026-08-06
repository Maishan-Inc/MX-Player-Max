import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'

const systems = [
  ['01', 'Native path', 'Hardware-first playback for the formats your browser already understands.'],
  ['02', 'Frame pipeline', 'WebCodecs and WASM become interchangeable frame producers.'],
  ['03', 'Adaptive runtime', 'Codec, device, browser and power signals shape every decision.'],
]

export default function App() {
  const rootRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const context = gsap.context(() => {
      gsap.fromTo('[data-reveal]', { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.85, stagger: 0.1, ease: 'power3.out' })
      gsap.fromTo('[data-orbit]', { rotate: -8, scale: 0.94, opacity: 0 }, { rotate: 0, scale: 1, opacity: 1, duration: 1.4, ease: 'expo.out' })
    }, root)
    return () => context.revert()
  }, [])

  return (
    <main ref={rootRef} className="demo-shell">
      <nav className="topbar" data-reveal>
        <span className="wordmark">MX<span>/</span>MAX</span>
        <span className="topbar-status"><i /> engine architecture preview</span>
        <a href="https://github.com/" target="_blank" rel="noreferrer">GitHub ↗</a>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow" data-reveal>MEDIA ENGINE CORE / 001</p>
          <h1 data-reveal>One runtime.<br /><em>Every frame.</em></h1>
          <p className="hero-lede" data-reveal>MX-Player-Max chooses the right path before the first frame: native playback when it is best, custom frames when they matter.</p>
          <div className="hero-actions" data-reveal>
            <button type="button">Open playground</button>
            <button type="button" className="quiet">Read the architecture</button>
          </div>
        </div>
        <div className="signal-orbit" data-orbit aria-label="Playback strategy visualization">
          <div className="orbit-ring ring-one" />
          <div className="orbit-ring ring-two" />
          <div className="orbit-core"><span>MX</span><small>FRAME<br />ADAPTER</small></div>
          <span className="orbit-label label-native">HTMLVIDEO</span>
          <span className="orbit-label label-codecs">WEBCODECS</span>
          <span className="orbit-label label-wasm">WASM</span>
        </div>
      </section>
      <section className="system-grid">
        {systems.map(([number, title, text]) => <article key={number} data-reveal><span>{number}</span><h2>{title}</h2><p>{text}</p></article>)}
      </section>
      <footer data-reveal><span>DESIGNED FOR THE WEB MEDIA STACK</span><span>DOCKER / NPM / ESM / WEBGPU</span></footer>
    </main>
  )
}

