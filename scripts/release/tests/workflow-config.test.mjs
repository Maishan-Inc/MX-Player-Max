import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const ci = await readFile(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
const deployDemo = await readFile(new URL('../../../.github/workflows/deploy-demo.yml', import.meta.url), 'utf8')
const release = await readFile(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8')

test('CI runs browser, package metadata, and release script gates', () => {
  for (const command of ['pnpm test:browser', 'pnpm verify:packages', 'pnpm test:release']) {
    assert.match(ci, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(ci, /npm\s+publish/)
})

test('release workflow separates validation, packaging, consumer smoke, and artifact jobs', () => {
  for (const job of ['validate:', 'package:', 'consumer-smoke:', 'artifact:', 'publish:']) assert.match(release, new RegExp(`\\n  ${job}`))
  assert.match(release, /needs:\s*\[?validate/)
  assert.match(release, /release:pack/)
  assert.match(release, /release:smoke/)
  assert.match(release, /upload-artifact@v4/)
  assert.match(release, /libvpx-vp8-single\.wasm/)
  assert.match(release, /libvpx-vp8-simd\.wasm/)
  assert.doesNotMatch(release, /packages\/decoder-wasm-vpx\/wasm\/libvpx-vp8-threaded\.wasm/)
  assert.doesNotMatch(release, /\bnpm\s+publish/)
})

test('publishing requires a tag, explicit confirmation, protected environment, and npm token', () => {
  assert.match(release, /workflow_dispatch:/)
  assert.match(release, /type:\s*choice/)
  assert.match(release, /publish\b/)
  assert.match(release, /startsWith\(github\.ref, ['"]refs\/tags\/v['"]\)/)
  assert.match(release, /environment:\s*\n\s+name:\s*npm-production/)
  assert.match(release, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/)
  assert.match(release, /pnpm\s+publish\s+-r/)
})

test('Demo deployment is manual, validated, and isolated from SDK publishing', () => {
  assert.match(deployDemo, /workflow_dispatch:/)
  assert.match(deployDemo, /version:/)
  assert.match(deployDemo, /deploy_pages:/)
  assert.match(deployDemo, /type:\s*boolean/)
  assert.doesNotMatch(deployDemo, /^\s+(?:push|pull_request):/m)
  for (const command of ['pnpm typecheck', 'pnpm test', 'pnpm build:pages', 'pnpm verify:packages', 'pnpm test:release', 'pnpm test:pages']) {
    assert.match(deployDemo, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  for (const action of ['actions/configure-pages@v6', 'actions/upload-pages-artifact@v3', 'actions/deploy-pages@v5']) {
    assert.match(deployDemo, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  for (const permission of ['contents: read', 'pages: write', 'id-token: write']) assert.match(deployDemo, new RegExp(permission))
  assert.match(deployDemo, /path:\s*apps\/demo\/dist/)
  assert.match(deployDemo, /environment:\s*\n\s+name:\s*github-pages/)
  assert.match(deployDemo, /gh api ["']repos\/\$\{GITHUB_REPOSITORY\}\/pages["']/)
  assert.doesNotMatch(deployDemo, /\bnpm\s+publish/)
})

test('CI and SDK release workflows do not deploy GitHub Pages', () => {
  for (const workflow of [ci, release]) {
    assert.doesNotMatch(workflow, /actions\/(?:configure|deploy)-pages/)
    assert.doesNotMatch(workflow, /upload-pages-artifact/)
  }
})
