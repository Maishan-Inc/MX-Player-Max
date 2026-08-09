# @mx-player-max/subtitles

与 UI 解耦的 SRT/ASS/SSA 字幕内核。包只依赖 `@mx-player-max/types` 公共入口，负责有界解析、外挂来源、内嵌 packet 转换、轨道生命周期、媒体时钟调度、安全 DOM Overlay 和可替换样式存储；不依赖 core、demux、decoder、renderer、SDK、UI 或 demo。

## 入口

- `parseSrt()`：UTF-8 BOM、CRLF/LF、可选序号、多行文本和整数微秒时间。
- `parseAss()` / `AssPacketParser`：Script Info、V4/V4+ Styles、Events `Format`、Dialogue 逗号和白名单 override tags。
- `loadExternalSubtitle()`：本地 `File` 或直接 HTTPS/CORS 请求，带响应字节/块数、读取超时和解析预算。
- `parseEmbeddedSubtitlePackets()`：将内嵌 UTF-8 或 Matroska ASS/SSA packet 转为 `SubtitleCue[]`。
- `SubtitleTrackManager` / `SubtitleScheduler`：轨道选择、epoch 失效、稳定重叠顺序和时钟查询。
- `SubtitleOverlay`：适配 HTMLVideo、WebGPU、WebGL2、Canvas2D 宿主的独立文本层。
- `SubtitleStyleStore`：默认使用按媒体 origin 或 `local-file` 作用域的版本化 localStorage，失败时回退内存和默认样式。

```ts
import { parseSrt, SubtitleTrackManager } from '@mx-player-max/subtitles'

const parsed = parseSrt(text, { trackId: 'external-en' })
// parsed.cues 的 start/end 均为整数微秒；parsed.diagnostics 使用稳定 SUBTITLE_* code。
```

字幕文本不解析 HTML，Overlay 只使用 `textContent`。ASS 仅支持 `\\N`/`\\n`、`\\fn`、`\\fs`、`\\b`、`\\i`、`\\u`、`\\c`/`\\1c`、`\\3c`、`\\bord`、`\\a`/`\\an` 和 `\\pos`。动画、绘图、卡拉 OK、transform、移动和碰撞排版产生降级诊断；本包不声称完整 libass 兼容。

等价 URL（忽略 fragment）和同一 `File` 对象按字幕格式去重，避免重复 active read。

Phase 8 不包含 PGS/VobSub、字幕菜单、字体选择器、拖拽句柄、样式编辑器或控制条。
