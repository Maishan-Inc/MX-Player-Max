import { DemuxWorkerController, type DemuxWorkerRequest, type DemuxWorkerResponse } from '@mx-player-max/demux'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope
const controller = new DemuxWorkerController({
  postMessage(message: DemuxWorkerResponse, transfer: Transferable[] = []): void {
    scope.postMessage(message, transfer)
  },
})

scope.onmessage = (event: MessageEvent<DemuxWorkerRequest>): void => {
  void controller.handle(event.data)
}

export {}
