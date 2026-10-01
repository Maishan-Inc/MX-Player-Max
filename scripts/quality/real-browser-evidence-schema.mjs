const BACKENDS = ['native', 'webcodecs', 'wasm']
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0

export function validateRealBrowserMatrix(matrix, { requirePassed = false, sampleHashes } = {}) {
  if (matrix?.schemaVersion !== 1 || matrix.evidenceLevel !== 'real-browser' || !Array.isArray(matrix.rows)) throw new Error('Invalid real-browser evidence schema')
  const expected = new Set(['chrome/latest', 'chrome/latest-1', 'firefox/latest', 'firefox/latest-1', 'safari/latest', 'safari/latest-1'])
  const totals = { pending: 0, passed: 0, failed: 0 }
  for (const row of matrix.rows) {
    const key = `${row.browser}/${row.stableSlot}`
    if (!expected.delete(key)) throw new Error(`Unexpected or duplicate real-browser row: ${key}`)
    for (const backend of BACKENDS) {
      if (!['pending', 'passed', 'failed', 'unsupported'].includes(row[backend])) throw new Error(`${key}: invalid ${backend} status`)
    }
    if (!['pending', 'passed', 'failed'].includes(row.result)) throw new Error(`${key}: invalid result`)
    totals[row.result] += 1
    if (row.result === 'pending') {
      if (requirePassed) throw new Error(`${key}: pending real-browser acceptance`)
      if (BACKENDS.some((backend) => row[backend] !== 'pending')) throw new Error(`${key}: pending row must retain pending backend evidence`)
      for (const field of ['browserVersion', 'os', 'gpu', 'crossOriginIsolated', 'sampleSha256']) {
        if (row[field] !== null) throw new Error(`${key}: pending row must not contain fabricated ${field}`)
      }
      if (!nonempty(row.reason) || row.reason.length < 20) throw new Error(`${key}: pending row needs a concrete reason`)
      continue
    }
    if (!/^\d+(?:\.\d+)+$/.test(row.browserVersion ?? '')) throw new Error(`${key}: invalid physical browser version`)
    if (!nonempty(row.os) || !nonempty(row.gpu) || typeof row.crossOriginIsolated !== 'boolean') throw new Error(`${key}: incomplete environment`)
    if (row.browser === 'safari' && !/macos|mac os/i.test(row.os)) throw new Error(`${key}: physical Safari requires macOS`)
    if (!/^[a-f0-9]{64}$/.test(row.sampleSha256 ?? '')) throw new Error(`${key}: invalid sample SHA-256`)
    if (sampleHashes && !sampleHashes.has(row.sampleSha256)) throw new Error(`${key}: unknown corpus sample`)
    if (row.result === 'passed') {
      if (BACKENDS.some((backend) => row[backend] === 'pending' || row[backend] === 'failed')) throw new Error(`${key}: passed result contradicts backend status`)
      for (const backend of BACKENDS) {
        if (row[backend] === 'unsupported' && (!nonempty(row.backendReasons?.[backend]) || row.backendReasons[backend].length < 20)) {
          throw new Error(`${key}: unsupported ${backend} needs a capability reason`)
        }
      }
    }
    if (requirePassed && (row.result !== 'passed' || row.native !== 'passed')) throw new Error(`${key}: native and overall acceptance must pass`)
  }
  if (expected.size > 0) throw new Error(`Missing real-browser rows: ${[...expected].join(', ')}`)
  if (requirePassed) {
    for (const browser of ['chrome', 'firefox', 'safari']) {
      const rows = matrix.rows.filter((row) => row.browser === browser)
      const latest = Number(rows.find((row) => row.stableSlot === 'latest').browserVersion.split('.')[0])
      const previous = Number(rows.find((row) => row.stableSlot === 'latest-1').browserVersion.split('.')[0])
      if (latest <= previous) throw new Error(`${browser}: latest-two-stable versions must be distinct and ordered`)
    }
  }
  return totals
}
