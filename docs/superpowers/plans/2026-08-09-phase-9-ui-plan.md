# Phase 9 Optional Player UI Implementation Plan

This plan implements the approved design in
`docs/superpowers/specs/2026-08-09-phase-9-ui-design.md`.

The implementation order follows `AGENTS.md`: public contracts and fixtures
first, service-independent logic second, browser adapters third, UI and
framework/demo integration last. Tests are added with each behavior rather than
deferred to the end. The approved design commit is `c2f8dc4`.

## Step 1: Capture the Phase 8 baseline and protect scope

Files:

- no source changes
- results will later be recorded in
  `docs/development/phase-9-acceptance.md`

Work:

- Confirm the worktree contains only this uncommitted plan after the approved
  design commit.
- Build the current Phase 8 `types`, `core`, and `sdk` dependency slice before
  changing public contracts.
- Record SHA-256 and byte counts for every `packages/sdk/dist` artifact and the
  aggregate packed SDK size.
- Record the current package dependency graph and verify SDK has no UI edge.
- Record the current automated test count as the Phase 8 comparison baseline.

Verification:

```text
pnpm --filter @mx-player-max/sdk... build
pnpm test
git status --short
```

Checkpoint: baseline evidence exists before any Phase 9 implementation file is
changed.

## Step 2: Add playback and preview public contracts first

Files:

- `packages/types/src/index.ts`
- `packages/types/tests/playback-ui-public-api.test.ts` (new)
- `packages/types/tests/native-public-api.test.ts`
- `packages/types/tests/custom-video-public-api.test.ts`
- `packages/types/README.md`

Tests first:

- Compile exact `PlaybackTimeRange`, `PlaybackControlCapabilities`,
  `PlaybackErrorSummary`, `PlaybackSnapshot`, `PlaybackChangeReason`, preview
  request/provider/result/options, and presentation types.
- Assert all time values use `Micros`, range arrays are readonly, preview does
  not expose `SourceDescriptor`, `MediaDescriptor`, `VideoFrame`, canvas,
  renderer, or GPU types, and all callbacks have explicit return types.
- Assert `EngineEventMap.playbackchange`, `MediaEngine.playback`,
  `MediaEngine.requestPreview()`, `MXPlayerOptions.preview`, and
  `PREVIEW_INPUT_INVALID` are public.

Implementation:

- Add the approved exact contracts and stable error code.
- Extend `MediaEngine` without weakening existing subtitle, frame ownership,
  audio, renderer, or AI contracts.
- Document microsecond, epoch, null, provider, and error semantics.

Verification:

```text
pnpm --filter @mx-player-max/types test
pnpm --filter @mx-player-max/types typecheck
```

## Step 3: Implement pure range and snapshot normalization

Files:

- `packages/core/src/playback/ranges.ts` (new)
- `packages/core/src/playback/snapshot.ts` (new)
- `packages/core/tests/playback-ranges.test.ts` (new)
- `packages/core/tests/playback-snapshot.test.ts` (new)

Tests first:

- Cover empty, malformed, negative, non-finite, unsafe, overlapping, adjacent,
  out-of-order, duplicate, and more-than-64 ranges.
- Verify range normalization never bridges a real gap and drops old overflow
  ranges deterministically.
- Cover initial/loading/ready/playing/paused/seeking/buffering/ended/error/closed
  snapshots, paused intent through seek, nullable time/duration, and safe error
  summaries.
- Cover Native range snapshots and Custom played accumulation/forward-buffer
  projection with known and unknown duration.

Implementation:

- Build browser-independent range normalization and a mutable internal tracker
  that publishes cloned readonly snapshots.
- Keep `buffering` orthogonal to `PlaybackState` and implement the approved
  deterministic clearing rules.
- Coalesce high-frequency time/buffer publication through an injectable frame
  scheduler so Node tests remain deterministic; state and error transitions
  publish immediately.

Verification:

```text
pnpm --filter @mx-player-max/core test -- playback-ranges playback-snapshot
pnpm --filter @mx-player-max/core typecheck
```

## Step 4: Complete Native observable state

Files:

- `packages/core/src/native/media-events.ts`
- `packages/core/src/native/video-element-adapter.ts`
- `packages/core/src/native/pipeline.ts`
- `packages/core/tests/fake-video.ts`
- `packages/core/tests/native-events.test.ts`
- `packages/core/tests/native-pipeline.test.ts`
- `packages/core/tests/native-playback-snapshot.test.ts` (new)

Tests first:

- Add fake `played`, `buffered`, volume, muted, playback-rate, seeking, waiting,
  canplay/playing, fullscreen, and Picture-in-Picture state transitions.
- Verify `volumechange`, `ratechange`, progress, playing/canplay, waiting/stalled,
  seek, EOS, and errors publish complete source data for the snapshot tracker.
- Verify no Native event after close reaches Core and listener counts return to
  zero.

Implementation:

- Extend the public-independent video adapter with safe state readers and event
  plumbing; do not expose the element outside the Native boundary.
- Normalize actual `played`/`buffered` `TimeRanges` and volume/rate changes.
- Preserve all existing Native error mapping and autoplay behavior.

Verification:

```text
pnpm --filter @mx-player-max/core test -- native
pnpm --filter @mx-player-max/core typecheck
```

## Step 5: Add isolated Native preview

Files:

- `packages/core/src/native/preview.ts` (new)
- `packages/core/tests/native-preview.test.ts` (new)
- `packages/core/tests/fake-video.ts`

Tests first:

- Cover default 160x90 output, bounded custom dimensions, invalid time and
  dimensions, MIME allowlist, 512 KiB blob budget, 2,500 ms timeout, one
  latest-wins request, caller abort, source replacement, and close.
- Verify the preview service never seeks, pauses, draws, or reads the active
  playback element.
- Cover URL and File source ownership, object URL revocation, tainted-canvas or
  CORS failure, decode failure, and quiet `null` degradation.
- Assert stale preview completion cannot publish a previous session epoch.

Implementation:

- Create one off-DOM muted preview media element and one bounded canvas per
  Native load.
- Reuse only the public load source/options necessary for the isolated element;
  never expose a source or DOM node in public preview results.
- Validate encoded blob metadata before returning `MediaPreviewImage` and
  release all listeners, timers, object URLs, canvas references, and pending
  work on replacement/close.

Verification:

```text
pnpm --filter @mx-player-max/core test -- native-preview
pnpm --filter @mx-player-max/core typecheck
```

## Step 6: Complete Custom observable state and provider preview

Files:

- `packages/core/src/custom/events.ts`
- `packages/core/src/custom/pipeline.ts`
- `packages/core/src/custom/audio-controller.ts`
- `packages/core/src/playback/preview-manager.ts` (new)
- `packages/core/tests/custom-playback-snapshot.test.ts` (new)
- `packages/core/tests/custom-preview.test.ts` (new)
- existing Custom fake/test helpers under `packages/core/tests/`

Tests first:

- Cover Custom current time from AudioContext or media wall clock, paused
  intent, rate, volume, mute, seek, buffered horizon, underrun/buffering,
  resumption, EOS, and no-audio capability.
- Verify Native and Custom inputs produce the same public snapshot semantics.
- Cover a valid provider, no provider, invalid blob/type/dimensions/time,
  rejection, timeout, abort, latest-wins behavior, load epoch, and close.
- Assert the provider receives only time, duration, dimensions, epoch, and
  AbortSignal; it receives no source, media codec-private data, frame, PCM, or
  renderer resource.

Implementation:

- Add bounded public-state getters/events to the Custom pipeline without
  changing decoded frame ownership or audio clock authority.
- Compute played and buffered ranges from actual presentation/clock progress.
- Implement a shared provider manager that validates and epochs all results;
  Custom without a provider reports preview capability false.

Verification:

```text
pnpm --filter @mx-player-max/core test -- custom-playback custom-preview
pnpm --filter @mx-player-max/core typecheck
```

## Step 7: Integrate snapshot, presentation, and preview in Core

Files:

- `packages/core/src/index.ts`
- `packages/core/src/native/target.ts`
- `packages/core/src/presentation.ts` (new)
- `packages/core/tests/playback-contract.test.ts` (new)
- `packages/core/tests/presentation.test.ts` (new)
- `packages/core/tests/native-engine.test.ts`
- `packages/core/tests/custom-engine.test.ts`
- `packages/core/README.md`

Tests first:

- Cover initial snapshot, load epoch increment before async work, atomic source
  replacement, attach-time state, all change reasons, and late Native/Custom
  events after replacement or close.
- Cover volume/mute/rate commands, seeking intent, buffering clear rules, error
  redaction, and existing fine-grained event compatibility.
- Cover container fullscreen for Native and Custom, direct-surface limitations,
  capability changes, active fullscreen/PiP state, unsupported Custom PiP, and
  document-listener cleanup.
- Cover Native preview selection versus Custom provider/null selection through
  the `MediaEngine` public method.

Implementation:

- Own one playback tracker per engine session and expose `playback`.
- Feed it from both pipelines and presentation observers without browser-brand
  or renderer-name branches in the UI contract.
- Generalize fullscreen to the resolved target container for both paths while
  retaining Native PiP.
- Abort and close preview/presentation resources inside existing pipeline
  disposal and engine close paths.

Verification:

```text
pnpm --filter @mx-player-max/core test
pnpm --filter @mx-player-max/core typecheck
```

Checkpoint: types/Core provide one tested, path-independent public state before
any UI package code is added.

## Step 8: Expose the complete SDK facade

Files:

- `packages/sdk/src/index.ts`
- `packages/sdk/tests/playback-sdk.test.ts` (new)
- `packages/sdk/tests/native-sdk.test.ts`
- `packages/sdk/tests/custom-video-sdk.test.ts`
- `packages/sdk/tests/subtitle-sdk.test.ts`
- `packages/sdk/README.md`

Tests first:

- Cover `playback`, `playbackchange`, current `ready`, repeated `load()`, and
  `requestPreview()` proxies.
- Verify an older ready/preview/seek completion cannot replace current state.
- Verify `destroy()` remains idempotent and later operations return closed
  errors.
- Re-run subtitle facade tests to prove the new state surface did not bypass or
  duplicate Phase 8 behavior.

Implementation:

- Replace the construction-only `ready` field with a current-promise getter.
- Add public `load()`, playback getter/event forwarding, and preview proxy.
- Continue to re-export types from the public package entry only.

Verification:

```text
pnpm --filter @mx-player-max/sdk test
pnpm --filter @mx-player-max/sdk typecheck
```

## Step 9: Scaffold the optional UI package and lifecycle

Files:

- `packages/ui/package.json` (new)
- `packages/ui/tsconfig.json` (new)
- `packages/ui/README.md` (new)
- `packages/ui/scripts/copy-style.mjs` (new)
- `packages/ui/src/index.ts` (new)
- `packages/ui/src/contracts.ts` (new)
- `packages/ui/src/errors.ts` (new)
- `packages/ui/src/lifecycle.ts` (new)
- `packages/ui/src/controller.ts` (new)
- `packages/ui/src/style.css` (new, minimal shell initially)
- `packages/ui/tests/fakes/player.ts` (new)
- `packages/ui/tests/lifecycle.test.ts` (new)
- `pnpm-lock.yaml`

Tests first:

- Cover create without attach, initial attach synchronization, same-host repeat
  attach, remount, full option replacement, invalid container/options,
  `UI_DESTROYED`, idempotent destroy, and attach/update after destroy.
- Count SDK, owner-document, window, timer, animation-frame, observer, pointer,
  theater, and object-URL resources before/after remount and destroy.
- Dispatch late events and promise completions after source epoch/destroy and
  assert no DOM mutation.

Implementation:

- Add ESM/declaration/style exports, `@mx-player-max/sdk` and
  `@mx-player-max/types` public dependencies, named-import Lucide dependency,
  and `happy-dom` test dependency.
- Implement stable UI errors, validated cloned options, one owned light-DOM
  root, lifecycle/session epochs, and a cleanup registry.
- Ensure the UI package never owns or destroys the supplied player and never
  inspects or moves video/canvas children.
- Copy CSS to `dist/style.css` through a cross-platform Node build script; do
  not inject styles at runtime.

Verification:

```text
pnpm --filter @mx-player-max/ui test -- lifecycle
pnpm --filter @mx-player-max/ui typecheck
pnpm --filter @mx-player-max/ui build
```

## Step 10: Build the state-driven control shell

Files:

- `packages/ui/src/dom.ts` (new)
- `packages/ui/src/icons.ts` (new)
- `packages/ui/src/controls/icon-button.ts` (new)
- `packages/ui/src/controls/control-bar.ts` (new)
- `packages/ui/src/controls/status-layer.ts` (new)
- `packages/ui/src/controls/time.ts` (new)
- `packages/ui/tests/playback-controls.test.ts` (new)
- `packages/ui/tests/status-layer.test.ts` (new)
- `packages/ui/tests/aria.test.ts` (new)

Tests first:

- Cover all playback states and status priority, play/pause, ended replay,
  next callback disabled/hidden/pending/rejection, mute, volume, rate, PiP,
  theater, fullscreen, and unsupported capability states.
- Assert controls never optimistically change committed media state; only a new
  SDK snapshot changes pressed/selected values.
- Assert tooltip IDs, aria-label/pressed/disabled/live/alert state, DOM order,
  stable button dimensions/classes, and safe unknown-error mapping.

Implementation:

- Render the two-row control shell and status layer using native DOM only.
- Import exact Lucide icons rather than a catalog and provide reusable tooltip
  and ARIA binding.
- Implement epoch-checked async commands and safe `UI_OPERATION_FAILED`
  reporting without exposing host exceptions.

Verification:

```text
pnpm --filter @mx-player-max/ui test -- playback-controls status-layer aria
pnpm --filter @mx-player-max/ui typecheck
```

## Step 11: Implement timeline, continuous seek, and hover preview

Files:

- `packages/ui/src/progress/timeline.ts` (new)
- `packages/ui/src/progress/seek-coordinator.ts` (new)
- `packages/ui/src/preview/coordinator.ts` (new)
- `packages/ui/src/preview/view.ts` (new)
- `packages/ui/tests/timeline.test.ts` (new)
- `packages/ui/tests/seek.test.ts` (new)
- `packages/ui/tests/preview.test.ts` (new)

Tests first:

- Cover current/duration formatting, unknown duration, EOS, multi-range played
  and buffered rendering, clamping, and non-finite input.
- Cover pointer click, pointer capture drag, 80 ms continuous seek coalescing,
  release flush, Home/End/arrow/Page keys, repeated seek, stale completion, and
  cleanup during drag.
- Cover fine-pointer 100 ms preview delay, 160x90 request, abort on movement,
  epoch validation, null fallback, 12-object-URL eviction/revocation, touch-only
  time feedback, and container-edge clamping.

Implementation:

- Keep drag position as temporary interaction feedback and committed values
  snapshot-driven.
- Use bounded numeric `--mxp-*` variables for range/preview geometry.
- Quietly hide preview images on unsupported/failure while retaining timestamp
  and seek behavior.

Verification:

```text
pnpm --filter @mx-player-max/ui test -- timeline seek preview
pnpm --filter @mx-player-max/ui typecheck
```

## Step 12: Implement overlays, focus, shortcuts, and auto-hide

Files:

- `packages/ui/src/overlays/state-machine.ts` (new)
- `packages/ui/src/overlays/panel.ts` (new)
- `packages/ui/src/overlays/settings.ts` (new)
- `packages/ui/src/overlays/statistics.ts` (new)
- `packages/ui/src/overlays/about.ts` (new)
- `packages/ui/src/accessibility/focus.ts` (new)
- `packages/ui/src/accessibility/shortcuts.ts` (new)
- `packages/ui/src/accessibility/visibility.ts` (new)
- `packages/ui/tests/overlays.test.ts` (new)
- `packages/ui/tests/focus.test.ts` (new)
- `packages/ui/tests/shortcuts.test.ts` (new)
- `packages/ui/tests/auto-hide.test.ts` (new)

Tests first:

- Cover single-overlay mutual exclusion, settings-to-stats/about transitions,
  Escape, outside pointerdown, focus entry/trap/restore, disconnected triggers,
  and epoch-checked pending focus.
- Cover Space/arrows/F/M/C and suppression for input, textarea, select, button,
  slider, contenteditable, menu, and overlay targets.
- Cover auto-hide only during playing and every pointer/keyboard/focus/menu/drag
  interaction lock, timer reset, source change, remount, and destroy.
- Verify statistics use only public safe fields and update at bounded frequency.

Implementation:

- Use one `MainOverlay` state machine and attach owner-document listeners only
  while needed.
- Implement focus containment/restoration, scoped shortcuts, and centralized
  visibility locks.
- Keep settings limited to playback rate, subtitles, statistics, and about.

Verification:

```text
pnpm --filter @mx-player-max/ui test -- overlays focus shortcuts auto-hide
pnpm --filter @mx-player-max/ui typecheck
```

## Step 13: Implement subtitle tracks, styles, and safe-area editor

Files:

- `packages/ui/src/subtitles/tracks.ts` (new)
- `packages/ui/src/subtitles/styles.ts` (new)
- `packages/ui/src/subtitles/editor.ts` (new)
- `packages/ui/tests/subtitle-tracks.test.ts` (new)
- `packages/ui/tests/subtitle-styles.test.ts` (new)
- `packages/ui/tests/subtitle-editor.test.ts` (new)
- `packages/sdk/tests/subtitle-sdk.test.ts`
- `packages/subtitles/tests/style-overlay.test.ts`

Tests first:

- Cover subtitle off, embedded/file/url safe summaries, loading/error status,
  selection pending/confirmation/failure, C shortcut restore, and session reset.
- Cover every approved Phase 8 style field, validation rollback, event-confirmed
  control state, reset, and existing origin/local-file store integration.
- Cover center drag, upper/lower handles, 80 ms SDK style throttling plus final
  flush, x 5-95%, y 8-92%, 6-256 px, resize, DPR, fullscreen, pointer capture,
  source change, close, and destroy.
- Assert no UI import/read of subtitle internals, cue DOM/text, localStorage,
  video, canvas, `VideoFrame`, or renderer resource.

Implementation:

- Render track and font/style pages from Phase 8 getters/events only.
- Use SDK style commands and let Phase 8 validation/store remain authoritative.
- Render a generic UI-owned editor guide and coalesce local geometry separately
  from bounded SDK style writes.
- Implement the approved pause/resume token for subtitle menu/editor sessions.

Verification:

```text
pnpm --filter @mx-player-max/ui test -- subtitle
pnpm --filter @mx-player-max/sdk test -- subtitle
pnpm --filter @mx-player-max/subtitles test -- style-overlay
```

## Step 14: Finish CSS, themes, responsive layout, and package output

Files:

- `packages/ui/src/style.css`
- `packages/ui/package.json`
- `packages/ui/scripts/copy-style.mjs`
- `packages/ui/tests/style-contract.test.ts` (new)
- `packages/ui/README.md`

Tests first:

- Scan all emitted UI classes for the `mxp-` prefix and all public visual
  tokens for the `--mxp-` prefix.
- Assert no runtime style element creation, CSS-in-JS, unbounded inline style,
  decorative gradient/orb rules, negative letter spacing, or framework import.
- Assert dark/light/system tokens, AA target colors, 40x40 controls, 20 px
  icons, 6 px maximum panel radius, focus-visible, reduced motion, 760 px hide,
  and 420 px wrapping rules exist.
- Resolve package exports and verify `dist/style.css` is present after build.

Implementation:

- Complete the approved neutral palette, stable geometry, control/status layers,
  overlay panels, sliders, swatches, tooltips, subtitle guide, container queries,
  viewport fallback, focus styles, and reduced-motion overrides.
- Use data attributes and bounded CSS variables for runtime geometry only.
- Keep CSS independently importable and replaceable.

Verification:

```text
pnpm --filter @mx-player-max/ui test
pnpm --filter @mx-player-max/ui typecheck
pnpm --filter @mx-player-max/ui build
```

Checkpoint: the framework-free package is complete and tested before adapters
or demo integration.

## Step 15: Implement thin React and Vue components

Files:

- `packages/react/package.json`
- `packages/react/src/index.ts`
- `packages/react/src/component.tsx` (new)
- `packages/react/tests/adapter.test.tsx` (new)
- `packages/react/README.md`
- `packages/vue/package.json`
- `packages/vue/src/index.ts`
- `packages/vue/src/component.ts` (new)
- `packages/vue/tests/adapter.test.ts` (new)
- `packages/vue/README.md`
- `pnpm-lock.yaml`

Tests first:

- Cover mount order, shared SDK/UI container, no duplicate initial load,
  subsequent `playerOptions` identity reload, `uiOptions` update, imperative
  ref/expose, source replacement, UI-first unmount cleanup, repeat unmount, and
  no SSR DOM access.
- Assert adapters contain no control state machine, shortcuts, subtitle logic,
  generated CSS, or UI markup beyond the host container.

Implementation:

- Add UI as a public package dependency while retaining React/Vue as peers.
- Export one `MXPlayer` component and typed handle from each adapter.
- Keep stylesheet import explicit in consumer docs.

Verification:

```text
pnpm --filter @mx-player-max/react test
pnpm --filter @mx-player-max/vue test
pnpm --filter @mx-player-max/react typecheck
pnpm --filter @mx-player-max/vue typecheck
```

## Step 16: Replace the Demo landing page with the player workbench

Files:

- `apps/demo/package.json`
- `apps/demo/src/App.tsx`
- `apps/demo/src/main.tsx`
- `apps/demo/src/styles.css`
- `apps/demo/public/mx-player-poster.png` (new generated bitmap)
- `apps/demo/README.md`
- optional asset provenance file under `apps/demo/public/`
- `pnpm-lock.yaml`

Work:

- Use the applicable image-generation skill to create a repository-owned,
  inspectable media poster and record its generation/provenance. Do not use an
  SVG illustration or a remote stock placeholder.
- Use the applicable GSAP React/core/performance guidance for restrained demo
  shell entrance and view transitions only; respect reduced motion.
- Make the first screen the actual player workbench with URL and local File
  source selection, the official React component, theater host adapter, and a
  nonblank poster stage.
- Import `@mx-player-max/ui/style.css` explicitly and remove duplicated player
  controls from the demo.
- Keep Demo layout distinct from MX-Player-Pro and from the old marketing hero;
  do not add nested cards, decorative gradients/orbs, or overlapping controls.

Verification:

```text
pnpm --filter @mx-player-max/demo typecheck
pnpm --filter @mx-player-max/demo build
```

## Step 17: Add Playwright interaction and screenshot verification

Files:

- `playwright.config.ts` (new)
- root `package.json`
- `packages/ui/tests/playwright/fixture/index.html` (new)
- `packages/ui/tests/playwright/fixture/main.ts` (new)
- `packages/ui/tests/playwright/ui.spec.ts` (new)
- committed Chromium desktop/mobile snapshots generated by Playwright
- `packages/ui/package.json`
- `pnpm-lock.yaml`

Tests first and implementation together:

- Add a private Vite fixture that uses the production UI source/CSS and a typed
  deterministic public-SDK fake. It is excluded from package exports and the
  published tarball.
- Configure Chromium desktop 1440x900, Chromium mobile 390x844, Firefox, and
  Playwright WebKit projects.
- Capture desktop/mobile control, subtitles, settings/statistics, error, and
  responsive states with stable seeded data.
- Assert visible control bounding boxes do not overlap, intended text does not
  overflow, media/poster pixels are nonblank, preview and tooltips stay inside,
  760/420 rules apply, keyboard focus works, and reduced motion removes
  transitions.
- Run Firefox/WebKit behavioral layout checks without labeling them real
  Firefox latest-stable or macOS Safari verification.

Verification:

```text
pnpm test:browser
```

Use `view_image` to inspect every committed desktop/mobile baseline before
accepting it. Fix layout defects in source; do not update snapshots to hide a
regression.

## Step 18: Update architecture, API, integration, and acceptance docs

Files:

- `README.md`
- `CHANGELOG.md`
- `packages/ui/README.md`
- `packages/sdk/README.md`
- `packages/react/README.md`
- `packages/vue/README.md`
- `apps/demo/README.md`
- `docs/architecture/ui-package.md`
- `docs/architecture/distribution-and-embedding.md`
- `docs/development/integration.md`
- `docs/development/testing.md`
- `docs/development/phase-9-acceptance.md` (new)
- any public API/browser compatibility index that references Phase 9

Work:

- Document lifecycle, snapshot, preview, options, CSS/theme, framework adapter,
  and raw DOM integration examples using public entries only.
- Correct the outdated direct-frame/direct-video preview and Phase 9 UMD text.
- Document the shared-container requirement for UI fullscreen and quiet Custom
  PiP/preview degradation.
- Record exact unit, typecheck, build, browser automation, screenshot, package,
  dependency, size, and worktree results.
- Keep fake DOM, deterministic player, Playwright Chromium/Firefox/WebKit, real
  Chrome/Firefox, and real macOS Safari evidence in separate tables.
- Leave real latest-two-stable browser rows pending unless those exact physical
  environments were actually run.
- State every Phase 9 exclusion from the approved design, including Phase 10.

Verification:

```text
rg -n "frame queue|<video> snapshot|UMD|real browser|pending|Phase 10" docs packages apps README.md CHANGELOG.md
git diff --check
```

## Step 19: Run the full release gate and audit package boundaries

Run:

```text
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
git diff --check
```

Additional checks:

- Build the Phase 9 SDK alone, record SHA-256/bytes, run the full monorepo build,
  and confirm the SDK artifact hash/bytes remain identical.
- Compare the recorded Phase 8 and Phase 9 SDK sizes and attribute only the
  approved public contract delta.
- Pack UI into a validated temporary directory and inspect exports/files for
  ESM, declarations, `style.css`, and absence of tests/demo/framework runtime.
- Scan manifests and imports to prove SDK/Core/decoder/demux/renderer/audio/
  subtitles do not depend on UI and UI has no internal cross-package imports.
- Scan production TypeScript for `any`, unsafe assertions used to cross package
  boundaries, raw URL/subtitle/DOM error display, direct video/canvas/frame/GPU
  access in UI, runtime style injection, and unbounded preview caches.
- Inspect all Playwright screenshots and confirm no overlap, overflow, cropped
  controls, or blank media area.
- Start the Demo dev server on 4173 or the next free port, verify the URL loads,
  and leave it running for user evaluation.
- Confirm the worktree contains only intended Phase 9 changes.

If a required command fails, diagnose and fix the cause before delivery. Do not
mark a simulated browser run as real-browser completion.

## Step 20: Final scope audit and commit

Review the final diff against the approved design and explicitly reject:

- Phase 10 WASM Codec work;
- PGS/VobSub or complete libass;
- subtitle content editing;
- playlist ownership;
- Custom built-in preview decode;
- Document Picture-in-Picture;
- UMD/IIFE distribution;
- unrelated refactors or metadata churn.

Re-run the release gate after any final correction. Update acceptance evidence
with the final counts and hashes, then commit all Phase 9 implementation, plan,
tests, screenshots, assets, and documentation as:

```text
feat(ui): implement phase 9 player interface
```

The phase is complete only when the commit exists, the required worktree is
clean, the Demo server URL is reported, and real-browser pending items remain
truthfully separated from automated evidence.
