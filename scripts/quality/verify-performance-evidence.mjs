import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePerformanceMatrix, validatePerformanceReport } from './performance-evidence-schema.mjs'

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const directory = path.join(root, 'tests/performance/baselines')
const thresholds = JSON.parse(await readFile(path.join(root, 'tests/performance/thresholds.json'), 'utf8'))
if (thresholds.schemaVersion !== 1) throw new Error('Unsupported performance threshold schema')

let files = []
try { files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort() } catch { /* no collected evidence yet */ }
const reports = []
for (const file of files) {
  const report = JSON.parse(await readFile(path.join(directory, file), 'utf8'))
  validatePerformanceReport(report, file, thresholds)
  reports.push({ report, file })
}
validatePerformanceMatrix(reports)
console.log(`Performance evidence verified: ${files.length} baseline file(s).`)
