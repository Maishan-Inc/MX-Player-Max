import {
  BarChart3,
  Captions,
  Check,
  ClipboardCopy,
  Clock,
  Code,
  Info,
  Link,
  Lock,
  LockOpen,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  Repeat,
  RotateCcw,
  Settings,
  SkipForward,
  Volume2,
  VolumeX,
  Wrench,
  X,
  createElement,
} from 'lucide'

type IconNode = Parameters<typeof createElement>[0]

/**
 * One shared glyph vocabulary with the MXAnime-CMS built-in MX-Player: `PictureInPicture2`
 * for PiP, `RectangleHorizontal` for theater mode, `Lock`/`LockOpen` for the control lock,
 * and `Maximize`/`Minimize` for fullscreen. The right-click menu adds one glyph per entry.
 */
const ICONS = {
  about: Info,
  captions: Captions,
  check: Check,
  close: X,
  copyDebug: ClipboardCopy,
  copyEmbed: Code,
  copyUrl: Link,
  copyUrlAtTime: Clock,
  fullscreen: Maximize,
  fullscreenExit: Minimize,
  lock: Lock,
  loop: Repeat,
  mini: PictureInPicture,
  mute: Volume2,
  muted: VolumeX,
  next: SkipForward,
  pause: Pause,
  pip: PictureInPicture2,
  play: Play,
  replay: RotateCcw,
  reset: RotateCcw,
  settings: Settings,
  statistics: BarChart3,
  theater: RectangleHorizontal,
  troubleshoot: Wrench,
  unlock: LockOpen,
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
