export const NATIVE_VIDEO_EVENTS = [
  'loadedmetadata',
  'canplay',
  'play',
  'playing',
  'pause',
  'seeking',
  'seeked',
  'waiting',
  'stalled',
  'timeupdate',
  'progress',
  'durationchange',
  'volumechange',
  'ratechange',
  'enterpictureinpicture',
  'leavepictureinpicture',
  'ended',
  'error',
  'emptied',
] as const

export type NativeVideoEventName = typeof NATIVE_VIDEO_EVENTS[number]
