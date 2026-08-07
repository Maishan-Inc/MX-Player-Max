import type { DemuxLimitsInput } from '../limits'
import { EbmlContainerAdapter } from './matroska-adapter'

export class WebMContainerAdapter extends EbmlContainerAdapter {
  constructor(limits: DemuxLimitsInput = {}) {
    super({
      id: 'webm',
      name: 'WebM',
      docType: 'webm',
      mimeVideo: 'video/webm',
      mimeAudio: 'audio/webm',
    }, limits)
  }
}

