# @mx-player-max/decoder-wasm-vpx

Approved Phase 10.2 libvpx VP8 decoder plugin. It accepts video-only VP8 8-bit 4:2:0 tracks and emits I420 `VideoFrame` objects through MXWF frame ABI v1.

The project owner approved all three recorded variants for the repository license and patent gate on 2026-08-20. Their BSD-3-Clause license, WebM patent grant, immutable upstream commit, compiler, build flags, byte lengths, and SHA-256 values are recorded in `wasm/PROVENANCE.md`. The npm package and release manifest include only `single` and `simd`; applications may use those assets through an explicit `wasmBaseUrl`.

The `single` and `simd` modules are self-contained. The `threaded` module is a real pthread build, but
Phase 10.2 does not ship Emscripten pthread host glue; its initialization is expected to fail and fall
back to SIMD or single. This is a fallback test condition, not threaded decode support.
For that technical reason, `threaded` remains outside npm, Release, Browser, and Pages artifacts even though its legal review status is `approved`.
