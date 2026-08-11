import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

for (const specifier of ['@mx-player-max/browser/style.css', '@mx-player-max/ui/style.css']) {
  const css = await readFile(fileURLToPath(import.meta.resolve(specifier)), 'utf8')
  assert.match(css, /\.mxp-player-ui/)
}
