import { readFile } from 'node:fs/promises'
import { validateRealBrowserMatrix } from './real-browser-evidence-schema.mjs'

const matrix = JSON.parse(await readFile(new URL('../../tests/browser/evidence/real-browser-matrix.json', import.meta.url), 'utf8'))
const totals = validateRealBrowserMatrix(matrix)
console.log(`Real-browser evidence schema passed: ${totals.passed} passed, ${totals.failed} failed, ${totals.pending} pending. This is not release acceptance.`)
