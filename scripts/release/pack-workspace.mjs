import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateManifest } from './generate-manifest.mjs'
import { normalizePackageDist } from './normalize-esm.mjs'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const releaseTempRoot = path.join(workspaceRoot, '.release-tmp')
const outputRoot = path.join(releaseTempRoot, 'release-pack')
const vpxPackage = '@mx-player-max/decoder-wasm-vpx'
const approvedVpxFiles = ['wasm/libvpx-vp8-single.wasm', 'wasm/libvpx-vp8-simd.wasm']

export function validatePackedManifest(manifest, files) {
  const label = manifest.name ?? '<unknown package>'
  if (JSON.stringify(manifest).includes('workspace:')) throw new Error(`${label}: packed package.json contains workspace protocol`)
  if (typeof manifest.types !== 'string' || !files.includes(stripDotSlash(manifest.types))) throw new Error(`${label}: declaration entry is missing from the tarball`)
  if (!manifest.exports || typeof manifest.exports !== 'object') throw new Error(`${label}: exports is required`)
  for (const target of collectExportTargets(manifest.exports)) {
    if (!files.includes(stripDotSlash(target))) throw new Error(`${label}: missing export target ${target}`)
  }
  if (label === '@mx-player-max/browser' || label === '@mx-player-max/ui') {
    if (!manifest.exports['./style.css']) throw new Error(`${label}: style.css export is required`)
  }
  if (label === '@mx-player-max/browser') {
    if (!manifest.exports['./iife'] || !manifest.exports['./iife.min']) throw new Error(`${label}: IIFE exports are required`)
  }
  if (label === '@mx-player-max/react') {
    if (manifest.dependencies?.react !== undefined || manifest.peerDependencies?.react === undefined) throw new Error(`${label}: React must be a peer dependency`)
  }
  if (label === '@mx-player-max/vue') {
    if (manifest.dependencies?.vue !== undefined || manifest.peerDependencies?.vue === undefined) throw new Error(`${label}: Vue must be a peer dependency`)
  }
  if (label === vpxPackage) {
    for (const required of [...approvedVpxFiles, 'wasm/PROVENANCE.md', 'third_party/libvpx/LICENSE', 'third_party/libvpx/PATENTS']) {
      if (!files.includes(required)) throw new Error(`${label}: approved WASM distribution is missing ${required}`)
    }
    const excluded = files.filter((file) => file.endsWith('.wasm') && !approvedVpxFiles.includes(file))
    if (excluded.length > 0) throw new Error(`${label}: unapproved or technically excluded WASM entered the tarball: ${excluded.join(', ')}`)
  }
}

export async function packWorkspace({ root = workspaceRoot, output = outputRoot } = {}) {
  const resolvedRoot = path.resolve(root)
  const resolvedOutput = path.resolve(output)
  assertSafeOutput(resolvedRoot, resolvedOutput, 'release-pack')
  await rm(resolvedOutput, { recursive: true, force: true })
  const tarballDirectory = path.join(resolvedOutput, 'tarballs')
  const logDirectory = path.join(resolvedOutput, 'logs')
  await mkdir(tarballDirectory, { recursive: true })
  await mkdir(logDirectory, { recursive: true })

  const packageDirectories = await publicPackageDirectories(resolvedRoot)
  for (const directory of packageDirectories) await normalizePackageDist(directory)
  if (resolvedRoot === workspaceRoot) await generateManifest({ root: resolvedRoot })
  const reportEntries = []
  for (const directory of packageDirectories) {
    const sourceManifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
    const result = runPnpm(['pack', '--json', '--pack-destination', tarballDirectory], directory)
    const log = safeLog(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, resolvedRoot)
    await writeFile(path.join(logDirectory, `${sourceManifest.name.replaceAll('/', '-')}.log`), log, 'utf8')
    if (result.status !== 0) throw new Error(`${sourceManifest.name}: pnpm pack failed; see release-pack/logs`)
    const packReport = JSON.parse(result.stdout)
    const tarballPath = path.resolve(directory, packReport.filename)
    if (!isWithin(tarballDirectory, tarballPath)) throw new Error(`${sourceManifest.name}: tarball escaped output directory`)
    const tarball = await readFile(tarballPath)
    const packedManifest = readTarJson(gunzipSync(tarball), 'package/package.json')
    const files = (packReport.files ?? []).map((entry) => entry.path).sort()
    validatePackedManifest(packedManifest, files)
    reportEntries.push({
      name: packedManifest.name,
      version: packedManifest.version,
      tarball: path.relative(resolvedOutput, tarballPath).replaceAll('\\', '/'),
      size: tarball.byteLength,
      sha256: createHash('sha256').update(tarball).digest('hex'),
      files,
    })
  }
  reportEntries.sort((left, right) => left.name.localeCompare(right.name))
  const report = { schemaVersion: 1, packages: reportEntries }
  await writeFile(path.join(resolvedOutput, 'pack-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return report
}

if (isMain(import.meta.url)) {
  const report = await packWorkspace()
  console.log(`Packed ${report.packages.length} packages into .release-tmp/release-pack/tarballs.`)
}

async function publicPackageDirectories(root) {
  const packagesRoot = path.join(root, 'packages')
  const entries = await readdir(packagesRoot, { withFileTypes: true })
  const directories = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directory = path.join(packagesRoot, entry.name)
    const manifestPath = path.join(directory, 'package.json')
    try {
      if (!(await stat(manifestPath)).isFile()) continue
    } catch {
      continue
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (manifest.private !== true) directories.push(directory)
  }
  return directories.sort((left, right) => left.localeCompare(right))
}

function runPnpm(args, cwd) {
  const pnpmCli = process.env.npm_execpath
  if (!pnpmCli) throw new Error('npm_execpath is unavailable; run release:pack through pnpm')
  return spawnSync(process.execPath, [pnpmCli, ...args], { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 })
}

function readTarJson(tar, expectedName) {
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    const name = readNullTerminated(header.subarray(0, 100))
    if (name.length === 0) break
    const size = Number.parseInt(readNullTerminated(header.subarray(124, 136)).trim() || '0', 8)
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

function collectExportTargets(value) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.values(value).flatMap(collectExportTargets)
}

function stripDotSlash(value) {
  return value.startsWith('./') ? value.slice(2) : value
}

function assertSafeOutput(root, output, expectedName) {
  const parent = path.join(root, '.release-tmp')
  if (!isWithin(parent, output) || path.basename(output) !== expectedName) throw new Error(`Unsafe release output path: ${output}`)
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function safeLog(value, root) {
  return value.replaceAll(root, '<workspace>').replaceAll('\\', '/').trim().slice(0, 100_000)
}

function isMain(moduleUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(moduleUrl))
}
