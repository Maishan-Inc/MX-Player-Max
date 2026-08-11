import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../../ui/dist/style.css', import.meta.url))
const outputDirectory = fileURLToPath(new URL('../dist/', import.meta.url))
const output = fileURLToPath(new URL('../dist/style.css', import.meta.url))

await mkdir(outputDirectory, { recursive: true })
await copyFile(source, output)
