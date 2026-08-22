/**
 * Shared WebGPU test harness.
 *
 * Three conditions are required before a page can obtain a GPU device, and all
 * three are easy to miss (see docs/development/webgpu-harness.md):
 *   1. `navigator.gpu` is [SecureContext] — `about:blank` reports
 *      `isSecureContext === false`, so the page must be served over
 *      http://127.0.0.1 or https.
 *   2. `headless: true` with no channel uses chromium-headless-shell, which
 *      exposes `navigator.gpu` but never returns an adapter. `channel: 'chromium'`
 *      selects the full build.
 *   3. The full build still needs `--enable-unsafe-webgpu` before it hands out a
 *      SwiftShader fallback adapter on a machine with no GPU.
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const HELPERS = resolve(dirname(fileURLToPath(import.meta.url)), 'webgpu-page-helpers.js')
const PAGE = '<!doctype html><meta charset="utf-8"><title>webgpu-harness</title>'

const MIME = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mxai': 'application/octet-stream' }

/**
 * Serve a blank secure-context page, hand a Playwright page to `callback`, and
 * always tear both down. Returns whatever `callback` returns.
 *
 * The page can `await import('/helpers.js')` to get `createGpuHelpers(device)`
 * from webgpu-page-helpers.js.
 *
 * @param {(page: import('@playwright/test').Page) => Promise<unknown>} callback
 * @param {{ port?: number, routes?: Record<string, string> }} [options]
 *   `routes` maps a URL prefix to a directory, so a gate can import the built
 *   package output. Extensionless specifiers fall back to `<path>.js`, which is
 *   what `tsc` emits and browsers cannot resolve on their own.
 */
export async function withWebGpuPage(callback, options = {}) {
  const port = options.port ?? 4398
  const routes = Object.entries(options.routes ?? {})
  const helpers = await readFile(HELPERS, 'utf8')
  const server = http.createServer((request, response) => {
    const url = (request.url ?? '/').split('?')[0]
    if (url === '/helpers.js') {
      response.writeHead(200, { 'content-type': MIME['.js'] })
      response.end(helpers)
      return
    }
    const route = routes.find(([prefix]) => url.startsWith(prefix))
    if (route) {
      void serveFile(response, route[1], url.slice(route[0].length))
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(PAGE)
  })
  await new Promise((ready) => server.listen(port, '127.0.0.1', ready))

  let browser
  try {
    browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-unsafe-webgpu'] })
  } catch (cause) {
    server.close()
    const detail = cause instanceof Error ? cause.message.split('\n')[0] : 'unknown failure'
    throw new Error(`the full Chromium build could not launch (${detail}). Install it with "pnpm exec playwright install chromium".`)
  }

  try {
    const page = await browser.newPage()
    const consoleErrors = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)) })
    await page.goto(`http://127.0.0.1:${port}/`)
    const result = await callback(page)
    if (consoleErrors.length > 0) console.error(consoleErrors.map((line) => `  [console] ${line}`).join('\n'))
    return result
  } finally {
    await browser.close()
    server.close()
  }
}

/** Report `failures` using the same shape as the other scripts/quality gates. */
export function reportFailures(failures, successMessage) {
  if (failures.length > 0) {
    console.error(`\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
    process.exitCode = 1
  } else {
    console.log(`\n${successMessage}`)
  }
}

/** Serve one file from a route directory, refusing paths that escape it. */
async function serveFile(response, directory, relative) {
  const target = resolve(directory, `.${relative.startsWith('/') ? relative : `/${relative}`}`)
  if (target !== directory && !target.startsWith(directory + sep)) {
    response.writeHead(403).end('forbidden')
    return
  }
  for (const candidate of extname(target) === '' ? [`${target}.js`, target] : [target]) {
    try {
      const body = await readFile(candidate)
      response.writeHead(200, { 'content-type': MIME[extname(candidate)] ?? 'application/octet-stream' })
      response.end(body)
      return
    } catch { /* try the next candidate */ }
  }
  response.writeHead(404).end('not found')
}
