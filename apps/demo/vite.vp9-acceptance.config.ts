import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url))
const testRoot = fileURLToPath(new URL('../../tests/browser/vp9/', import.meta.url))
const publicEntry = (name: string): string => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url))

// This server exists only for local browser acceptance. Its allowlist never enters Demo public,
// Browser release, npm packages, Pages or Docker assets.
const assets = new Map<string, { path: string; type: string }>([
  ['/fixture/vp9-p0.webm', { path: fileURLToPath(new URL('../../packages/decoder-wasm-vpx/tests/fixtures/webm-vp9-p0-8bit-641x359.webm', import.meta.url)), type: 'video/webm' }],
  ['/fixture/vp9-p2.webm', { path: fileURLToPath(new URL('../../packages/decoder-wasm-vpx/tests/fixtures/webm-vp9-p2-10bit-641x359.webm', import.meta.url)), type: 'video/webm' }],
  ['/wasm/libvpx-vp9-single.wasm', { path: fileURLToPath(new URL('../../packages/decoder-wasm-vpx/wasm/libvpx-vp9-single.wasm', import.meta.url)), type: 'application/wasm' }],
  ['/wasm/libvpx-vp9-simd.wasm', { path: fileURLToPath(new URL('../../packages/decoder-wasm-vpx/wasm/libvpx-vp9-simd.wasm', import.meta.url)), type: 'application/wasm' }],
  ['/wasm/libvpx-vp9-threaded.wasm', { path: fileURLToPath(new URL('../../packages/decoder-wasm-vpx/wasm/libvpx-vp9-threaded.wasm', import.meta.url)), type: 'application/wasm' }],
])

function serveRestrictedAcceptanceAssets(): Plugin {
  return {
    name: 'mxp-local-vp9-acceptance-assets',
    configureServer(server): void {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' || request.url === undefined) { next(); return }
        const url = new URL(request.url, 'http://localhost')
        if (url.searchParams.get('isolated') === '1') {
          response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
          response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
        }
        if (url.pathname === '/worker-entry.ts') {
          response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
          response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
        }
        const asset = assets.get(url.pathname)
        if (asset === undefined) { next(); return }
        try {
          const bytes = readFileSync(asset.path)
          response.writeHead(200, {
            'Content-Type': asset.type,
            'Content-Length': String(bytes.byteLength),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          })
          response.end(bytes)
        } catch {
          response.writeHead(404)
          response.end()
        }
      })
    },
  }
}

export default defineConfig({
  root: testRoot,
  resolve: {
    alias: {
      '@mx-player-max/types': publicEntry('types'),
      '@mx-player-max/capabilities': publicEntry('capabilities'),
      '@mx-player-max/demux': publicEntry('demux'),
      '@mx-player-max/decoder-wasm': publicEntry('decoder-wasm'),
      '@mx-player-max/decoder-worker': publicEntry('decoder-worker'),
      '@mx-player-max/decoder-wasm-vpx': publicEntry('decoder-wasm-vpx'),
    },
  },
  plugins: [serveRestrictedAcceptanceAssets()],
  server: { fs: { allow: [workspaceRoot], deny: ['**/*.wasm', '**/tests/fixtures/*.webm'] } },
})
