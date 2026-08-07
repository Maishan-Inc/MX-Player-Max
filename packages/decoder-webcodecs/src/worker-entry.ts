import { VideoDecoderWorkerController } from './worker-controller'
import type { DecoderWorkerRequest, DecoderWorkerResponse } from './worker-protocol'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope
const controller = new VideoDecoderWorkerController({
  postMessage(message: DecoderWorkerResponse, transfer: Transferable[] = []): void {
    scope.postMessage(message, transfer)
  },
})

scope.onmessage = (event: MessageEvent<DecoderWorkerRequest>): void => {
  void controller.handle(event.data)
}

export {}
