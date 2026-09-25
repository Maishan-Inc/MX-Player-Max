import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const required = [
  'mxwf_abi_version', 'mxwf_alloc', 'mxwf_free', 'mxwf_decoder_create',
  'mxwf_decoder_create_codec', 'mxwf_decoder_decode', 'mxwf_decoder_flush',
  'mxwf_decoder_reset', 'mxwf_decoder_receive_frame', 'mxwf_frame_release',
  'mxwf_decoder_destroy', 'mxwf_debug_live_frames', 'mxwf_debug_live_bytes',
]

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expectedAssets = {
  single: { bytes: 425_535, sha256: '1d794a4e47b6fc128e10ce5f950881786e90a0770334a6ea3d103832ca68f975' },
  simd: { bytes: 469_852, sha256: '8af5276252bbfda07eb57e00062f555aca2f8013b518800f23bcf6988c610557' },
  threaded: { bytes: 468_098, sha256: '4a63f254743e627eaec39e3ad7787f03c68f69d017b03b6c2ad98de1974b9c15' },
}

for (const [variant, expected] of Object.entries(expectedAssets)) {
  const file = resolve(packageRoot, 'wasm', `libvpx-vp9-${variant}.wasm`)
  const bytes = await readFile(file)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (bytes.byteLength !== expected.bytes) throw new Error(`${variant} byte length mismatch`)
  if (digest !== expected.sha256) throw new Error(`${variant} SHA-256 mismatch`)
  const module = await WebAssembly.compile(bytes)
  const imports = WebAssembly.Module.imports(module)
  const exports = new Set(WebAssembly.Module.exports(module).map((entry) => entry.name))
  for (const name of required) if (!exports.has(name)) throw new Error(`${variant} missing export ${name}`)
  if (variant !== 'threaded' && imports.length !== 0) throw new Error(`${variant} must not import host functions`)
  if (variant === 'threaded') {
    if (!imports.some((entry) => entry.module === 'env' && entry.name === 'memory' && entry.kind === 'memory')) throw new Error('threaded shared-memory import missing')
    if (!imports.some((entry) => entry.module === 'env' && entry.name === '__pthread_create_js')) throw new Error('threaded pthread host import missing')
  }
  console.log(`${variant}: bytes=${bytes.byteLength} sha256=${digest} imports=${imports.length}`)
}
