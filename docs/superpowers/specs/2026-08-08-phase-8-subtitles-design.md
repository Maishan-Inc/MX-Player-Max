# Phase 8: SRT/ASS Subtitle Kernel Design

## Status

Approved design. Implementation follows the Phase 8 acceptance document.

## Goal and scope

Phase 8 delivers a reusable, UI-independent subtitle kernel for SRT and ASS/SSA
text subtitles. The kernel owns parsing, bounded subtitle sources, track
lifecycle, media-clock scheduling, safe DOM overlay rendering, and replaceable
style persistence. Core composes these pieces with the existing Native and
Custom pipelines. SDK exposes the stable public API and events.

Phase 8 does not implement PGS, VobSub, bitmap subtitles, complete libass
compatibility, subtitle menus, font pickers, drag handles, style editors, or
control bars. Those are later phases.

## Dependency boundaries

```text
@mx-player-max/types
        ^
@mx-player-max/subtitles  (parsers, sources, tracks, clock, overlay, styles)
        ^
@mx-player-max/core       (lifecycle composition)
        ^
@mx-player-max/sdk        (stable SDK proxy)
```

`subtitles` depends only on the public `types` entry point. It never imports
Core, demux, decoder, renderer, SDK, UI, React, Vue, or the demo. Demux,
decoder, renderer, and audio packages remain unaware of subtitles. Subtitle
text is never burned into a `VideoFrame`, `GPUTexture`, or renderer output.

## Public contracts

`@mx-player-max/types` adds or completes:

- `SubtitleCue`: stable `cueId`, integer-microsecond `start`/`end`, pure
  `text`, source track ID, layer, and optional cue style.
- `SubtitleCueStyle`: validated font stack, size, primary/outline colors,
  outline width, bold/italic/underline, alignment, and base x/y position.
- `SubtitleTrack`: stable ID, language/name, `embedded`/`file`/`url` source,
  `srt`/`ass` format, state, and safe diagnostic summary.
- `SubtitleSourceDescriptor`, `SubtitleTrackState`, `SubtitleState`,
  `SubtitleDiagnostic`, `SubtitleClockSnapshot`, and `SubtitleStyleStore`.
- Typed subtitle event payloads added to `EngineEventMap` and stable
  `SUBTITLE_*` error codes.

All time fields are non-negative safe integer microseconds. Public methods and
callbacks have explicit return types and use no `any`.

`SubtitleStyleStore` is replaceable and has load/save/reset behavior. The
default implementation uses a versioned `localStorage` record when available,
otherwise an in-memory fallback.

## Parsers

### SRT

The parser performs one bounded forward scan. It strips an optional UTF-8 BOM,
accepts CRLF or LF, accepts optional sequence numbers, supports common comma or
dot millisecond separators, and preserves multi-line text as `\n`. Text is
always plain text; HTML, entities, scripts, SVG, and CSS are not interpreted.

Each cue validates `start < end`, non-negative safe microseconds, cue count,
line count, line length, text size, and parser time budget. Malformed entries
produce stable diagnostics and the scanner must continue or stop at a bounded
point without retry loops or unbounded allocation.

### ASS/SSA

The parser recognizes Script Info, V4/V4+ Styles, Events, Format, and Dialogue.
Dialogue fields are mapped by the active Format declaration; the final text
field absorbs commas in dialogue text. Supported text/style features are:

- `\\N`/`\\n` line breaks;
- `\\fn`, `\\fs`, `\\b`, `\\i`, `\\u`;
- `\\c`/`\\1c`, `\\3c` colors;
- `\\bord` outline width;
- `\\a`/`\\an` basic alignment;
- `\\pos` basic position.

Only these override tags are parsed. Animation, `\\t`, `\\move`, `\\fad`,
drawings, karaoke timing, collision layout, and other libass behavior are
explicitly unsupported. Such input yields a warning diagnostic and safe text
degradation; the implementation never claims full libass compatibility. Font
names, colors, coordinates, and numeric values are validated before entering
the style model. No ASS value is concatenated into HTML, CSS, a URL, SVG, or
script.

Default hard limits are centralized in `SubtitleParserLimits`: 8 MiB input,
16 KiB line length, 20,000 cues, 8,000 lines, 64 KiB text per cue, and a
100 ms injectable parsing budget. Callers may reduce limits but cannot raise
the implementation safety ceiling.

## Sources and embedded demux

The kernel exposes a common bounded source interface for:

- embedded subtitle packets;
- local `File` text;
- HTTPS URL text.

Embedded subtitles use an independent, controlled Demux session supplied by
Core. This avoids changing the Phase 3-7 video/audio decoder protocol and
prevents subtitle packet arrival from becoming the display clock. The session
filters the selected subtitle track, enforces packet/batch/parse budgets, and
closes with the media epoch.

Remote subtitles use direct browser `fetch` only, with HTTPS, CORS, omitted
credentials, bounded redirects, response bytes, cue count, and parsing time.
The SDK never proxies or uploads the source. Public diagnostics expose only a
safe origin/category and stable code; they omit query parameters, response
body, complete URL, and DOM exceptions.

## Track lifecycle and epochs

The track manager provides read-only enumeration plus add external track,
select track or `null`, close subtitles, and remove track operations. Track IDs
are validated and stable; duplicate explicit IDs return
`SUBTITLE_TRACK_ID_CONFLICT`. Equivalent external sources are fingerprinted to
avoid duplicate active reads.

`load`, source replacement, seek, track selection, and close increment the
subtitle epoch. Every async source read, parse result, scheduler refresh, cue
event, warning, EOS, and overlay update carries the session/epoch and is
discarded unless it still matches. A superseded continuous seek cannot update
the selected track or overlay.

Overlapping active cues sort deterministically by start ascending, end
ascending, layer descending, and cue ID lexicographically.

## Clock and scheduling

`SubtitleClock` adapts the existing media clocks and exposes a snapshot plus a
subscription. Native reads `HTMLVideo.currentTime` as integer microseconds;
Custom reads the existing AudioContext sample clock when audio exists and the
existing media wall clock otherwise. The scheduler never uses packet arrival
time.

One bounded rAF refresh loop runs while playback is active. Play, pause,
rate-change, seeking, seeked, EOS, and track changes synchronously trigger a
refresh or stop. Seek completion clears stale cues and immediately queries the
new time/epoch. Pause freezes the current cue set; EOS clears or retains the
final set according to the selected end boundary and stops scheduling.

## Overlay

`SubtitleOverlay` accepts a host and target kind (`native-video`, `webgpu`,
`webgl2`, or `canvas2d`) but has no knowledge of codecs, packets, decoders, or
renderers. It creates one owned absolutely positioned layer, preserves host
children, and renders text using `textContent`/text nodes with CSS
`white-space: pre-line`. It supports multiple cues, line breaks, layer order,
container resize, DPR, fullscreen, and explicit close cleanup.

Automatic host resolution uses the supplied container, or the parent of a
direct video/canvas target. An explicit `overlayHost` can override this. If no
host is available, parsing and track APIs remain usable while the overlay is
disabled with a recoverable diagnostic; playback continues.

Close cancels rAF, ResizeObserver, and listeners, invalidates pending refresh
generations, removes owned nodes, and prevents late updates.

## Styles and scope

The default font stack covers Chinese, Japanese, and Korean system fonts. Style
scope is the URL origin/hostname for remote media and the stable `local-file`
scope for local files. Storage failure, corruption, unsupported fields, and
schema mismatch always fall back to validated defaults without interrupting
playback. Style changes only update the overlay.

## Core and SDK integration

Core creates and closes the subtitle manager alongside the active pipeline,
injects the correct Native or Custom clock, starts the independent embedded
demux session when needed, and forwards safe subtitle events. Existing Native,
Custom, Audio, Renderer, and AI code paths retain their current ownership and
epoch contracts.

SDK proxies the subtitle track, selection, external-source, close/remove,
style, and overlay lifecycle methods and re-exports the public types. No Phase
8 API creates menus or other UI controls.

## Verification and documentation

Unit tests cover normal, malformed, malicious, and oversized SRT/ASS input;
BOM/newlines/commas/boundaries/overlap ordering; supported and unsupported ASS
tags; injection safety; track lifecycle and duplicate IDs; Native/Custom clock,
pause, rate, seek, continuous seek, epoch, EOS; source budgets and CORS; style
scope/corrupt storage/default fallback; overlay resize/multiple cues/close;
and Core/SDK event integration.

The phase updates package READMEs, public API documentation, CHANGELOG,
subtitle/security architecture and browser compatibility notes, and adds
`docs/development/phase-8-acceptance.md`. Fake DOM and unit results are never
presented as real Chrome, Firefox, or Safari verification; real-browser status
is recorded separately.
