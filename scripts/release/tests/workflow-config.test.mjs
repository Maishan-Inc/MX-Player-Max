import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const ci = await readFile(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
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
