# 字幕管线

## 1. Phase 8 范围

Phase 8 交付与 UI 解耦的 SRT、ASS/SSA 文本字幕内核：内嵌/外挂来源、轨道生命周期、媒体时钟调度、安全 Overlay 和样式持久化。PGS、VobSub、完整 libass、字幕菜单、字体选择器、拖拽句柄、样式编辑器和控制条不在本阶段。

## 2. 依赖和数据流

```text
@mx-player-max/types
        ↑
@mx-player-max/subtitles
        ↑
@mx-player-max/core
        ↑
@mx-player-max/sdk

Embedded packet / File / HTTPS URL
        ↓
bounded SRT / ASS parser
        ↓
stable SubtitleCue[] index
        ↓
HTMLVideo / AudioContext / MediaWallClock query
        ↓
safe Subtitle Overlay above video/canvas
```

`subtitles` 只依赖 `types` 公共入口。Demux、decoder、audio、renderer 和 AI 包不反向依赖字幕。Core 为内嵌字幕创建独立的受限 Demux 会话，因此不改变 Phase 3-7 的视频/音频 packet 路由和所有权。Overlay 永远不把文字烧录到 `VideoFrame`、`GPUTexture` 或 renderer 输出。

## 3. 公共契约

- `SubtitleCue` 使用稳定 cue/track ID、整数微秒 `start/end`、纯文本 `text`、layer 和可选基础样式。
- `SubtitleTrack` 只公开安全的 source kind/format/embedded track ID，不公开 File 或完整 URL。
- 所有方法、事件和 callback 有显式返回类型；公共代码不使用 `any`。
- `SUBTITLE_*` 是稳定错误域。公共 warning/error 只包含安全 message、code、可选行号和 cue ID。
- `subtitlecuechange` 只发送 cue metadata、当前媒体微秒和 epoch，不发送字幕正文。

## 4. SRT

解析器接受 UTF-8 BOM、CRLF/LF、可选数字序号、逗号/点毫秒、短 `MM:SS` 形式和多行文本。每条 cue 要求非负安全整数微秒且 `start < end`。

输入字节、行数、行长、cue 数、cue 文本、诊断数和可注入解析时间都有默认上限与硬上限。逐行扫描最多保留配置行数和配置行长，不为恶意超长行做无界复制；无效 block 向前跳过，不重试或回退循环。HTML、script、SVG 和实体都只是字符串。

## 5. ASS/SSA

实现识别 `[Script Info]`、`[V4 Styles]`、`[V4+ Styles]`、`[Events]`、活动 `Format` 和 `Dialogue`。Style 和 Dialogue 都按声明字段名映射，Text 字段吸收逗号；Matroska ASS/SSA packet 按 `ReadOrder,Layer/Marked,Style,Name,MarginL,MarginR,MarginV,Effect,Text` 映射，时间只使用容器 PTS/duration。

白名单只有：

- `\\N` / `\\n` / `\\h`；
- `\\fn`、`\\fs`、`\\b`、`\\i`、`\\u`；
- `\\c` / `\\1c`、`\\3c`；
- `\\bord`、`\\a` / `\\an`、`\\pos`。

动画、`\\t`、`\\move`、`\\fad`/`\\fade`、绘图、卡拉 OK、复杂 transform、blur/shadow/rotation 和碰撞排版均产生 `SUBTITLE_ASS_UNSUPPORTED_FEATURE` 并安全降级。字体、颜色、数值和位置进入 style model 前会验证；ASS 内容不拼接为 HTML、SVG、脚本、CSS URL 或动态 CSS。

## 6. 来源、轨道和 epoch

外挂 `File` 在本地直接读取；远程字幕只允许无凭据 HTTPS、CORS、拒绝重定向并限制 Content-Length、流式累计字节/块数、单次读取超时和解析预算。SDK 不代理或上传用户文件。

轨道管理器支持枚举、添加外挂轨、选择/切换、`null` 关闭显示、移除和整体 `closeSubtitles()`。显式重复/非法 ID 返回稳定错误；等价 URL（忽略 fragment）和同一 `File` 对象按格式 fingerprint，避免重复 active read。加载、选择、seek、remove、换源和 close 提升 operation/epoch，AbortSignal 与结果提交点都检查当前 generation；旧结果不能改变轨道、事件或 Overlay。

重叠 cue 固定按 start 升序、end 升序、layer 降序、cue ID 二进制字典序输出，避免 locale 导致跨浏览器差异。

## 7. 时钟和调度

- Native：直接读取 `HTMLVideo.currentTime`，转换为整数微秒。
- Custom 有音频：读取 Phase 5 AudioContext 实际消费 sample 主时钟。
- Custom 无音频：读取现有可 pause/resume/seek/rate 的媒体墙钟。

packet 到达只建立 cue 索引，不驱动显示。播放中只有一个有界 rAF 唤醒循环；pause 取消循环但保留正确 cue；rate-change 刷新时钟映射；seek 开始提升 epoch 并停止旧更新；seek 完成同步重查新媒体时间；EOS 最后刷新并停止。连续 seek 的旧 epoch 不发布 cue。

## 8. Overlay 和样式

同一个 `SubtitleOverlay` 可附加到 `native-video`、`webgpu`、`webgl2` 或 `canvas2d` 宿主。它创建一个绝对定位的自有层，保留宿主既有 children；使用 `textContent` 和 `white-space: pre-line`，支持多 cue、换行、layer、resize、DPR、fullscreen 和显式 detach/close。

默认样式包含中日韩系统字体栈、字号、颜色、描边、粗体/斜体/下划线、alignment 和 x/y。`SubtitleStyleStore` 可替换；默认存储按远程媒体 origin 或稳定 `local-file` 作用域保存版本化记录。存储不可用、schema 不匹配、JSON 损坏或字段非法时回退经过验证的默认值，不中断播放。

## 9. 浏览器验证边界

Node/Vitest fake DOM 已覆盖文本节点、resize、DPR、cleanup 和迟到更新，但不代表真实 Chrome、Firefox 或 macOS Safari。真实浏览器仍需验证 HTMLVideo/canvas 定位、fullscreen 宿主变化、字体 fallback、ResizeObserver、CORS、AudioContext 时钟和连续 seek；状态记录在 `docs/development/phase-8-acceptance.md`。
