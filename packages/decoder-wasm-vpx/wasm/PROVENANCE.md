# libvpx VP8 WASM provenance

Review status: `Approved`. The project owner approved the three recorded variants for the repository license and patent gate on 2026-08-20. `single` and `simd` may be distributed through the hash-locked release manifest, npm package, Release artifact, and Pages artifact. `threaded` remains technically excluded from those artifacts until Emscripten pthread host glue is implemented.

## Source

- Upstream: `https://chromium.googlesource.com/webm/libvpx`
- Tag: `v1.15.2`
- Commit: `d168454ecd099805c675d4a98c66f4891373302a`
- License: BSD-3-Clause, preserved at `third_party/libvpx/LICENSE`
- Patent statement: Google WebM implementation patent grant with termination clause, preserved at `third_party/libvpx/PATENTS`
- Authorization record: the project owner confirmed that the required license and patent authorization was obtained on 2026-08-20. This repository record is not independent legal advice.

## Toolchain

- Emscripten: `4.0.15`
- emsdk checkout: `5261a44315049f9a98ad3f3f0fb9ca575ae8ca4c`
- Emscripten release commit: `b412b6307e541b93dd93f01b61181e15c17302ec`
- Wrapper: `native/mxwf_vpx.c`, MXWF ABI v1
- Common libvpx configure: `--target=generic-gnu --disable-vp9 --disable-vp8-encoder --disable-shared --disable-docs --disable-examples --disable-tools --disable-unit-tests --disable-webm-io --disable-libyuv`
- Common link: `-O3 -sSUPPORT_LONGJMP=wasm --no-entry -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=268435456 -sMALLOC=emmalloc`

## Matrix

| Variant | libvpx/compiler flags | Bytes | SHA-256 | Runtime status |
| --- | --- | ---: | --- | --- |
| `single` | `--disable-multithread`; decoder threads=1 | 113304 | `d8de9e34abade1d60ebd4646d98681dacf3c688d2f38dc7b1e1c15c699f1c5ba` | Self-contained, zero imports |
| `simd` | single flags plus `-msimd128`; decoder threads=1 | 135291 | `79e784506b25160e650c02d6d87213075188f98fda1e829a342ad4cad980853d` | Self-contained, zero imports, contains `v128` instructions |
| `threaded` | `--enable-multithread --extra-cflags='-pthread -sSUPPORT_LONGJMP=wasm'`; wrapper `-DMXWF_DECODER_THREADS=2`; link `-pthread` | 139725 | `422c57f2634f6e24d2745b01dcf54a4cd2da0ba079fe60f85a0377041becb07f` | Real pthread/shared-memory libvpx build, but Emscripten host glue is not implemented in 10.2; initialization must fail safely and fall back |

The threaded asset imports shared memory plus Emscripten pthread host functions. The Phase 10.2 no-glue plugin intentionally does not fabricate those functions. Isolated clients try threaded first, receive a recoverable initialization failure, then continue with SIMD or single. This is a tested fallback condition, not a claim of working threaded decode.
