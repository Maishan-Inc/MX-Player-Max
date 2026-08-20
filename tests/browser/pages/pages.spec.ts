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
  expect(manifest.assets.filter((asset) => asset.packageName === '@mx-player-max/decoder-wasm-vpx').map((asset) => asset.path).sort()).toEqual([
    'wasm/libvpx-vp8-simd.wasm',
    'wasm/libvpx-vp8-single.wasm',
  ])
  expect(manifest.excluded).toContainEqual(expect.objectContaining({
    path: 'wasm/libvpx-vp8-threaded.wasm',
    publishable: false,
    reason: 'threaded-host-glue-unavailable',
  }))

  const wasm = await request.get('sdk/wasm/libvpx-vp8-single.wasm')
  expect(wasm.status()).toBe(200)
  expect(wasm.headers()['content-type']).toContain('application/wasm')
  expect((await wasm.body()).byteLength).toBe(113304)

  const iife = await request.get('sdk/mx-player-max.iife.min.js')
  expect(iife.status()).toBe(200)
  expect(iife.headers()['content-type']).toContain('javascript')
})

interface ReleaseManifest {
  readonly assets: readonly { readonly packageName: string; readonly path: string }[]
  readonly excluded: readonly { readonly path: string; readonly publishable: boolean; readonly reason: string }[]
}
