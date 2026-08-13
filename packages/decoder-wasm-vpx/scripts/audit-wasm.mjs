import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const assets = {
  single: { file: 'libvpx-vp8-single.wasm', bytes: 113304, sha256: 'd8de9e34abade1d60ebd4646d98681dacf3c688d2f38dc7b1e1c15c699f1c5ba', imports: 'none' },
  simd: { file: 'libvpx-vp8-simd.wasm', bytes: 135291, sha256: '79e784506b25160e650c02d6d87213075188f98fda1e829a342ad4cad980853d', imports: 'none' },
  threaded: { file: 'libvpx-vp8-threaded.wasm', bytes: 139725, sha256: '422c57f2634f6e24d2745b01dcf54a4cd2da0ba079fe60f85a0377041becb07f', imports: 'pthread' },
}
const required = ['mxwf_abi_version', 'mxwf_alloc', 'mxwf_free', 'mxwf_decoder_create', 'mxwf_decoder_decode', 'mxwf_decoder_flush', 'mxwf_decoder_reset', 'mxwf_decoder_receive_frame', 'mxwf_frame_release', 'mxwf_decoder_destroy', 'mxwf_debug_live_frames', 'mxwf_debug_live_bytes']

for (const [variant, expected] of Object.entries(assets)) {
  const bytes = await readFile(resolve('wasm', expected.file))
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (bytes.byteLength !== expected.bytes) throw new Error(`${variant} byte length mismatch`)
  if (digest !== expected.sha256) throw new Error(`${variant} SHA-256 mismatch`)
  const module = await WebAssembly.compile(bytes)
  const imports = WebAssembly.Module.imports(module)
  const exports = new Set(WebAssembly.Module.exports(module).map((entry) => entry.name))
  for (const name of required) if (!exports.has(name)) throw new Error(`${variant} missing export ${name}`)
  if (expected.imports === 'none' && imports.length !== 0) throw new Error(`${variant} has unexpected imports`)
  if (expected.imports === 'pthread') {
    if (!imports.some((entry) => entry.module === 'env' && entry.name === 'memory' && entry.kind === 'memory')) throw new Error('threaded shared-memory import missing')
    if (!imports.some((entry) => entry.module === 'env' && entry.name === '__pthread_create_js')) throw new Error('threaded pthread host import missing')
  }
  process.stdout.write(`${variant}: ${bytes.byteLength} bytes ${digest} imports=${imports.length}\n`)
}
