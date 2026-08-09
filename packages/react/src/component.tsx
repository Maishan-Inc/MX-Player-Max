import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type ReactElement } from 'react'
import { MXPlayer as SdkPlayer } from '@mx-player-max/sdk'
import { attachPlayerUi, type PlayerUiController, type PlayerUiOptions } from '@mx-player-max/ui'
import type { MXPlayerOptions } from '@mx-player-max/types'

export interface MXPlayerReactProps {
  readonly playerOptions: Omit<MXPlayerOptions, 'target'>
  readonly uiOptions?: PlayerUiOptions
  readonly className?: string
  readonly style?: CSSProperties
}

export interface MXPlayerComponentHandle {
  readonly player: SdkPlayer | null
  readonly ui: PlayerUiController | null
}

export const MXPlayer = forwardRef<MXPlayerComponentHandle, MXPlayerReactProps>(function MXPlayerComponent(props, ref): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<SdkPlayer | null>(null)
  const uiRef = useRef<PlayerUiController | null>(null)
  const lastPlayerOptions = useRef(props.playerOptions)
  const lastUiOptions = useRef(props.uiOptions)

  useImperativeHandle(ref, (): MXPlayerComponentHandle => ({
    get player(): SdkPlayer | null { return playerRef.current },
    get ui(): PlayerUiController | null { return uiRef.current },
  }), [])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const player = new SdkPlayer({ ...props.playerOptions, target: host })
    const ui = attachPlayerUi(player, host, props.uiOptions)
    void player.ready.catch(() => undefined)
    playerRef.current = player
    uiRef.current = ui
    return (): void => {
      ui.destroy()
      player.destroy()
      uiRef.current = null
      playerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (lastPlayerOptions.current === props.playerOptions) return
    lastPlayerOptions.current = props.playerOptions
    const player = playerRef.current
    const host = hostRef.current
    if (player && host) void player.load({ ...props.playerOptions, target: host }).catch(() => undefined)
  }, [props.playerOptions])

  useEffect(() => {
    if (lastUiOptions.current === props.uiOptions) return
    lastUiOptions.current = props.uiOptions
    uiRef.current?.update(props.uiOptions ?? {})
  }, [props.uiOptions])

  return <div ref={hostRef} className={props.className} style={props.style} />
})
