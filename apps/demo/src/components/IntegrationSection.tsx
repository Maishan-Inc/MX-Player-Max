import { Fragment, useMemo, useState } from 'react'
import { CheckIcon, CopyIcon } from './icons'
import { format, type DemoCopy } from '../i18n'

const NPM_INSTALL = 'pnpm add @mx-player-max/sdk @mx-player-max/ui'
const DOCS_URL = 'https://github.com/Maishan-Inc/MX-Player-Max/blob/main/docs/development/integration.md'

/** The first tab loads the bundle published beside this page; the rest install from npm. */
const NPM_TAB_IDS = new Set(['dom', 'react', 'vue'])

type IntegrationCopy = DemoCopy['integration']

interface Snippet {
  readonly id: string
  readonly label: string
  readonly lang: string
  readonly code: string
}

function buildSnippets(sdkBaseUrl: string, copy: IntegrationCopy): readonly Snippet[] {
  const comment = copy.comments
  return [
    {
      id: 'iife',
      label: 'HTML (Pages)',
      lang: 'html',
      code: `<link rel="stylesheet" href="${sdkBaseUrl}style.css">
<div id="player" style="position:relative;aspect-ratio:16/9"></div>

<!-- ${comment.pagesBundle} -->
<script src="${sdkBaseUrl}mx-player-max.iife.min.js"></script>
<script>
  // ${comment.iifeGlobal}
  const handle = MXPlayerMax.create({
    target: '#player',
    source: { kind: 'url', url: 'https://media.example.com/movie.mp4' },
    ui: { theme: 'dark', locale: 'auto' },
  })

  handle.ready.then(() => console.log('ready'))
</script>`,
    },
    {
      id: 'dom',
      label: 'JavaScript',
      lang: 'typescript',
      code: `import { MXPlayer } from '@mx-player-max/sdk'
import { attachPlayerUi } from '@mx-player-max/ui'
import '@mx-player-max/ui/style.css'

// ${comment.hostRequirement}
const host = document.querySelector<HTMLElement>('#player')!

const player = new MXPlayer({
  target: host,
  source: { kind: 'url', url: 'https://media.example.com/movie.mp4' },
  native: { crossOrigin: 'anonymous', preload: 'metadata' },
  subtitles: { enabled: true },
})

// ${comment.sharedContainer}
const ui = attachPlayerUi(player, host, {
  theme: 'system',
  locale: 'auto',
  share: { pageUrl: location.href, videoUrl: 'https://media.example.com/movie.mp4' },
})
await player.ready

// ${comment.sourceSwap}
await player.load({ target: host, source: { kind: 'file', file }, intent: 'normal' })

// ${comment.teardown}
ui.destroy()
player.destroy()`,
    },
    {
      id: 'react',
      label: 'React',
      lang: 'tsx',
      code: `import { useMemo, useRef } from 'react'
import { MXPlayer, type MXPlayerComponentHandle } from '@mx-player-max/react'
import '@mx-player-max/ui/style.css'

export function Player({ url }: { url: string }) {
  const ref = useRef<MXPlayerComponentHandle>(null)

  // ${comment.memoize}
  const playerOptions = useMemo(() => ({
    source: { kind: 'url' as const, url },
    subtitles: { enabled: true },
  }), [url])
  const uiOptions = useMemo(() => ({ theme: 'dark' as const, locale: 'auto' as const }), [])

  return (
    <>
      <div className="player-host" style={{ position: 'relative', aspectRatio: '16 / 9' }}>
        <MXPlayer ref={ref} playerOptions={playerOptions} uiOptions={uiOptions} />
      </div>
      <button onClick={() => void ref.current?.player?.play()}>${comment.playButton}</button>
    </>
  )
}`,
    },
    {
      id: 'vue',
      label: 'Vue 3',
      lang: 'vue',
      code: `<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { MXPlayer } from '@mx-player-max/vue'
import '@mx-player-max/ui/style.css'

const url = shallowRef('https://media.example.com/movie.mp4')
const playerOptions = computed(() => ({
  source: { kind: 'url' as const, url: url.value },
  subtitles: { enabled: true },
}))
const uiOptions = { theme: 'dark', locale: 'auto' } as const
</script>

<template>
  <!-- ${comment.adapterOrder} -->
  <MXPlayer
    class="player-host"
    :player-options="playerOptions"
    :ui-options="uiOptions"
  />
</template>`,
    },
  ]
}

interface IntegrationSectionProps {
  readonly sdkBaseUrl: string
  readonly version: string
  readonly copy: IntegrationCopy
}

export function IntegrationSection({ sdkBaseUrl, version, copy }: IntegrationSectionProps) {
  const snippets = useMemo(() => buildSnippets(sdkBaseUrl, copy), [sdkBaseUrl, copy])
  const [activeId, setActiveId] = useState(snippets[0]?.id ?? 'iife')
  const [copied, setCopied] = useState(false)
  const active = snippets.find((snippet) => snippet.id === activeId) ?? snippets[0]

  const copyActive = async (): Promise<void> => {
    if (!active) return
    try {
      await navigator.clipboard.writeText(active.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // clipboard is unavailable outside a secure context; the code can still be selected
    }
  }

  return (
    <section className="integration" aria-labelledby="integration-heading" data-demo-reveal>
      <div className="integration-intro">
        <h2 id="integration-heading">{copy.heading}</h2>
        <p>
          {copy.intro}{' '}
          <a href={DOCS_URL} target="_blank" rel="noreferrer">{copy.docsLink}</a>{copy.introSuffix}
        </p>
      </div>

      <div className="integration-panel">
        <div className="integration-tabbar">
          <div className="integration-tabgroup">
            <div className="integration-tabs" role="tablist" aria-label={copy.tabsLabel}>
              {snippets.map((snippet, index) => {
                const previous = snippets[index - 1]
                const startsNpmGroup = index > 0 && NPM_TAB_IDS.has(snippet.id)
                  && previous !== undefined && !NPM_TAB_IDS.has(previous.id)
                return (
                  <Fragment key={snippet.id}>
                    {startsNpmGroup && <span className="integration-tab-sep" aria-hidden="true" />}
                    <button
                      type="button"
                      role="tab"
                      id={`tab-${snippet.id}`}
                      aria-selected={snippet.id === activeId}
                      aria-controls={`panel-${snippet.id}`}
                      className={snippet.id === activeId ? 'is-active' : ''}
                      onClick={() => setActiveId(snippet.id)}
                    >
                      {snippet.label}
                    </button>
                  </Fragment>
                )
              })}
            </div>
            <code className="integration-npm">{NPM_INSTALL}</code>
          </div>
        </div>

        <div className="integration-code">
          <div className="integration-code-head">
            <span>{active?.lang}</span>
            <button type="button" onClick={() => { void copyActive() }} aria-label={copy.copyAria}>
              {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
              {copied ? copy.copied : copy.copy}
            </button>
          </div>
          {/* Every block shares one grid cell, so the container keeps the tallest height and
              switching tabs does not shift the page. */}
          <div className="integration-code-stack">
            {snippets.map((snippet) => (
              <pre
                key={snippet.id}
                role="tabpanel"
                id={`panel-${snippet.id}`}
                aria-labelledby={`tab-${snippet.id}`}
                aria-hidden={snippet.id === activeId ? undefined : true}
                className={snippet.id === activeId ? 'is-active' : ''}
              ><code>{snippet.code}</code></pre>
            ))}
          </div>
        </div>
      </div>

      <p className="integration-note">{format(copy.note, { version })}</p>
    </section>
  )
}
