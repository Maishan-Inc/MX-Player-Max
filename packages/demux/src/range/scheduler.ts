import { ErrorCodes } from '@mx-player-max/types'
import { DemuxError, createRangeAbortError } from './errors'

interface QueueItem {
  run: (signal: AbortSignal) => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  signal: AbortSignal | undefined
  removeQueuedAbort: (() => void) | undefined
}

export class RangeScheduler {
  readonly #maxConcurrent: number
  readonly #queue: QueueItem[] = []
  readonly #active = new Set<AbortController>()
  #closed = false

  constructor(maxConcurrent: number) {
    this.#maxConcurrent = maxConcurrent
  }

  schedule<T>(run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.#closed) return Promise.reject(createRangeAbortError(true))
    if (signal?.aborted === true) return Promise.reject(createRangeAbortError(false, signal.reason))

    return new Promise<T>((resolve, reject) => {
      const item: QueueItem = {
        run: (taskSignal) => run(taskSignal),
        resolve: (value) => resolve(value as T),
        reject,
        signal,
        removeQueuedAbort: undefined,
      }
      if (signal !== undefined) {
        const onAbort = (): void => {
          const index = this.#queue.indexOf(item)
          if (index < 0) return
          this.#queue.splice(index, 1)
          reject(createRangeAbortError(false, signal.reason))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        item.removeQueuedAbort = () => signal.removeEventListener('abort', onAbort)
      }
      this.#queue.push(item)
      this.#pump()
    })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const item of this.#queue.splice(0)) {
      item.removeQueuedAbort?.()
      item.reject(createRangeAbortError(true))
    }
    for (const controller of this.#active) controller.abort(createRangeAbortError(true))
  }

  get pendingCount(): number {
    return this.#queue.length
  }

  get activeCount(): number {
    return this.#active.size
  }

  #pump(): void {
    while (!this.#closed && this.#active.size < this.#maxConcurrent) {
      const item = this.#queue.shift()
      if (item === undefined) return
      item.removeQueuedAbort?.()
      if (item.signal?.aborted === true) {
        item.reject(createRangeAbortError(false, item.signal.reason))
        continue
      }
      this.#start(item)
    }
  }

  #start(item: QueueItem): void {
    const controller = new AbortController()
    this.#active.add(controller)
    const onExternalAbort = (): void => controller.abort(item.signal?.reason)
    item.signal?.addEventListener('abort', onExternalAbort, { once: true })

    void item.run(controller.signal).then(
      (value) => {
        if (this.#closed) item.reject(createRangeAbortError(true))
        else if (item.signal?.aborted === true) item.reject(createRangeAbortError(false, item.signal.reason))
        else item.resolve(value)
      },
      (cause: unknown) => {
        if (this.#closed) item.reject(createRangeAbortError(true, cause))
        else if (item.signal?.aborted === true || controller.signal.aborted) {
          item.reject(createRangeAbortError(false, cause))
        } else {
          item.reject(cause instanceof Error ? cause : new DemuxError(ErrorCodes.RANGE_NETWORK_FAILED, 'Range task failed', { cause }))
        }
      },
    ).finally(() => {
      item.signal?.removeEventListener('abort', onExternalAbort)
      this.#active.delete(controller)
      this.#pump()
    })
  }
}

