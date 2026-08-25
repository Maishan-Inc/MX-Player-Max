import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest = JSON.parse(await readFile(resolve(root, 'tests/media/manifest.json'), 'utf8'))
const modes = JSON.parse(await readFile(resolve(root, 'apps/demo/src/media-acceptance-modes.json'), 'utf8'))
const failures = []
const ids = new Set()
const subtitleFormats = new Map(manifest.subtitles.map((entry) => [entry.id, entry.format]))
const hashPattern = /^[a-f0-9]{64}$/
const wasmEvidenceStatuses = new Set(['approved-pending-real-browser', 'not-covered-by-vp8-video-only-scope', 'not-implemented'])
/** `claims` names the `expectedPaths` entry a mode is evidence for; these two are not route claims. */
const nonRouteClaims = new Set(['no-route', null])

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
  if (!['mp4', 'webm', 'matroska'].includes(sample.container)) failures.push(`${sample.id}: unsupported container label`)
  if (![8, 10].includes(sample.video?.bitDepth)) failures.push(`${sample.id}: invalid bit depth`)
  if (!sample.video?.codec || !sample.video?.profile || (sample.audio !== null && !sample.audio?.codec)) failures.push(`${sample.id}: codec metadata incomplete`)
  if (!Array.isArray(sample.expectedPaths)) failures.push(`${sample.id}: expectedPaths missing`)
  /**
   * An empty `expectedPaths` is a real finding rather than an omission — HEVC has no route in any
   * browser measured — but it has to say why, or it is indistinguishable from a sample nobody
   * finished describing.
   */
  else if (sample.expectedPaths.length === 0 && typeof sample.noRouteReason !== 'string') {
    failures.push(`${sample.id}: expectedPaths is empty without a noRouteReason`)
  }
  if (!sample.minimumReproduction) failures.push(`${sample.id}: minimum reproduction missing`)
  for (const subtitleId of sample.subtitleIds) if (!subtitleFormats.has(subtitleId)) failures.push(`${sample.id}: unknown subtitle ${subtitleId}`)
  // A muxed subtitle track has no file of its own, so its declaration is the only record of which
  // corpus subtitle it carries and in which container codec.
  for (const embedded of sample.embeddedSubtitleTracks ?? []) {
    if (!subtitleFormats.has(embedded.subtitleId)) failures.push(`${sample.id}: unknown embedded subtitle ${embedded.subtitleId}`)
    else if (subtitleFormats.get(embedded.subtitleId) !== embedded.format) failures.push(`${sample.id}: embedded subtitle ${embedded.subtitleId} is ${subtitleFormats.get(embedded.subtitleId)}, declared ${embedded.format}`)
    if (typeof embedded.codecId !== 'string' || embedded.codecId.length === 0) failures.push(`${sample.id}: embedded subtitle track is missing a CodecID`)
    if (!sample.subtitleIds.includes(embedded.subtitleId)) failures.push(`${sample.id}: embedded subtitle ${embedded.subtitleId} is missing from subtitleIds`)
  }
  if (sample.wasmStatus !== undefined && !wasmEvidenceStatuses.has(sample.wasmStatus)) failures.push(`${sample.id}: invalid WASM evidence status`)
}
/**
 * Cross-check the acceptance mode table against the corpus in both directions. A corpus route claim
 * with no mode is a claim nothing verifies, which is how `mp4-h264`, `mp4-av1` and the WASM entry
 * came to declare paths that had never been played; a mode naming a sample or a path the corpus does
 * not declare is a test measuring something the corpus does not describe.
 */
const sampleFiles = new Map(manifest.samples.map((sample) => [sample.path.replace(/^fixtures\//, ''), sample]))
const claimedPaths = new Map(manifest.samples.map((sample) => [sample.id, new Set()]))
for (const [id, mode] of Object.entries(modes)) {
  const sample = sampleFiles.get(mode.sample)
  if (sample === undefined) { failures.push(`acceptance mode ${id}: sample ${mode.sample} is not in the corpus`); continue }
  if (!['native', 'custom', 'wasm'].includes(mode.pipeline)) failures.push(`acceptance mode ${id}: unknown pipeline ${mode.pipeline}`)
  if (nonRouteClaims.has(mode.claims)) {
    if (mode.claims === 'no-route' && sample.expectedPaths.length > 0) {
      failures.push(`acceptance mode ${id}: claims no route but ${sample.id} declares ${sample.expectedPaths.join(', ')}`)
    }
    continue
  }
  if (!sample.expectedPaths.includes(mode.claims)) {
    failures.push(`acceptance mode ${id}: claims ${mode.claims} which ${sample.id} does not declare`)
    continue
  }
  claimedPaths.get(sample.id).add(mode.claims)
}
for (const sample of manifest.samples) {
  const covered = claimedPaths.get(sample.id)
  for (const path of sample.expectedPaths) {
    if (!covered.has(path)) failures.push(`${sample.id}: declares the ${path} path but no acceptance mode claims it`)
  }
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
