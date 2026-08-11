import { create, type BrowserPlayerHandle } from '@mx-player-max/browser'
import { MXPlayer as ReactPlayer, type MXPlayerReactProps } from '@mx-player-max/react'
import { MXPlayer as SdkPlayer, type PlaybackDecisionTrace } from '@mx-player-max/sdk'
import { MXPlayer as VuePlayer, type MXPlayerVueProps } from '@mx-player-max/vue'

const source = { kind: 'url', url: 'https://example.test/media.mp4' } as const
const reactProps: MXPlayerReactProps = { playerOptions: { source } }
const vueProps: MXPlayerVueProps = { playerOptions: { source } }
const trace: PlaybackDecisionTrace | null = null
const handle: BrowserPlayerHandle | null = null

void [create, ReactPlayer, SdkPlayer, VuePlayer, reactProps, vueProps, trace, handle]
