# 媒体基础知识

本文档解释播放器涉及的底层概念。`codec-strategy.md` 讲「我们怎么做」，本文档讲「为什么必须这么做」。读完本文应该能自行推导出策略文档里的决策矩阵，而不是记忆表格。

## 1. 容器与 Codec 的分工

**容器是快递箱，Codec 是箱子里的商品。**

箱子外贴着清单：里面有几件商品、分别是什么类型、放在箱子的哪个位置。快递员认识箱子才能拆开；认识商品才知道怎么用。

这两件事**完全独立**：

- 认识箱子但不认识商品 → 能拆开，看到里面有东西，但用不了
- 认识商品但不认识箱子 → 根本打不开，商品是什么无所谓

浏览器就是快递员。它对容器和 Codec 分别有各自的支持列表，**两个列表都命中才能原生播放**。

这解释了一个反直觉的现象：同样的 H.264 视频，装在 MP4 里浏览器能直接播，装在 MKV 里完全播不了。不是 H.264 的问题——是箱子打不开。

## 2. MP4 封装结构

MP4（正式名 ISO Base Media File Format，ISO BMFF）由嵌套的 **box**（早期文档叫 atom）组成。每个 box 的格式是「4 字节长度 + 4 字节类型标识 + 内容」，内容里可以再嵌套 box。

```text
ftyp                     文件类型标识，开头几字节就能认出这是 MP4
moov                     元数据总目录
 ├─ mvhd                 时长、时间刻度
 ├─ trak                 视频轨
 │   └─ mdia
 │       └─ minf
 │           └─ stbl     索引表（关键）
 │               ├─ stsd  Codec 配置，H.264 的 avcC 就在这里
 │               ├─ stts  每帧时长
 │               ├─ stss  哪些帧是关键帧
 │               ├─ stsc  样本到 chunk 的映射
 │               ├─ stsz  每帧字节数
 │               └─ stco  每个 chunk 在文件中的字节偏移
 └─ trak                 音频轨（同样结构）
mdat                     实际音视频数据，一大块二进制
```

### stbl 是完整的全局索引

`stbl`（Sample Table）配合它的子 box，可以精确回答：第 N 帧在文件的第几字节、有多长、时间戳是多少、是不是关键帧。

所以 seek 到 10 分 30 秒的流程是：查 `stts` 找到对应帧号 → 查 `stss` 找到之前最近的关键帧 → 查 `stsz`/`stco` 算出字节偏移 → 发一个 Range 请求直接读那一段。

**这是 MP4 最适合网络播放的原因**：索引完整且集中，一次读取就能建立全局定位能力。

### faststart 问题

`moov` 在文件中的位置不是固定的。很多编码器默认写在 `mdat` **之后**（因为编码完成前不知道最终索引），结果是浏览器必须下载到文件末尾才能开始播放。

把 `moov` 移到 `mdat` 前面的操作叫 **faststart**（FFmpeg 里是 `-movflags +faststart`）。实现 Range Loader 时必须处理这两种布局：先读文件头找 `moov`，找不到就读文件尾。

### fragmented MP4

还有一种变体 **fMP4**，用 `moof`（Movie Fragment）+ `mdat` 的重复片段代替单一大 `mdat`，每个片段自带索引。这是 DASH 和 HLS 分片的常用格式，也是 MSE（Media Source Extensions）要求的格式。

## 3. MKV 封装结构

Matroska 用 **EBML**（Extensible Binary Meta Language）编码，可以理解成二进制版的 XML：每个元素是「ID + 长度 + 内容」，可无限嵌套。

```text
EBML Header              声明这是 Matroska/WebM
Segment                  整个内容的根容器
 ├─ SeekHead             各顶层元素的位置索引（可选）
 ├─ Info                 时长、时间刻度（TimecodeScale）
 ├─ Tracks               轨道声明
 │   └─ TrackEntry       每条轨道：类型、Codec ID、CodecPrivate、语言、名称
 ├─ Cluster              一段时间的数据块，通常几秒
 │   ├─ Timecode         本 Cluster 的时间基准
 │   └─ SimpleBlock      帧数据（含轨道号、相对时间戳、关键帧标记）
 ├─ Cluster
 ├─ Cluster              ……持续排列
 ├─ Cues                 索引表（可选！）
 ├─ Chapters             章节
 ├─ Attachments          附件，可以塞字体文件
 └─ Tags                 元数据标签
```

### Cluster 自包含

每个 Cluster 携带自己的时间基准，内部混合了视频、音频、字幕的帧。这让 MKV 天生适合**流式写入**：录制到一半断电，已经写完的 Cluster 依然可以播放。

MP4 在这方面相反——`moov` 没写完，整个文件就是废的。

### Cues 是可选的

`Cues` 才是 MKV 的 seek 索引。但规范允许没有它，此时只能从当前位置向前扫描 Cluster 来定位。

这直接对应 `execution-plan.md` Phase 2 的要求「解析关键帧索引**或提供可控的前向扫描回退**」。实现时必须两条路都有。

### 轨道类型不受限

MKV 允许任意数量、任意类型的轨道，Codec ID 是开放字符串（`V_MPEGH/ISO/HEVC`、`A_TRUEHD`、`S_HDMV/PGS` 等）。MP4 作为 ISO 标准，轨道类型和 Codec 都需要注册的四字符码（`hvc1`、`mp4a`、`ec-3`）。

## 4. 为什么这个差异决定一切

| 维度 | MP4 | MKV |
|---|---|---|
| 设计目标 | 标准化、可互操作、流式友好 | 什么都能装 |
| 索引 | `stbl` 全局索引，必需 | `Cues` 可选 |
| 断电容错 | 差 | 好 |
| 轨道类型 | 受 ISO 注册约束 | 开放 |
| 附件/章节 | 有限支持 | 完整支持 |
| **浏览器原生解封装** | **三浏览器全支持** | **零支持** |

MKV 的开放性让它成为高质量片源的唯一选择：一个蓝光 REMUX 需要同时装下 HEVC 10-bit HDR 视频、TrueHD Atmos 主音轨、多条 DTS-HD 备选音轨、若干 PGS 位图字幕、章节标记，甚至字幕用的字体文件。MP4 装不下这个组合。

**而没有任何浏览器认识 MKV。**

这两句话合起来构成本项目的核心矛盾：**内容质量越高，越不可能走原生路径。** 这就是 `codec-strategy.md` 7.3 节里 MKV 表格 HTMLVideo 列恒为「淘汰」的根本原因——与 Codec 无关，纯粹是容器问题。

## 5. H.264 / H.265 / H.266 是同一条演进线

这三个是同一系列的三代，由 ITU-T VCEG 与 ISO/IEC MPEG 联合开发。两个组织各有各的命名：

| 代 | ITU-T 名 | ISO/MPEG 名 | 定稿年份 | 相对上代码率节省 |
|---|---|---|---|---|
| 第 1 代 | H.264 | AVC / MPEG-4 Part 10 | 2003 | — |
| 第 2 代 | H.265 | HEVC | 2013 | 约 50% |
| 第 3 代 | H.266 | VVC | 2020 | 再约 50% |

所以 **H.264 = AVC**、**H.265 = HEVC**、**H.266 = VVC**，只是叫法不同。「同画质省 50% 码率」是官方目标值，实际取决于内容和编码参数。

### 主要技术演进

块划分方式是最大差别：

- **H.264** — 固定 16×16 宏块，可细分到 4×4
- **H.265** — 引入 CTU（Coding Tree Unit），最大 64×64，四叉树递归细分。4K/8K 画面中大片相似区域（天空、墙面）可以用一个大块编码，省下大量码率
- **H.266** — CTU 扩大到 128×128，并支持二叉树/三叉树等更灵活的划分

代价是**解码复杂度逐代显著上升**。这就是没有硬件解码时软解 HEVC 会吃力、软解 VVC 基本不可行的原因。

### 专利格局与 AV1

H.264 的专利授权相对集中（MPEG LA 单一专利池）。H.265 则分散在 MPEG LA、Access Advance（原 HEVC Advance）、Velos Media 等多个组织，条款复杂且费用高，导致部分厂商不愿采用。

**Firefox 至今不支持 HEVC 就是这个原因，不是技术做不到。**

这直接催生了 **AV1**：由 AOMedia（Google、Netflix、Amazon、Mozilla、Intel 等）开发，**免版税**，压缩效率与 HEVC 相当或更好。

理解这一点后，浏览器支持表里的「Firefox 支持 AV1 但不支持 HEVC」就不再是随机事实，而是可推导的结论。同理，Safari 支持 HEVC 是因为 Apple 是 HEVC 专利持有方之一，且深度整合了硬件解码。

## 6. SDR 与 HDR 的本质

### 差别是亮度范围

- **SDR**（Standard Dynamic Range）— 按约 100 nits 的参考白设计，源自 CRT 显像管的物理亮度上限
- **HDR**（High Dynamic Range）— 参考到 1000 / 4000 / 10000 nits

实际差别在于**同时呈现明暗细节的能力**。逆光拍人像，SDR 要么人脸死黑、要么天空过曝；HDR 能同时保留两者。

### 为什么 10-bit 是硬性前提

这不是「10-bit 更好」的取舍，是物理必需：

- 8-bit = 每通道 256 个亮度级
- 把亮度范围从 100 nits 拉伸到 1000 nits，仍然只有 256 级可用
- 结果是相邻级之间的跳变变得肉眼可见 → **色带**（banding），在天空、渐变、暗部尤其明显

10-bit = 1024 级，12-bit = 4096 级，才足以平滑铺满 HDR 的亮度范围。

**所以「8-bit HDR」不成立。** 探测到 HDR 标记但位深是 8 时，元数据本身就有问题。

### 三个技术组成

| 组成 | SDR | HDR |
|---|---|---|
| 位深 | 8-bit | **10-bit 或 12-bit** |
| 传输函数 | gamma 2.2 / BT.1886 | **PQ** 或 **HLG** |
| 色域（原色） | BT.709 | **BT.2020** |

**传输函数**（transfer function / EOTF）是数字码值到实际亮度的映射曲线，是真正的分界线：

- **PQ**（Perceptual Quantizer，SMPTE ST 2084）— **绝对**亮度映射。码值 512 对应确定的 nits 值，与显示设备无关。用于流媒体和蓝光。
- **HLG**（Hybrid Log-Gamma，ARIB STD-B67）— **相对**亮度映射。曲线低段兼容传统 gamma，SDR 屏幕收到也能看出大致正确的画面。用于广播电视。

**色域**决定可表现的颜色范围。BT.2020 覆盖的色彩空间显著大于 BT.709，这是 HDR 内容色彩更鲜艳的原因之一（另一个是亮度）。

## 7. 四种 HDR 格式

它们共享上一节的技术基础，**差别只在元数据层**：

| 格式 | 传输函数 | 元数据 | 载体位置 | 授权 |
|---|---|---|---|---|
| **HDR10** | PQ | **静态**：ST 2086 母版显示信息 + CTA-861.3 的 MaxCLL/MaxFALL | 容器级或 SEI | 开放 |
| **HDR10+** | PQ | **动态**：ST 2094-40，逐场景 | SEI 消息 | 需授权 |
| **HLG** | HLG | **无需元数据** | 仅传输函数标记 | 开放 |
| **Dolby Vision** | PQ | **动态**：ST 2094-10 | **RPU** NAL 单元 | 专有授权 |

### 静态与动态元数据的区别

静态元数据描述的是**整部影片**的母版制作环境：制作时用的显示器峰值亮度是多少、最亮像素多少 nits、平均亮度多少。播放器据此做一次全局色调映射。

问题是一部电影可能既有白天沙漠又有夜晚室内，一套参数无法同时照顾两者。

动态元数据为**每个场景**（甚至每帧）提供独立参数，映射效果明显更好。代价是需要授权。

### Dolby Vision 的 Profile 是关键陷阱

Dolby Vision 有多个 Profile，兼容性差别极大：

| Profile | 结构 | 基础层 | 忽略 RPU 的后果 |
|---|---|---|---|
| **5** | 单层 | IPT-PQ-c2 色彩空间 | **画面严重偏色**（发绿/发紫） |
| **7** | 双层：BL + EL + RPU | HDR10 兼容 | 只得到基础层，损失增强层 |
| **8.1** | 单层 | **合规 HDR10** | 正常，仅失去动态元数据 |

Codec 字符串形如 `dvh1.05.06` / `dvhe.05.06`（HEVC 基）、`dav1.10.x`（AV1 基），中间两位即 Profile。

**Profile 5 是最危险的场景：解码成功，但画面是错的。**

普通 HEVC 解码器能正常解出 P5 的码流——它本质上就是 HEVC——但色彩数据在 IPT-PQ-c2 空间中，需要 RPU 里的映射参数才能转回正常色彩。忽略 RPU 直接当 BT.2020 显示，结果就是整体偏色。

这比解码失败更糟：失败会报错，偏色会静默呈现给用户，用户只会觉得「这个播放器画面不对」。

**所以 P5 必须显式识别并拒绝或警告，P8.1 可以安全降级为 HDR10。** 两者处理策略完全相反，而一个 `hdr: boolean` 字段区分不出来——这正是需要扩展 `TrackInfo` 的原因。

### 检测应该用哪个 API

不是 `canPlayType`（它不接受色彩参数），而是 `MediaCapabilities.decodingInfo()`：

```js
await navigator.mediaCapabilities.decodingInfo({
  type: 'file',
  video: {
    contentType: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
    width: 3840, height: 2160,
    bitrate: 25_000_000, framerate: 60,
    transferFunction: 'pq',           // 'srgb' | 'pq' | 'hlg'
    colorGamut: 'rec2020',            // 'srgb' | 'p3' | 'rec2020'
    hdrMetadataType: 'smpteSt2086',   // 'smpteSt2094-10' | 'smpteSt2094-40'
  },
})
```

显示端能力单独查询：

```js
matchMedia('(video-dynamic-range: high)').matches
matchMedia('(color-gamut: rec2020)').matches
```

### 完整的 HDR 链条

```text
片源元数据
    ↓
容器保留元数据
    ↓
解码器输出高位深帧并传出色彩信息
    ↓
浏览器合成器走 HDR 路径
    ↓
操作系统 HDR 模式已开启
    ↓
显示器支持 HDR 且处于 HDR 模式
```

**任何一环断掉，结果都是静默降级为 SDR。**

一个高频问题：Windows 显示设置里的 HDR 开关未打开时，浏览器一律输出 SDR，用户有 HDR 屏也没用。macOS 的 EDR 机制是自动的。这一环完全在播放器代码之外，只能检测并提示用户。

这也解释了为什么只有 HTMLVideo 原生路径能可靠保 HDR：浏览器把解码帧连同色彩元数据直接交给系统合成器，全程不经过 JS。走 WebCodecs 后你拿到的是 `VideoFrame`，色彩信息在其中，但色调映射和 HDR 画布输出的责任转移到了应用侧，而这部分 Web 能力目前有限。

## 8. 声道音频

Phase 5 的自定义输出只把 mono/stereo 作为可靠布局。多声道若无明确矩阵不会猜测 downmix；这避免把 5.1/对象音频错误映射成双声道。PCM 被标准化为 interleaved Float32，实际消费采样数而非 decode/入队时间决定媒体时钟。

**5.1** 表示 5 个全频声道加 1 个低频声道：

```text
     前左          前中          前右
        \           |           /
         \          |          /
          \         |         /
              [   听众位置   ]
          /                   \
         /                     \
    环绕左                     环绕右

  .1 = LFE（低频效果声道），接低音炮
```

`.1` 这个记法的由来：LFE 只传输约 120 Hz 以下的信号，带宽约为全频声道的十分之一，所以记作 0.1 而非 1。

常见布局：

| 布局 | 组成 |
|---|---|
| 2.0 | 立体声左右 |
| 5.1 | 前左/前中/前右/环绕左/环绕右 + LFE |
| 7.1 | 5.1 基础上增加后环绕左/右 |
| 5.1.2 | 5.1 加 2 个天空声道 |
| **7.1.4** | 7.1 加 **4 个天空声道** |

第三位数字是**高度层声道数**。7.1.4 是 Dolby Atmos 家庭影院的典型布局。

## 9. 对象音频与 Dolby Atmos

### 声道音频 vs 对象音频

传统声道音频的信息是「**这段声音送到左后音箱**」——制作时就绑定了具体声道，回放系统的布局必须匹配，否则只能做降混。

对象音频的信息是「**这段声音位于坐标 (x, y, z)**」——回放端根据实际音箱布局实时计算每个音箱该出多少。

好处是同一份内容在 5.1、7.1.4、耳机上都能得到各自最优的渲染结果。

### Atmos 不是 Codec

**Dolby Atmos 是塞在某个 Codec 码流里的对象元数据层**，本身不是编码格式。它必须有载体：

| 载体 | Codec 字符串 | 典型场景 | 承载方式 |
|---|---|---|---|
| **E-AC-3 + JOC** | `ec-3` | 流媒体（Netflix 等） | JOC（Joint Object Coding）从 5.1 核心床重建对象 |
| **Dolby TrueHD + Atmos** | `mlpa` | 蓝光原盘 | MLP 无损编码 + 扩展子流携带对象元数据 |
| **Dolby AC-4 IMS** | `ac-4` | 广播、ATSC 3.0 | 原生对象音频编码 |

所以「支持 Atmos」需要同时满足两件事：**能解码载体 Codec**，**并且能渲染对象**。

DTS:X 是竞品，原理相同，载体是 DTS-HD MA 的扩展。

### Web 平台的现实

**WebCodecs 的 `AudioDecoder` 注册表只包含**：`mp4a.40.*`（AAC）、`flac`、`mp3`、`opus`、`vorbis`、`pcm-*`、`ulaw`、`alaw`。

**没有 `ac-3`、没有 `ec-3`、没有 `mlpa`、没有 `ac-4`。**

这是规范层面的缺失，不是某个浏览器没实现。自定义管线在音频侧对这些格式**无路可走**。

**HTMLVideo 原生路径**是 Web 上唯一可能真正输出 Atmos 的途径：Safari 在 Apple 平台支持 `ec-3`，并能把码流透传给 HDMI/AirPlay 接收端由系统或功放渲染。Edge on Windows 有 AC-3/E-AC-3 解码能力。Chromium 开源构建通常因授权原因不含，Firefox 没有。

**Web Audio 没有对象渲染器。** `PannerNode` 是给合成音源做 3D 空间化的工具，与 Atmos 的对象渲染不是一回事。此外 `AudioContext.destination.maxChannelCount` 受输出设备限制，浏览器默认只给立体声，多声道输出本身就需要额外条件。

## 10. 蓝光原盘与 REMUX

### BDMV 目录结构

蓝光光盘的内容组织：

```text
BDMV/
 ├─ index.bdmv          顶层索引
 ├─ MovieObject.bdmv    导航对象
 ├─ PLAYLIST/
 │   └─ *.mpls          播放列表：定义章节、播放顺序、可选轨道组合
 ├─ STREAM/
 │   └─ *.m2ts          实际音视频数据（MPEG-TS 封装）
 ├─ CLIPINF/
 │   └─ *.clpi          每个 m2ts 的流信息与索引
 └─ AUXDATA/ META/ JAR/ 字体、元数据、BD-J 交互程序
```

真正的媒体数据在 `STREAM/*.m2ts` 里，采用 MPEG-TS 封装。播放列表 `.mpls` 决定播放哪些片段、以什么顺序、默认用哪条音轨。

某些影片会使用「seamless branching」——正片被切成多个 m2ts 片段，由不同 `.mpls` 组合成剧场版/导演剪辑版。这是原盘处理最复杂的部分。

### 三种片源类型

| 类型 | 说明 | 画质音质 | 体积 |
|---|---|---|---|
| **原盘 / BDMV / ISO** | 完整光盘结构，含菜单和 BD-J 交互 | 原始 | 25–100 GB |
| **REMUX** | 把 m2ts 中的流**原样搬进 MKV**，不重新编码 | **与原盘完全一致** | 20–60 GB |
| **Encode** | 重新编码压缩 | 有损失 | 2–20 GB |

**REMUX 是关键概念**：它只做容器转换（demux + remux），不触碰码流本身，所以画质音质与原盘逐比特一致，只是丢掉了菜单和交互功能。

### 为什么 REMUX 一定是 MKV

一个典型的蓝光 REMUX 需要同时装下：

- HEVC 10-bit HDR10（或 Dolby Vision）视频轨
- TrueHD Atmos 主音轨
- 若干条 DTS-HD MA / AC-3 备选语言音轨
- 多条 PGS 位图字幕
- 章节标记
- 有时还有字幕渲染需要的字体附件

**只有 MKV 能装下这个组合。** MP4 的轨道类型受 ISO 注册约束，PGS 字幕、TrueHD、章节和附件的支持都不完整。

这就是高质量片源几乎清一色 MKV 的原因——不是社区偏好，是唯一可行的技术选择。

而这又直接导致了第 4 节的结论：**质量最高的内容，恰好是浏览器最不可能原生播放的内容。**

## 11. FFmpeg 的能力边界

一个常见误解是「有 FFmpeg 就能支持一切格式」。FFmpeg 确实解决了**解码**问题，但播放不只是解码。有五道墙：

### 第一道：解码 ≠ 保真

FFmpeg 解 E-AC-3 Atmos 时，解的是其中的 **5.1 核心床，不重建 JOC 对象**。输出是正常的 5.1 音频，但 **Atmos 已经丢失**。

TrueHD 同理：无损的 7.1 床解出来了，对象元数据没有被渲染。

这不是 FFmpeg 的缺陷——它是解码库，对象渲染属于回放端的职责，需要 Dolby 授权的渲染器。

### 第二道：浏览器没有 bitstream 透传

家用播放器可以把 Atmos 码流**原封不动**送给 AV 功放，由功放完成对象渲染（称为 bitstream passthrough）。

**Web 平台完全没有这个 API。** Web Audio 只接受 PCM 采样点。

所以即使某个解码器能完整解出对象，也没有任何途径把它送到能渲染的设备——除非走 HTMLVideo 原生路径，让操作系统去做透传。

### 第三道：Web Audio 没有对象渲染器

如第 9 节所述，`PannerNode` 不是 Atmos 渲染器，且多声道输出本身受设备和浏览器限制。

### 第四道：软件解码性能

FFmpeg WASM 是纯软件解码。4K HEVC 10-bit 的软解需要相当高的 CPU 吞吐，浏览器单线程 WASM 通常无法维持实时播放。未跨源隔离的页面还用不了多线程。

而硬件解码芯片处理这个场景毫不费力——但只能通过 WebCodecs 或 HTMLVideo 访问，FFmpeg WASM 拿不到。

### 第五道：体积与启动成本

完整 FFmpeg WASM 构建 10–20 MB。用户点开视频要先下载十几 MB 才能开始播放，初始化还需数百毫秒到数秒。

裁剪构建能减小体积，但每减一个组件就少支持一批格式，与「兜底一切」的目标直接冲突。

### 准确定位

**FFmpeg 兜底让内容能播，不保证播得对、播得动、播得快。**

这就是 `codec-strategy.md` 第 6.3 节要求「主流组合落到 FFmpeg 应上报诊断而非静默兜底」的原因——如果 MP4/H.264 走到了 FFmpeg，说明前面的候选选择出了 bug，而用户会付出体积、功耗和性能的全部代价。

## 12. 完整案例推导

现在把前面所有知识串起来，推导一个真实场景。

**片源：MKV 封装 + HEVC 10-bit HDR10 + E-AC-3 Atmos**（典型的流媒体压制或蓝光 REMUX）

### 路径一：HTMLVideo 原生

**直接出局。** 原因在第 4 节：没有浏览器能解封装 MKV。

注意这与 HEVC 无关——即使换成三浏览器都支持的 H.264，MKV 依然打不开。快递员不认识这个箱子，里面装什么都无所谓。

### 路径二：Demux + WebCodecs

**视频侧**：自己解封装 MKV，拿到 HEVC 裸码流，送 `VideoDecoder`。在 Safari 和有硬件 HEVC 的 Chrome 上能硬件解码，性能没问题。

但 HDR 保真需要第 7 节末尾那条完整链路：解码器 → 系统色彩管理 → 显示器。走自定义路径后，你拿到的是 `VideoFrame` 对象，色彩信息确实带着，但色调映射和输出到 HDR 画布的责任转移到了应用侧，而这部分 Web 能力目前有限。

**音频侧**：**完全无路可走。** WebCodecs 的 `AudioDecoder` 不接受 `ec-3`（第 9 节）。

结果：视频能播（HDR 存疑），**音频完全没有声音**。

### 路径三：Demux + WebCodecs 视频 + FFmpeg WASM 音频

视频同上。音频用 FFmpeg WASM 解 E-AC-3。

但根据第 11 节第一道墙：FFmpeg 只解核心床，**Atmos 对象丢失**。就算它能解出对象，第二道墙（浏览器无透传）和第三道墙（Web Audio 无对象渲染器）也让对象无处可去。

结果：能播，**HDR 大概率降为 SDR，Atmos 必然降为 5.1**。

### 三条路的汇总

| 路径 | 视频 | 音频 |
|---|---|---|
| HTMLVideo 原生 | **不可能**（容器） | 不可能 |
| Demux + WebCodecs | 硬解可行，HDR 需自建管线 | **无解** |
| Demux + WebCodecs + FFmpeg | 同上 | 能播，**降混 5.1** |

**没有任何一条路能同时保住 HDR 和 Atmos。**

### 同样的内容换个容器

**MP4 封装 + HEVC HDR10 + E-AC-3 Atmos，在 Safari 上播放：**

```text
容器 MP4        → 浏览器认识，直接解封装
HEVC            → Safari 原生硬件解码
HDR10           → 元数据直通系统色彩管理 → 显示器 HDR
ec-3 + Atmos    → Safari 原生解码，系统透传给 HDMI/AirPlay
```

**全部保真。**

### 结论

**容器决定保真度天花板，而不是 Codec。**

完全相同的视频码流和音频码流，装在 MP4 里能在 Safari 上全保，装在 MKV 里三条路都保不住。

这就是 `codec-strategy.md` 第 7 节按**容器分组**而不是按 Codec 分组的原因，也是 7.3 节 MKV 表格里 HTMLVideo 列恒为「淘汰」的推导过程。

也正因如此，播放器 UI 上不应该提供「开启 HDR」「开启杜比全景声」这类开关——它们不是开关，是一整条能力链的结果。正确做法是**如实显示当前保真度状态**（`HDR10 · 原生路径 · 已保真` / `Dolby Atmos · 已降混为 5.1`），并在用户选择会导致降级的操作（如对 HDR 内容启用滤镜）时明确告知代价。

## 13. VideoFrame presentation fundamentals

A decoded `VideoFrame` is a scarce platform resource, not a reusable JavaScript value. Queue ownership belongs to the decoder pipeline; a successful `readVideoFrame()` transfers ownership to its caller. Passing that object to a renderer transfers temporary ownership again, and the renderer closes it after upload/draw. Scheduler drops, stale epochs, invalid frames and late frames must also close exactly once. Reusing or broadcasting the same frame creates double-close or use-after-close behavior, so ordinary events contain counters only.

Display dimensions and coded dimensions are different concepts. Crop must remain inside the selected frame bounds; output CSS size is multiplied by DPR to produce the backing canvas size. The engine accepts only positive safe integers, 0/90/180/270 rotation and a bounded DPR, then caps both canvas and texture dimensions. `contain` preserves the whole frame with unused canvas area, `cover` fills while clipping, and `fill` may change aspect ratio.

Color metadata is descriptive, not proof of end-to-end display fidelity. BT.709/sRGB and full/limited range can be reported directly from `VideoFrame.colorSpace`. BT.2020 primaries do not by themselves prove HDR; PQ or HLG transfer metadata and a confirmed high-precision texture/canvas/display path are also required. WebGL2 or Canvas2D drawing can remain watchable while honestly reporting `hdrPreserved=false`. The renderer does not use pixel readback to infer color because full-frame GPU-to-CPU copies are slow, privacy-sensitive and unnecessary for presentation.

The presentation time is chosen before drawing. With audio, the number of samples actually consumed by AudioWorklet maps AudioContext time to media time. Without audio, the media wall clock provides the same pause/resume/seek/rate mapping. rAF is only a wake-up mechanism; it is not the media clock. This is why increasing decode concurrency cannot implement playback rate and why an early frame waits while a sufficiently late frame is closed as a drop.
