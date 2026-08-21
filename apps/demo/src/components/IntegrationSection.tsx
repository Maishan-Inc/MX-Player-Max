import { Fragment, useMemo, useState } from 'react'
import { CheckIcon, CopyIcon } from './icons'

const NPM_INSTALL = 'pnpm add @mx-player-max/sdk @mx-player-max/ui'
const DOCS_URL = 'https://github.com/Maishan-Inc/MX-Player-Max/blob/main/docs/development/integration.md'

/** The first tab loads the bundle published beside this page; the rest install from npm. */
const NPM_TAB_IDS = new Set(['dom', 'react', 'vue'])

interface Snippet {
  readonly id: string
  readonly label: string
  readonly lang: string
  readonly code: string
}

function buildSnippets(sdkBaseUrl: string): readonly Snippet[] {
  return [
    {
      id: 'iife',
      label: 'HTML (Pages)',
      lang: 'html',
      code: `<link rel="stylesheet" href="${sdkBaseUrl}style.css">
<div id="player" style="position:relative;aspect-ratio:16/9"></div>

<!-- 这份 bundle 与本页一起发布，跟随站点最新一次部署。 -->
<script src="${sdkBaseUrl}mx-player-max.iife.min.js"></script>
<script>
  // IIFE 只暴露一个全局名。
  const handle = MXPlayerMax.create({
    target: '#player',
    source: { kind: 'url', url: 'https://media.example.com/movie.mp4' },
    ui: { theme: 'dark' },
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

// 宿主必须有稳定尺寸和定位上下文：position: relative; aspect-ratio: 16 / 9。
const host = document.querySelector<HTMLElement>('#player')!

const player = new MXPlayer({
  target: host,
  source: { kind: 'url', url: 'https://media.example.com/movie.mp4' },
  native: { crossOrigin: 'anonymous', preload: 'metadata' },
  subtitles: { enabled: true },
})

// UI 与 SDK 共享同一个容器，引擎不反向依赖 UI。
const ui = attachPlayerUi(player, host, { theme: 'system' })
await player.ready

// 换源不需要重建实例，ready 始终指向当前 load。
await player.load({ target: host, source: { kind: 'file', file }, intent: 'normal' })

// 卸载顺序固定：先 UI，再引擎。
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

  // 顶层 identity 变化会分别触发 load() 与 update()，生产组件务必 memoize。
  const playerOptions = useMemo(() => ({
    source: { kind: 'url' as const, url },
    subtitles: { enabled: true },
  }), [url])
  const uiOptions = useMemo(() => ({ theme: 'dark' as const }), [])

  return (
    <>
      <div className="player-host" style={{ position: 'relative', aspectRatio: '16 / 9' }}>
        <MXPlayer ref={ref} playerOptions={playerOptions} uiOptions={uiOptions} />
      </div>
      <button onClick={() => void ref.current?.player?.play()}>播放</button>
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
const uiOptions = { theme: 'dark' } as const
</script>

<template>
  <!-- 适配器按 UI -> SDK 顺序清理，但不会自动导入 CSS。 -->
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
}

export function IntegrationSection({ sdkBaseUrl, version }: IntegrationSectionProps) {
  const snippets = useMemo(() => buildSnippets(sdkBaseUrl), [sdkBaseUrl])
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
      // clipboard 在非安全上下文不可用；代码仍可手动选中
    }
  }

  return (
    <section className="integration" aria-labelledby="integration-heading" data-demo-reveal>
      <div className="integration-intro">
        <h2 id="integration-heading">嵌入你自己的应用</h2>
        <p>
          引擎、官方 UI 和框架适配层分开发布，按需取用。完整 API 与远程媒体要求见{' '}
          <a href={DOCS_URL} target="_blank" rel="noreferrer">接入文档</a>。
        </p>
      </div>

      <div className="integration-panel">
        <div className="integration-tabbar">
          <div className="integration-tabgroup">
            <div className="integration-tabs" role="tablist" aria-label="接入方式">
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
            <button type="button" onClick={() => { void copyActive() }} aria-label="复制代码">
              {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          {/* 所有代码块叠在同一个网格格子里，容器高度取最长那段，切 tab 不跳动。 */}
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

      <p className="integration-note">
        当前构建 {version}。远端媒体需要 HTTPS、CORS 放行、<code>Accept-Ranges: bytes</code> 与{' '}
        <code>206 Partial Content</code>；多线程 WASM 需要宿主自行设置 COOP/COEP，失败时自动回退单线程。
      </p>
    </section>
  )
}
