import type { WasmDecoderManifest } from '@mx-player-max/decoder-wasm'

export const libvpxVp8Manifest: WasmDecoderManifest = Object.freeze({
  codec: 'vp8',
  version: 'libvpx-v1.15.2-mxwf1',
  variants: Object.freeze({
    threaded: 'libvpx-vp8-threaded.wasm',
    simd: 'libvpx-vp8-simd.wasm',
    single: 'libvpx-vp8-single.wasm',
  }),
  sha256: Object.freeze({
    threaded: '422c57f2634f6e24d2745b01dcf54a4cd2da0ba079fe60f85a0377041becb07f',
    simd: '79e784506b25160e650c02d6d87213075188f98fda1e829a342ad4cad980853d',
    single: 'd8de9e34abade1d60ebd4646d98681dacf3c688d2f38dc7b1e1c15c699f1c5ba',
  }),
  sizeBytes: Object.freeze({ threaded: 139_725, simd: 135_291, single: 113_304 }),
  supportsVideo: true,
  supportsAudio: false,
  profiles: Object.freeze(['0']),
  pixelFormats: Object.freeze(['I420']),
  bitDepths: Object.freeze([8] as const),
  license: 'BSD-3-Clause',
  upstream: 'https://chromium.googlesource.com/webm/libvpx@d168454ecd099805c675d4a98c66f4891373302a',
  compiler: 'Emscripten 4.0.15 (b412b6307e541b93dd93f01b61181e15c17302ec)',
  buildFlags: 'VP8 decoder only; -O3; SUPPORT_LONGJMP=wasm; STANDALONE_WASM=1; FILESYSTEM=0; fixed 256 MiB memory; SIMD=-msimd128; threaded=-pthread, CONFIG_MULTITHREAD=1, decoder threads=2',
  patentRisk: 'Google WebM implementation patent grant with termination clause; repository license and patent review approved on 2026-08-20',
  review: Object.freeze({
    status: 'approved',
    notes: 'License and patent review approved by the project owner on 2026-08-20. The threaded variant remains technically excluded from release artifacts until Emscripten pthread host glue is implemented.',
  }),
})

export const libvpxVp9Manifest: WasmDecoderManifest = Object.freeze({
  codec: 'vp9',
  version: 'libvpx-v1.15.2-mxwf1-vp9',
  variants: Object.freeze({
    threaded: 'libvpx-vp9-threaded.wasm',
    simd: 'libvpx-vp9-simd.wasm',
    single: 'libvpx-vp9-single.wasm',
  }),
  sha256: Object.freeze({
    threaded: '4a63f254743e627eaec39e3ad7787f03c68f69d017b03b6c2ad98de1974b9c15',
    simd: '8af5276252bbfda07eb57e00062f555aca2f8013b518800f23bcf6988c610557',
    single: '1d794a4e47b6fc128e10ce5f950881786e90a0770334a6ea3d103832ca68f975',
  }),
  sizeBytes: Object.freeze({ threaded: 468_098, simd: 469_852, single: 425_535 }),
  supportsVideo: true,
  supportsAudio: false,
  profiles: Object.freeze(['0', '2']),
  pixelFormats: Object.freeze(['I420', 'I420P10']),
  bitDepths: Object.freeze([8, 10] as const),
  license: 'BSD-3-Clause',
  upstream: 'https://chromium.googlesource.com/webm/libvpx@d168454ecd099805c675d4a98c66f4891373302a',
  compiler: 'Emscripten 4.0.15 (b412b6307e541b93dd93f01b61181e15c17302ec)',
  buildFlags: 'VP8/VP9 decoder, VP9 highbitdepth; -O3; SUPPORT_LONGJMP=wasm; STANDALONE_WASM=1; FILESYSTEM=0; fixed 256 MiB memory; SIMD=-msimd128; threaded=-pthread, CONFIG_MULTITHREAD=1, decoder threads=2',
  patentRisk: 'WebM/libvpx patent review required before release',
  review: Object.freeze({ status: 'restricted', notes: 'Real binaries and hashes are recorded; browser, reproducibility, license, and patent review are still required before publication.' }),
})
