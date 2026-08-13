# Phase 13 media corpus

The binary fixtures in `fixtures/` are generated from FFmpeg `lavfi` test patterns and sine waves. They
contain no third-party footage, names, voices, or artwork and are distributed under the repository license.
`manifest.json` records the exact bytes, SHA-256, encoded streams, and reproduction command.

Run `pnpm quality:media` to verify every committed fixture. CI verifies committed bytes and does not depend on
an FFmpeg download. Maintainers regenerate fixtures explicitly with
`powershell -File scripts/quality/generate-media-fixtures.ps1`; the script requires FFmpeg 9.0 and must be
followed by a manifest hash review because encoder output may change across toolchain builds.

Large and 30-minute files are deliberately not committed. Generate a long-run input from the H.264 seed:

```powershell
ffmpeg -stream_loop 599 -i tests/media/fixtures/mp4-h264-baseline-8bit-aac.mp4 `
  -t 1800 -c copy -movflags +faststart tests/media/generated/long-run-h264-aac-30m.mp4
```

The performance collector records both the seed SHA-256 and generated output SHA-256. This keeps clones and
CI small while preserving a reproducible input recipe without relying on an external host.
