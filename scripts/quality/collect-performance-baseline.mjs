import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox } from '@playwright/test'
import { LONG_RUN_SAMPLE, SMOKE_SAMPLE, validatePerformanceReport } from './performance-evidence-schema.mjs'
import { sourceFingerprint } from './source-fingerprint.mjs'

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const option = (name, fallback) => process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const scenario = option('scenario', 'smoke')
const backendOption = option('backend', 'native')
const browserNames = option('browsers', 'chromium,firefox').split(',')
if (!['smoke', 'long-run-30m'].includes(scenario)) throw new Error('Use --scenario=smoke or --scenario=long-run-30m')
if (!['native', 'custom', 'all'].includes(backendOption)) throw new Error('Use --backend=native, custom or all')
if (new Set(browserNames).size !== browserNames.length || browserNames.some((name) => !['chromium', 'firefox'].includes(name))) throw new Error('Use --browsers=chromium,firefox or either installed browser')
const backends = backendOption === 'all' ? ['native', 'custom'] : [backendOption]
const browserTypes = { chromium, firefox }
// Never install browsers. Fail before starting a server if a requested local executable is absent.
for (const name of browserNames) {
  try { await access(browserTypes[name].executablePath()) } catch { throw new Error(`${name} is not installed locally; select an available --browsers value. Nothing was downloaded.`) }
}
const sampleSha256 = scenario === 'smoke' ? SMOKE_SAMPLE.sha256 : await hashSample(path.join(root, 'tests/media/generated/long-run-vp8-opus-30m.webm'))
const { version: sdkVersion } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const sourceSha256 = await sourceFingerprint(root)
const thresholds = JSON.parse(await readFile(path.join(root, 'tests/performance/thresholds.json'), 'utf8'))
const runId = new Date().toISOString().replaceAll(':', '-')
// Raw attempts, including failures, are retained outside approved baselines. Promotion is reviewed.
const outputDirectory = path.resolve(root, option('output', `.release-tmp/performance/${runId}`))
if (outputDirectory === path.join(root, 'tests/performance/baselines')) throw new Error('Collect raw reports outside the approved baseline directory')
const viteCli = path.join(root, 'apps/demo/node_modules/vite/bin/vite.js')
await access(viteCli)
await assertPortAvailable('http://127.0.0.1:4177')
const server = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', '4177', '--strictPort'], { cwd: path.join(root, 'apps/demo'), stdio: 'ignore', windowsHide: true })
let failures = 0
try {
  await waitForServer('http://127.0.0.1:4177', server)
  await mkdir(outputDirectory, { recursive: true })
  for (const browserName of browserNames) {
    const browser = await browserTypes[browserName].launch()
    try {
      for (const backend of backends) for (const isolated of [false, true]) {
        const page = await browser.newPage()
        let report
        let failure = null
        try {
          const parameters = new URLSearchParams({ performanceAcceptance: scenario, backend, isolated: String(isolated), sampleSha256 })
          await page.goto(`http://127.0.0.1:4177/?${parameters}`)
          await page.locator('#performance-start').click({ noWaitAfter: true })
          await page.waitForFunction(() => /^(passed|failed)$/.test(document.body.dataset.status ?? ''), undefined, { timeout: scenario === 'long-run-30m' ? 1_860_000 : 45_000 })
          report = await page.evaluate(() => window.__performanceAcceptance)
        } catch (cause) { failure = cause instanceof Error ? cause.message : 'Performance runner failed' }
        finally { await page.close() }
        const evidence = {
          ...(report ?? { status: 'failed', scenario, requestedBackend: backend, sample: { ...(scenario === 'smoke' ? SMOKE_SAMPLE : LONG_RUN_SAMPLE), sha256: sampleSha256 } }),
          collectedAt: new Date().toISOString(), sdkVersion, sourceSha256,
          environment: { ...report?.environment, browserName, browserVersion: browser.version(), os: `${os.type()} ${os.release()} ${os.arch()}` },
        }
        const file = `${backend}-${browserName}-${isolated ? 'isolated' : 'non-isolated'}-${scenario}.json`
        if (failure === null) {
          try { validatePerformanceReport(evidence, file, thresholds) } catch (cause) { failure = cause instanceof Error ? cause.message : 'Threshold validation failed' }
        }
        // A completed run can still fail thresholds. Keep its original metrics and the reason.
        await writeFile(path.join(outputDirectory, file), `${JSON.stringify({ ...evidence, validation: { passed: failure === null, reason: failure } }, null, 2)}\n`, 'utf8')
        if (failure !== null) { failures += 1; console.error(`${file}: ${failure}`) }
        else console.log(`${file}: passed`)
      }
    } finally { await browser.close() }
  }
} finally { await stopServer(server) }
console.log(`Raw performance reports: ${outputDirectory}`)
if (failures > 0) process.exitCode = 1

async function hashSample(filePath) {
  try { await access(filePath) } catch { throw new Error('Generate the 1810-second local sample with the manifest command before collecting long-run evidence') }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  const digest = hash.digest('hex')
  if (digest === SMOKE_SAMPLE.sha256) throw new Error('Long-run sample SHA-256 unexpectedly matches the seed')
  return digest
}

async function assertPortAvailable(url) {
  try {
    await fetch(url)
    throw new Error('Port 4177 is already serving HTTP; stop the existing process before collecting performance evidence')
  } catch (cause) { if (cause instanceof Error && cause.message.startsWith('Port 4177')) throw cause }
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Performance preview server exited with code ${child.exitCode}`)
    try { if ((await fetch(url)).ok) return } catch { /* retry localhost */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for performance preview server')
}

async function stopServer(child) {
  if (child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))])
  if (child.exitCode !== null) return
  child.kill('SIGKILL')
  await exited
}
