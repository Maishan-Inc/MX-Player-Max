# @mx-player-max/decoder-wasm-vpx

Approved Phase 10.2 libvpx VP8 decoder plugin. It accepts video-only VP8 8-bit 4:2:0 tracks and emits I420 `VideoFrame` objects through MXWF frame ABI v1.

The project owner approved all three recorded variants for the repository license and patent gate on 2026-08-20. Their BSD-3-Clause license, WebM patent grant, immutable upstream commit, compiler, build flags, byte lengths, and SHA-256 values are recorded in `wasm/PROVENANCE.md`. The npm package and release manifest include only `single` and `simd`; applications may use those assets through an explicit `wasmBaseUrl`.

The `single` and `simd` modules are self-contained. The `threaded` module is a real pthread build, but
Phase 10.2 does not ship Emscripten pthread host glue; its initialization is expected to fail and fall
back to SIMD or single. This is a fallback test condition, not threaded decode support.
For that technical reason, `threaded` remains outside npm, Release, Browser, and Pages artifacts even though its legal review status is `approved`.

## Native Windows toolchain

Docker is not required. The repository includes PowerShell helpers for an Emscripten installation at
`G:\Node\emsdk`:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
. .\packages\decoder-wasm-vpx\scripts\setup-emsdk.ps1
```

The leading dot is required: `emsdk_env.bat` runs in a child `cmd.exe` process and cannot update the
current PowerShell `PATH`. The helper expects Emscripten `4.0.15` and checks `emcc.bat`, `em++.bat`
and `wasm-ld.exe` before continuing.

To verify or fetch the pinned libvpx source from PowerShell:

```powershell
pnpm --filter @mx-player-max/decoder-wasm-vpx toolchain:check
pnpm --filter @mx-player-max/decoder-wasm-vpx build:vp9 -- -FetchSource
```

`build:vp9` builds the pinned VP9 single, SIMD and threaded modules. `audit:vp9` checks their
recorded sizes, SHA-256 hashes, required exports and import shape. The restricted VP9 manifest and
real WebM profile 0/2 decoding tests are present, but Core does not register the VP9 plugin and
release packaging excludes all three VP9 binaries. The VP9 browser, reproducibility, license and
patent gates remain open; building these assets does not authorize distribution. The real-media
Manager tests explicitly disable its approval requirement for local technical verification; the
default Manager rejects restricted VP9 before fetching a binary.

Run `pnpm test:vp9:browser` from the repository root for the separate local browser harness. It
serves the restricted fixtures and WASM files from an explicit test-only allowlist, verifies real
`I420P10` frame transfer and `copyTo()`, and repeats demux seek/reset through epochs 1–3 in both
isolated and non-isolated contexts. The 2026-09-25 result is recorded in
`docs/development/evidence/vp9-browser-2026-09-25.json`: installed Chrome/Edge 153 passed; the
Playwright Firefox engine cannot construct `I420P10`, and Playwright WebKit lacks `VideoFrame`.
These automation results do not cover previous-stable versions or physical macOS Safari.
The default source mirror is `https://github.com/webmproject/libvpx.git`; pass `-SourceUrl` to
`build-vp9.ps1` when a local mirror is required.
