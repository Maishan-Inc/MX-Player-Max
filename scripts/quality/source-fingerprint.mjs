import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Include uncommitted sources; exclude generated outputs and evidence to avoid circular hashes. */
export async function sourceFingerprint(root) {
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true })
    .split('\0').filter((name) => /^(packages\/|apps\/|scripts\/|\.github\/|tests\/|package\.json$|pnpm-|tsconfig|playwright|docker-compose|compose\.)/.test(name))
    .filter((name) => !/(^|\/)(node_modules|dist|dist-lib|generated|evidence|baselines|test-results)\//.test(name) && !name.endsWith('.tsbuildinfo'))
  const hash = createHash('sha256')
  for (const name of [...new Set(names)].sort()) {
    let bytes = await readFile(path.join(root, name))
    // Git checks out text with platform-specific endings. Hash normalized text and exact binary bytes.
    if (/\.(?:[cm]?js|tsx?|json|ya?ml|md|css|html|ps1|sh|c|h|conf|txt)$/.test(name) || !path.extname(name)) bytes = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))
    hash.update(name).update('\0').update(createHash('sha256').update(bytes).digest()).update('\0')
  }
  return hash.digest('hex')
}
