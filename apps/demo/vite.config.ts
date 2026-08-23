import { createReadStream, existsSync, statSync } from 'node:fs'
import { Transform } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'

const SAMPLE_PATH = fileURLToPath(new URL('./public/flower.webm', import.meta.url))
const QUALITY_FIXTURE_DIRECTORY = new URL('../../tests/media/fixtures/', import.meta.url)
const QUALITY_ASSETS = new Map([
  ['mp4-h264-baseline-8bit-aac.mp4', { path: fileURLToPath(new URL('mp4-h264-baseline-8bit-aac.mp4', QUALITY_FIXTURE_DIRECTORY)), type: 'video/mp4' }],
  ['webm-vp8-p0-8bit-opus.webm', { path: fileURLToPath(new URL('webm-vp8-p0-8bit-opus.webm', QUALITY_FIXTURE_DIRECTORY)), type: 'video/webm' }],
  ['webm-vp8-p0-8bit-video-only.webm', { path: fileURLToPath(new URL('webm-vp8-p0-8bit-video-only.webm', QUALITY_FIXTURE_DIRECTORY)), type: 'video/webm' }],
  ['webm-vp9-p0-8bit-opus.webm', { path: fileURLToPath(new URL('webm-vp9-p0-8bit-opus.webm', QUALITY_FIXTURE_DIRECTORY)), type: 'video/webm' }],
  ['webm-vp9-p2-10bit-opus.webm', { path: fileURLToPath(new URL('webm-vp9-p2-10bit-opus.webm', QUALITY_FIXTURE_DIRECTORY)), type: 'video/webm' }],
  ['mp4-av1-main-8bit-aac.mp4', { path: fileURLToPath(new URL('mp4-av1-main-8bit-aac.mp4', QUALITY_FIXTURE_DIRECTORY)), type: 'video/mp4' }],
  ['mp4-hevc-main10-10bit-aac.mp4', { path: fileURLToPath(new URL('mp4-hevc-main10-10bit-aac.mp4', QUALITY_FIXTURE_DIRECTORY)), type: 'video/mp4' }],
  ['mkv-h264-baseline-8bit-aac.mkv', { path: fileURLToPath(new URL('mkv-h264-baseline-8bit-aac.mkv', QUALITY_FIXTURE_DIRECTORY)), type: 'video/x-matroska' }],
  ['mkv-vp8-p0-8bit-opus.mkv', { path: fileURLToPath(new URL('mkv-vp8-p0-8bit-opus.mkv', QUALITY_FIXTURE_DIRECTORY)), type: 'video/x-matroska' }],
  ['basic-timing.srt', { path: fileURLToPath(new URL('basic-timing.srt', QUALITY_FIXTURE_DIRECTORY)), type: 'text/plain; charset=utf-8' }],
  ['basic-style.ass', { path: fileURLToPath(new URL('basic-style.ass', QUALITY_FIXTURE_DIRECTORY)), type: 'text/plain; charset=utf-8' }],
])
const LONG_RUN_SAMPLE_PATH = fileURLToPath(new URL('../../tests/media/generated/long-run-vp8-opus-30m.webm', import.meta.url))
if (existsSync(LONG_RUN_SAMPLE_PATH)) QUALITY_ASSETS.set('long-run-vp8-opus-30m.webm', { path: LONG_RUN_SAMPLE_PATH, type: 'video/webm' })
const WASM_SAMPLE_PATH = fileURLToPath(new URL('../../packages/decoder-wasm-vpx/tests/fixtures/webm-vp8-p0-8bit-642x358.webm', import.meta.url))
const WASM_ASSET_DIRECTORY = new URL('../../packages/decoder-wasm-vpx/wasm/', import.meta.url)
const WASM_ASSETS = new Map([
  ['libvpx-vp8-single.wasm', fileURLToPath(new URL('libvpx-vp8-single.wasm', WASM_ASSET_DIRECTORY))],
  ['libvpx-vp8-simd.wasm', fileURLToPath(new URL('libvpx-vp8-simd.wasm', WASM_ASSET_DIRECTORY))],
  ['libvpx-vp8-threaded.wasm', fileURLToPath(new URL('libvpx-vp8-threaded.wasm', WASM_ASSET_DIRECTORY))],
])
/**
 * AI model roots for `aiModelBaseUrl`, served straight out of the workspace so the weights
 * never enter `public/` and therefore never reach the Pages artifact — `prepare-pages.mjs`
 * rejects `.mxai` on purpose. Paths are an explicit allowlist rather than a directory mount,
 * so a crafted request cannot walk out of the weights folder.
 */
const MODEL_ASSET_DIRECTORY = new URL('../../packages/postprocess/assets/weights/', import.meta.url)
const MODEL_ASSETS = new Map([
  ['weights/rt4ksr/rt4ksr_x2.mxai', fileURLToPath(new URL('rt4ksr/rt4ksr_x2.mxai', MODEL_ASSET_DIRECTORY))],
  ['weights/rife/rife_v4.25.mxai', fileURLToPath(new URL('rife/rife_v4.25.mxai', MODEL_ASSET_DIRECTORY))],
])

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? './' : '/',
  plugins: [serveAcceptanceAssets(), serveModelAssets(), serveQualityAssets(), serveSampleRanges(), react()],
  server: { host: true, port: 4173 },
  preview: { host: true, port: 4173 },
}))

function serveModelAssets(): Plugin {
  const install = (server: Pick<ViteDevServer | PreviewServer, 'middlewares'>): void => {
    server.middlewares.use((request, response, next) => {
      if (request.method !== 'GET' || request.url === undefined) { next(); return }
      const url = new URL(request.url, 'http://localhost')
      if (!url.pathname.startsWith('/models/')) { next(); return }
      const assetPath = MODEL_ASSETS.get(url.pathname.slice('/models/'.length))
      if (assetPath === undefined) { response.writeHead(404); response.end(); return }
      serveFile(request.headers.range, response, assetPath, 'application/octet-stream')
    })
  }
  return {
    name: 'mxp-ai-model-assets',
    configureServer(server): void { install(server) },
    configurePreviewServer(server): void { install(server) },
  }
}

function serveQualityAssets(): Plugin {
  const install = (server: Pick<ViteDevServer | PreviewServer, 'middlewares'>): void => {
    server.middlewares.use((request, response, next) => {
      if (request.method !== 'GET' || request.url === undefined) { next(); return }
      const url = new URL(request.url, 'http://localhost')
      const prefix = url.pathname.startsWith('/quality-media/') ? '/quality-media/'
        : url.pathname.startsWith('/quality-subtitles/') ? '/quality-subtitles/' : null
      if (prefix === null) { next(); return }
      const asset = QUALITY_ASSETS.get(url.pathname.slice(prefix.length))
      if (asset === undefined) { response.writeHead(404); response.end(); return }
      serveQualityFile(request.headers.range, response, asset.path, asset.type, url.searchParams.get('fault'))
    })
  }
  return {
    name: 'mxp-quality-media-assets',
    configureServer(server): void { install(server) },
    configurePreviewServer(server): void { install(server) },
  }
}

function serveQualityFile(
  range: string | undefined,
  response: import('node:http').ServerResponse,
  filePath: string,
  contentType: string,
  fault: string | null,
): void {
  const actualSize = statSync(filePath).size
  const size = fault === 'truncated' ? Math.min(128, actualSize) : actualSize
  if (fault === 'disconnect') { response.destroy(); return }
  if (fault === 'status-200' && range !== undefined) {
    response.writeHead(200, { 'Accept-Ranges': 'bytes', 'Content-Length': String(actualSize), 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' })
    createReadStream(filePath).pipe(response)
    return
  }
  const match = /^bytes=([0-9]+)-([0-9]*)$/.exec(range ?? '')
  if (range !== undefined && match === null) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return }
  const start = match?.[1] === undefined ? 0 : Number(match[1])
  const requestedEnd = match?.[2]
  const end = requestedEnd === undefined || requestedEnd.length === 0 ? size - 1 : Math.min(Number(requestedEnd), size - 1)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return
  }
  const partial = range !== undefined
  const contentRange = fault === 'bad-content-range' ? `bytes ${start + 1}-${end}/${size}` : `bytes ${start}-${end}/${size}`
  response.writeHead(partial ? 206 : 200, {
    'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Content-Length': String(end - start + 1),
    ...(partial ? { 'Content-Range': contentRange } : {}), 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff',
  })
  const stream = createReadStream(filePath, { start, end })
  if (fault !== 'corrupt') { stream.pipe(response); return }
  let offset = start
  stream.pipe(new Transform({
    transform(chunk: Buffer, _encoding, callback): void {
      const output = Buffer.from(chunk)
      const corruptOffset = 8
      if (offset <= corruptOffset && corruptOffset < offset + output.byteLength) output[corruptOffset - offset] = 0
      offset += output.byteLength
      callback(null, output)
    },
  })).pipe(response)
}

function serveAcceptanceAssets(): Plugin {
  const install = (server: Pick<ViteDevServer | PreviewServer, 'middlewares'>): void => {
    server.middlewares.use((request, response, next) => {
      if (request.url === undefined) { next(); return }
      const url = new URL(request.url, 'http://localhost')
      if (url.searchParams.get('wasmAcceptance') === 'isolated') {
        response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
        response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
      }
      if (url.searchParams.has('performanceAcceptance') && url.searchParams.get('isolated') === 'true') {
        response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
        response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
      }
      if (/^\/assets\/(?:demux-)?worker-entry-[A-Za-z0-9_-]+\.js$/.test(url.pathname)) {
        response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
      }
      if (request.method !== 'GET') { next(); return }
      if (url.pathname === '/wasm-vp8.webm') {
        serveFile(request.headers.range, response, WASM_SAMPLE_PATH, 'video/webm')
        return
      }
      const assetName = url.pathname.startsWith('/wasm/') ? url.pathname.slice('/wasm/'.length) : ''
      const assetPath = WASM_ASSETS.get(assetName)
      if (assetPath !== undefined) {
        serveFile(undefined, response, assetPath, 'application/wasm')
        return
      }
      next()
    })
  }
  return {
    name: 'mxp-wasm-acceptance-assets',
    configureServer(server): void { install(server) },
    configurePreviewServer(server): void { install(server) },
  }
}

function serveSampleRanges(): Plugin {
  const install = (server: Pick<ViteDevServer | PreviewServer, 'middlewares'>): void => {
    server.middlewares.use((request, response, next) => {
      if (request.method !== 'GET' || request.url === undefined
        || new URL(request.url, 'http://localhost').pathname !== '/flower.webm') {
        next()
        return
      }
      const match = /^bytes=([0-9]+)-([0-9]+)$/.exec(request.headers.range ?? '')
      const startText = match?.[1]
      const endText = match?.[2]
      if (startText === undefined || endText === undefined) {
        next()
        return
      }
      const size = statSync(SAMPLE_PATH).size
      const start = Number(startText)
      const end = Math.min(Number(endText), size - 1)
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
        response.writeHead(416, { 'Content-Range': `bytes */${size}` })
        response.end()
        return
      }
      response.writeHead(206, {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Type': 'video/webm',
      })
      const stream = createReadStream(SAMPLE_PATH, { start, end })
      stream.on('error', (error) => response.destroy(error))
      stream.pipe(response)
    })
  }
  return {
    name: 'mxp-demo-sample-ranges',
    configureServer(server): void { install(server) },
    configurePreviewServer(server): void { install(server) },
  }
}

function serveFile(
  range: string | undefined,
  response: import('node:http').ServerResponse,
  filePath: string,
  contentType: string,
): void {
  const size = statSync(filePath).size
  const match = /^bytes=([0-9]+)-([0-9]+)$/.exec(range ?? '')
  const startText = match?.[1]
  const endText = match?.[2]
  if (range !== undefined && (startText === undefined || endText === undefined)) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` })
    response.end()
    return
  }
  const start = startText === undefined ? 0 : Number(startText)
  const end = endText === undefined ? size - 1 : Math.min(Number(endText), size - 1)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` })
    response.end()
    return
  }
  const partial = range !== undefined
  response.writeHead(partial ? 206 : 200, {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'Content-Length': String(end - start + 1),
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    'Content-Type': contentType,
  })
  const stream = createReadStream(filePath, { start, end })
  stream.on('error', (error) => response.destroy(error))
  stream.pipe(response)
}
