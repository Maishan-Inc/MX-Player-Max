# Phase 9: Optional Player UI Design

## Status

Approved design. This document is the implementation boundary for Phase 9.

## Goal

Phase 9 delivers `@mx-player-max/ui`, an optional, reusable player interface
implemented with native DOM APIs and TypeScript. One controller provides the
same controls for an SDK-managed Native `<video>` surface and an SDK-managed
Custom `<canvas>` surface. The UI consumes public SDK state and commands only;
it never reaches into Core, renderer, audio, subtitle, decoder, or DOM surface
internals.

The package includes playback controls, timeline and hover preview, subtitle
track and style controls, presentation controls, settings/statistics/about
overlays, keyboard access, responsive CSS, and thin React and Vue adapters.
The demo becomes a real integration workbench for the official React adapter.

## Confirmed decisions

- The SDK exposes one immutable playback snapshot and a `playbackchange` event.
- Native playback has a built-in, isolated preview implementation. Custom
  playback accepts an optional public preview provider and otherwise degrades
  to time-only hover feedback.
- Theater mode is owned by a host adapter. It does not enter the media engine.
- The UI core is a native DOM controller. Phase 9 does not register a Web
  Component.
- React and Vue each expose one thin `MXPlayer` component and an imperative
  handle containing the SDK player and UI controller.
- UMD/IIFE distribution remains Phase 12. Phase 9 publishes ESM, declarations,
  and an independently exported `style.css`.

## Scope boundaries

Phase 9 does not include Phase 10 WASM codecs, PGS or VobSub, complete libass,
subtitle content editing, playlist or next-episode business logic, a Custom
built-in preview decoder, Document Picture-in-Picture, UMD/IIFE output, or
unrelated architecture refactoring.

The existing Phase 8 subtitle parsers, scheduler, overlay, track manager,
events, style API, and `SubtitleStyleStore` remain the only subtitle engine.
The UI neither parses subtitles nor reads or writes subtitle persistence.

## Existing gaps and document resolution

The Phase 8 SDK already exposes media state events, playback commands,
subtitle tracks and styles, safe renderer/audio statistics, Native fullscreen,
and Native Picture-in-Picture. It does not yet expose a complete attach-time
playback state, played/buffered ranges, observable volume or rate, presentation
state changes, source replacement on `MXPlayer`, Custom fullscreen, or a safe
preview API.

Two older architecture statements are superseded for Phase 9:

1. `docs/architecture/ui-package.md` suggests reading the internal frame queue
   or taking a direct `<video>` snapshot. The UI must instead call the public,
   bounded preview API defined here.
2. The same document lists a UI UMD bundle. The accepted distribution plan
   assigns UMD/IIFE work to Phase 12, so it is not a Phase 9 artifact.

## Dependency boundaries

```text
@mx-player-max/types
        ^
@mx-player-max/core
        ^
@mx-player-max/sdk <------- @mx-player-max/ui
        ^                         ^
        |                         |
        +---- react / vue --------+
                       ^
                       |
                     demo

@mx-player-max/types <------- @mx-player-max/ui
lucide core icon data <------- @mx-player-max/ui
```

`ui` depends only on the public `sdk` and `types` entry points plus named
Lucide icon data. It never imports internal files or depends directly on Core,
subtitles, renderers, audio, demux, decoders, React, Vue, or the demo. SDK and
all engine packages remain unaware of UI. React and Vue depend on SDK and UI;
the demo depends on the React adapter and UI stylesheet.

All public APIs have explicit return types. Production code uses no `any`, and
package-to-package imports use public exports only.

## Unified playback contract

### Snapshot types

`@mx-player-max/types` adds these UI-independent playback contracts:

```ts
export interface PlaybackTimeRange {
  readonly start: Micros
  readonly end: Micros
}

export type PresentationMode = 'inline' | 'fullscreen' | 'picture-in-picture'

export interface PlaybackControlCapabilities {
  readonly seek: boolean
  readonly volume: boolean
  readonly playbackRate: boolean
  readonly fullscreen: boolean
  readonly pictureInPicture: boolean
  readonly preview: boolean
}

export interface PlaybackErrorSummary {
  readonly code: string
  readonly recoverable: boolean
}

export interface PlaybackSnapshot {
  readonly sessionEpoch: number
  readonly state: PlaybackState
  readonly paused: boolean
  readonly currentTime: Micros | null
  readonly duration: Micros | null
  readonly played: readonly PlaybackTimeRange[]
  readonly buffered: readonly PlaybackTimeRange[]
  readonly bufferedAhead: Micros
  readonly volume: number
  readonly muted: boolean
  readonly playbackRate: number
  readonly seeking: boolean
  readonly buffering: boolean
  readonly presentationMode: PresentationMode
  readonly capabilities: PlaybackControlCapabilities
  readonly lastError: PlaybackErrorSummary | null
}

export type PlaybackChangeReason =
  | 'load'
  | 'state'
  | 'time'
  | 'buffer'
  | 'volume'
  | 'rate'
  | 'presentation'
  | 'capabilities'
  | 'error'
```

`EngineEventMap` gains:

```ts
playbackchange: {
  snapshot: PlaybackSnapshot
  reason: PlaybackChangeReason
}
```

Existing fine-grained events remain available for compatibility. The official
UI derives playback controls from `playback` and `playbackchange`, while Phase
8 subtitle controls continue to use subtitle getters and subtitle events.

### Snapshot semantics

- All times are non-negative safe integer microseconds. Unknown, negative,
  unsafe, or non-finite browser values become `null`, zero, or an empty range
  at the Core boundary.
- Ranges require `start < end`, are sorted, merge only overlapping or adjacent
  ranges, and never invent continuity across gaps. Each list is capped at 64
  entries; overflow drops the oldest ranges rather than joining gaps.
- Native ranges come from the media element's `played` and `buffered` values.
  Custom played ranges are accumulated from actual clock/presentation progress.
  Custom buffered ranges describe the currently playable forward horizon and
  are clamped to known duration.
- `paused` describes playback intent. Seeking preserves the pre-seek intent so
  the play icon does not flicker while a playing session seeks.
- `buffering` is an orthogonal transient flag. It does not add another value to
  `PlaybackState`. It is true only while playback intends to run but the active
  pipeline cannot currently advance. Pause, ready, seeking, ended, error, a
  resumed Native `playing`/`canplay`, or a resumed Custom output clock clears
  it deterministically.
- `presentationMode` and presentation capabilities are observed SDK state, not
  assumptions made after a button click.
- `lastError` omits causes, stacks, URLs, query parameters, subtitle text, and
  DOM exception messages. UI-facing text is mapped from stable codes.
- Every load attempt increments `sessionEpoch` before asynchronous work begins.
  Snapshot emissions, preview results, pipeline callbacks, and presentation
  callbacks commit only when their captured epoch is still current.

Core coalesces high-frequency time and buffer updates to at most one immutable
snapshot emission per animation frame while preserving the latest value. State,
error, presentation, and capability transitions emit immediately.

### SDK load lifecycle

`MediaEngine` exposes `playback` and the preview method described below.
`MXPlayer` proxies both and adds a public source replacement method:

```ts
class MXPlayer {
  get ready(): Promise<void>
  get playback(): PlaybackSnapshot
  load(options: MXPlayerOptions): Promise<void>
  requestPreview(request: MediaPreviewRequest): Promise<MediaPreviewImage | null>
}
```

The constructor starts the first `load()`. `ready` returns the current load
promise rather than the promise captured at construction. Calling `load()`
atomically supersedes the prior session through the engine epoch. `destroy()`
remains idempotent; later loads and commands fail with stable closed errors.

## Safe preview contract

`@mx-player-max/types` adds these contracts:

```ts
export interface MediaPreviewRequest {
  readonly time: Micros
  readonly width?: number
  readonly height?: number
  readonly signal?: AbortSignal
}

export interface MediaPreviewProviderRequest {
  readonly time: Micros
  readonly width: number
  readonly height: number
  readonly duration: Micros | null
  readonly sessionEpoch: number
  readonly signal: AbortSignal
}

export interface MediaPreviewProviderResult {
  readonly blob: Blob
  readonly time: Micros
  readonly width: number
  readonly height: number
}

export type MediaPreviewProvider = (
  request: MediaPreviewProviderRequest,
) => Promise<MediaPreviewProviderResult | null>

export interface MediaPreviewImage extends MediaPreviewProviderResult {
  readonly sessionEpoch: number
}

export interface MediaPreviewOptions {
  readonly provider?: MediaPreviewProvider
}
```

`MXPlayerOptions.preview?.provider` supplies the Custom provider. The provider
receives only bounded time/duration data and an abort signal, not a source
descriptor, complete `MediaDescriptor`, codec-private bytes, active `<video>`,
canvas, `VideoFrame`, private frame queue, pixel array, renderer, or GPU
resource. A closure may hold any host-owned source information it legitimately
needs.

The engine enforces these hard ceilings: one latest-wins request per session,
320x180 maximum dimensions, 57,600 maximum pixels, 512 KiB maximum encoded
image size, accepted PNG/JPEG/WebP blob types, and a 2,500 ms timeout. Callers
may request the UI default of 160x90; omitted width and height independently
default to 160 and 90. Invalid arguments return a stable input
error; cancellation, unsupported output, timeout, tainted canvas, provider
failure, or invalid provider output resolves to `null` and never moves the
player into `error`. The public `ErrorCodes` collection adds
`PREVIEW_INPUT_INVALID`; closed-engine calls continue to use `ENGINE_CLOSED`.

Native preview uses one off-DOM, muted preview media element and bounded canvas
owned by the current load. It reuses the session source but never seeks, pauses,
reads from, or draws the active playback element. Its listeners, object URL,
pending seek, canvas, and generated blobs are released on source replacement or
close. Remote CORS or canvas restrictions degrade to `null`.

Custom playback calls the configured provider. Without one, snapshot preview
capability is false. Phase 9 does not add a second Custom demux/decode pipeline.

## Presentation contract

Core observes `fullscreenchange`, `enterpictureinpicture`,
`leavepictureinpicture`, and relevant capability changes. Fullscreen operates
on the SDK target container for both Native and Custom paths; a direct surface
target remains valid for SDK-only use but cannot guarantee that external UI
travels into fullscreen. Official UI integrations therefore use one shared
container as both SDK target and UI host.

Custom container fullscreen is implemented in Phase 9. Custom Picture-in-
Picture remains unsupported until a safe public path exists, so its capability
is false and the UI disables the button. No browser-brand or renderer-kind
branch exists in UI.

Theater mode is deliberately outside the SDK:

```ts
export interface TheaterModeAdapter {
  getState(): boolean
  setState(active: boolean): void | Promise<void>
  subscribe(listener: (active: boolean) => void): () => void
}
```

The button renders only when an adapter is provided. The adapter remains the
source of truth and owns host-page layout. Async completion is checked against
the UI lifecycle epoch.

## UI public API

```ts
export interface PlayerUiController {
  readonly attached: boolean
  attach(container: HTMLElement): void
  update(options: PlayerUiOptions): void
  destroy(): void
}

export interface PlayerUiFeatureOptions {
  readonly nextEpisode?: boolean
  readonly volume?: boolean
  readonly subtitles?: boolean
  readonly pictureInPicture?: boolean
  readonly theater?: boolean
  readonly settings?: boolean
  readonly statistics?: boolean
  readonly about?: boolean
  readonly fullscreen?: boolean
  readonly preview?: boolean
}

export interface NextEpisodeControlOptions {
  readonly onRequest?: () => void | Promise<void>
  readonly unavailableBehavior?: 'disabled' | 'hidden'
}

export interface PlayerUiOptions {
  readonly theme?: 'dark' | 'light' | 'system'
  readonly features?: PlayerUiFeatureOptions
  readonly labels?: Readonly<Partial<PlayerUiLabels>>
  readonly autoHideDelayMs?: number
  readonly nextEpisode?: NextEpisodeControlOptions
  readonly theaterMode?: TheaterModeAdapter
  readonly onError?: (error: PlayerUiErrorSummary) => void
}

export function createPlayerUi(
  player: MXPlayer,
  options?: PlayerUiOptions,
): PlayerUiController

export function attachPlayerUi(
  player: MXPlayer,
  container: HTMLElement,
  options?: PlayerUiOptions,
): PlayerUiController
```

`attachPlayerUi` is a convenience around create plus attach. The controller
does not own the supplied player. `PlayerUiLabels` contains the finite set of
visible, tooltip, and ARIA strings published by the package; partial overrides
fall back to the built-in English labels. `PlayerUiErrorSummary` contains only
`code` and `recoverable`. The UI package publishes these stable codes:

```ts
export const UiErrorCodes = {
  UI_DESTROYED: 'UI_DESTROYED',
  UI_INVALID_CONTAINER: 'UI_INVALID_CONTAINER',
  UI_INVALID_OPTIONS: 'UI_INVALID_OPTIONS',
  UI_OPERATION_FAILED: 'UI_OPERATION_FAILED',
} as const

export type PlayerUiErrorCode =
  (typeof UiErrorCodes)[keyof typeof UiErrorCodes]

export interface PlayerUiErrorSummary {
  readonly code: PlayerUiErrorCode
  readonly recoverable: boolean
}

export class PlayerUiError extends Error {
  readonly code: PlayerUiErrorCode
  readonly recoverable: boolean
}
```

`PlayerUiOptions` controls:

- `theme`: `dark`, `light`, or `system`;
- feature visibility overrides;
- tooltip and ARIA label overrides;
- bounded auto-hide delay;
- optional next-episode callback and disabled-versus-hidden policy;
- optional `TheaterModeAdapter`.

Options are cloned and validated. `update()` has full replacement semantics:
an omitted value returns to its default, which prevents stale callbacks and
feature flags from surviving a host update.

Rejected next-episode or theater operations restore the button's enabled state
and report only `UI_OPERATION_FAILED` through the optional safe callback. The
UI never renders a raw host exception.

The controller registers no custom element and injects no stylesheet. It uses
light DOM so host container queries, fullscreen, and focus management remain
predictable.

## Package structure

```text
packages/ui/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    contracts.ts
    controller.ts
    lifecycle.ts
    controls/
    progress/
    preview/
    subtitles/
    overlays/
    accessibility/
    style.css
  tests/
    fakes/
    playwright/
    *.test.ts
```

Modules are kept focused: lifecycle owns subscriptions and epochs; a playback
store holds only the latest SDK snapshot; control modules render commands;
seek and preview coordinators own cancellation; subtitle modules translate UI
input into public subtitle calls; one overlay coordinator owns menu state;
accessibility owns shortcuts, focus, and announcements.

`package.json` exports `.` as tree-shakeable ESM/declarations and
`./style.css` as the copied standalone stylesheet. Only the CSS export is
listed in `sideEffects`. Named Lucide icon imports prevent shipping the full
icon catalog.

## Attach, update, and destroy

- First attach builds one owned `mxp-` root and synchronously reads playback,
  subtitle, and safe diagnostic getters before subscribing.
- Attaching again to the same container is a no-op apart from a synchronous
  state refresh. It never duplicates nodes or listeners.
- Attaching to a different container completely removes old host observers and
  document/window listeners before moving the same controller root. It does not
  move or inspect the SDK media surface. Host classes and attributes are
  removed only when this controller added them; pre-existing host state is
  restored.
- Session epoch changes close overlays, abort seek and preview work, clear
  session-only subtitle shortcut memory, revoke preview object URLs, reset
  transient interaction locks, and resynchronize from public getters.
- Every async handler captures both UI lifecycle epoch and SDK session epoch.
  A result that no longer matches either is discarded.
- `destroy()` is idempotent and cancels AbortControllers, pointer capture,
  timers, animation frames, ResizeObserver, owner-document and window listeners,
  SDK subscriptions, theater subscriptions, object URLs, and pending focus
  restoration. It removes only UI-owned DOM.
- `attach()` or `update()` after destroy throws stable `UI_DESTROYED`. A
  destroyed controller cannot be revived.

React and Vue adapters that own both objects destroy UI first and player
second.

## Playback controls and state mapping

The control bar has a full-width progress row above one command row:

```text
[played / buffered / progress rail]
[play] [next] [mute] [volume] [time]    [subtitles] [PiP] [theater] [settings] [fullscreen]
```

The left group contains play/pause, next episode, mute, volume slider, and time
readout. The right group contains subtitles, Picture-in-Picture, theater mode,
settings, and fullscreen. The next button delegates to its optional callback;
it owns no playlist state. It is disabled by default without a callback and may
be configured hidden. Theater is absent without its adapter. Fullscreen and PiP
disabled/pressed states come from the snapshot.

The play icon follows `snapshot.paused`. At EOS, play performs an epoch-checked
`seek(0)` followed by `play()`. Async controls suppress duplicate activation
while pending, but only subsequent SDK snapshots determine their final state.

Visible media status priority is:

```text
error > loading > seeking > buffering > ended > ready / playing / paused
```

This priority affects presentation only and never mutates playback state.
Public error text maps stable codes to bounded messages. Unknown codes display
a generic failure and never expose URL, query, source, subtitle content, DOM
exception, internal reason, or stack.

Loading shows a bounded progress indicator and status label, buffering shows a
compact non-modal indicator, ready and paused expose a center play command,
ended exposes replay, and error shows the safe mapped message. Animation is not
the only differentiator between any two states.

## Timeline and continuous seek

- The rail renders distinct played and buffered segments plus the current
  position. Gaps remain visible.
- Unknown duration displays `--:--`, retains valid current time, disables seek,
  and ignores non-finite input.
- Pointer capture supports click, drag, and continuous seek. Move submissions
  are coalesced to approximately 80 ms, with the final target always submitted
  on pointer release.
- Slider keyboard handling supports Left/Right, Home/End, and PageUp/PageDown.
  Global Left/Right shortcuts seek five seconds.
- A drag target is temporary interaction feedback, not player state. The UI
  uses snapshot seeking/time updates for committed feedback.
- Each seek result captures lifecycle and session epochs. Superseded resolve or
  reject paths do not touch DOM or announcements.

## Hover preview

Fine-pointer hover and pointer drag show the target timestamp immediately.
After roughly 100 ms at a stable target, the preview coordinator requests a
160x90 image. A new target aborts the old request. A controller holds at most 12
object URLs and revokes the oldest on overflow; detach, source replacement, and
destroy revoke all of them.

The preview box measures itself and clamps its position to the progress rail.
Touch-only hover does not request images. A null, aborted, unsupported, timed
out, or failed request hides the bitmap without hiding the target time and
without affecting seek.

## Subtitle UI

### Track page

The track page includes a close-subtitles command, every public track, current
selection, and safe state/source summaries. It distinguishes embedded, local
file, and remote URL tracks without showing a File object or URL. Loading and
error states are visible but contain no parser input or private diagnostic.

Selecting a track shows a pending affordance. The selected state changes only
after the Phase 8 getter/event confirms it. `selectSubtitleTrack(null)` is the
only close operation used for normal UI toggling; `closeSubtitles()` remains a
session teardown command and is not used as a toggle.

### Font and style page

Controls map directly to Phase 8 fields: validated font stack, font size,
alignment, x/y position, text color, outline color, outline width, bold,
italic, and underline. Font choices use menus, colors use swatches/native color
inputs, binary styles use toggles, and bounded numeric values use sliders or
steppers. The UI calls `setSubtitleStyle()` and waits for
`subtitlestylechange` before treating the value as committed.

The UI never imports `SubtitleStyleStore` or touches `localStorage`. The Phase
8 manager continues to scope and persist validated styles.

### Position editor

Subtitle edit mode draws a generic position guide owned by UI. It does not read
the subtitle overlay, cue DOM, subtitle text, active video, or active canvas.
Dragging the center changes x/y. Top and bottom handles adjust font size while
maintaining the anchor. Calls to `setSubtitleStyle()` are coalesced by animation
frame for the local guide and throttled to at most one SDK update per 80 ms,
with a final update on pointer release. This keeps live feedback responsive
without writing the Phase 8 style store on every pointer event.

The safe area is x 5-95% and y 8-92%, with the Phase 8 6-256 px font-size
limits. ResizeObserver, DPR, and fullscreen changes remeasure and re-clamp the
guide. Pointer capture and observers are released on close, detach, source
replacement, and destroy.

## Overlay state machine and focus

One state machine allows at most one primary overlay:

```ts
type MainOverlay =
  | 'none'
  | 'subtitles'
  | 'subtitle-editor'
  | 'settings'
  | 'stats'
  | 'about'
```

Opening a new overlay atomically closes the current one. Escape, an outside
pointerdown, or the active trigger closes it. Focus enters the first enabled
control, remains trapped in the open overlay, and returns to the still-connected
trigger on close. Pending focus restoration is epoch checked.

Opening subtitle menus or the editor pauses playback as accepted in ADR-0004.
A resume token records that UI initiated the pause. Closing resumes only if the
same session is current, playback was running before UI paused it, and no user
or external state transition invalidated the token.

Settings contains playback rate, subtitle entry, statistics, and about entry.
It does not add filters, codec selection, playlists, or Phase 10 controls.
Statistics use only public backend, media, renderer, native frame, and custom
audio/video fields. They update at a bounded low frequency and omit internal
reasons and private source data.

## Visibility and keyboard behavior

Controls auto-hide only while the snapshot is playing and no interaction lock
is active. The default delay is 2,500 ms. They stay visible for ready, paused,
seeking, buffering, ended, and error states, and during pointer activity,
keyboard activity, focus-within, an open overlay, seek drag, or subtitle drag.
Hidden controls cannot receive pointer events, and a focused control is never
hidden.

Shortcuts are scoped to the attached player container:

- Space toggles play/pause.
- Left/Right seek minus/plus five seconds.
- Up/Down change volume by ten percentage points.
- F toggles fullscreen.
- M toggles mute.
- C closes the current subtitle or restores the last still-available selected
  track for the current session.

Global shortcuts do not run when the event target is an input, textarea,
select, button, slider, contenteditable region, menu, or open overlay. Native
control behavior remains available in those elements.

## Visual and CSS contract

The visual direction is a neutral professional media tool, distinct from both
the current demo landing page and MX-Player-Pro. The default dark surface uses
near-black neutrals, warm white, cool gray, a cyan-green interaction accent,
amber warnings, and coral errors. It uses no decorative gradients, colored
orbs, oversized rounding, or copied animation choreography.

The control band is full width at the bottom. Primary overlays have at most a
6 px radius. Icon buttons have a stable 40x40 px box and 20 px Lucide icon.
Typography remains compact with zero letter spacing and does not scale with
viewport width.

All classes use `mxp-`. Published custom properties cover surface, panel,
text, muted text, accent, warning, danger, border, focus, control size, panel
width, safe area, and bounded dynamic progress/position values. Dark, light,
and system token mappings are included. Hosts may override tokens on the UI
container.

No runtime `<style>`, CSS-in-JS, generated stylesheet, or uncontrolled inline
CSS is allowed. Runtime geometry is communicated through validated `data-mxp-*`
attributes and bounded `--mxp-*` numeric custom properties only.

## Responsive behavior

Container queries are primary, with viewport media-query fallback:

- At 760 px or below, hide the volume slider and theater button.
- The progress row always owns a full row so command changes cannot resize it.
- At 420 px or below, command groups wrap into two stable rows instead of
  shrinking type or clipping buttons.
- Tooltips and the 160x90 preview clamp to container bounds.
- Panels have fixed responsive max width/height and bounded overflow.
- Long track names wrap to at most two lines and expose the full name in a
  tooltip. No visible control text may overflow or overlap.

Fixed grid tracks, icon dimensions, slider dimensions, and counters prevent
hover, labels, loading states, or dynamic values from shifting the layout.

## Accessibility

- Every icon button has a tooltip, `aria-label`, and explicit disabled and
  pressed state where relevant.
- Progress and volume are semantic sliders with bounded values and useful
  `aria-valuetext`.
- Tab order is progress, left controls, right controls, then the active overlay.
- `focus-visible` uses a 2 px high-contrast solid outline with 2 px offset.
- Disabled state uses more than opacity: attribute state, icon treatment,
  border treatment, and tooltip text remain explicit.
- Primary text/background combinations meet WCAG AA. State announcements use
  a bounded polite live region; unrecoverable errors use `role="alert"`.
- Motion is limited to short opacity/transform CSS transitions. Under
  `prefers-reduced-motion: reduce`, transitions and rotation stop while text,
  icon, and ARIA state remain complete.

## React and Vue adapters

Each adapter exposes one thin `MXPlayer` component. Props contain
`playerOptions` without `target`, `uiOptions`, and host class/style hooks.
React uses a forwarded ref and Vue uses `expose` to provide:

```ts
interface MXPlayerComponentHandle {
  readonly player: MXPlayer | null
  readonly ui: PlayerUiController | null
}
```

Components access DOM only after mount, create SDK then UI, attach both to the
same container, call `player.load()` when the `playerOptions` reference changes,
and call `ui.update()` when `uiOptions` changes. Unmount destroys UI before SDK.
The initial mounted options are consumed by the constructor and do not trigger
a duplicate load; only subsequent identity changes reload. SSR produces only
the host element and never accesses window or document.

Adapters do not copy playback state, shortcuts, overlay logic, subtitle logic,
or CSS. Consumers import `@mx-player-max/ui/style.css` explicitly; adapters do
not inject it.

## Demo integration

The demo changes from an architecture landing page into the usable player
workbench as its first screen. It provides local File and validated URL source
selection and mounts the official React component. A repository-owned,
licensed static poster keeps the initial media stage visibly nonblank. The
poster is a demo asset, not a UI package dependency.

GSAP remains confined to restrained demo-shell entrance and view-transition
animation. It never enters `packages/ui`, drives player state, or changes the
official UI interaction model. The demo remains Docker deployable and is not a
runtime dependency of any package.

## Testing strategy

### Types and Core

Tests cover snapshot normalization, range validation/merge/caps, non-finite
duration, played and buffered reporting, volume/mute/rate, Native and Custom
parity, presentation capabilities and changes, Custom fullscreen, buffering,
continuous seek, session epochs, late pipeline events, and preview validation,
budget, timeout, cancellation, cleanup, Native isolation, and Custom provider
fallback.

### SDK

Tests cover the current `ready` getter, repeated `load()`, snapshot proxy and
event forwarding, preview provider/result handling, source replacement, close,
and late results after destroy.

### UI DOM tests

Vitest with `happy-dom` and a typed fake public SDK covers:

- playback sync, all player states, played/buffered segments, volume, mute,
  unknown duration, EOS, seek, continuous seek, and late seek completion;
- overlay mutual exclusion, Escape, outside close, focus entry/trap/restore,
  and auto-hide interaction locks;
- subtitle off, track selection/status, style updates, drag and handle changes,
  safe-area clamping, resize/DPR/fullscreen, and Phase 8 persistence integration;
- repeat attach, remount, option replacement, source epoch, idempotent destroy,
  late events, object URL revocation, and listener/observer/timer cleanup;
- equivalent behavior for Native and Custom snapshots, and degradation without
  PiP, fullscreen, theater, or preview;
- keyboard exclusions, ARIA state, focus-visible, and reduced-motion classes.

Mocks and fake DOM results remain explicitly labeled simulation.

### Playwright

Playwright mounts a deterministic public-SDK harness with the production UI
CSS. Chromium captures committed desktop 1440x900 and mobile 390x844 snapshots.
Firefox and Playwright WebKit run interaction and layout checks. Tests verify:

- no visible control bounding boxes overlap incoherently;
- visible text does not exceed its intended container;
- tooltips, panels, and preview stay within the player;
- the 760 px visibility rules and 420 px wrapping rules apply;
- keyboard focus, outside click, pointer capture, and reduced motion work;
- the media/poster stage is visibly nonblank.

Playwright WebKit is browser automation, not evidence of real macOS Safari.
Fake Native/Custom harnesses are not evidence of actual decoder or renderer
behavior.

### Real-browser matrix

`docs/development/phase-9-acceptance.md` separately records Chrome/Chromium,
Firefox, and macOS Safari latest-two-stable manual status. Unless those exact
physical/browser environments are run during Phase 9, their status remains
pending. Phase 8's real-browser subtitle items also remain pending and cannot
be replaced by Phase 9 simulated or Playwright results.

## Distribution and size verification

Phase 9 builds:

```text
packages/ui/dist/
  index.js
  index.d.ts
  index.js.map
  index.d.ts.map
  *.js / *.d.ts / maps for focused internal modules
  controls/*
  progress/*
  preview/*
  subtitles/*
  overlays/*
  accessibility/*
  style.css
```

The stylesheet is copied as a build artifact and exported as
`@mx-player-max/ui/style.css`. Packaging tests inspect the tarball export map
and confirm no runtime style injector, framework runtime, demo asset, test, or
internal package import is included.

The Phase 8 SDK artifact and Phase 9 SDK artifact will differ because Phase 9
adds required public playback and preview contracts. A clean Phase 8 build is
recorded before implementation and the contract-only delta is measured and
attributed. After the Phase 9 SDK contract is complete, the zero-UI-cost gate
hashes a filtered SDK build, runs the full monorepo build including UI/adapters,
then hashes the SDK output again; those two Phase 9 hashes and byte counts must
match. Package manifests and import scans must also show no SDK-to-UI edge.
Demo and adapter bundles are measured separately.

## Documentation and acceptance

Implementation updates the root README, UI/SDK/React/Vue/Demo READMEs, public
API documentation, CHANGELOG, UI architecture, distribution/embedding,
integration/testing guidance, and browser compatibility notes. It adds
`docs/development/phase-9-acceptance.md` with acceptance items, exact command
results, test counts, screenshot results, artifact checks, size measurements,
worktree status, and honest real-browser pending items.

Final verification includes:

```text
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
git diff --check
```

It also checks package dependency direction, public entry-point imports, CSS
export and packed contents, SDK artifact attribution and isolation, committed
desktop/mobile screenshots, and final worktree state. Phase 9 implementation is
complete only after documentation and acceptance evidence are included in the
final `feat(ui): implement phase 9 player interface` commit.
