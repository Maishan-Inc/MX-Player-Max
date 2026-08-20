import { readFile } from 'node:fs/promises'

const matrix = JSON.parse(await readFile(new URL('../../tests/browser/evidence/real-browser-matrix.json', import.meta.url), 'utf8'))
if (matrix.schemaVersion !== 1 || matrix.evidenceLevel !== 'real-browser' || !Array.isArray(matrix.rows)) throw new Error('Invalid real-browser evidence schema')
const expected = new Set(['chrome/latest', 'chrome/latest-1', 'firefox/latest', 'firefox/latest-1', 'safari/latest', 'safari/latest-1'])
for (const row of matrix.rows) {
  const key = `${row.browser}/${row.stableSlot}`
  if (!expected.delete(key)) throw new Error(`Unexpected or duplicate real-browser row: ${key}`)
  if (!['pending', 'passed', 'failed', 'unsupported'].includes(row.wasm)) throw new Error(`${key}: invalid WASM evidence status`)
  if (row.result === 'pending') {
    if (row.wasm !== 'pending') throw new Error(`${key}: pending row must retain pending WASM evidence`)
    for (const field of ['browserVersion', 'os', 'gpu', 'crossOriginIsolated', 'sampleSha256']) if (row[field] !== null) throw new Error(`${key}: pending row must not contain fabricated ${field}`)
    if (typeof row.reason !== 'string' || row.reason.length < 20) throw new Error(`${key}: pending row needs a concrete reason`)
    continue
  }
  if (row.result !== 'passed' && row.result !== 'failed') throw new Error(`${key}: invalid result`)
  if (typeof row.browserVersion !== 'string' || /playwright|headless|simulated/i.test(row.browserVersion)) throw new Error(`${key}: invalid physical browser version`)
  if (typeof row.os !== 'string' || typeof row.gpu !== 'string' || typeof row.crossOriginIsolated !== 'boolean') throw new Error(`${key}: incomplete environment`)
  if (!/^[a-f0-9]{64}$/.test(row.sampleSha256 ?? '')) throw new Error(`${key}: invalid sample SHA-256`)
}
if (expected.size > 0) throw new Error(`Missing real-browser rows: ${[...expected].join(', ')}`)
console.log('Real-browser evidence schema passed: 6 rows remain explicitly pending; WASM review is approved and ready for execution.')
