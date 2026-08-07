import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { resolveVideoTarget } from '../src/native/target'
import { FakeDocument, FakeVideo } from './fake-video'

afterEach(() => vi.unstubAllGlobals())

describe('native target resolution', () => {
  it('reuses a supplied video element', () => {
    const video = new FakeVideo()
    expect(resolveVideoTarget(video as unknown as HTMLElement)).toMatchObject({ video, owned: false })
  })

  it('creates an owned video in a container without clearing children', () => {
    const document = new FakeDocument()
    const children: unknown[] = [{ marker: true }]
    const container = {
      ownerDocument: document,
      tagName: 'DIV',
      appendChild(node: unknown) { children.push(node); return node },
    }
    const result = resolveVideoTarget(container as unknown as HTMLElement)
    expect(result.owned).toBe(true)
    expect(children).toHaveLength(2)
    expect(children[0]).toEqual({ marker: true })
  })

  it('rejects missing and invalid selector targets', () => {
    const document = new FakeDocument()
    vi.stubGlobal('document', document)
    expect(() => resolveVideoTarget('#missing')).toThrowError(expect.objectContaining({ code: ErrorCodes.ENGINE_INVALID_TARGET }))
    document.querySelector = () => { throw new Error('invalid') }
    expect(() => resolveVideoTarget('[')).toThrowError(expect.objectContaining({ code: ErrorCodes.ENGINE_INVALID_TARGET }))
  })
})
