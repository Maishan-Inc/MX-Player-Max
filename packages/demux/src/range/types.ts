import type {
  ByteRange,
  RangeLoaderOptions,
  RangeReadResult,
  RetryPolicy,
  SourceDescriptor,
} from '@mx-player-max/types'

export interface RangeLoader {
  read(range: ByteRange, options?: RangeLoaderOptions): Promise<RangeReadResult>
  close(): void
}

export interface FileRangeLoaderOptions extends RangeLoaderOptions {
  maxConcurrentReads?: number
}

export type RangeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface HttpRangeLoaderOptions extends RangeLoaderOptions {
  headers?: Readonly<Record<string, string>>
  credentials?: RequestCredentials
  maxConcurrentReads?: number
  fetch?: RangeFetch
}

export interface CreateRangeLoaderOptions extends RangeLoaderOptions {
  credentials?: RequestCredentials
  maxConcurrentReads?: number
  fetch?: RangeFetch
}

export type RangeLoaderFactory = (source: SourceDescriptor, options?: CreateRangeLoaderOptions) => RangeLoader

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 50,
  maxDelayMs: 1_000,
}

export const DEFAULT_MAX_CONCURRENT_READS = 4
