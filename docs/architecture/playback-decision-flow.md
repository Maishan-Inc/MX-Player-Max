# 播放路径决策流程

本文档定义从接收源到选定后端的**完整决策流程**，回答一个问题：对于一个具体的文件，引擎按什么顺序决定用哪条路播放。

## 1. 四条解耦的决策轴

不能把后端当成一个东西选。有四条决策轴，**只有前两条在原生路径必须一致，自定义管线可以各自独立**：

| 轴 | 决策 | 原生路径 | 自定义管线 |
|---|---|---|---|
| 容器 | 谁拆箱 | HTMLVideo（浏览器内置） | Demux Worker（我们的代码） |
| 视频解码 | 谁解码视频帧 | HTMLVideo（硬件） | WebCodecs / 专用 WASM / FFmpeg |
| 音频解码 | 谁解码音频 | HTMLVideo（硬件） | WebCodecs / FFmpeg |
| 渲染 | 谁把帧画到屏幕上 | 浏览器合成器 | WebGPU / WebGL2 / Canvas2D |

**关键：** 原生路径下四条轴绑在一起，一个不满足整条路径出局。自定义管线下四条可以任意组合——最常见的组合是：

```text
容器：Demux Worker（因为容器是 MKV）
视频：WebCodecs（硬件解码）
音频：FFmpeg WASM（因为 WebCodecs 不收 ec-3 / dts）
渲染：WebGPU 或 Canvas2D
```

这个四轴模型是基础。下面所有流程都建立在这个模型上。

## 2. 五种后端的总览

| 后端 | 容器 | 视频解码 | 音频解码 | 渲染 | 逐帧 | 保真度 |
|---|---|---|---|---|---|---|
| **HTMLVideo 原生** | 浏览器 | 浏览器硬件 | 浏览器硬件 | 系统合成器 | 不可 | **最高** |
| **MSE + HTMLVideo** | Demux → fMP4 | 浏览器硬件 | 浏览器硬件 | 系统合成器 | 不可 | **最高** |
| **WebCodecs 全解码** | Demux | WebCodecs 硬件 | WebCodecs 硬件 | WebGPU/GL2/C2D | 可 | 中（需自建 HDR 管线） |
| **WebCodecs 视频 + 其他音频** | Demux | WebCodecs 硬件 | FFmpeg WASM | WebGPU/GL2/C2D | 可 | 中（HDR/音频降级） |
| **WASM 全软解** | Demux | WASM 软解 | WASM 软解 | WebGPU/GL2/C2D | 可 | **最低** |

MSE 路径的价值：**容器的约束被你绕过去了。** 你自己拆 MKV，把码流重新包成 fMP4，浏览器以为自己在播 MP4。它保留了原生路径的全部优势——硬件解码、系统 HDR、音画同步、AirPlay/PiP。代价是实现轻量 MP4 muxer。

MSE 和其他路径的关键区别：视频和音频**仍然必须同时走同一路径**（都是 HTMLVideo），因为 fMP4 同时承载了音视频。但这不是问题——MKV 里的 HEVC 和 E-AC-3 都可以放进 fMP4，Safari 原生认识它们。

## 3. 总决策流程

下面是完整流程。每一个分叉后面标注了它对应第 1 节的哪条轴。

### 阶段 1：源类型分叉

```text
                    ┌─── 本地 File → 需要吗？不需要：File API 直接读 slice()
  SourceDescriptor ─┤
                    └─── 远程 URL → 需要先探测：服务器支持 Range 吗？
                                    ├─ 支持 → Range Loader，按需读取
                                    └─ 不支持 → 全量下载（大文件警告）
```

如果源是远程 URL 且不支持 Range，**所有容器解析和 seek 能力大幅受限**——可能需要下载整个文件才能开始探容器。这是外部约束，与格式无关。

### 阶段 2：MIME / 后缀作为初始猜测（不可作为结论！）

```text
文件后缀 / Content-Type 响应头
         ↓
  只作为探测方向提示，不参与后端选择
         ↓
  真实容器由阶段 3 的 magic bytes 确认
```

例：`.mkv` 后缀但内容实际是 WebM → 按 WebM 处理。

### 阶段 3：容器识别（轴 1：容器）

```text
读取文件头 magic bytes
         ├── 0x00 00 00 xx 66 74 79 70 → MP4 / MOV / fMP4
         ├── 0x1A 45 DF A3             → Matroska / WebM
         ├── 0x47                      → MPEG-TS
         ├── 0x46 4C 56                → FLV
         └── 其他                       → 容器未知 → 进入 FFmpeg 统一路径
```

结果决定**容器侧的候选集**：

| 容器 | HTMLVideo 候选可用？ | MSE 候选可用？ | Demux 必须？ | 说明 |
|---|---|---|---|---|
| MP4 | 是（三浏览器） | 无需要 | 自定义路径需 | |
| WebM | 是（Chrome/Firefox） | 无需要 | 自定义路径需 | |
| MKV | 否 | 是 | 必须 | 必须自行解封装 |
| MPEG-TS | 否 | 可能 | 必须 | |
| AVI / FLV / ASF | 否 | 否 | 必须 | FFmpeg 候选 |

### 阶段 4：播放意图检查

```text
PlaybackIntent
  ├── 'normal'      → HTMLVideo / MSE 候选可用
  ├── 'low-power'   → HTMLVideo / MSE 候选获得额外 +20 分
  ├── 'frame-access'→ HTMLVideo / MSE 直接淘汰
  ├── 'filters'     → HTMLVideo / MSE 直接淘汰
  └── 'editing'     → HTMLVideo / MSE 直接淘汰
```

**意图在后端选之前判断，不是之后。** `frame-access` / `filters` / `editing` 三种意图下，表里 HTMLVideo 和 MSE 都不会出现在候选列表中，根本不用做后续检测。

### 阶段 5：轨道元数据解析

```text
Demuxer（或浏览器内置）解析
         ↓
输出每条轨道的：
  ├── kind          视频 / 音频 / 字幕
  ├── codec         H.264 / H.265 / VP9 / AV1 / AAC / Opus / E-AC-3 / DTS / ...
  ├── codecPrivate  avcC / hvcC / Annex-B → OBU / 其他配置
  ├── profile/level 决定解码器是否支持
  ├── ColorInfo     位深、原色、传输函数、HDR 格式、DV Profile
  └── AudioObjectInfo  对象音频格式、载体 codec、声道布局
```

### 阶段 6：候选生成（轴 2 + 轴 3：视频 + 音频解码）

根据四元组生成候选：

```text
容器结果 + 视频 Codec + 音频 Codec + 播放意图
           ↓
生成可能的后端组合，每条候选标注：
  ├── 哪个轴用了什么（容器拆箱 / 视频解码 / 音频解码 / 渲染）
  ├── 依赖的浏览器能力（HTMLVideo 原生 / MSE / WebCodecs / WASM / WebGPU）
  └── 预期保真度（HDR 全保 / HDR 降级 / 降混到 N 声道）
```

候选示例：

```
#1: MSE + HTMLVideo（Safari 可用；MKV/HEVC/ec3/Atmos → fMP4 → HTMLVideo 硬件+HDR+Atmos）
#2: Demux + WebCodecs 视频 + FFmpeg 音频（全浏览器可用；HDR 降级，ec3→5.1 降混）
#3: Demux + FFmpeg 全软解（全浏览器可用；HDR 降级，ec3→5.1 降混，性能差）
```

### 阶段 7：能力验证与评分

对每条候选，按**当前浏览器的实际能力**验证：

```text
候选所需能力              → 验证方式
─────────────────────────────────────────
HTMLVideo 原生解封装       → MediaCapabilities.decodingInfo() 返回 supported
HTMLVideo 原生视频解码     → 同上，含 codec/profile/level 字符串
HTMLVideo 原生音频解码     → 同上
MSE ECMA-3/CEB-3          → MediaSource.isTypeSupported()
WebCodecs VideoDecoder    → VideoDecoder.isConfigSupported(具体配置)
WebCodecs AudioDecoder    → AudioDecoder.isConfigSupported(具体配置)
WebGPU                    → navigator.gpu 存在
WASM SIMD                 → WebAssembly.validate(simdWasm)
WASM Threads              → crossOriginIsolated && SharedArrayBuffer
```

**关键规则：** 绝不能只检测 API 构造函数是否存在。`typeof VideoDecoder !== 'undefined'` 不代表能解 `hvc1.2.4.L123.B0`。必须用**具体的 codec 配置字符串**验证。

验证后评分：

```text
硬件解码         +40    decodingInfo.powerEfficient === true
平滑播放         +30    decodingInfo.smooth === true
零拷贝           +20    原生路径 / WebGPU 外部纹理
启动快           +10    不需要下载大型 WASM
逐帧访问         +20    frame-access/filters/editing 意图
HDR 保留         +30    hdrPreservation 意图
内存风险         -20    WASM 路径，大体积文件
已知平台 Bug     -100   黑名单匹配
```

**评分在验证阶段同步完成，不是在验证之后。** 每条候选验证到哪条能力就加对应的分，验证不过就淘汰该候选。

### 阶段 8：初始化与回退

```text
最高分候选
      ↓
初始化对应的后端
      ↓
      ├── 成功 → Ready
      └── 失败（Decoder 抛异常 / WASM 下载失败 / 哈希不匹配）
              ↓
         自动回退下一候选（原子回退）
              ↓
         重复直到成功或候选用尽
```

**回退必须原子化：** 当前候选失败后，下一候选从零开始初始化，不能带着旧状态。

WASM 内部还有一层回退：

```text
WASM 后端被选中
      ↓
检测 crossOriginIsolated
      ├── 是 → 尝试 threaded
      │        ├── 成功 → 使用
      │        └── 失败 → 自动回退 simd
      └── 否 → 尝试 simd
               ├── 成功 → 使用
               └── 失败 → 自动回退 single
```

**WASM 变体选择在阶段 8，不在阶段 6。** 阶段 6 只看"这个 Codec 有没有 WASM 解码器候选"，具体用 threaded/simd/single 到初始化时才决定。

### 阶段 8.1：Phase 4/5 WebCodecs 初始化门禁

Phase 4 只在最终候选 `kind === 'webcodecs'` 且意图为 `frame-access`、`filters`、`editing`、`ai-enhance` 时初始化视频 custom pipeline。还必须再次确认具体 `mediaCapabilities.webCodecs.video.status === 'supported'`；`configure()` 仍需 try/catch，因为配置探测不是初始化成功的充分条件。

`normal`/`low-power` 被迫选中 WebCodecs 时返回 `CUSTOM_BACKEND_UNAVAILABLE`，不把只有视频 Frame 的管线包装成完整播放器。Native 候选仍完全走 Phase 3 HTMLVideo。最终选择 custom 时，目标解析阶段创建的引擎自有 video 会被移除；调用方提供的节点不会被删除，也不会创建隐藏 video。

Custom 初始化顺序固定为：复用 Phase 2 Probe 结果 → 启动一个 Demux Worker session → 选择视频/音频轨 → 分别建立已验证 VideoDecoderConfig/AudioDecoderConfig → 初始化 Worklet/output graph → configure 两个 decoder → ready。autoplay 只调用 custom `play()`；AudioContext resume 被拒绝返回 `AUDIO_AUTOPLAY_BLOCKED`，不静默无声。Demux response 中的音视频 packet 都进入对应有界路径。

### 阶段 9：运行时监控与动态调整

```text
持续记录：
 ├── 丢帧率 → 超过阈值触发诊断
 ├── 解码延迟 → 可能解码器在软解而非硬解
 ├── 音画漂移 → AudioContext.currentTime vs 视频帧 pts
 └── 内存压力 → 帧队列拥塞

触发动态降级：
 ├── 丢帧率持续 > 5% → 降低帧队列长度 / 考虑回退
 └── 内存超过阈值 → 清空缓存 / 降低缓冲
```

Phase 4 不执行上述呈现侧动态丢帧。它只允许关闭旧 epoch、seek preroll、非法或 close 后迟到的 Frame；正常 Frame 若突破有界 queue，返回 `WEBCODECS_QUEUE_OVERFLOW`。音频时钟、画面显示、运行时 dropped-frame 策略在 Phase 5/6 实现。

## 4. 硬件解码 vs GPU 渲染：两件事

这是一个关键区分。你的流程把它们连在一起了（"浏览器是否支持硬件 → 然后再 GPU 加速"），但它们是**不同轴上的不同决策**：

| | 硬件解码 | GPU 渲染（"GPU 加速"） |
|---|---|---|
| 问的是什么 | 解码芯片能不能处理这个 Codec？ | 显示后端能不能高效把帧画上屏幕？ |
| 芯片 | **ASIC**——GPU 上的专用解码单元，不是 GPU 着色器 | GPU 着色器 + 纹理单元 |
| 浏览器接口 | `decodingInfo` / `isConfigSupported` | WebGPU / WebGL2 / Canvas2D |
| 原生路径 | 自动，浏览器管理 | 自动，系统合成器 |
| 自定义路径 | 通过 WebCodecs 调 hardware decoder | 通过自己的渲染器 |
| 互斥关系 | **可解码但不由 GPU 渲染**——HTMLVideo 原生路径就是这样 | **可由 GPU 渲染但非硬解**——WASM 软解 + WebGPU 显示 |

### 各平台的硬件解码单元

硬件解码单元在 GPU/SoC 里，但**不是所有 GPU 都带所有 codec 的硬解单元**：

| 平台 | H.264 | H.265/HEVC | AV1 |
|---|---|---|---|
| Intel（UHD 630+，≈2017+） | 硬件 | 硬件 | Tiger Lake 11 代（2020+） |
| AMD（Vega+，≈2018+） | 硬件 | 硬件 | RDNA2 / RX 6000（2020+） |
| NVIDIA（GTX 10 系+） | 硬件 | 硬件 | RTX 30 系（2020+） |
| Apple Silicon（M1+） | 硬件 | 硬件 | M3+（2023+） |
| 高通骁龙（8 系） | 硬件 | 硬件 | 8 Gen 2+（2022+） |
| 天玑（9000+） | 硬件 | 硬件 | 天玑 9000+（2022+） |

**Linux 例外：** Chrome on Linux 的 VA-API 硬件解码历来不稳定，跟浏览器配置和 GPU 驱动绑定。不能默认 Linux 有硬件解码。

**Windows 例外：** Chrome on Windows 的 HEVC 硬件解码依赖系统安装的 HEVC 视频扩展。没装就是没有，跟显卡能力无关。

### 无法直接检测 GPU 硬解能力

**不存在** `navigator.gpu.supportsHevcHardwareDecode()` 这种 API。只能间接检测：

```js
// 方法 1：看系统推荐（推荐但不等于实际）
const { powerEfficient } = await navigator.mediaCapabilities.decodingInfo({
  type: 'file',
  video: { contentType: '...; codecs="hvc1.2.4.L120.B0"', ... },
})

// 方法 2：VideoDecoder 能否配置
const { supported, config } = await VideoDecoder.isConfigSupported({
  codec: 'hvc1.2.4.L120.B0',
  hardwareAcceleration: 'prefer-hardware',
})

// 方法 3：运行时验证
// 配置 VideoDecoder 后观察丢帧率和解码延迟
// 如果跳帧严重 → 可能是软解
```

Chrome 的 `powerEfficient` 值在多版本间不稳定，`scoring-model` 应该给这个分源一个可调节权重。

## 5. M3U8 / HLS 的专门决策

### 5.1 M3U8 不是文件

**.m3u8 是文本播放列表，不在第 3 节的容器探测流程里。** 它指向一组 TS 或 fMP4 分片。识别方式是在阶段 3 读文件头时检测到 `#EXTM3U` 文本头（而非二进制 magic bytes）。

### 5.2 决策流程

```text
检测到 M3U8
      ↓
├── Safari + nativeHls → HTMLVideo 原生
│    直接给 <video> 设 src，浏览器自己拉分片、解封装、解码、切码率
│    ── 这是 Safari 上 HDR + Atmos 唯一保真路径
│    ── 功耗最低、启动最快
│
├── 其他浏览器 → 两个子路径：
│   │
│   ├── HLS.js / 自建分片管线 + MSE
│   │   拉 M3U8 → 拉 TS/fMP4 分片 → 解封装（可能 Demux Worker）
│   │   → 重新打包成 fMP4 → 通过 MSE 喂 HTMLVideo
│   │   ── 视频/音频仍走硬件解码
│   │   ── HDR 保留（HTMLVideo 输出）
│   │   ── Safari 之外不指望 Atmos
│   │
│   └── WebCodecs 逐帧解码
│       拉 M3U8 → 拉分片 → Demux Worker
│       → VideoDecoder（硬件）+ AudioDecoder
│       ── 需要逐帧访问时使用
│       ── HDR 需自建管线
```

**M3U8 首推 HTMLVideo（Safari 原生 / MSE），逐帧需求才走 WebCodecs。** 反过来——给流媒体内容走 WASM 软解——性能问题会立刻放大，因为每个分片都需要软解的初始化。

### 5.3 首阶段怎么处理 M3U8

`AGENTS.md` 明确：首阶段只处理文件型媒体，HLS/DASH 只保留接口。

实现层这意味着：
- M3U8 检测逻辑在阶段 3（和文件头探测共用入口）
- Safari 原生路径**可以**启用（只需 `canPlayType`，不依赖分片管线）。
- 自定义分片管线留到后续阶段

已有的 `packages/platform/src/index.ts` 的 `nativeHls` 检测正是为此准备。

## 6. 首阶段不做的事

以下不在首阶段范围，但流程中预留了位置：

- HLS 分片拉取与 re-mux（MSE 路径）
- 动态码率切换（ABR）
- DRM / EME（Widevine、FairPlay、PlayReady）
- 直播
- DASH（自建或 Shaka Player）

## 7. 支持格式与参数范围

### 7.1 容器

| 容器 | 常见后缀 | 首阶段 |
|---|---|---|
| MP4 / ISO BMFF | `.mp4` `.m4v` `.m4a` | 完整支持 |
| WebM | `.webm` | 完整支持 |
| Matroska | `.mkv` `.mka` `.mk3d` | 完整支持 |
| MPEG-TS | `.ts` `.m2ts` `.mts` | 插件接入 |
| QuickTime | `.mov` `.qt` | 插件接入 |
| AVI | `.avi` | 插件接入 |
| FLV | `.flv` `.f4v` | 插件接入 |
| ASF / WMV | `.wmv` `.asf` | 插件接入 |
| Ogg | `.ogv` `.ogg` `.ogx` | 低优先级 |
| HLS | `.m3u8` | Safari 原生可用，自定义管线后续 |

### 7.2 视频 Codec

| Codec | 首阶段 | 原生路径 | WebCodecs | 专用 WASM | FFmpeg 兜底 |
|---|---|---|---|---|---|
| H.264 / AVC | 完整支持 | 全浏览器 | 全浏览器硬解 | OpenH264 | 备选 |
| H.265 / HEVC | 完整支持 | Safari + 有硬件的 Chrome | 同上 | libde265 | 备选 |
| VP8 | 完整支持 | Chrome/Firefox | Chrome/Firefox | libvpx | 备选 |
| VP9 Profile 0 | 完整支持 | Chrome/Firefox | Chrome/Firefox | libvpx | 备选 |
| VP9 Profile 2 (10-bit) | 支持 | 有限 | 有限 | libvpx | 备选 |
| AV1 Main | 完整支持 | Chrome/Firefox | Chrome | dav1d | 备选 |
| AV1 High (10/12-bit) | 支持 | 少 | 少 | dav1d | 备选 |
| MPEG-2 | 插件 | 否 | 否 | 无 | 兜底 |
| MPEG-4 Part 2 (DivX/Xvid) | 插件 | 否 | 否 | 无 | 兜底 |
| VC-1 / WMV | 插件 | 否 | 否 | 无 | 兜底 |
| H.266 / VVC | 插件（验证接口） | 否 | 否 | VVdeC | 备选 |
| ProRes | 插件 | 否 | 否 | 无 | 兜底 |
| RealVideo | 插件 | 否 | 否 | 无 | 兜底 |

### 7.3 音频 Codec

| Codec | 原生路径 | WebCodecs AudioDecoder | FFmpeg | 备注 |
|---|---|---|---|---|
| AAC (mp4a) | 全浏览器 | 支持 | 备选 | 最常见音频 Codec |
| Opus | Chrome/Firefox，Safari 部分 | 支持 | 备选 | WebM/MKV 常见 |
| Vorbis | Chrome/Firefox | 支持 | 备选 | WebM 历史主音频 |
| MP3 (mp3) | 全浏览器 | 支持 | 备选 | 向后兼容 |
| FLAC | Chrome/Firefox | 支持 | 备选 | 无损 |
| PCM/WAV | 全浏览器 | 支持 | 备选 | |
| AC-3 | Safari 部分 / Edge | **不支持** | 兜底 | DVD 标配 |
| E-AC-3 (Dolby Digital Plus) | Safari（Atmos 透传） | **不支持** | 兜底（仅核心床） | 流媒体标配；Atmos 载体 |
| Dolby TrueHD | 否 | **不支持** | 兜底（仅无损床） | 蓝光标配；Atmos 载体 |
| DTS / DTS-HD MA | 否 | **不支持** | 兜底（仅核心床） | 蓝光备选 |
| WMA (Windows Media Audio) | 否 | **不支持** | 兜底 | 历史格式 |
| RealAudio | 否 | **不支持** | 兜底 | 历史格式 |

**粗体标注的 `不支持` 是规范层面的缺失**——不是某个浏览器没实现，是 `AudioDecoder` 的注册 table 里就没有这些 codec ID。自定义管线下这些格式必须走 FFmpeg。

### 7.4 字幕

| 格式 | 首阶段 | 方式 |
|---|---|---|
| SRT 内嵌/外挂 | 完整支持 | 独立解析器 |
| ASS/SSA 文本 | 完整支持 | 独立解析器，有限特效 |
| WebVTT | 支持 | 浏览器原生或独立解析 |
| PGS / VobSub 位图 | 后续 | 位图字幕渲染 |
| 章节 | 支持（信息显示） | MKV Chapters 元素 |

### 7.5 HDR / 色深

| 类型 | 首阶段支持 |
|---|---|
| HDR10 (PQ, ST 2086 static) | 探测 + 原生保留 + 自定义降级为 SDR |
| HDR10+ (ST 2094-40 dynamic) | 探测 + 原生保留（如有） + 自定义降级 |
| HLG (ARIB STD-B67) | 探测 + 原生保留 |
| Dolby Vision P5 (IPT-PQ-c2) | 探测 + **拒绝或警告**（解码成功但偏色） |
| Dolby Vision P7 (双层) | 探测 + 只播基础层 |
| Dolby Vision P8.1 (单层 HDR10 基础) | 探测 + 降级为 HDR10 |
| 10-bit 色深 | WebGL2 需扩展 + 16-bit 纹理支持 |
| 12-bit 色深 | 极少见，探测并记录 |

### 7.6 对象音频

| 类型 | 首阶段支持 |
|---|---|
| Dolby Atmos (ec-3 载体) | 探测 + Safari 原生路径可透传，自定义降为 5.1 |
| Dolby Atmos (TrueHD 载体) | 探测 + 自定义降为 7.1 床 |
| DTS:X | 探测 + 自定义降为核心床 |

### 7.7 按设备与浏览器的实际落点

> 本表是**预期结果**，不是实现依据。[AGENTS.md §4](../../AGENTS.md) 禁止把浏览器品牌映射到后端；实现必须走 §3 的探测流程。本表用于测试预期和用户支持答疑。数据基准 2026-08。
>
> API 版本门槛见 `codec-strategy.md` §4.3。

| 平台 | 浏览器 | 普通 MP4/WebM | MKV / 逐帧 | AI 超分插帧 |
|---|---|---|---|---|
| **Windows** | Chrome / Edge 113+ | HTMLVideo | WebCodecs | ✅ **最佳平台**，WebGPU 走 D3D12 |
| Windows | Firefox 141+ | HTMLVideo | WebCodecs（防 H.264 陷阱） | ✅ |
| **macOS** | Safari 26+ | HTMLVideo（HEVC/HDR/Atmos 最佳） | WebCodecs | ✅ WebGPU 直映射 Metal |
| macOS | Safari 16.4–18.7 | HTMLVideo | ⚠️ 无 `AudioDecoder`，须走后端 #2 | ❌ |
| macOS | Chrome 113+ | HTMLVideo | WebCodecs | ✅ |
| macOS | Firefox 145+ | HTMLVideo | WebCodecs | ⚠️ 仅 Apple Silicon + macOS Tahoe 26 |
| **Linux** | Chrome | HTMLVideo | WebCodecs | ⚠️ WebGPU 仍在 `#enable-unsafe-webgpu` 后 |
| Linux | Firefox | HTMLVideo | WebCodecs | ❌ 开发中 |
| **Android** | Chrome 121+ | HTMLVideo | WebCodecs | ⚠️ 热节流使 AI 不可持续 |
| Android | Firefox | HTMLVideo | ❌ WebCodecs 未实现 | ❌ |
| **iOS / iPadOS 26+** | 全部浏览器 | HTMLVideo | WebCodecs | ⚠️ 未验证 |
| iOS 25 及更早 | 全部浏览器 | HTMLVideo | ⚠️ 无 `AudioDecoder` | ❌ 无 WebGPU |

**iOS 的特殊性**：Chrome、Edge、Firefox 在 iOS 上全部是 WebKit 内核，不存在「换浏览器解决问题」的选项。判断依据只有 iOS 版本。

**移动端不在首阶段范围**（AGENTS.md 第 14 行桌面优先）。即使 WebGPU 可用，手机跑几分钟神经网络就会降频，画面反而比不开 AI 更差。

## 8. 伪代码

```ts
async function selectBackend(
  source: SourceDescriptor,
  intent: PlaybackIntent,
  capabilities: CapabilitySnapshot,
): Promise<PlaybackSelection> {
  // 阶段 1：源类型
  const loader = createLoader(source)
  const supportsRange = await loader.probeRangeSupport()

  // 阶段 2：MIME/后缀 → 仅提示
  const extensionHint = guessContainerFromName(source)
  // 不使用 extensionHint 做决策

  // 阶段 3：容器识别（magic bytes）
  const header = await loader.read(0, 4096)
  const container = identifyContainer(header)
  // 返回：'mp4' | 'webm' | 'mkv' | 'mpegts' | 'hls' | ...

  // 阶段 4：意图
  const needsFrameAccess = intent === 'frame-access'
    || intent === 'filters' || intent === 'editing'

  // 阶段 5：轨道解析
  const demuxer = createDemuxer(container, loader)
  const media = await demuxer.probe()
  // media.tracks[] 含 ColorInfo / AudioObjectInfo

  // 阶段 6：候选生成
  const candidates: BackendCandidate[] = []

  // HTMLVideo 原生候选
  if (!needsFrameAccess && containerIsNative(container)) {
    candidates.push(...createNativeCandidates(media, container))
  }

  // MSE 候选（容器不原生支持，但 codec 浏览器认识）
  if (!needsFrameAccess && canRemux(container)) {
    candidates.push(...createMSECandidates(media, capabilities))
  }

  // WebCodecs 候选
  if (!needsFrameAccess || needsFrameAccess) {
    candidates.push(...createWebCodecsCandidates(media, intent, capabilities))
  }

  // WASM 候选
  candidates.push(...createWasmCandidates(media))

  // FFmpeg 最终兜底
  candidates.push(...createFFmpegCandidate(media))

  // 阶段 7：能力验证 + 评分（同步进行）
  const validated: BackendCandidate[] = []
  for (const candidate of candidates) {
    const score = await validateAndScore(
      candidate, media, intent, capabilities
    )
    if (score !== null) {
      validated.push({ ...candidate, score })
    }
  }
  validated.sort((a, b) => b.score - a.score)

  // 阶段 8：初始化 + 回退循环
  for (const candidate of validated) {
    try {
      const backend = await initialize(candidate, media, capabilities)
      return { backend: candidate, intent, capabilities }
    } catch (error) {
      reportFallback(candidate, error)
      continue  // 原子回退
    }
  }

  throw new EngineError('NO_PLAYBACK_BACKEND', '所有后端初始化失败')
}

function createNativeCandidates(media: MediaDescriptor, container: string): BackendCandidate[] {
  // HTMLVideo 原生——最简路径
  // 前提：容器浏览器原生认识
  if (!containerIsNative(container)) return []
  // 具体组合能否播由阶段 7 的 canPlayType + decodingInfo 回答
  return [{
    id: 'native-htmlvideo',
    kind: 'html-video',
    videoCodec: media.tracks.find(t => t.kind === 'video')?.codec ?? null,
    audioCodec: media.tracks.find(t => t.kind === 'audio')?.codec ?? null,
    renderer: 'native',
    score: 0,  // 阶段 7 填
    reasons: ['硬件解码（浏览器管理）', '系统 HDR', '原生音画同步', 'PiP/投屏'],
    requires: ['container-native', 'codec-native'],
  }]
}

function createMSECandidates(media: MediaDescriptor, caps: CapabilitySnapshot): BackendCandidate[] {
  // MSE — 自己拆容器，重包成 fMP4，浏览器当原生内容播
  // 前提：浏览器支持 MSE 且 codec 能被 SourceBuffer 接受
  // 首阶段仅 Safari，后续扩展到 Chrome/Firefox（流媒体场景）
  if (!caps.mediaSource) return []
  return [{
    id: 'mse-fmp4',
    kind: 'mse',
    videoCodec: media.tracks.find(t => t.kind === 'video')?.codec ?? null,
    audioCodec: media.tracks.find(t => t.kind === 'audio')?.codec ?? null,
    renderer: 'native',
    score: 0,
    reasons: ['容器→fMP4 Remux', '硬件解码', '系统 HDR', '原生音画同步'],
    requires: ['MediaSource', 'SourceBuffer'],
  }]
}
```

## 9. 与现有代码的差距

当前 `packages/types/src/index.ts` 的 `BackendKind` 是三个值：

```ts
export type BackendKind = 'html-video' | 'webcodecs' | 'wasm'
```

**少了 `'mse'`。** 这是有意推迟的——首阶段不实现 MSE 分片管线，所以在阶段 6 跳过 MSE 候选。但类型层面应该预留这个值，避免后续增补时破坏类型兼容。

同样，`packages/strategy/src/index.ts` 只创建了三个候选（native、webcodecs、wasm），MSE 候选的生成逻辑需要在实现 MSE 能力时补充。

`packages/capabilities/src/index.ts` 的 `workerMediaSource` 字段当前硬编码为 `false`——这是正确的（首阶段不实现），但为 MSE 决策做准备时应改为先从 `MediaSource.canConstructInDedicatedWorker` 探测。

**首阶段可落地的改进：** Phase 1 的能力探测应该把 `MediaSource.isTypeSupported()` 也纳入（用于 MSE 候选的验证），即使结果暂时不用。
