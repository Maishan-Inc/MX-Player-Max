import type { SourceDescriptor } from '@mx-player-max/types'
import { FileRangeLoader } from './file-loader'
import { HttpRangeLoader } from './http-loader'
import type { CreateRangeLoaderOptions, RangeLoader } from './types'

export function createRangeLoader(source: SourceDescriptor, options: CreateRangeLoaderOptions = {}): RangeLoader {
  const shared = {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.cache === undefined ? {} : { cache: options.cache }),
    ...(options.maxConcurrentReads === undefined ? {} : { maxConcurrentReads: options.maxConcurrentReads }),
  }
  if (source.kind === 'file') return new FileRangeLoader(source.file, shared)
  return new HttpRangeLoader(source.url, {
    ...shared,
    ...(source.headers === undefined ? {} : { headers: source.headers }),
    ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })
}

