# VP8 fixture provenance

- File: `webm-vp8-p0-8bit-642x358.webm`
- Source: `https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm`
- Source license: CC0 / public domain dedication, as published by MDN interactive examples
- Source bytes: 554058
- Source SHA-256: `c6f8a348953395598a9a73b9bab1676436410797bce9f398f4be1531d6e76dda`
- Output bytes: 45408
- Output SHA-256: `31cc0a477479e3acde7e336769d068cd57d4d18fab8904ba9e44a47bab7ab95a`
- Output: WebM, VP8 profile 0, 8-bit `yuv420p`, 642x358, 30000/1001 fps, 1.001 seconds, video-only
- Tool: FFmpeg `9.0-full_build-www.gyan.dev`, Scoop archive SHA-256 `13f55932bed5b2c2e5706c91af8081f8e9ed76364f2f682de0ae22679bf26642`

Generation command:

```text
ffmpeg -hide_banner -y -i flower.webm -map 0:v:0 -an -vf scale=642:358:flags=lanczos,format=yuv420p -t 1 -c:v libvpx -deadline best -cpu-used 0 -b:v 0 -crf 32 -g 30 -lag-in-frames 0 -auto-alt-ref 0 -threads 1 -map_metadata -1 webm-vp8-p0-8bit-642x358.webm
```
