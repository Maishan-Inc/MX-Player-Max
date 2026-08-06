# 字幕管线

## 1. 首阶段范围

支持内嵌和外挂 SRT、ASS/SSA 文本字幕。支持多字幕轨、语言/名称显示、开关、字体、字号、位置、颜色、描边和本地保存。PGS、VobSub 和其他位图字幕作为后续能力。

## 2. 数据流

```text
Demux Subtitle Packet / External File
        ↓
SRT / ASS Parser
        ↓
SubtitleCue[]
        ↓
Media Clock 查询 active cues
        ↓
Subtitle Overlay
```

字幕显示由媒体时钟驱动，不由数据包到达驱动。字幕可以覆盖在 HTMLVideo、WebGPU、WebGL2 或 Canvas2D 渲染器之上，保持 UI 与渲染后端解耦。

## 3. ASS 处理边界

首阶段解析 Dialogue 时间和文本，支持换行、基础颜色、字体、大小、位置和描边。未实现的高级动画、复杂绘图、卡拉 OK 和碰撞排版必须明确降级，不得伪装成完整 libass 兼容。

外挂字幕必须限制大小、解析时间和 cue 数量。文本默认按纯文本渲染，不能把字幕作为 HTML 插入。

## 4. 样式与缓存

样式按远程主机或本地文件作用域保存。默认字体栈必须覆盖中日韩字符。样式调整不应触发重新解封装或回退播放，只改变覆盖层。

