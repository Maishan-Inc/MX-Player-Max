import { readFile } from 'node:fs/promises'

const phase11 = await readFile(new URL('../../docs/development/phase-11-acceptance.md', import.meta.url), 'utf8')
const phase12 = await readFile(new URL('../../docs/development/phase-12-acceptance.md', import.meta.url), 'utf8')
const phase13 = await readFile(new URL('../../docs/development/phase-13-acceptance.md', import.meta.url), 'utf8')
const renderMode = await readFile(new URL('../../docs/development/render-mode-mkv-acceptance.md', import.meta.url), 'utf8')
const evidence = JSON.parse(await readFile(new URL('../../docs/development/evidence/current-test-counts.json', import.meta.url), 'utf8'))

for (const [name, document] of [['phase-11', phase11], ['phase-12', phase12]]) {
  if (/pnpm test[^\n|]*[；，,]\s*\d+\s*(?:tests|项测试)/i.test(document) || /全仓\s*\d+\s*项测试/.test(document)) {
    throw new Error(`${name} contains a manually maintained current test total`)
  }
  if (!document.includes('current-test-counts.json')) throw new Error(`${name} must reference generated current counts`)
}
if (!phase13.includes('current-test-counts.json')) throw new Error('Phase 13 acceptance must reference generated current counts')
// The render-mode/Matroska record is maintained the same way: it may quote per-project browser
// results, but never a workspace test total that would silently rot.
if (!renderMode.includes('current-test-counts.json')) throw new Error('Render-mode acceptance must reference generated current counts')
if (/pnpm test[^\n|]*[；，,]\s*\d+\s*(?:tests|项测试)/i.test(renderMode) || /全仓\s*\d+\s*项测试/.test(renderMode)) {
  throw new Error('Render-mode acceptance contains a manually maintained current test total')
}
if (evidence.schemaVersion !== 1 || evidence.command !== 'pnpm test' || evidence.totals.tests !== evidence.totals.passed + evidence.totals.skipped + evidence.totals.todo) {
  throw new Error('Invalid current test-count evidence')
}
console.log(`Acceptance drift check passed: generated evidence contains ${evidence.totals.tests} tests.`)
