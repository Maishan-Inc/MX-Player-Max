# Codec、容器与解码器策略

## 1. 核心原则：没有单一 Codec 优先级

容器决定如何读取和解封装，Codec 决定如何解码。MKV、MP4、WebM 不能直接当作 Codec 名称传入解码器。

**不存在"H.264 的全局优先级"这种东西。** 同一个 H.264 视频，装在 MP4 里可以让 HTMLVideo 直接播放，装在 MKV 里必须先解封装再送 WebCodecs。真正的优先级由四元组决定：

```text
容器格式 + Codec 配置 + 播放意图 + 当前浏览器能力
                    ↓
              候选后端集合
                    ↓
                  评分
                    ↓
              最终解码路径
```

决策顺序：

```text
文件后缀 / MIME
      ↓ 只作为初始猜测，不作为结论
读取文件头 magic bytes 探测真实容器
      ↓
Demuxer 解析轨道，输出 Codec ID、profile、level、bit depth、色彩信息
      ↓
生成候选后端（HTMLVideo / WebCodecs / 专用 WASM / FFmpeg WASM）
      ↓
canPlayType + decodingInfo + isConfigSupported 逐个验证
      ↓
按硬件解码、功耗、拷贝次数、启动时间、逐帧需求评分
      ↓
初始化最高分后端，失败则原子回退下一候选
```

文件后缀只是提示，绝不能作为判断依据。`.mkv` 后缀的文件可能实际是 WebM，`.mp4` 可能实际是 MOV 变体。必须读文件头确认。

## 2. 容器与文件后缀映射

| 容器 | 常见后缀 | 浏览器原生解封装 | 首阶段支持 |
|---|---|---|---|
| MP4 / ISO BMFF | `.mp4` `.m4v` `.m4a` | 三浏览器全部支持 | 原生 + 自定义双路径 |
| WebM | `.webm` | Chrome / Firefox 支持，Safari 部分 | 原生 + 自定义双路径 |
| Matroska | `.mkv` `.mka` | **全部不支持** | 仅自定义路径 |
| QuickTime | `.mov` `.qt` | Safari 支持，Chrome/Firefox 视 Codec | 自定义路径为主 |
| MPEG-TS | `.ts` `.m2ts` `.mts` | **全部不支持** | 仅自定义路径 |
| AVI | `.avi` | **全部不支持** | 仅自定义路径 |
| FLV | `.flv` `.f4v` | **全部不支持** | 仅自定义路径 |
| ASF / WMV | `.wmv` `.asf` | **全部不支持** | 仅自定义路径 |
| Ogg | `.ogv` `.ogg` | Chrome / Firefox 支持 | 原生 + 自定义 |
| HLS 播放列表 | `.m3u8` | 仅 Safari 原生 | 见第 3.4 节 |

**关键区别：** 前四列的"浏览器原生解封装"决定了能否走 HTMLVideo 直接播放。容器不被原生支持时，无论 Codec 多么主流，都必须先经过 Demuxer Worker。

首阶段容器实现优先级：MP4、WebM、Matroska/MKV。MPEG-TS、AVI、FLV、MOV 特殊变体作为独立容器插件接入。

## 3. HTMLVideo 直接播放路径

### 3.1 成立条件

HTMLVideo 直接播放要求**同时**满足三个条件：

1. 容器被浏览器原生解封装（MP4 / WebM / Ogg，Safari 额外支持 MOV）。
2. 视频 Codec 被浏览器原生解码。
3. 音频 Codec 被浏览器原生解码。

任何一条不满足，整个原生路径淘汰，进入自定义管线。这不是降级，是必然选择——HTMLVideo 无法只解码视频而把音频交给别人。

### 3.2 为什么普通播放优先 HTMLVideo

| 能力 | HTMLVideo | 自定义管线 |
|---|---|---|
| 硬件解码 | 系统级，包含专用解码芯片 | 依赖 WebCodecs 是否命中硬件 |
| 功耗 | 最低，浏览器有整条省电路径 | 多一次 GPU 上传与合成 |
| HDR | 系统色彩管理直通显示器 | 需要自建色彩管线 |
| 音画同步 | 浏览器内部时钟，零漂移 | 需要 AudioContext 主时钟 + epoch |
| 内存 | 浏览器内部管理 | 需要自建帧队列与背压 |
| 画中画 / 投屏 / AirPlay | 原生支持 | 不可用 |
| 逐帧访问 | **不可用** | 可用 |
| 滤镜 / AI 处理 | **不可用** | 可用 |

普通观看场景下 HTMLVideo 全面占优。只有需要逐帧、滤镜、编辑或 WebGPU 处理时才值得放弃这些优势。

### 3.3 各容器的原生可播放组合

**MP4 直接播放（`.mp4` / `.m4v`）**

| 视频 Codec | 音频 Codec | Chrome | Firefox | Safari |
|---|---|---|---|---|
| H.264 (avc1) | AAC | 直接播放 | 直接播放 | 直接播放 |
| H.264 (avc1) | MP3 | 直接播放 | 直接播放 | 直接播放 |
| H.265 (hvc1/hev1) | AAC | 硬件支持时可播放 | 不支持 | 直接播放 |
| AV1 (av01) | AAC / Opus | 直接播放 | 直接播放 | Apple Silicon + 新版本 |
| VP9 (vp09) | Opus | 直接播放 | 直接播放 | 部分版本 |
| MPEG-4 Part 2 (DivX/Xvid) | MP3 | 不支持 | 不支持 | 不支持 |

MP4 + H.264 + AAC 是唯一在三浏览器全部可靠直接播放的组合，是原生路径的基准场景。

**WebM 直接播放（`.webm`）**

| 视频 Codec | 音频 Codec | Chrome | Firefox | Safari |
|---|---|---|---|---|
| VP8 | Vorbis / Opus | 直接播放 | 直接播放 | 不支持 |
| VP9 | Opus / Vorbis | 直接播放 | 直接播放 | 部分版本 |
| AV1 | Opus | 直接播放 | 直接播放 | 部分版本 |

**Ogg 直接播放（`.ogv` / `.ogg`）**

Theora + Vorbis 在 Chrome / Firefox 可直接播放，Safari 不支持。这是低优先级的历史格式。

### 3.4 M3U8 / HLS 的特殊性

`.m3u8` 不是媒体容器，是文本播放列表，指向一组 MPEG-TS 或 fMP4 分片。它的处理与文件型媒体完全不同：

- **Safari**：原生支持。`canPlayType('application/vnd.apple.mpegurl')` 返回非空时，直接把 `.m3u8` URL 交给 HTMLVideo，浏览器自己拉分片、解封装、解码、切码率。这是 Safari 上功耗与稳定性最优的路径。
- **Chrome / Firefox**：不原生支持。必须由 JS 拉取播放列表、拉分片、解封装，再通过 MSE 喂给 HTMLVideo，或通过 WebCodecs 自定义解码。

首阶段范围限定在文件型媒体（本地 `File`、支持 CORS/Range 的远程 URL）。HLS 只保留接口与 Safari 原生能力探测（`packages/platform/src/index.ts` 中的 `nativeHls` 检测已实现），不实现分片管线。

## 4. WebCodecs 解码路径

### 4.1 何时使用

三种情况必须走 WebCodecs：

1. **容器不被浏览器原生支持** — MKV、TS、FLV、AVI 中的主流 Codec。Demuxer 拆出裸码流后，WebCodecs 仍能硬件解码。
2. **需要逐帧访问** — 滤镜、AI、编辑器、WebGPU 处理。
3. **需要精确控制解码时序** — 自定义 seek 策略、帧级缓存。

WebCodecs 的价值在于：**绕过容器限制，但保留硬件解码。** 这是 MKV 播放的最优路径——不需要软件解码，只是浏览器不认识 Matroska 封装而已。

### 4.2 数据流

```text
Range Loader → Demux Worker → EncodedVideoChunk
                                    ↓
                          VideoDecoder（硬件优先）
                                    ↓
                              VideoFrame
                                    ↓
                      WebGPU / WebGL2 / Canvas2D 渲染
```

### 4.3 浏览器 WebCodecs 视频解码支持

| Codec | 配置字符串示例 | Chrome | Firefox | Safari |
|---|---|---|---|---|
| H.264 / AVC | `avc1.640028` | 支持，硬件优先 | 支持 | 支持 |
| H.265 / HEVC | `hvc1.1.6.L93.B0` | 系统有硬件解码时支持 | 不支持 | 支持 |
| VP8 | `vp8` | 支持 | 支持 | 有限 |
| VP9 | `vp09.00.10.08` | 支持 | 支持 | 有限 |
| AV1 | `av01.0.04M.08` | 支持 | 逐步支持 | 硬件机型支持 |
| MPEG-2 | — | 不支持 | 不支持 | 不支持 |
| VC-1 / WMV | — | 不支持 | 不支持 | 不支持 |
| MPEG-4 Part 2 | — | 不支持 | 不支持 | 不支持 |

**强制规则：** 绝不能只判断 `typeof VideoDecoder !== 'undefined'`。必须对**具体配置**调用 `VideoDecoder.isConfigSupported()`，因为同一浏览器对 H.264 Baseline 和 H.264 High 10 Profile 的支持可能不同。当前 `packages/capabilities/src/index.ts` 只检测了构造函数存在（`webCodecsVideo` 字段），配置级验证必须在 Phase 1 补齐。

### 4.4 码流格式转换

Demuxer 输出必须转换成 WebCodecs 期望的格式：

- **H.264**：MP4 中是 avcC（长度前缀），MPEG-TS 中是 Annex-B（起始码）。`VideoDecoder` 的 `description` 字段传 avcC 时用 `avc1`，不传时用 `avc3` + Annex-B。混淆会直接导致解码失败。
- **H.265**：同理区分 hvcC 与 Annex-B，对应 `hvc1` / `hev1`。
- **AV1**：需要传递 sequence header OBU 作为 `description`。
- **VP9**：通常不需要额外 description，但 profile 2（10-bit）必须在配置字符串中正确声明。

## 5. WASM 专用解码器路径

### 5.1 定位

专用 WASM 解码器不是"更好的选择"，是**WebCodecs 不可用时的补位**。它是纯软件解码，CPU 占用与功耗都显著高于硬件路径。

选择专用 WASM 的条件：

1. WebCodecs 不支持该 Codec 配置（`isConfigSupported` 返回 false）。
2. WebCodecs 初始化失败或解码中途报错。
3. 需要跨浏览器一致的解码行为（编辑器场景，帧精确性优先于性能）。

### 5.2 各解码器职责

| 解码器 | 负责 Codec | 使用场景 | 参考体积（SIMD 单线程） |
|---|---|---|---|
| OpenH264 | H.264 / AVC | WebCodecs 不支持特定 profile，或需一致行为 | 约 200–400 KB |
| libde265 | H.265 / HEVC | Firefox 全场景、Chrome 无硬件 HEVC 时 | 约 400–700 KB |
| dav1d | AV1 | 旧版浏览器无 AV1 WebCodecs 支持时 | 约 300–600 KB |
| libvpx | VP8 / VP9 | Safari 缺 VP8/VP9 支持时 | 约 500–900 KB |
| VVdeC | H.266 / VVC | 唯一可用路径，无任何浏览器原生支持 | 约 1–2 MB |

体积为量级参考，实际以构建产物 manifest 中的真实值为准。

### 5.3 优先于 FFmpeg 的原因

| 维度 | 专用解码器 | FFmpeg WASM |
|---|---|---|
| 体积 | 单 Codec 200 KB – 2 MB | 完整构建 10–20 MB |
| 初始化 | 快 | 慢，需实例化整个框架 |
| 优化程度 | 针对单 Codec 深度优化（dav1d 尤其突出） | 通用实现 |
| 许可证 | 逐个明确（OpenH264 有专利池覆盖条款） | LGPL/GPL 组件需逐项审查 |
| 可裁剪性 | 天然最小 | 需要精细 configure 裁剪 |

按需只下载当前文件真正需要的那一个解码器，是控制启动时间与流量的关键。

### 5.4 线程与 SIMD

WASM 变体选择在**选定 WASM 后端之后**才发生，不在策略评分阶段加载任何二进制：

```text
选定 WASM 后端
      ↓
检测 crossOriginIsolated / SharedArrayBuffer / WASM Threads / SIMD
      ↓
threaded（跨源隔离 + 多核）→ simd（有 SIMD 无隔离）→ single（兜底）
      ↓
threaded 初始化失败 → 自动回退 simd → 再失败回退 single
```

未跨源隔离的页面不下载多线程产物。回退必须是自动的，不能让播放整体失败。

## 6. FFmpeg WASM 最终兜底

### 6.1 使用条件

FFmpeg 是**最后候选**，只在以下情况加载：

1. Codec 没有专用 WASM 解码器 — MPEG-2、MPEG-4 Part 2（DivX/Xvid）、VC-1、WMV、RealVideo、Indeo、Cinepak、ProRes、DNxHD 等。
2. 容器没有独立 Demuxer 实现 — 冷门 AVI 变体、RealMedia、NUT 等。
3. 音频侧冷门格式 — AC-3、E-AC-3、DTS、TrueHD、WMA、RealAudio、APE、TAK。

### 6.2 代价

- 体积 10–20 MB，即使裁剪后仍远超专用解码器。
- 初始化耗时可达数百毫秒到数秒。
- 多线程需要跨源隔离，未隔离时单线程性能对高分辨率片源可能不足。
- 许可证复杂，GPL 组件会传染整个分发包。

### 6.3 规则

FFmpeg 不进入任何主流格式的正常候选链。MP4/H.264、MKV/H.265、WebM/VP9 这类主流组合，如果落到 FFmpeg，说明前面的候选选择或能力探测出了问题，应当上报诊断而非静默兜底。

裁剪构建必须只包含目标 Codec 与 Demuxer，明确标记 LGPL 与 GPL 边界，禁止把未审查的 GPL 构建发布到公共 CDN。

## 7. 完整决策矩阵

标记含义：**首选** = 该场景最优路径；**可用** = 条件满足时可选；**必需** = 唯一可行路径；**淘汰** = 不可用。

### 7.1 MP4 / M4V

| 视频 Codec | 音频 Codec | HTMLVideo | Demux + WebCodecs | 专用 WASM | FFmpeg |
|---|---|---|---|---|---|
| H.264 | AAC / MP3 | **首选**（三浏览器） | 可用（逐帧需求） | OpenH264 | 淘汰 |
| H.265 | AAC | **首选**（Safari；Chrome 有硬件时） | 可用（Chrome 有硬件） | libde265（Firefox **必需**） | 淘汰 |
| AV1 | AAC / Opus | **首选**（Chrome/Firefox） | 可用 | dav1d | 淘汰 |
| VP9 | Opus / AAC | **首选**（Chrome/Firefox） | 可用 | libvpx | 淘汰 |
| MPEG-4 Part 2 | MP3 | 淘汰 | 淘汰 | 无 | **必需** |
| ProRes | PCM | 淘汰 | 淘汰 | 无 | **必需** |

### 7.2 WebM

| 视频 Codec | 音频 Codec | HTMLVideo | Demux + WebCodecs | 专用 WASM | FFmpeg |
|---|---|---|---|---|---|
| VP8 | Vorbis / Opus | **首选**（Chrome/Firefox） | 可用 | libvpx（Safari **必需**） | 淘汰 |
| VP9 | Opus / Vorbis | **首选**（Chrome/Firefox） | 可用 | libvpx | 淘汰 |
| AV1 | Opus | **首选**（Chrome/Firefox） | 可用 | dav1d | 淘汰 |

### 7.3 Matroska / MKV — 全部需要 Demuxer

MKV 不被任何浏览器原生解封装，HTMLVideo 列**恒为淘汰**。这是 MKV 与 MP4 的根本区别。

| 视频 Codec | 音频 Codec | HTMLVideo | Demux + WebCodecs | 专用 WASM | FFmpeg |
|---|---|---|---|---|---|
| H.264 | AAC / AC-3 / DTS | 淘汰 | **首选**（三浏览器） | OpenH264 | 音频冷门时兜底 |
| H.265 | AAC / AC-3 / DTS | 淘汰 | **首选**（Safari；Chrome 有硬件） | libde265（Firefox **必需**） | 音频冷门时兜底 |
| AV1 | Opus / AAC | 淘汰 | **首选**（Chrome/Firefox） | dav1d | 淘汰 |
| VP9 | Opus / Vorbis | 淘汰 | **首选** | libvpx | 淘汰 |
| VC-1 / WMV | 任意 | 淘汰 | 淘汰 | 无 | **必需** |
| RealVideo | RealAudio | 淘汰 | 淘汰 | 无 | **必需** |

MKV 常见的 AC-3 / E-AC-3 / DTS / TrueHD 音轨没有浏览器原生或 WebCodecs 支持，视频走 WebCodecs 硬件解码、音频走 FFmpeg WASM 的混合路径是正常且预期的组合。

### 7.4 MPEG-TS / M2TS

| 视频 Codec | 音频 Codec | HTMLVideo | Demux + WebCodecs | 专用 WASM | FFmpeg |
|---|---|---|---|---|---|
| H.264 (Annex-B) | AAC / AC-3 | 淘汰 | **首选** | OpenH264 | 音频兜底 |
| H.265 (Annex-B) | AAC / AC-3 | 淘汰 | 可用 | libde265 | 音频兜底 |
| MPEG-2 | MP2 / AC-3 | 淘汰 | 淘汰 | 无 | **必需** |

TS 的 H.264/H.265 是 Annex-B 起始码格式，送入 WebCodecs 前必须完成格式转换（见 4.4）。

### 7.5 其他容器

| 容器 | 典型 Codec | 路径 |
|---|---|---|
| MOV | H.264 / AAC | Safari 可原生；其他浏览器 Demux + WebCodecs |
| MOV | ProRes / DNxHD | FFmpeg **必需** |
| FLV | H.264 / AAC | Demux + WebCodecs **首选** |
| AVI | DivX / Xvid / MJPEG | FFmpeg **必需** |
| ASF / WMV | VC-1 / WMA | FFmpeg **必需** |

## 8. HDR 与色深

### 8.1 需要识别的信息

Demuxer 与 Codec 配置解析必须输出：

- **位深** — 8 / 10 / 12 bit。`TrackInfo.bitDepth` 字段已存在于 `packages/types/src/index.ts`。
- **色彩原色 / 传输特性 / 矩阵系数** — BT.709、BT.2020、PQ (SMPTE ST 2084)、HLG。
- **HDR 类型** — HDR10（静态 ST 2086 元数据）、HDR10+（动态元数据）、HLG、Dolby Vision（profile 5 / 8.1 等）。

当前 `TrackInfo` 只有 `hdr?: boolean` 与 `colorSpace?: string`，无法区分 HDR10 / HLG / Dolby Vision，也无法承载 ST 2086 元数据。Phase 1 应扩展为结构化色彩描述。

### 8.2 各路径的 HDR 能力

| 路径 | HDR 保真度 |
|---|---|
| HTMLVideo 原生 | 完整。浏览器直通系统色彩管理与显示器，HDR10 / HLG / Dolby Vision 由平台处理 |
| WebCodecs + WebGPU | 需自建色彩管线。`VideoFrame` 携带色彩空间信息，但 tone mapping 与显示器输出需自行处理 |
| WASM 软件解码 | 输出高位深像素，色彩管线完全自建 |

### 8.3 首阶段策略

1. 探测并如实记录 HDR 与位深信息。
2. HDR 内容在普通播放意图下**强烈优先** HTMLVideo 原生路径，这是唯一能保证端到端 HDR 保真的路径。
3. HDR 内容被迫走自定义路径（如 MKV 封装的 HEVC HDR）时，明确降级为 SDR 并上报诊断事件，**不得声称保留了 HDR**。
4. 10-bit / 12-bit 内容在自定义渲染器中需要 16-bit 浮点纹理支持；WebGL2 无相应扩展时降级为 8-bit 并记录。

## 9. 编码能力

**首阶段不实现编码。** 项目定位是解码与播放引擎，不是转码器。

明确边界：

- 不提供 `VideoEncoder` / `AudioEncoder` 封装。
- 不提供转码、导出、录制 API。
- 不在 WASM 构建中包含编码器（FFmpeg 裁剪时禁用所有 encoder，可显著减小体积）。

自定义管线输出的 `VideoFrame` 与 `AudioData` 是标准 WebCodecs 对象，外部消费者可以自行接入 `VideoEncoder`、`MediaRecorder` 或 WebRTC。引擎提供帧数据，不提供编码实现。

需要注意的是，"编码"一词在媒体语境中有两个含义，本项目只处理后者：

- **Encoding（编码操作）** — 把原始帧压缩成码流。不在范围内。
- **Codec / Encoding format（编码格式）** — H.264、AV1 等压缩格式。这是本文档全部内容所讨论的对象。

## 10. 解码器插件契约

每个解码器插件必须声明：

- Codec ID、支持的 profile 与 level 范围。
- 接受的配置格式（avcC / hvcC / Annex-B / OBU sequence header）。
- 支持的容器私有数据格式。
- 输出像素格式、色彩空间、位深支持范围。
- 输出时间戳单位（统一微秒整数）。
- 提供的变体（single / simd / threaded）。
- 内存上限与初始化成本量级。
- 许可证、专利与发行限制。

契约由 `packages/decoder-wasm/src/index.ts` 的 `WasmDecoderManifest` 承载，当前已有 codec / version / variants / sha256 / license 字段，profile 范围与色彩能力字段需补充。

## 11. WASM 构建矩阵

```text
codec/
  single/decoder.wasm
  simd/decoder.wasm
  threaded/decoder.wasm
  manifest.json
```

对外只有一个 SDK 版本。运行时先选择 Codec 插件，再选择 `threaded`、`simd` 或 `single`。不支持多线程时只下载单线程产物，不同变体不并行下载。

manifest 必须记录每个变体的真实体积与 SHA-256，运行时下载后校验哈希，失败则停止加载该变体并尝试安全回退。

## 12. 许可证与供应链

每个二进制必须有 `NOTICE`、上游 commit、编译器版本、编译参数和许可证清单。

需要单独评估的项：

- **OpenH264** — Cisco BSD 许可，但 H.264 专利费由 Cisco 承担的条款仅适用于其官方分发的二进制。自行编译的产物不自动继承该覆盖。
- **libde265** — LGPL/GPL 双许可，HEVC 专利池（Access Advance、Via LA）独立于软件许可证。
- **VVdeC** — Fraunhofer 自有许可，VVC 专利状况需独立评估。
- **dav1d** — BSD-2，AV1 由 AOMedia 专利池覆盖，风险相对最低。
- **libvpx** — BSD，风险低。
- **FFmpeg** — 必须明确区分 LGPL 与 GPL 组件。启用 `--enable-gpl` 会使整个分发包受 GPL 约束。
- **ProRes 解码** — FFmpeg 中为逆向实现，商业分发需评估 Apple 相关权利。

未完成许可证与专利审查的二进制不得发布到 npm 或公共 CDN。
