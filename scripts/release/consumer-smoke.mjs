import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const releaseTempRoot = path.join(workspaceRoot, '.release-tmp')
const packRoot = path.join(releaseTempRoot, 'release-pack')
const consumerRoot = path.join(releaseTempRoot, 'consumer-smoke')
const fixtureRoot = path.join(workspaceRoot, 'scripts/release/tests/consumer-fixture')

export function validateBrowserGlobal(sandbox) {
  if (!sandbox || typeof sandbox !== 'object' || !sandbox.MXPlayerMax || typeof sandbox.MXPlayerMax !== 'object') throw new Error('MXPlayerMax global is missing')
  for (const entry of ['create', 'MXPlayer', 'attachPlayerUi']) {
    if (typeof sandbox.MXPlayerMax[entry] !== 'function') throw new Error(`MXPlayerMax.${entry} is missing`)
  }
}

export async function runConsumerSmoke({ root = workspaceRoot } = {}) {
  const resolvedRoot = path.resolve(root)
  const resolvedPackRoot = path.join(resolvedRoot, '.release-tmp', 'release-pack')
  const resolvedConsumerRoot = path.join(resolvedRoot, '.release-tmp', 'consumer-smoke')
  assertSafeDirectory(resolvedRoot, resolvedConsumerRoot, 'consumer-smoke')
  const report = JSON.parse(await readFile(path.join(resolvedPackRoot, 'pack-report.json'), 'utf8'))
  await rm(resolvedConsumerRoot, { recursive: true, force: true })
  await mkdir(resolvedConsumerRoot, { recursive: true })
  await cp(path.join(resolvedRoot, 'scripts/release/tests/consumer-fixture'), resolvedConsumerRoot, { recursive: true })

  const packageJson = JSON.parse(await readFile(path.join(resolvedConsumerRoot, 'package.json'), 'utf8'))
  packageJson.dependencies = Object.fromEntries(report.packages.map((entry) => [
    entry.name,
    `file:${path.relative(resolvedConsumerRoot, path.join(resolvedPackRoot, entry.tarball)).replaceAll('\\', '/')}`,
  ]))
  Object.assign(packageJson.dependencies, { react: '19.2.8', 'react-dom': '19.2.8', vue: '3.5.41' })
  packageJson.devDependencies = { '@types/react': '19.2.18', '@types/react-dom': '19.2.4', '@webgpu/types': '0.1.64', typescript: '5.9.3' }
  packageJson.pnpm = {
    overrides: Object.fromEntries(report.packages.map((entry) => [
      entry.name,
      `file:${path.relative(resolvedConsumerRoot, path.join(resolvedPackRoot, entry.tarball)).replaceAll('\\', '/')}`,
    ])),
  }
  await writeFile(path.join(resolvedConsumerRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

  const commands = [
    ['pnpm', ['install', '--prefer-offline', '--ignore-scripts', '--no-frozen-lockfile']],
    ['node', ['smoke.mjs']],
    ['pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit']],
    ['node', ['iife-smoke.mjs']],
    ['node', ['css-smoke.mjs']],
  ]
  const results = []
  for (const [kind, args] of commands) {
    const result = runCommand(kind, args, resolvedConsumerRoot)
    const commandName = `${kind} ${args.join(' ')}`
    const logName = `${results.length + 1}-${kind}.log`
    await mkdir(path.join(resolvedConsumerRoot, 'logs'), { recursive: true })
    await writeFile(path.join(resolvedConsumerRoot, 'logs', logName), safeLog(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, resolvedRoot), 'utf8')
    if (result.status !== 0) throw new Error(`Consumer smoke failed: ${commandName}; see .release-tmp/consumer-smoke/logs/${logName}`)
    results.push({ command: commandName, status: 'passed' })
  }

  for (const entry of report.packages) {
    const installedManifest = JSON.parse(await readFile(path.join(resolvedConsumerRoot, 'node_modules', ...entry.name.split('/'), 'package.json'), 'utf8'))
    if (JSON.stringify(installedManifest).includes('workspace:')) throw new Error(`${entry.name}: installed manifest contains workspace protocol`)
    if (entry.name === '@mx-player-max/react' && installedManifest.dependencies?.react !== undefined) throw new Error('React adapter bundled React as a dependency')
    if (entry.name === '@mx-player-max/vue' && installedManifest.dependencies?.vue !== undefined) throw new Error('Vue adapter bundled Vue as a dependency')
  }

  const smokeReport = { schemaVersion: 1, commands: results }
  await writeFile(path.join(resolvedPackRoot, 'consumer-smoke-report.json'), `${JSON.stringify(smokeReport, null, 2)}\n`, 'utf8')
  await rm(resolvedConsumerRoot, { recursive: true, force: true })
  return smokeReport
}

if (isMain(import.meta.url)) {
  const report = await runConsumerSmoke()
  console.log(`Packed consumer smoke passed ${report.commands.length} commands.`)
}

function runCommand(kind, args, cwd) {
  if (kind === 'node') return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 })
  const pnpmCli = process.env.npm_execpath
  if (!pnpmCli) throw new Error('npm_execpath is unavailable; run release:smoke through pnpm')
  return spawnSync(process.execPath, [pnpmCli, ...args], { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 })
}

function assertSafeDirectory(root, directory, expectedName) {
  const parent = path.join(root, '.release-tmp')
  const relative = path.relative(parent, directory)
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative) || path.basename(directory) !== expectedName) throw new Error(`Unsafe consumer directory: ${directory}`)
}

function safeLog(value, root) {
  return value.replaceAll(root, '<workspace>').replaceAll('\\', '/').trim().slice(0, 100_000)
}

function isMain(moduleUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(moduleUrl))
}
