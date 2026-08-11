import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createManifest } from '../generate-manifest.mjs'

test('generates deterministic hashes, MIME, ordering, and SRI', async () => {
  const root = await fixtureRoot()
  try {
    const first = await createManifest({ root, assets: fixtureAssets() })
    const second = await createManifest({ root, assets: [...fixtureAssets()].reverse() })
    assert.deepEqual(first, second)
    const js = first.assets.find((asset) => asset.path === 'dist/alpha.js')
    assert.ok(js)
    const bytes = Buffer.from('alpha')
    assert.equal(js.sha256, createHash('sha256').update(bytes).digest('hex'))
    assert.equal(js.sha384, createHash('sha384').update(bytes).digest('hex'))
    assert.equal(js.integrity, `sha384-${createHash('sha384').update(bytes).digest('base64')}`)
    assert.equal(js.mime, 'text/javascript')
    assert.equal(first.assets[0].path, 'dist/alpha.js')
    assert.equal(first.assets[1].path, 'dist/style.css')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('excludes unreviewed WASM/model resources from publishable assets', async () => {
  const root = await fixtureRoot()
  try {
    const manifest = await createManifest({
      root,
      assets: [{ packageDir: 'packages/fixture', path: 'dist/alpha.js', type: 'esm' }, { packageDir: 'packages/fixture', path: 'dist/pending.wasm', type: 'wasm', reviewStatus: 'pending' }],
    })
    assert.equal(manifest.assets.some((asset) => asset.path.endsWith('.wasm')), false)
    assert.deepEqual(manifest.excluded, [{ packageDir: 'packages/fixture', path: 'dist/pending.wasm', type: 'wasm', publishable: false, reason: 'license-review-required' }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects missing, duplicate, escaping, and unknown-MIME resources', async () => {
  const root = await fixtureRoot()
  try {
    await assert.rejects(() => createManifest({ root, assets: [{ packageDir: 'packages/fixture', path: 'dist/missing.js', type: 'esm' }] }), /Manifest resource is missing/)
    await assert.rejects(() => createManifest({ root, assets: [{ packageDir: 'packages/fixture', path: 'dist/alpha.js', type: 'esm' }, { packageDir: 'packages/fixture', path: 'dist/alpha.js', type: 'esm' }] }))
    await assert.rejects(() => createManifest({ root, assets: [{ packageDir: 'packages/fixture', path: '../package.json', type: 'json' }] }))
    await assert.rejects(() => createManifest({ root, assets: [{ packageDir: 'packages/fixture', path: 'dist//alpha.js', type: 'esm' }] }))
    await assert.rejects(() => createManifest({ root, assets: [{ packageDir: 'packages/fixture', path: 'dist/alpha.bin', type: 'binary' }] }))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects a resource whose expected hash has changed', async () => {
  const root = await fixtureRoot()
  try {
    await assert.rejects(
      () => createManifest({ root, assets: [{ packageDir: 'packages/fixture', path: 'dist/alpha.js', type: 'esm', expectedSha256: '0'.repeat(64) }] }),
      /Manifest SHA-256 mismatch/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mx-player-max-manifest-'))
  const packageDirectory = path.join(root, 'packages/fixture')
  await mkdir(path.join(packageDirectory, 'dist'), { recursive: true })
  await mkdir(path.join(root, 'packages', 'browser'), { recursive: true })
  await mkdir(path.join(root, 'packages', 'sdk'), { recursive: true })
  await writeFile(path.join(root, 'packages', 'browser', 'package.json'), JSON.stringify({ version: '0.1.0' }))
  await writeFile(path.join(root, 'packages', 'sdk', 'package.json'), JSON.stringify({ version: '0.1.0' }))
  await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({ name: '@mx-player-max/fixture', version: '0.1.0' }))
  await writeFile(path.join(packageDirectory, 'dist', 'alpha.js'), 'alpha')
  await writeFile(path.join(packageDirectory, 'dist', 'alpha.bin'), 'alpha')
  await writeFile(path.join(packageDirectory, 'dist', 'style.css'), 'body{}')
  await writeFile(path.join(packageDirectory, 'dist', 'pending.wasm'), 'pending')
  return root
}

function fixtureAssets() {
  return [
    { packageDir: 'packages/fixture', path: 'dist/style.css', type: 'css' },
    { packageDir: 'packages/fixture', path: 'dist/alpha.js', type: 'esm' },
  ]
}
