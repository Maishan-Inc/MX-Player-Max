import type { DecoderWorkerRequest, DecoderWorkerResponse } from '@mx-player-max/decoder-worker'
import {
  LibvpxVp8WorkerBackend,
  LibvpxVp8WorkerController,
  type LibvpxVp8WorkerConfig,
} from '@mx-player-max/decoder-wasm-vpx'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope
const controller = new LibvpxVp8WorkerController({
  postMessage(message: DecoderWorkerResponse, transfer: Transferable[] = []): void {
    scope.postMessage(message, transfer)
  },
}, {
  // Only this local acceptance Worker can bypass the restricted review gate. The regular Worker
  // entry and Core keep their default approval requirement.
  createBackend: (callbacks) => new LibvpxVp8WorkerBackend(callbacks, { requireApprovedReview: false }),
})

scope.onmessage = (event: MessageEvent<DecoderWorkerRequest<LibvpxVp8WorkerConfig>>): void => {
  void controller.handle(event.data)
}

export {}
