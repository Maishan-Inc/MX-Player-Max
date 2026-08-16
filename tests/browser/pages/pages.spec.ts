import { expect, test } from '@playwright/test'

const expectedVersion = process.env.VITE_APP_VERSION?.trim() || 'dev'

test('serves the Demo and publishable Browser SDK from a repository subpath', async ({ page, request }) => {
  await page.goto('./', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('.player-stage')).toBeVisible()
  await expect(page.locator('.mxp-player-ui')).toBeVisible()
  await expect(page.locator('.runtime-status')).toContainText(`MX Player Max ${expectedVersion}`)
  await expect(page.getByRole('link', { name: 'Repository' })).toHaveAttribute(
    'href',
    'https://github.com/Maishan-Inc/MX-Player-Max',
  )
  await expect(page.locator('#media-url')).toHaveValue('http://127.0.0.1:4178/MX-Player-Max/flower.webm')

  const media = await request.get('flower.webm', { headers: { Range: 'bytes=0-31' } })
  expect([200, 206]).toContain(media.status())
  expect(media.headers()['content-type']).toContain('video/webm')
  expect((await media.body()).byteLength).toBeGreaterThan(0)

  const manifestResponse = await request.get('sdk/manifest.json')
  expect(manifestResponse.status()).toBe(200)
  const manifest = await manifestResponse.json() as ReleaseManifest
  expect(manifest.assets.some((asset) => asset.packageName === '@mx-player-max/browser')).toBe(true)
  expect(manifest.excluded.some((asset) => asset.publishable === false && asset.path.endsWith('.wasm'))).toBe(true)

  const iife = await request.get('sdk/mx-player-max.iife.min.js')
  expect(iife.status()).toBe(200)
  expect(iife.headers()['content-type']).toContain('javascript')
})

interface ReleaseManifest {
  readonly assets: readonly { readonly packageName: string }[]
  readonly excluded: readonly { readonly path: string; readonly publishable: boolean }[]
}
