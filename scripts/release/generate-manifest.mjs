import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertManifest, MANIFEST_SCHEMA_VERSION } from './manifest-schema.mjs'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const defaultOutputPath = path.join(workspaceRoot, 'packages/browser/dist/manifest.json')
export const DEFAULT_RELEASE_ASSETS = [
  { packageDir: 'packages/audio', path: 'dist/worklet-processor.js', type: 'audio-worklet' },
  { packageDir: 'packages/browser', path: 'dist/index.js', type: 'esm' },
  { packageDir: 'packages/browser', path: 'dist/index.js.map', type: 'source-map' },
  { packageDir: 'packages/browser', path: 'dist/mx-player-max.iife.js', type: 'iife' },
  { packageDir: 'packages/browser', path: 'dist/mx-player-max.iife.js.map', type: 'source-map' },
  { packageDir: 'packages/browser', path: 'dist/mx-player-max.iife.min.js', type: 'iife-min' },
  { packageDir: 'packages/browser', path: 'dist/mx-player-max.iife.min.js.map', type: 'source-map' },
  { packageDir: 'packages/browser', path: 'dist/style.css', type: 'css' },
  { packageDir: 'packages/core', path: 'dist/custom/demux-worker-entry.js', type: 'worker' },
  { packageDir: 'packages/decoder-webcodecs', path: 'dist/worker-entry.js', type: 'worker' },
  {
    packageDir: 'packages/decoder-wasm-vpx', path: 'wasm/libvpx-vp8-single.wasm', type: 'wasm',
    publishable: true, reviewStatus: 'approved', reason: 'license-and-patent-review-granted',
    expectedSha256: 'd8de9e34abade1d60ebd4646d98681dacf3c688d2f38dc7b1e1c15c699f1c5ba',
  },
  {
    packageDir: 'packages/decoder-wasm-vpx', path: 'wasm/libvpx-vp8-simd.wasm', type: 'wasm',
    publishable: true, reviewStatus: 'approved', reason: 'license-and-patent-review-granted',
    expectedSha256: '79e784506b25160e650c02d6d87213075188f98fda1e829a342ad4cad980853d',
  },
  {
    packageDir: 'packages/decoder-wasm-vpx', path: 'wasm/libvpx-vp8-threaded.wasm', type: 'wasm',
    publishable: false, reviewStatus: 'approved', reason: 'threaded-host-glue-unavailable',
    expectedSha256: '422c57f2634f6e24d2745b01dcf54a4cd2da0ba079fe60f85a0377041becb07f',
  },
]

export async function generateManifest({
  root = workspaceRoot,
  output = defaultOutputPath,
  assets = DEFAULT_RELEASE_ASSETS,
  excluded = [],
} = {}) {
  const manifest = await createManifest({ root: path.resolve(root), assets, excluded })
  assertManifest(manifest)
  const outputPath = path.resolve(output)
  if (!isWithin(path.resolve(root), outputPath)) throw new Error(`Manifest output escapes workspace: ${output}`)
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

export async function createManifest({ root = workspaceRoot, assets = DEFAULT_RELEASE_ASSETS, excluded = [] } = {}) {
  const browserPackage = JSON.parse(await readFile(path.join(root, 'packages/browser/package.json'), 'utf8'))
  const sdkPackage = JSON.parse(await readFile(path.join(root, 'packages/sdk/package.json'), 'utf8'))
  if (browserPackage.version !== sdkPackage.version) throw new Error('Browser and SDK versions must match')

  const publishable = []
  const excludedEntries = [...excluded]
  const seen = new Set()
  for (const asset of assets) {
    const packageDir = safeRelativePath(asset.packageDir)
    const assetPath = safeRelativePath(asset.path)
    const key = `${packageDir}/${assetPath}`
    if (seen.has(key)) throw new Error(`Duplicate manifest resource: ${key}`)
    seen.add(key)
    if (asset.publishable === false || asset.reviewStatus !== undefined && asset.reviewStatus !== 'approved') {
      excludedEntries.push({ packageDir, path: assetPath, type: asset.type, publishable: false, reason: asset.reason ?? 'license-review-required' })
      continue
    }
    const packageJsonPath = path.join(root, packageDir, 'package.json')
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    const filePath = path.join(root, packageDir, assetPath)
    if (!isWithin(path.join(root, packageDir), filePath)) throw new Error(`Manifest resource escapes package: ${key}`)
    let bytes
    try {
      bytes = await readFile(filePath)
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') throw new Error(`Manifest resource is missing: ${key}`)
      throw cause
    }
    const metadata = await stat(filePath)
    if (!metadata.isFile()) throw new Error(`Manifest resource is not a file: ${key}`)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const sha384Bytes = createHash('sha384').update(bytes).digest()
    if (asset.expectedSha256 !== undefined && asset.expectedSha256 !== sha256) throw new Error(`Manifest SHA-256 mismatch: ${key}`)
    publishable.push({
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      path: assetPath,
      type: asset.type,
      mime: mimeFor(assetPath),
      size: bytes.byteLength,
      sha256,
      sha384: sha384Bytes.toString('hex'),
      integrity: `sha384-${sha384Bytes.toString('base64')}`,
      publishable: true,
    })
  }

  publishable.sort(compareAssets)
  excludedEntries.sort((left, right) => `${left.packageDir}/${left.path}`.localeCompare(`${right.packageDir}/${right.path}`))
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    sdkVersion: sdkPackage.version,
    browserVersion: browserPackage.version,
    baseUrls: { assetBaseUrl: null, wasmBaseUrl: null, aiModelBaseUrl: null },
    urlResolution: {
      assetBaseUrl: 'Use the explicit option; otherwise resolve from the ESM module URL or IIFE script URL.',
      wasmBaseUrl: 'Use the explicit option; otherwise resolve relative to assetBaseUrl/wasm/.',
      aiModelBaseUrl: 'Use the explicit option; otherwise resolve relative to assetBaseUrl/models/.',
    },
    assets: publishable,
    excluded: excludedEntries,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await generateManifest()
  console.log(`Manifest written to ${path.relative(workspaceRoot, defaultOutputPath).replaceAll('\\', '/')}`)
}

function compareAssets(left, right) {
  return left.packageName.localeCompare(right.packageName) || left.path.localeCompare(right.path) || left.type.localeCompare(right.type)
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) throw new Error(`Manifest path is invalid: ${value}`)
  const portable = value.replaceAll('\\', '/')
  if (portable.includes('\0') || portable.split('/').includes('..')) throw new Error(`Manifest path escapes its root: ${value}`)
  const normalized = path.posix.normalize(portable)
  if (normalized !== portable || normalized === '.') throw new Error(`Manifest path is not normalized: ${value}`)
  return normalized
}

function mimeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript'
  if (filePath.endsWith('.css')) return 'text/css'
  if (filePath.endsWith('.map') || filePath.endsWith('.json')) return 'application/json'
  if (filePath.endsWith('.wasm')) return 'application/wasm'
  throw new Error(`Manifest MIME is unknown for ${filePath}`)
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}
