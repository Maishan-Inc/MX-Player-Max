# Demo poster provenance

`mx-player-poster.png` is a repository-owned 1920x1080 bitmap generated on
2026-08-09 with deterministic System.Drawing primitives (seed `9`). It depicts
an original mountain and lake scene, contains no third-party source material,
text, logo, trademark, or embedded metadata, and may be distributed under the
same license as this repository.

The image-generation skill was consulted first. The built-in AI image tool was
not available in this session, and the API/CLI fallback was not used because it
requires explicit user authorization and an `OPENAI_API_KEY`.

`flower.webm` is the MDN interactive-examples flower sample downloaded from
`https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm` on
2026-08-09. Its SHA-256 is
`C6F8A348953395598A9A73B9BAB1676436410797BCE9F398F4BE1531D6E76DDA`.
MDN publishes this sample for reuse under CC0; it is included only in the Demo
application and is not part of an SDK or UI package export.

`webm-vp8-p0-8bit-opus.webm` is the Demo's default media. It is a synthetic
VP8 + Opus WebM generated for this repository by the same FFmpeg
`lavfi testsrc2 + sine` recipe as the rest of the quality corpus; its SHA-256 is
`e9e8baf10f81588a257bffe147648c31f5a0c5e5a52b57888e935917749d13b8` and its
full provenance is recorded in `tests/media/manifest.json`. Unlike the MDN
`flower.webm` (VP8 + Vorbis), it plays on both the Native and WebCodecs paths.
