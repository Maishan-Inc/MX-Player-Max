import type {
  AudioCodecConfig,
  CapabilityResult,
  CapabilitySnapshot,
  CapabilitySupport,
  MediaCapabilityQuery,
  MediaCapabilityReport,
  MediaDescriptor,
  NativeTrackCapability,
  VideoCodecConfig,
  WebCodecsCapability,
} from '@mx-player-max/types'
import { CAPABILITY_SCHEMA_VERSION, type CapabilityProbeAdapter, type MediaDecodingQuery } from './contracts'

export function createMediaCapabilityQuery(media: MediaDescriptor): MediaCapabilityQuery {
  const video = media.tracks.find((track) => track.kind === 'video')
  const audio = media.tracks.find((track) => track.kind === 'audio')
  return {
    container: media.container,
    mimeType: media.mimeType,
    video: video ? {
      codec: video.codec ?? video.codecId,
      ...(video.width !== undefined ? { codedWidth: video.width } : {}),
      ...(video.height !== undefined ? { codedHeight: video.height } : {}),
      ...(video.bitrate !== undefined ? { bitrate: video.bitrate } : {}),
      ...(video.frameRate !== undefined ? { framerate: video.frameRate } : {}),
      ...(video.codecPrivate ? { description: video.codecPrivate } : {}),
    } : null,
    audio: audio ? {
      codec: audio.codec ?? audio.codecId,
      ...(audio.sampleRate !== undefined ? { sampleRate: audio.sampleRate } : {}),
      ...(audio.channels !== undefined ? { numberOfChannels: audio.channels } : {}),
      ...(audio.bitrate !== undefined ? { bitrate: audio.bitrate } : {}),
      ...(audio.codecPrivate ? { description: audio.codecPrivate } : {}),
    } : null,
  }
}

export async function probeMediaReport(
  adapter: CapabilityProbeAdapter,
  snapshot: CapabilitySnapshot,
  query: MediaCapabilityQuery,
): Promise<MediaCapabilityReport> {
  const [nativeVideo, nativeAudio] = await probeNativeTracks(adapter, snapshot, query)
  const webVideo = await probeWebCodecsTrack(adapter, snapshot, query.video, 'video')
  const webAudio = await probeWebCodecsTrack(adapter, snapshot, query.audio, 'audio')
  const nativePlayable = combineTrackSupport(query.video, nativeVideo, query.audio, nativeAudio)
  const webCodecsPlayable = combineTrackSupport(query.video, webVideo, query.audio, webAudio)
  return {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    query,
    native: {
      video: nativeVideo,
      audio: nativeAudio,
      playable: nativePlayable.status,
      reasons: sortReasons(nativePlayable.reasons),
    },
    webCodecs: {
      video: webVideo,
      audio: webAudio,
      playable: webCodecsPlayable.status,
      reasons: sortReasons(webCodecsPlayable.reasons),
    },
  }
}

async function probeNativeTracks(
  adapter: CapabilityProbeAdapter,
  snapshot: CapabilitySnapshot,
  query: MediaCapabilityQuery,
): Promise<readonly [NativeTrackCapability, NativeTrackCapability]> {
  const absent = (): NativeTrackCapability => ({ status: 'unknown', reasons: ['track-absent'], contentType: null, canPlayType: '' })
  const pair = (result: NativeTrackCapability): readonly [NativeTrackCapability, NativeTrackCapability] => [
    query.video ? cloneNativeResult(result) : absent(),
    query.audio ? cloneNativeResult(result) : absent(),
  ]
  if (!query.video && !query.audio) return [absent(), absent()]
  if (!snapshot.htmlVideo) return pair({ status: 'unsupported', reasons: ['html-video-unavailable'], contentType: query.mimeType, canPlayType: '' })
  if (!query.mimeType) return pair({ status: 'unknown', reasons: ['native-content-type-unavailable'], contentType: null, canPlayType: '' })

  const contentType = buildContentType(query.mimeType, query.video, query.audio)
  let canPlayType: '' | 'maybe' | 'probably' = ''
  try {
    canPlayType = normalizeCanPlayType(adapter.canPlayType(contentType))
  } catch {
    return pair({ status: 'unknown', reasons: ['can-play-type-failed'], contentType, canPlayType: '' })
  }
  if (canPlayType === '') {
    return pair({ status: 'unsupported', reasons: ['can-play-type-empty'], contentType, canPlayType })
  }
  if (!snapshot.mediaCapabilities) {
    return pair({ status: 'supported', reasons: ['can-play-type'], contentType, canPlayType })
  }
  if (!canCreateDecodingQuery(query)) {
    return pair({ status: 'unknown', reasons: ['decoding-info-config-incomplete'], contentType, canPlayType })
  }
  try {
    const decodingInfo = await adapter.decodingInfo(createDecodingQuery(query))
    return pair({
      status: decodingInfo.supported ? 'supported' : 'unsupported',
      reasons: sortReasons([
        decodingInfo.supported ? 'decoding-info-supported' : 'decoding-info-unsupported',
        canPlayType === 'probably' ? 'can-play-type-probably' : 'can-play-type-maybe',
      ]),
      contentType,
      canPlayType,
      decodingInfo,
    })
  } catch {
    return pair({ status: 'unknown', reasons: ['decoding-info-failed'], contentType, canPlayType })
  }
}

function cloneNativeResult(result: NativeTrackCapability): NativeTrackCapability {
  return {
    ...result,
    reasons: [...result.reasons],
    ...(result.decodingInfo ? { decodingInfo: { ...result.decodingInfo } } : {}),
  }
}

async function probeWebCodecsTrack<T extends VideoCodecConfig | AudioCodecConfig>(
  adapter: CapabilityProbeAdapter,
  snapshot: CapabilitySnapshot,
  config: T | null,
  kind: 'video' | 'audio',
): Promise<WebCodecsCapability> {
  if (!config) return { status: 'unknown', reasons: ['track-absent'], configPresent: false }
  if ((kind === 'video' && !snapshot.webCodecsVideo) || (kind === 'audio' && !snapshot.webCodecsAudio)) {
    return { status: 'unsupported', reasons: ['webcodecs-api-unavailable'], configPresent: true }
  }
  if (!config.codec.trim() || (kind === 'audio' && !isCompleteAudioDecoderConfig(config as AudioCodecConfig))) {
    return { status: 'unknown', reasons: ['webcodecs-config-incomplete'], configPresent: true }
  }
  try {
    const supported = kind === 'video'
      ? await adapter.isVideoConfigSupported(config as VideoCodecConfig)
      : await adapter.isAudioConfigSupported(config as AudioCodecConfig)
    return {
      status: supported ? 'supported' : 'unsupported',
      reasons: [supported ? 'config-supported' : 'config-unsupported'],
      configPresent: true,
    }
  } catch {
    return { status: 'unknown', reasons: ['config-probe-failed'], configPresent: true }
  }
}

function createDecodingQuery(query: MediaCapabilityQuery): MediaDecodingQuery {
  return {
    type: 'file',
    ...(query.video && query.mimeType ? {
      video: { ...query.video, contentType: buildTrackContentType(query.mimeType, query.video.codec, 'video') },
    } : {}),
    ...(query.audio && query.mimeType ? {
      audio: { ...query.audio, contentType: buildTrackContentType(query.mimeType, query.audio.codec, 'audio') },
    } : {}),
  }
}

function canCreateDecodingQuery(query: MediaCapabilityQuery): boolean {
  if (!query.mimeType) return false
  if (!query.video) return query.audio !== null
  return query.video.codedWidth !== undefined
    && query.video.codedHeight !== undefined
    && query.video.bitrate !== undefined
    && query.video.framerate !== undefined
}

function isCompleteAudioDecoderConfig(config: AudioCodecConfig): boolean {
  return config.sampleRate !== undefined && config.numberOfChannels !== undefined
}

function combineTrackSupport(
  firstConfig: VideoCodecConfig | AudioCodecConfig | null,
  first: CapabilityResult,
  secondConfig: VideoCodecConfig | AudioCodecConfig | null,
  second: CapabilityResult,
): { status: CapabilitySupport; reasons: readonly string[] } {
  const results = [
    ...(firstConfig ? [first] : []),
    ...(secondConfig ? [second] : []),
  ]
  if (results.length === 0) return { status: 'unknown', reasons: ['no-media-track'] }
  if (results.some((result) => result.status === 'unsupported')) {
    return { status: 'unsupported', reasons: results.flatMap((result) => result.reasons) }
  }
  if (results.some((result) => result.status === 'unknown')) {
    return { status: 'unknown', reasons: results.flatMap((result) => result.reasons) }
  }
  return { status: 'supported', reasons: results.flatMap((result) => result.reasons) }
}

function buildContentType(mimeType: string, video: VideoCodecConfig | null, audio: AudioCodecConfig | null): string {
  if (!video && !audio) return mimeType
  const codecs = [video?.codec, audio?.codec].filter((codec): codec is string => Boolean(codec))
  return codecs.length === 0 ? mimeType : `${mimeType}; codecs="${codecs.join(', ')}"`
}

function buildTrackContentType(mimeType: string, codec: string, kind: 'video' | 'audio'): string {
  const normalizedMimeType = kind === 'audio' ? mimeType.replace(/^video\//i, 'audio/') : mimeType
  return `${normalizedMimeType}; codecs="${codec}"`
}

function normalizeCanPlayType(value: string): '' | 'maybe' | 'probably' {
  return value === 'probably' ? 'probably' : value === 'maybe' ? 'maybe' : ''
}

function sortReasons(reasons: readonly string[]): string[] {
  return [...new Set(reasons)].sort()
}
