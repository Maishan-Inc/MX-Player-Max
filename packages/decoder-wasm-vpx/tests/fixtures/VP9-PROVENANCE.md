# VP9 fixture provenance

Source input is the repository's existing MDN CC0 `flower.webm` sample:

- Source: `https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm`
- Source SHA-256: `c6f8a348953395598a9a73b9bab1676436410797bce9f398f4be1531d6e76dda`
- Source license: CC0 / public-domain dedication
- Tool: FFmpeg 9.0-full_build-www.gyan.dev

Both outputs are video-only WebM, VP9, 641x359, 30000/1001 fps, approximately one second:

| File | Profile | Pixel format | SHA-256 |
| --- | --- | --- | --- |
| `webm-vp9-p0-8bit-641x359.webm` | 0 | yuv420p | `1372eed5c2c2d04ea63033bb548902403b283a9918fc126d619dcd8e4f9d60c6` |
| `webm-vp9-p2-10bit-641x359.webm` | 2 | yuv420p10le | `09ba8a0c2c2b07f42a1a0fc26af56f13d758893c65dabf2fc750037dba92741d` |

Generation command for profile 0:

```text
ffmpeg -hide_banner -y -i flower.webm -map 0:v:0 -an -vf scale=641:359:flags=lanczos,format=yuv420p -t 1 -c:v libvpx-vp9 -deadline best -cpu-used 0 -b:v 0 -crf 32 -g 30 -lag-in-frames 0 -auto-alt-ref 0 -threads 1 -map_metadata -1 webm-vp9-p0-8bit-641x359.webm
```

The profile 2 command is identical except for `format=yuv420p10le` and `-profile:v 2`.
