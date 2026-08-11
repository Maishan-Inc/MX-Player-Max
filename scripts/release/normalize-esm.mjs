import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export async function normalizePackageDist(packageDirectory) {
  const distDirectory = path.join(packageDirectory, 'dist')
  if (!(await isDirectory(distDirectory))) return
  const files = await collectJavaScriptFiles(distDirectory)
  const fileSet = new Set(files.map((file) => path.resolve(file)))
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const normalized = source.replace(/((?:\bfrom\s*|\bimport\s+|\bimport\s*\(\s*|\bnew\s+URL\s*\(\s*)["'])(\.{1,2}\/[^"']+)(["'])/g, (match, prefix, specifier, quote) => {
      if (path.posix.extname(specifier) !== '') return match
      const candidate = path.resolve(path.dirname(file), specifier)
      if (fileSet.has(`${candidate}.js`)) return `${prefix}${specifier}.js${quote}`
      if (fileSet.has(path.join(candidate, 'index.js'))) return `${prefix}${specifier}/index.js${quote}`
      return match
    })
    if (normalized !== source) {
      const withoutStaleMap = normalized.replace(/\r?\n\/\/# sourceMappingURL=[^\r\n]+\s*$/, '\n')
      await writeFile(file, withoutStaleMap, 'utf8')
      await rm(`${file}.map`, { force: true })
    }
  }
}

async function collectJavaScriptFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectJavaScriptFiles(entryPath))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(entryPath)
  }
  return files
}

async function isDirectory(directory) {
  try { return (await stat(directory)).isDirectory() } catch { return false }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const packagesRoot = path.join(root, 'packages')
  for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) await normalizePackageDist(path.join(packagesRoot, entry.name))
  }
}
