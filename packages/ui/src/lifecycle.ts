export class CleanupScope {
  #cleanups = new Set<() => void>()
  #closed = false

  get closed(): boolean { return this.#closed }

  add(cleanup: () => void): () => void {
    if (this.#closed) { cleanup(); return () => {} }
    this.#cleanups.add(cleanup)
    return () => { this.#cleanups.delete(cleanup); cleanup() }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const cleanup of [...this.#cleanups]) {
      try { cleanup() } catch { /* best effort cleanup */ }
    }
    this.#cleanups.clear()
  }
}

export function isElement(value: unknown): value is HTMLElement {
  if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) return true
  return Boolean(value && typeof value === 'object' && typeof (value as { appendChild?: unknown }).appendChild === 'function')
}
