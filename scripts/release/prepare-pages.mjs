import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertManifest } from './manifest-schema.mjs'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REQUIRED_DEMO_FILES = ['index.html', '.nojekyll', 'flower.webm']
const RESTRICTED_ASSET_PATTERN = /\.(?:wasm|mxai|onnx|bin|data|model|weights|pth|pt|zip)$/i

export async function preparePagesArtifact({ root = workspaceRoot } = {}) {
  const resolvedRoot = path.resolve(root)
  const demoDist = path.join(resolvedRoot, 'apps/demo/dist')
  const browserPackage = path.join(resolvedRoot, 'packages/browser')
  const browserDist = path.join(browserPackage, 'dist')
  const manifestPath = path.join(browserDist, 'manifest.json')

  for (const file of REQUIRED_DEMO_FILES) await requireFile(path.join(demoDist, file), `required Pages file is missing: ${file}`)

  const manifest = assertManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  const assets = manifest.assets.filter((asset) => asset.packageName === '@mx-player-max/browser')
  if (assets.length === 0) throw new Error('Release manifest contains no publishable Browser assets')

  const sdkDirectory = path.join(demoDist, 'sdk')
  await rm(sdkDirectory, { recursive: true, force: true })
  await mkdir(sdkDirectory, { recursive: true })

  const sdkFiles = []
  for (const asset of assets) {
    const relativePath = browserAssetPath(asset.path)
    const source = path.resolve(browserPackage, asset.path)
    const destination = path.resolve(sdkDirectory, relativePath)
    if (!isWithin(browserDist, source)) throw new Error(`Browser asset escapes dist: ${asset.path}`)
    if (!isWithin(sdkDirectory, destination)) throw new Error(`Browser asset escapes Pages SDK: ${asset.path}`)
    await requireFile(source, `manifest-approved Browser asset is missing: ${asset.path}`)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(source, destination)
    sdkFiles.push(relativePath)
  }

  await cp(manifestPath, path.join(sdkDirectory, 'manifest.json'))
  sdkFiles.push('manifest.json')
  sdkFiles.sort()

  const pagesFiles = await listFiles(demoDist)
  const restrictedNames = new Set(manifest.excluded.map((asset) => path.posix.basename(asset.path)))
  for (const file of pagesFiles) {
    const name = path.posix.basename(file)
    if (restrictedNames.has(name) || RESTRICTED_ASSET_PATTERN.test(file)) {
      throw new Error(`restricted asset entered Pages output: ${file}`)
    }
  }

  const actualSdkFiles = (await listFiles(sdkDirectory)).sort()
  if (actualSdkFiles.join('\n') !== sdkFiles.join('\n')) throw new Error('Pages SDK output contains files outside the release manifest allowlist')
  return { sdkFiles }
}

if (isMain(import.meta.url)) {
  const report = await preparePagesArtifact()
  console.log(`Pages artifact prepared with ${report.sdkFiles.length} Browser SDK file(s).`)
}

function browserAssetPath(value) {
  if (typeof value !== 'string') throw new Error('Browser manifest path must be a string')
  const portable = value.replaceAll('\\', '/')
  if (!portable.startsWith('dist/') || portable.includes('\0') || portable.split('/').includes('..')) {
    throw new Error(`Browser manifest path is invalid: ${value}`)
  }
  const relativePath = portable.slice('dist/'.length)
  if (relativePath.length === 0 || path.posix.normalize(relativePath) !== relativePath) throw new Error(`Browser manifest path is invalid: ${value}`)
  return relativePath
}

async function requireFile(filePath, message) {
  try {
    if ((await stat(filePath)).isFile()) return
  } catch (cause) {
    if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'ENOENT') throw cause
  }
  throw new Error(message)
}

async function listFiles(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relativePath))
    else if (entry.isFile()) files.push(relativePath)
    else throw new Error(`Pages output contains an unsupported filesystem entry: ${relativePath}`)
  }
  return files
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function isMain(url) {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(url))
}
