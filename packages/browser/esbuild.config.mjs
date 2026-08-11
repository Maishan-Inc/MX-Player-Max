import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const packageDirectory = new URL('./', import.meta.url)
const packageJson = JSON.parse(await readFile(new URL('package.json', packageDirectory), 'utf8'))
const entryPoint = fileURLToPath(new URL('src/index.ts', packageDirectory))
const importMetaUrlShim = fileURLToPath(new URL('scripts/import-meta-url-shim.js', packageDirectory))
const banner = `/*! ${packageJson.name} v${packageJson.version} */`

const common = {
  entryPoints: [entryPoint],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'MXPlayerMax',
  target: ['chrome120', 'firefox121', 'safari17'],
  charset: 'utf8',
  legalComments: 'eof',
  sourcemap: 'external',
  sourcesContent: false,
  treeShaking: true,
  inject: [importMetaUrlShim],
  define: { 'import.meta.url': 'mxPlayerMaxImportMetaUrl' },
  banner: { js: banner },
  logLevel: 'info',
}

await Promise.all([
  build({
    ...common,
    outfile: fileURLToPath(new URL('dist/mx-player-max.iife.js', packageDirectory)),
  }),
  build({
    ...common,
    minify: true,
    outfile: fileURLToPath(new URL('dist/mx-player-max.iife.min.js', packageDirectory)),
  }),
])
