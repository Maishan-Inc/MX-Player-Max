# @mx-player-max/decoder-wasm-vpx

Restricted Phase 10.2 libvpx VP8 decoder plugin. It accepts video-only VP8 8-bit 4:2:0 tracks and emits I420 `VideoFrame` objects through MXWF frame ABI v1.

This package is not release-approved. It is available only when an application explicitly provides a self-hosted `wasmBaseUrl` and opts into restricted decoder review. The assets must not be added to the Browser release manifest or a public release until an independent license, patent, and reproducibility review changes the manifest status from `restricted`.

The `single` and `simd` modules are self-contained. The `threaded` module is a real pthread build, but
Phase 10.2 does not ship Emscripten pthread host glue; its initialization is expected to fail and fall
back to SIMD or single. This is a fallback test condition, not threaded decode support.
