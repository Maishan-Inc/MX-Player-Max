import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox } from '@playwright/test'
import { LONG_RUN_SAMPLE, SMOKE_SAMPLE } from './performance-evidence-schema.mjs'

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const outputDirectory = path.join(root, 'tests/performance/baselines')
const scenarioArgument = process.argv.find((argument) => argument.startsWith('--scenario='))
const scenario = scenarioArgument?.slice('--scenario='.length) ?? 'smoke'
if (scenario !== 'smoke' && scenario !== 'long-run-30m') throw new Error('Use --scenario=smoke or --scenario=long-run-30m')
const longRunPath = path.join(root, 'tests/media/generated/long-run-vp8-opus-30m.webm')
const sampleSha256 = scenario === 'smoke' ? SMOKE_SAMPLE.sha256 : await hashLongRunSample(longRunPath)
const viteCli = path.join(root, 'apps/demo/node_modules/vite/bin/vite.js')
await access(viteCli)
await assertPortAvailable('http://127.0.0.1:4177')
const server = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', '4177', '--strictPort'], { cwd: path.join(root, 'apps/demo'), stdio: 'ignore', windowsHide: true })

try {
  await waitForServer('http://127.0.0.1:4177', server)
  await mkdir(outputDirectory, { recursive: true })
  for (const [browserName, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
    const browser = await browserType.launch()
    try {
      for (const isolated of [false, true]) {
        const page = await browser.newPage()
        const parameters = new URLSearchParams({ performanceAcceptance: scenario, isolated: String(isolated), sampleSha256 })
        await page.goto(`http://127.0.0.1:4177/?${parameters}`)
        await page.locator('#performance-start').click({ noWaitAfter: true })
        const timeout = scenario === 'long-run-30m' ? 1_860_000 : 30_000
        await page.waitForFunction(() => /^(passed|failed)$/.test(document.body.dataset.status ?? ''), undefined, { timeout })
        const report = await page.evaluate(() => window.__performanceAcceptance)
        await page.close()
        if (!report || report.status !== 'passed') throw new Error(`${browserName}/${isolated ? 'isolated' : 'non-isolated'} ${scenario} performance run failed`)
        const evidence = {
          ...report,
          collectedAt: new Date().toISOString(),
          environment: { ...report.environment, browserName, browserVersion: browser.version(), os: `${os.type()} ${os.release()} ${os.arch()}` },
        }
        const date = new Date().toISOString().slice(0, 10)
        const file = `${date}-${browserName}-${isolated ? 'isolated' : 'non-isolated'}-${scenario}.json`
        await writeFile(path.join(outputDirectory, file), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
        console.log(`Wrote tests/performance/baselines/${file}`)
      }
    } finally { await browser.close() }
  }
} finally {
  await stopServer(server)
}

async function hashLongRunSample(filePath) {
  try { await access(filePath) } catch {
    throw new Error('Generate tests/media/generated/long-run-vp8-opus-30m.webm before collecting long-run evidence')
  }
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
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('Port 4177')) throw cause
  }
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Performance preview server exited with code ${child.exitCode}`)
    try { if ((await fetch(url)).ok) return } catch { /* retry */ }
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
