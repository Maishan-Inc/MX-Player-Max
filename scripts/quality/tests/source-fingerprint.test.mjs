import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { sourceFingerprint } from '../source-fingerprint.mjs'

test('fingerprint binds working sources, normalizes text endings and excludes reports/build products', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mxp-source-fingerprint-'))
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true })
    await mkdir(path.join(root, 'packages/test/src'), { recursive: true })
    await writeFile(path.join(root, 'packages/test/src/index.ts'), 'export const value = 1\n')
    const initial = await sourceFingerprint(root)
    await writeFile(path.join(root, 'packages/test/src/index.ts'), 'export const value = 1\r\n')
    assert.equal(await sourceFingerprint(root), initial)
    for (const directory of ['packages/test/dist', 'tests/browser/evidence', 'tests/performance/baselines']) {
      await mkdir(path.join(root, directory), { recursive: true })
      await writeFile(path.join(root, directory, 'output.json'), '{"passed":true}')
    }
    assert.equal(await sourceFingerprint(root), initial)
    await writeFile(path.join(root, 'packages/test/src/index.ts'), 'export const value = 2\n')
    assert.notEqual(await sourceFingerprint(root), initial)
  } finally { await rm(root, { recursive: true, force: true }) }
})
