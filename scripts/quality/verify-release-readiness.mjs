import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceFingerprint } from './source-fingerprint.mjs'
import { validateReleaseReadiness } from './release-readiness.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const read = async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'))
const { version: sdkVersion } = await read('package.json')
const sourceSha256 = await sourceFingerprint(root)
if (process.argv.includes('--fingerprint')) {
  console.log(JSON.stringify({ sdkVersion, sourceSha256 }, null, 2))
} else {
  const directory = 'tests/performance/baselines'
  const performance = await Promise.all((await readdir(path.join(root, directory))).filter((name) => name.endsWith('.json')).map(async (file) => ({ file, report: await read(`${directory}/${file}`) })))
  const manifest = await read('tests/media/manifest.json')
  const failures = validateReleaseReadiness({
    sdkVersion, sourceSha256, performance,
    sampleHashes: new Set(manifest.samples.map((sample) => sample.sha256)),
    browsers: await read('tests/browser/evidence/real-browser-matrix.json'),
    docker: await read('tests/browser/evidence/docker-runtime.json'),
  }, await read('tests/performance/thresholds.json'))
  if (failures.length) {
    console.error(`Release acceptance is incomplete:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
    process.exitCode = 1
  } else console.log(`Release acceptance passed for ${sdkVersion} (${sourceSha256}).`)
}
