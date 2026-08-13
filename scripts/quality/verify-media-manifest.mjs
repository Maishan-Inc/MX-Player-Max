import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest = JSON.parse(await readFile(resolve(root, 'tests/media/manifest.json'), 'utf8'))
const failures = []
const ids = new Set()
const subtitleIds = new Set(manifest.subtitles.map((entry) => entry.id))
const hashPattern = /^[a-f0-9]{64}$/

if (manifest.schemaVersion !== 1) failures.push('schemaVersion must equal 1')
if (!manifest.license || !manifest.source || !manifest.generator?.version) failures.push('corpus provenance is incomplete')
for (const entry of [...manifest.subtitles, ...manifest.samples]) {
  if (ids.has(entry.id)) failures.push(`duplicate id: ${entry.id}`)
  ids.add(entry.id)
  if (!hashPattern.test(entry.sha256)) failures.push(`${entry.id}: invalid SHA-256`)
  const path = resolve(root, 'tests/media', entry.path)
  if (!path.startsWith(resolve(root, 'tests/media') + sep)) { failures.push(`${entry.id}: path escapes corpus`); continue }
  try {
    const bytes = await readFile(path)
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== entry.sha256) failures.push(`${entry.id}: SHA-256 mismatch (${digest})`)
    if ('bytes' in entry && (await stat(path)).size !== entry.bytes) failures.push(`${entry.id}: byte length mismatch`)
  } catch (error) {
    failures.push(`${entry.id}: ${error instanceof Error ? error.message : 'file read failed'}`)
  }
}
for (const sample of manifest.samples) {
  if (!['mp4', 'webm'].includes(sample.container)) failures.push(`${sample.id}: unsupported container label`)
  if (![8, 10].includes(sample.video?.bitDepth)) failures.push(`${sample.id}: invalid bit depth`)
  if (!sample.video?.codec || !sample.video?.profile || (sample.audio !== null && !sample.audio?.codec)) failures.push(`${sample.id}: codec metadata incomplete`)
  if (!Array.isArray(sample.expectedPaths) || sample.expectedPaths.length === 0) failures.push(`${sample.id}: expectedPaths missing`)
  if (!sample.minimumReproduction) failures.push(`${sample.id}: minimum reproduction missing`)
  for (const subtitleId of sample.subtitleIds) if (!subtitleIds.has(subtitleId)) failures.push(`${sample.id}: unknown subtitle ${subtitleId}`)
  if (sample.wasmStatus !== undefined && sample.wasmStatus !== 'blocked-by-phase-10') failures.push(`${sample.id}: invalid WASM evidence status`)
}
const dimensions = {
  containers: new Set(manifest.samples.map((sample) => sample.container)),
  videoCodecs: new Set(manifest.samples.map((sample) => sample.video.codec)),
  profiles: new Set(manifest.samples.map((sample) => `${sample.video.codec}:${sample.video.profile}`)),
  bitDepths: new Set(manifest.samples.map((sample) => sample.video.bitDepth)),
  audioCodecs: new Set(manifest.samples.map((sample) => sample.audio?.codec ?? 'none')),
  subtitles: new Set(manifest.subtitles.map((entry) => entry.format)),
}
for (const [name, values] of Object.entries(dimensions)) if (values.size < 2) failures.push(`matrix dimension ${name} has fewer than two values`)
if (manifest.largeFixturePolicy?.storage !== 'generated-not-committed' || manifest.largeFixturePolicy?.durationSeconds !== 1800) failures.push('30-minute generated fixture policy is incomplete')
if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exitCode = 1
} else {
  console.log(`Verified ${manifest.samples.length} media samples and ${manifest.subtitles.length} subtitle fixtures.`)
}
