import {
  Captions,
  Check,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture,
  Play,
  RotateCcw,
  Settings,
  SkipForward,
  Theater,
  Volume2,
  VolumeX,
  X,
  createElement,
} from 'lucide'

type IconNode = Parameters<typeof createElement>[0]

const ICONS = {
  captions: Captions,
  check: Check,
  close: X,
  fullscreen: Maximize,
  fullscreenExit: Minimize,
  mute: Volume2,
  muted: VolumeX,
  next: SkipForward,
  pause: Pause,
  pip: PictureInPicture,
  play: Play,
  replay: RotateCcw,
  settings: Settings,
  theater: Theater,
} as const satisfies Record<string, IconNode>

export type PlayerIconName = keyof typeof ICONS

export function createPlayerIcon(document: Document, name: PlayerIconName): SVGElement {
  const icon = createElement(ICONS[name], {
    'aria-hidden': 'true',
    focusable: 'false',
  })
  icon.classList.add('mxp-icon-svg')
  return icon
}
