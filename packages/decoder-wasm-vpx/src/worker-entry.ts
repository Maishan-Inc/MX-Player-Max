import type { DecoderWorkerRequest, DecoderWorkerResponse } from '@mx-player-max/decoder-worker'
import { LibvpxVp8WorkerController, type LibvpxVp8WorkerConfig } from './worker-controller'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope
const controller = new LibvpxVp8WorkerController({
  postMessage(message: DecoderWorkerResponse, transfer: Transferable[] = []): void {
    scope.postMessage(message, transfer)
  },
})

scope.onmessage = (event: MessageEvent<DecoderWorkerRequest<LibvpxVp8WorkerConfig>>): void => {
  void controller.handle(event.data)
}

export {}
