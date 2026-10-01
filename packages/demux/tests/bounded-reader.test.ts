import { describe, expect, it, vi } from 'vitest'
import { FileRangeLoader } from '../src/index'
import { BoundedRangeReader } from '../src/containers/bounded-reader'
import { resolveDemuxLimits } from '../src/containers/limits'

describe('Cluster read-ahead window', () => {
  it('limits each read to the Cluster and configured range budget and returns owned bytes', async () => {
    const loader = new FileRangeLoader(new File([Uint8Array.from({ length: 100 }, (_, index) => index)], 'local.webm'))
    const read = vi.spyOn(loader, 'read')
    const reader = new BoundedRangeReader(loader, resolveDemuxLimits({ maxReadRangeBytes: 16 })).forkWithReadAhead(10, 30)
    const first = await reader.readAt(10, 16)
    first[0] = 255
    expect([...await reader.readAt(10, 2)]).toEqual([10, 11])
    expect([...await reader.readAt(28, 2)]).toEqual([28, 29])
    expect(read.mock.calls.map(([range]) => range)).toEqual([{ start: 10, endExclusive: 26 }, { start: 28, endExclusive: 30 }])
    await expect(reader.readAt(29, 2)).rejects.toMatchObject({ code: 'CONTAINER_TRUNCATED' })
    loader.close()
  })

  it('does not read ahead outside an explicit scope and detects source changes on refill', async () => {
    const file = new File([new Uint8Array(200_000)], 'local.webm')
    const loader = new FileRangeLoader(file)
    const read = vi.spyOn(loader, 'read')
    const reader = new BoundedRangeReader(loader, resolveDemuxLimits())
    await reader.readAt(0, 1)
    expect(read.mock.calls[0]![0]).toEqual({ start: 0, endExclusive: 1 })
    const scoped = reader.forkWithReadAhead(0, file.size)
    await scoped.readAt(0, 1)
    expect(read.mock.calls[1]![0]).toEqual({ start: 0, endExclusive: 65536 })
    const original = FileRangeLoader.prototype.read.bind(loader)
    read.mockImplementation(async (range) => ({ ...await original(range), sourceLength: file.size + 1 }))
    await expect(scoped.readAt(65536, 1)).rejects.toMatchObject({ code: 'RANGE_SOURCE_CHANGED' })
    loader.close()
  })
})
