import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_RELEASE_ASSETS } from '../release/generate-manifest.mjs'

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const audit = JSON.parse(await readFile(path.join(root, 'tests/security/assets.json'), 'utf8'))
if (audit.schemaVersion !== 1 || !Array.isArray(audit.assets)) throw new Error('Invalid supply-chain audit schema')
const auditedPaths = new Set(audit.assets.map((asset) => asset.path))

for (const asset of audit.assets) {
  if (!['ai-source', 'ai-model', 'wasm'].includes(asset.kind)) throw new Error(`Invalid asset kind: ${asset.kind}`)
  if (!['approved', 'restricted'].includes(asset.reviewStatus)) throw new Error(`Invalid review status: ${asset.path}`)
  if (asset.kind === 'wasm' && asset.reviewStatus !== 'approved') throw new Error(`Phase 10 WASM review is not approved: ${asset.path}`)
  if (typeof asset.license !== 'string' || asset.license.length === 0) throw new Error(`Missing license: ${asset.path}`)
  if (typeof asset.upstream !== 'string' || !asset.upstream.startsWith('https://')) throw new Error(`Missing immutable upstream: ${asset.path}`)
  if (!/^[a-f0-9]{40}$/.test(asset.commit ?? '')) throw new Error(`Missing upstream commit: ${asset.path}`)
  if (typeof asset.buildOptions !== 'string' || asset.buildOptions.length < 12) throw new Error(`Missing build options: ${asset.path}`)
  if (asset.kind === 'ai-model' && !auditedPaths.has(asset.derivedFrom)) throw new Error(`Derived model source is not audited: ${asset.path}`)
  const filePath = path.resolve(root, asset.path)
  if (!isWithin(root, filePath)) throw new Error(`Asset path escapes workspace: ${asset.path}`)
  const bytes = await readFile(filePath)
  const metadata = await stat(filePath)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (metadata.size !== asset.bytes) throw new Error(`Asset byte length mismatch: ${asset.path}`)
  if (digest !== asset.sha256) throw new Error(`Asset SHA-256 mismatch: ${asset.path}`)
  const license = await readRequiredText(asset.licensePath, `license for ${asset.path}`)
  const provenance = await readRequiredText(asset.provenancePath, `provenance for ${asset.path}`)
  if (!provenance.includes(asset.commit.slice(0, 8))) throw new Error(`Provenance omits commit for ${asset.path}`)
  if (asset.kind === 'ai-model' && !provenance.includes(asset.buildOptions)) throw new Error(`Provenance omits conversion command for ${asset.path}`)
  if (asset.kind === 'wasm') {
    if (!provenance.includes(asset.buildOptions)) throw new Error(`Provenance omits build options for ${asset.path}`)
    await readRequiredText(asset.patentStatementPath, `patent statement for ${asset.path}`)
  }
  if (license.trim().length < 100) throw new Error(`License text is incomplete: ${asset.path}`)
}

for (const asset of audit.assets.filter((entry) => entry.kind === 'wasm')) {
  const packageDir = path.posix.dirname(path.posix.dirname(asset.path))
  const assetPath = asset.path.slice(`${packageDir}/`.length)
  const releaseAsset = DEFAULT_RELEASE_ASSETS.find((entry) => entry.packageDir === packageDir && entry.path === assetPath)
  if (!releaseAsset || releaseAsset.reviewStatus !== 'approved' || releaseAsset.expectedSha256 !== asset.sha256) {
    throw new Error(`Approved WASM is not hash-locked in release policy: ${asset.path}`)
  }
  const threaded = path.posix.basename(asset.path) === 'libvpx-vp8-threaded.wasm'
  if (threaded && (releaseAsset.publishable !== false || releaseAsset.reason !== 'threaded-host-glue-unavailable')) {
    throw new Error(`Threaded WASM is not technically excluded by release policy: ${asset.path}`)
  }
  if (!threaded && (releaseAsset.publishable !== true || releaseAsset.reason !== 'license-and-patent-review-granted')) {
    throw new Error(`Approved WASM is not publishable in release policy: ${asset.path}`)
  }
}
console.log(`Supply-chain audit passed: ${audit.assets.length} hashed assets; 3 WASM variants approved, 2 publishable, 1 technically excluded.`)

function isWithin(parent, child) {
  const relative = path.relative(parent, child)
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function readRequiredText(relativePath, label) {
  if (typeof relativePath !== 'string') throw new Error(`Missing ${label}`)
  const filePath = path.resolve(root, relativePath)
  if (!isWithin(root, filePath)) throw new Error(`${label} escapes workspace`)
  try { return await readFile(filePath, 'utf8') } catch { throw new Error(`Unreadable ${label}`) }
}
