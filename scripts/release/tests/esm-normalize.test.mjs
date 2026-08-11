import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizePackageDist } from '../normalize-esm.mjs'

test('normalizes only relative imports whose JS targets exist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mx-player-max-esm-'))
  try {
    const dist = path.join(root, 'dist')
    await mkdir(dist, { recursive: true })
    await writeFile(path.join(dist, 'index.js'), "import { value } from './dep'; export { value } from './dep'; import governor from './governor'; import('./lazy'); new Worker(new URL('./worker.js', import.meta.url)); import 'external-package'; void governor;\n//# sourceMappingURL=index.js.map")
    await writeFile(path.join(dist, 'index.js.map'), '{}')
    await writeFile(path.join(dist, 'dep.js'), 'export const value = 1')
    await writeFile(path.join(dist, 'lazy.js'), 'export default 1')
    await writeFile(path.join(dist, 'worker.js'), '')
    await mkdir(path.join(dist, 'governor'))
    await writeFile(path.join(dist, 'governor', 'index.js'), 'export default 1')
    await normalizePackageDist(root)
    const output = await readFile(path.join(dist, 'index.js'), 'utf8')
    assert.match(output, /from '\.\/dep\.js'/)
    assert.match(output, /import\('\.\/lazy\.js'\)/)
    assert.match(output, /from '\.\/governor\/index\.js'/)
    assert.match(output, /new URL\('\.\/worker\.js'/)
    assert.match(output, /import 'external-package'/)
    assert.doesNotMatch(output, /sourceMappingURL/)
    await assert.rejects(() => stat(path.join(dist, 'index.js.map')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
