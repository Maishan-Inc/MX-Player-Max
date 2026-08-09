import { createReadStream, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'

const SAMPLE_PATH = fileURLToPath(new URL('./public/flower.webm', import.meta.url))

export default defineConfig({
  plugins: [serveSampleRanges(), react()],
  server: { host: true, port: 4173 },
  preview: { host: true, port: 4173 },
})

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
