import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { preparePagesArtifact } from '../prepare-pages.mjs'

test('copies only manifest-approved Browser assets into the Pages SDK directory', async () => {
  const root = await createFixture()
  try {
    const report = await preparePagesArtifact({ root })
    assert.deepEqual(report.sdkFiles, [
      'index.js',
      'manifest.json',
      'style.css',
      'wasm/libvpx-vp8-simd.wasm',
      'wasm/libvpx-vp8-single.wasm',
    ])
    assert.equal(await readFile(path.join(root, 'apps/demo/dist/sdk/index.js'), 'utf8'), 'browser esm')
    assert.equal(await readFile(path.join(root, 'apps/demo/dist/sdk/style.css'), 'utf8'), 'browser css')
    assert.equal(await readFile(path.join(root, 'apps/demo/dist/sdk/wasm/libvpx-vp8-single.wasm'), 'utf8'), 'single wasm')
    assert.equal(await readFile(path.join(root, 'apps/demo/dist/sdk/wasm/libvpx-vp8-simd.wasm'), 'utf8'), 'simd wasm')
    await assert.rejects(readFile(path.join(root, 'apps/demo/dist/sdk/worklet-processor.js')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects a Pages artifact with a missing required Demo file', async () => {
  const root = await createFixture({ omitNoJekyll: true })
  try {
    await assert.rejects(preparePagesArtifact({ root }), /required Pages file is missing: \.nojekyll/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects unlisted WASM assets already present in the Pages tree', async () => {
  const root = await createFixture()
  try {
    const directory = path.join(root, 'apps/demo/dist/assets')
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'unlisted-decoder.wasm'), 'restricted')
    await assert.rejects(preparePagesArtifact({ root }), /restricted asset entered Pages output: assets\/unlisted-decoder\.wasm/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects unlisted model assets already present in the Pages tree', async () => {
  const root = await createFixture()
  try {
    const directory = path.join(root, 'apps/demo/dist/assets')
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'unlisted-model.onnx'), 'restricted')
    await assert.rejects(preparePagesArtifact({ root }), /restricted asset entered Pages output: assets\/unlisted-model\.onnx/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function createFixture({ omitNoJekyll = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mxp-pages-'))
  const demoDist = path.join(root, 'apps/demo/dist')
  const browserDist = path.join(root, 'packages/browser/dist')
  const vpxWasm = path.join(root, 'packages/decoder-wasm-vpx/wasm')
  await mkdir(demoDist, { recursive: true })
  await mkdir(browserDist, { recursive: true })
  await mkdir(vpxWasm, { recursive: true })
  await writeFile(path.join(demoDist, 'index.html'), '<!doctype html>')
  await writeFile(path.join(demoDist, 'flower.webm'), 'media')
  if (!omitNoJekyll) await writeFile(path.join(demoDist, '.nojekyll'), '')
  await writeFile(path.join(browserDist, 'index.js'), 'browser esm')
  await writeFile(path.join(browserDist, 'style.css'), 'browser css')
  await writeFile(path.join(vpxWasm, 'libvpx-vp8-single.wasm'), 'single wasm')
  await writeFile(path.join(vpxWasm, 'libvpx-vp8-simd.wasm'), 'simd wasm')
  await writeFile(path.join(browserDist, 'manifest.json'), JSON.stringify(manifest()))
  return root
}

function manifest() {
  return {
    schemaVersion: 1,
    sdkVersion: '0.1.0',
    browserVersion: '0.1.0',
    baseUrls: {},
    urlResolution: {},
    assets: [
      asset('@mx-player-max/audio', 'dist/worklet-processor.js'),
      asset('@mx-player-max/browser', 'dist/index.js'),
      asset('@mx-player-max/browser', 'dist/style.css'),
      asset('@mx-player-max/decoder-wasm-vpx', 'wasm/libvpx-vp8-single.wasm'),
      asset('@mx-player-max/decoder-wasm-vpx', 'wasm/libvpx-vp8-simd.wasm'),
    ],
    excluded: [{
      packageDir: 'packages/decoder-wasm-vpx',
      path: 'wasm/libvpx-vp8-threaded.wasm',
      type: 'wasm',
      publishable: false,
      reason: 'threaded-host-glue-unavailable',
    }],
  }
}

function asset(packageName, assetPath) {
  const wasm = assetPath.endsWith('.wasm')
  return {
    packageName,
    packageVersion: '0.1.0',
    path: assetPath,
    type: wasm ? 'wasm' : assetPath.endsWith('.css') ? 'css' : 'esm',
    mime: wasm ? 'application/wasm' : assetPath.endsWith('.css') ? 'text/css' : 'text/javascript',
    size: 1,
    sha256: 'sha256',
    sha384: 'sha384',
    integrity: 'sha384-integrity',
    publishable: true,
  }
}
