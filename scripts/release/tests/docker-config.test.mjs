import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const dockerfile = await readFile(new URL('../../../apps/demo/Dockerfile', import.meta.url), 'utf8')
const nginx = await readFile(new URL('../../../apps/demo/nginx.conf', import.meta.url), 'utf8')
const compose = await readFile(new URL('../../../docker-compose.yml', import.meta.url), 'utf8')

test('demo container uses a reproducible install and a fixed local image name', () => {
  assert.match(dockerfile, /pnpm install --frozen-lockfile/)
  assert.doesNotMatch(dockerfile, /--no-frozen-lockfile/)
  assert.match(compose, /image:\s*mx-player-max-demo:phase-12-local/)
  assert.match(compose, /4174:8080/)
  assert.match(dockerfile, /EXPOSE 80 8080/)
})

test('nginx separates navigation, versioned assets, media, and missing resources', () => {
  assert.match(nginx, /location = \/index\.html/)
  assert.match(nginx, /Cache-Control "no-cache"/)
  assert.match(nginx, /location ~\* \^\/assets\//)
  assert.match(nginx, /Cache-Control "public, max-age=31536000, immutable"/)
  assert.match(nginx, /location ~\* \\.\(\?:mp4\|webm/)
  assert.match(nginx, /Content-Type-Options "nosniff" always/g)
  assert.ok((nginx.match(/Cross-Origin-Opener-Policy "same-origin" always/g) ?? []).length >= 5)
  assert.ok((nginx.match(/X-Content-Type-Options "nosniff" always/g) ?? []).length >= 5)
  assert.match(nginx, /listen 8080/)
  assert.match(nginx, /Content-Security-Policy .*object-src 'none'.*base-uri 'none'.*frame-ancestors 'none'/)
})

test('docker smoke checks headers, range, MIME, 404, and runtime isolation', async () => {
  const smoke = await readFile(new URL('../docker-smoke.ps1', import.meta.url), 'utf8')
  for (const evidence of [
    'Cross-Origin-Opener-Policy',
    'Cross-Origin-Embedder-Policy',
    'X-Content-Type-Options',
    'Content-Range',
    'Accept-Ranges',
    'Content-Length',
    'application/javascript',
    'text/css',
    'application/wasm',
    'crossOriginIsolated',
    'Content-Security-Policy',
    'non-isolated',
    '404',
  ]) assert.match(smoke, new RegExp(evidence))
  assert.match(smoke, /\$currentId -eq \$containerId -and \$currentLabel -eq 'phase12'/)
  assert.match(smoke, /Invoke-Docker @\('rm', '--force', \$containerId\)/)
  assert.match(smoke, /127\.0\.0\.1:\$\{NonIsolatedPort\}:8080/)
})
