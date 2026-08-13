import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePackedManifest } from '../pack-workspace.mjs'
import { validateBrowserGlobal } from '../consumer-smoke.mjs'
import { readFile } from 'node:fs/promises'

const browserManifest = {
  name: '@mx-player-max/browser',
  types: './dist/index.d.ts',
  exports: {
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    './style.css': './dist/style.css',
    './iife': './dist/mx-player-max.iife.js',
    './iife.min': './dist/mx-player-max.iife.min.js',
  },
  dependencies: { '@mx-player-max/sdk': '0.1.0' },
}

const browserFiles = [
  'package.json',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/style.css',
  'dist/mx-player-max.iife.js',
  'dist/mx-player-max.iife.min.js',
]

test('packed manifest validation catches missing exports and declarations', () => {
  assert.doesNotThrow(() => validatePackedManifest(browserManifest, browserFiles))
  assert.throws(() => validatePackedManifest({ ...browserManifest, exports: { '.': browserManifest.exports['.'] } }, browserFiles), /style\.css export/)
  assert.throws(() => validatePackedManifest(browserManifest, browserFiles.filter((file) => file !== 'dist/index.d.ts')), /declaration entry/)
  assert.throws(() => validatePackedManifest(browserManifest, browserFiles.filter((file) => file !== 'dist/mx-player-max.iife.js')), /missing export target/)
})

test('packed manifest validation rejects workspace protocols and misplaced framework peers', () => {
  assert.throws(() => validatePackedManifest({ ...browserManifest, dependencies: { '@mx-player-max/sdk': 'workspace:*' } }, browserFiles), /workspace protocol/)
  assert.throws(() => validatePackedManifest({ name: '@mx-player-max/react', types: './dist/index.d.ts', exports: { '.': './dist/index.js' }, dependencies: { react: '^19.0.0' }, peerDependencies: { react: '>=18' } }, ['dist/index.js', 'dist/index.d.ts']), /React must be a peer dependency/)
  assert.throws(() => validatePackedManifest({ name: '@mx-player-max/vue', types: './dist/index.d.ts', exports: { '.': './dist/index.js' }, dependencies: { vue: '^3.5.0' }, peerDependencies: { vue: '>=3.3' } }, ['dist/index.js', 'dist/index.d.ts']), /Vue must be a peer dependency/)
})

test('IIFE smoke rejects the wrong global name or incomplete public shape', () => {
  assert.doesNotThrow(() => validateBrowserGlobal({ MXPlayerMax: { create() {}, MXPlayer: class {}, attachPlayerUi() {} } }))
  assert.throws(() => validateBrowserGlobal({ MXPlayer: {} }), /MXPlayerMax global/)
  assert.throws(() => validateBrowserGlobal({ MXPlayerMax: { create() {}, MXPlayer: class {} } }), /attachPlayerUi/)
})

test('package verification rejects browser model and WASM assets', async () => {
  const source = await readFile(new URL('../verify-packages.mjs', import.meta.url), 'utf8')
  assert.match(source, /wasm\|mxai\|onnx/)
})
