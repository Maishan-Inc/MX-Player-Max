import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const bundle = await readFile(fileURLToPath(import.meta.resolve('@mx-player-max/browser/iife')), 'utf8')
const sandbox = {}
const context = createContext(sandbox)
const before = new Set(Reflect.ownKeys(sandbox))
runInContext(bundle, context)
assert.deepEqual(Reflect.ownKeys(sandbox).filter((key) => !before.has(key)), ['MXPlayerMax'])
assert.equal(typeof sandbox.MXPlayerMax.create, 'function')
assert.equal(typeof sandbox.MXPlayerMax.MXPlayer, 'function')
assert.equal(typeof sandbox.MXPlayerMax.attachPlayerUi, 'function')
