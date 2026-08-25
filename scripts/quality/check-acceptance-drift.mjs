import { readFile } from 'node:fs/promises'

const evidence = JSON.parse(await readFile(new URL('../../docs/development/evidence/current-test-counts.json', import.meta.url), 'utf8'))
/**
 * Every document that talks about the current workspace test total has to defer to the generated
 * evidence. `mustReference` additionally requires the pointer, which is what makes a reader who
 * wants a number go to the file that cannot rot; the roadmap only states the gate exists, so it is
 * checked for stale totals without being forced to carry the same pointer twice.
 */
const documents = [
  { name: 'phase-11', path: '../../docs/development/phase-11-acceptance.md', mustReference: true },
  { name: 'phase-12', path: '../../docs/development/phase-12-acceptance.md', mustReference: true },
  { name: 'phase-13', path: '../../docs/development/phase-13-acceptance.md', mustReference: true },
  { name: 'render-mode', path: '../../docs/development/render-mode-mkv-acceptance.md', mustReference: true },
  // The roadmap is not an acceptance record but stated its own "511 tests / 93 test files" for
  // months, so it drifted exactly the way these rules exist to prevent. It was not read at all.
  { name: 'roadmap', path: '../../docs/development/roadmap.md', mustReference: true },
]
/**
 * A hand-maintained total, in the shapes that have actually appeared. The separator between the
 * command and the number is optional: `pnpm test` 为 511/511 tests carried no comma at all and so
 * slipped past a pattern that required one. `\D` keeps the digits from being part of a larger
 * number, and the `N/N` form is matched because that is how a pass count gets written.
 */
const HAND_MAINTAINED_TOTALS = [
  /pnpm test[^\n|]*?\d+\s*(?:\/\s*\d+\s*)?(?:tests|项测试|test files|个测试文件)/i,
  /全仓\s*\d+\s*项测试/,
  /\d+\s*tests?\s*\/\s*\d+\s*test files/i,
]

const failures = []
for (const { name, path, mustReference } of documents) {
  const document = await readFile(new URL(path, import.meta.url), 'utf8')
  for (const pattern of HAND_MAINTAINED_TOTALS) {
    if (pattern.test(document)) failures.push(`${name} contains a manually maintained current test total (${pattern})`)
  }
  if (mustReference && !document.includes('current-test-counts.json')) {
    failures.push(`${name} must reference generated current counts`)
  }
}
if (evidence.schemaVersion !== 1 || evidence.command !== 'pnpm test' || evidence.totals.tests !== evidence.totals.passed + evidence.totals.skipped + evidence.totals.todo) {
  failures.push('Invalid current test-count evidence')
}
if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exitCode = 1
} else {
  console.log(`Acceptance drift check passed: generated evidence contains ${evidence.totals.tests} tests.`)
}
