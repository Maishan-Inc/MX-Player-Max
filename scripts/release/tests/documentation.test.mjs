import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const paths = [
  '../../../README.md',
  '../../../docs/README.md',
  '../../../docs/development/integration.md',
  '../../../docs/development/release.md',
  '../../../docs/architecture/distribution-and-embedding.md',
  '../../../docs/architecture/ui-package.md',
  '../../../docs/architecture/wasm-and-distribution.md',
  '../../../docs/decisions/ADR-0004-engine-and-optional-ui.md',
  '../../../packages/browser/README.md',
  '../../../packages/sdk/README.md',
  '../../../packages/ui/README.md',
  '../../../packages/react/README.md',
  '../../../packages/vue/README.md',
]

const documents = await Promise.all(paths.map(async (path) => ({ path, text: await readFile(new URL(path, import.meta.url), 'utf8') })))
const combined = documents.map(({ text }) => text).join('\n')

test('distribution docs describe the Browser public surface and license', () => {
  for (const marker of ['@mx-player-max/browser', 'MXPlayerMax', '<VERSION>', 'SHA384_FROM_MANIFEST', 'PolyForm-Noncommercial-1.0.0']) {
    assert.match(combined, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('production documentation avoids unfixed CDN versions and stale claims', () => {
  assert.doesNotMatch(combined, /@latest/)
  assert.doesNotMatch(combined, /所有 Codec 已支持|all codecs are supported/i)
  assert.doesNotMatch(combined, /Phase 12\s+(?:pending|计划在)/i)
})

test('GitHub Pages documentation preserves the Docker and isolation boundary', () => {
  assert.match(combined, /https:\/\/maishan-inc\.github\.io\/MX-Player-Max\//)
  assert.match(combined, /\.github\/workflows\/deploy-demo\.yml/)
  assert.match(combined, /GitHub Pages 不提供 COOP\/COEP/)
  assert.match(combined, /\/sdk\//)
})

test('integration docs retain the deployment security contract', () => {
  for (const marker of ['Content-Range', 'Accept-Ranges', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Embedder-Policy', 'crossOriginIsolated', 'application/wasm']) {
    assert.match(combined, new RegExp(marker))
  }
})
