import { spawnSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const packagesRoot = path.join(root, 'packages')
const repositoryUrl = 'git+https://github.com/Maishan-Inc/MX-Player-Max.git'
const homepage = 'https://github.com/Maishan-Inc/MX-Player-Max#readme'
const bugsUrl = 'https://github.com/Maishan-Inc/MX-Player-Max/issues'
const license = 'PolyForm-Noncommercial-1.0.0'
const cssPackages = new Set(['@mx-player-max/browser', '@mx-player-max/ui'])
const errors = []
const scheduledFileChecks = []

const packageDirectories = (await readdir(packagesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(packagesRoot, entry.name))
  .sort((left, right) => left.localeCompare(right))

const packages = []
for (const directory of packageDirectories) {
  const packagePath = path.join(directory, 'package.json')
  if (!(await isFile(packagePath))) continue
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
  if (manifest.private === true) continue
  packages.push({ directory, manifest })
  verifyManifest(directory, manifest)
}

const tempDirectory = path.join(root, '.release-tmp', `verify-packages-${process.pid}-${Date.now()}`)
assertSafeTempDirectory(tempDirectory)
await mkdir(tempDirectory, { recursive: true })
try {
  for (const packageEntry of packages) await verifyTarball(packageEntry, tempDirectory)
} finally {
  await rm(tempDirectory, { recursive: true, force: true })
}

if (errors.length > 0) {
  console.error(`Package verification failed with ${errors.length} issue(s):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`Verified ${packages.length} publishable packages.`)
}

function verifyManifest(directory, manifest) {
  const label = manifest.name ?? path.relative(root, directory)
  requireNonEmptyString(label, 'description', manifest.description)
  requireEqual(label, 'license', manifest.license, license)
  requireEqual(label, 'repository.type', manifest.repository?.type, 'git')
  requireEqual(label, 'repository.url', manifest.repository?.url, repositoryUrl)
  requireEqual(label, 'repository.directory', manifest.repository?.directory, path.relative(root, directory).replaceAll('\\', '/'))
  requireEqual(label, 'homepage', manifest.homepage, homepage)
  requireEqual(label, 'bugs.url', manifest.bugs?.url, bugsUrl)
  requireEqual(label, 'main', manifest.main, './dist/index.js')
  requireEqual(label, 'module', manifest.module, './dist/index.js')
  requireEqual(label, 'types', manifest.types, './dist/index.d.ts')
  requireEqual(label, 'publishConfig.access', manifest.publishConfig?.access, 'public')

  const expectedFiles = ['dist', 'README.md', 'LICENSE']
  if (!Array.isArray(manifest.files) || JSON.stringify(manifest.files) !== JSON.stringify(expectedFiles)) {
    errors.push(`${label}: files must equal ${JSON.stringify(expectedFiles)}`)
  }

  const expectedSideEffects = cssPackages.has(label) ? ['./dist/style.css'] : false
  if (JSON.stringify(manifest.sideEffects) !== JSON.stringify(expectedSideEffects)) {
    errors.push(`${label}: sideEffects must equal ${JSON.stringify(expectedSideEffects)}`)
  }

  if (!manifest.exports || typeof manifest.exports !== 'object') {
    errors.push(`${label}: exports is required`)
  } else {
    for (const target of collectExportTargets(manifest.exports)) {
      if (!target.startsWith('./dist/')) errors.push(`${label}: export target must stay inside dist: ${target}`)
      const resolved = path.resolve(directory, target)
      if (!isWithin(path.join(directory, 'dist'), resolved)) errors.push(`${label}: export target escapes dist: ${target}`)
    }
  }

  for (const relativePath of ['README.md', 'LICENSE', manifest.main, manifest.types, ...collectExportTargets(manifest.exports ?? {})]) {
    if (typeof relativePath !== 'string') continue
    const resolved = path.resolve(directory, relativePath)
    scheduledFileChecks.push({ label, relativePath, resolved })
  }

  if (label === '@mx-player-max/browser') {
    requireEqual(label, 'unpkg', manifest.unpkg, './dist/mx-player-max.iife.min.js')
    requireEqual(label, 'jsdelivr', manifest.jsdelivr, './dist/mx-player-max.iife.min.js')
    for (const exportName of ['./style.css', './iife', './iife.min']) {
      if (!(exportName in manifest.exports)) errors.push(`${label}: missing ${exportName} export`)
    }
  }
}

async function verifyTarball({ directory, manifest }, tempDirectory) {
  const label = manifest.name
  for (const check of scheduledFileChecks.filter((entry) => entry.label === label)) {
    if (!(await isFile(check.resolved))) errors.push(`${label}: missing ${check.relativePath}`)
  }

  const pnpmCli = process.env.npm_execpath
  if (!pnpmCli) throw new Error('npm_execpath is unavailable; run verification through pnpm')
  const result = spawnSync(process.execPath, [pnpmCli, 'pack', '--json', '--pack-destination', tempDirectory], {
    cwd: directory,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    errors.push(`${label}: pnpm pack failed: ${safeOutput(result.error?.message ?? result.stderr ?? result.stdout)}`)
    return
  }

  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    errors.push(`${label}: pnpm pack did not return JSON`)
    return
  }

  const fileNames = (report.files ?? []).map((entry) => entry.path)
  for (const fileName of fileNames) {
    if (isForbiddenTarballPath(fileName)) errors.push(`${label}: forbidden tarball file ${fileName}`)
    if (isUnreviewedBinary(fileName)) errors.push(`${label}: unreviewed binary in tarball ${fileName}`)
  }
  for (const required of ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts']) {
    if (!fileNames.includes(required)) errors.push(`${label}: tarball is missing ${required}`)
  }

  const tarballPath = path.resolve(directory, report.filename)
  if (!isWithin(tempDirectory, tarballPath)) {
    errors.push(`${label}: pack output escaped the temporary directory`)
    return
  }
  const packedManifest = readTarJson(gunzipSync(await readFile(tarballPath)), 'package/package.json')
  if (JSON.stringify(packedManifest).includes('workspace:')) {
    errors.push(`${label}: packed package.json still contains workspace protocol`)
  }
}

function collectExportTargets(value) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.values(value).flatMap(collectExportTargets)
}

function readTarJson(tar, expectedName) {
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    const name = readNullTerminated(header.subarray(0, 100))
    if (name.length === 0) break
    const sizeText = readNullTerminated(header.subarray(124, 136)).trim()
    const size = Number.parseInt(sizeText || '0', 8)
    const bodyStart = offset + 512
    if (name === expectedName) return JSON.parse(tar.subarray(bodyStart, bodyStart + size).toString('utf8'))
    offset = bodyStart + Math.ceil(size / 512) * 512
  }
  throw new Error(`Tar entry not found: ${expectedName}`)
}

function readNullTerminated(buffer) {
  const end = buffer.indexOf(0)
  return buffer.subarray(0, end === -1 ? buffer.length : end).toString('utf8')
}

function isForbiddenTarballPath(fileName) {
  return /(^|\/)(src|tests?|snapshots?)(\/|$)/i.test(fileName)
    || /\.tsbuildinfo$/i.test(fileName)
    || /(^|\/)(?:\.tmp|tmp|temp)(\/|$)/i.test(fileName)
}

function isUnreviewedBinary(fileName) {
  return /\.(?:wasm|mxai|onnx|bin|data|model|weights|pth|pt|zip)$/i.test(fileName)
}

function requireNonEmptyString(label, field, value) {
  if (typeof value !== 'string' || value.trim().length === 0) errors.push(`${label}: ${field} is required`)
}

function requireEqual(label, field, actual, expected) {
  if (actual !== expected) errors.push(`${label}: ${field} must equal ${JSON.stringify(expected)}`)
}

function assertSafeTempDirectory(directory) {
  const releaseTempRoot = path.join(root, '.release-tmp')
  if (!isWithin(releaseTempRoot, directory) || !path.basename(directory).startsWith('verify-packages-')) {
    throw new Error(`Unsafe package verification directory: ${directory}`)
  }
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function isFile(filePath) {
  try { return (await stat(filePath)).isFile() } catch { return false }
}

function safeOutput(output) {
  return String(output).replaceAll(root, '<workspace>').trim().slice(0, 500)
}
