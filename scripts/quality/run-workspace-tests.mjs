import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const mode = process.argv[2]
if (mode !== '--check' && mode !== '--update') throw new Error('Use --check or --update')
const evidencePath = path.join(root, 'docs/development/evidence/current-test-counts.json')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'mxp-test-counts-'))
const workspaces = await findTestWorkspaces()
const packages = []

try {
  for (const workspace of workspaces) {
    const output = path.join(temporary, `${workspace.directory.replaceAll('/', '-')}.json`)
    const result = spawnSync(process.execPath, [pnpmCli(), '--dir', workspace.directory, 'test', '--reporter=json', `--outputFile=${output}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    if (result.status !== 0) process.exit(result.status ?? 1)
    const report = JSON.parse(await readFile(output, 'utf8'))
    if (report.success !== true || report.numFailedTests !== 0) throw new Error(`${workspace.name}: Vitest report was not successful`)
    packages.push({
      name: workspace.name,
      directory: workspace.directory,
      testFiles: report.testResults.length,
      tests: report.numTotalTests,
      passed: report.numPassedTests,
      skipped: report.numPendingTests,
      todo: report.numTodoTests,
    })
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}

const evidence = {
  schemaVersion: 1,
  command: 'pnpm test',
  packages,
  totals: packages.reduce((total, entry) => ({
    testFiles: total.testFiles + entry.testFiles,
    tests: total.tests + entry.tests,
    passed: total.passed + entry.passed,
    skipped: total.skipped + entry.skipped,
    todo: total.todo + entry.todo,
  }), { testFiles: 0, tests: 0, passed: 0, skipped: 0, todo: 0 }),
}

if (mode === '--update') {
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(`Updated ${path.relative(root, evidencePath).replaceAll('\\', '/')}: ${evidence.totals.tests} tests.`)
} else {
  const expected = JSON.parse(await readFile(evidencePath, 'utf8'))
  if (JSON.stringify(expected) !== JSON.stringify(evidence)) {
    console.error('Workspace test-count evidence is stale. Run pnpm test:update-counts and review the diff.')
    console.error(`Expected ${expected.totals?.tests ?? 'unknown'} tests; observed ${evidence.totals.tests}.`)
    process.exit(1)
  }
  console.log(`Workspace tests passed and counts match evidence: ${evidence.totals.tests} tests in ${evidence.totals.testFiles} files.`)
}

async function findTestWorkspaces() {
  const candidates = []
  for (const parent of ['packages', 'apps']) {
    const parentPath = path.join(root, parent)
    for (const entry of await readdir(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const directory = `${parent}/${entry.name}`
      let manifest
      try { manifest = JSON.parse(await readFile(path.join(root, directory, 'package.json'), 'utf8')) } catch { continue }
      if (typeof manifest.scripts?.test === 'string') candidates.push({ name: manifest.name, directory })
    }
  }
  return candidates.sort((left, right) => left.name.localeCompare(right.name))
}

function pnpmCli() {
  const value = process.env.npm_execpath
  if (!value) throw new Error('npm_execpath is unavailable; run through pnpm')
  return value
}
