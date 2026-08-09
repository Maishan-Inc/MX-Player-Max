import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const source = resolve(root, '../src/style.css')
const target = resolve(root, '../dist/style.css')
await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)
