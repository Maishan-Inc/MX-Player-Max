# Phase 2 Range Loader 与容器抽象设计

日期：2026-08-07

## 1. 目标

Phase 2 在不构造真实解码器、不调用 WebCodecs、不加载 WASM 的前提下，建立从本地 `File` 或支持 CORS/HTTP Range 的远程文件到结构化容器数据的稳定边界：

```text
SourceDescriptor
        ↓
RangeLoader
        ↓
ContainerAdapter
        ↓
MediaDescriptor + DemuxPacket
        ↓
Phase 3 NativeMediaPipeline / Phase 4 CustomMediaPipeline
```

本阶段实现 MP4、Matroska 和 WebM 的容器识别、基础轨道元数据、按需 packet 读取、时间戳、关键帧信息和 seek 基础。HLS、DASH、MSE、解码、渲染、WASM 与字幕内容解析不在范围内。

## 2. 方案选择

采用原生 TypeScript 增量解析器，并共享受限 Range Reader、EBML 原语和 ISO BMFF box reader。

未采用第三方 MP4/EBML 解析库，原因是 Phase 2 需要统一控制 Range 行为、Worker 生命周期、错误码、内存预算和输入边界。未采用只实现 Probe 的简化方案，因为它不能满足 `DemuxPacket`、关键帧和 seek 的退出条件。

## 3. 包边界与目录

`@mx-player-max/types` 只保存可序列化或跨包共享的数据契约，不包含读取、网络或平台逻辑。

`@mx-player-max/demux` 保存 Range Loader、容器适配器、Demuxer、Worker 控制器及其实现：

```text
packages/demux/src/
  index.ts
  range/
    types.ts
    errors.ts
    validation.ts
    scheduler.ts
    cache.ts
    file-loader.ts
    http-loader.ts
  containers/
    limits.ts
    bounded-reader.ts
    registry.ts
    ebml/
      ids.ts
      reader.ts
      blocks.ts
      matroska-adapter.ts
      webm-adapter.ts
    mp4/
      boxes.ts
      sample-table.ts
      mp4-adapter.ts
  worker/
    protocol.ts
    controller.ts
    entry.ts
```

包之间只通过公共入口导入。Worker 入口只使用 `@mx-player-max/demux` 公共导出和结构化克隆可传递的消息。

包清单增加 `./worker` 子路径导出，使 bundler 可以用稳定 URL 创建模块 Worker；默认 `.` 入口仍导出协议、控制器和非 Worker 环境可测试的工厂，不在导入包时自动创建线程。

## 4. 公共类型

Phase 1 的 `Micros`、`SourceDescriptor`、`TrackInfo`、`MediaDescriptor`、`CapabilitySnapshot` 和 `MediaCapabilityReport` 保持现有语义。Phase 2 在 `packages/types/src/index.ts` 增加：

```ts
export interface ByteRange {
  /** Inclusive byte offset from the start of the source. */
  start: number
  /** Exclusive byte offset from the start of the source. */
  endExclusive: number
}

export interface RangeReadResult {
  data: Uint8Array
  /** Total source length in bytes, or null when the server reports `*`. */
  sourceLength: number | null
  contentRange: string | null
  etag: string | null
}

export interface RetryPolicy {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

export interface RangeCacheKey {
  sourceKey: string
  range: ByteRange
  etag: string | null
}

export interface RangeCache {
  get(key: RangeCacheKey): RangeReadResult | null
  set(key: RangeCacheKey, value: RangeReadResult): void
  deleteSource(sourceKey: string): void
  clear(): void
}

export interface RangeLoaderOptions {
  signal?: AbortSignal
  retry?: RetryPolicy
  cache?: RangeCache
}

export interface DemuxPacket {
  trackId: number
  kind: 'video' | 'audio' | 'subtitle'
  /** Presentation timestamp in integer microseconds. */
  timestamp: Micros
  /** Packet duration in integer microseconds, or null when absent. */
  duration: Micros | null
  keyframe: boolean
  data: Uint8Array
}
```

`DemuxPacket.duration` 使用 `Micros | null`，因为 Matroska Block 不保证携带可推导的 duration。实现不得使用负数或猜测帧率伪造未知时长。

`@mx-player-max/demux` 公共入口导出行为接口：

```ts
export interface RangeLoader {
  read(range: ByteRange, options?: RangeLoaderOptions): Promise<RangeReadResult>
  close(): void
}

export interface ContainerAdapter {
  readonly id: string
  readonly name: string
  canProbe(header: Uint8Array): boolean
  probe(reader: RangeLoader): Promise<ContainerProbeResult>
  createDemuxer(reader: RangeLoader, metadata: ContainerProbeResult): Demuxer
}

export interface ContainerProbeResult {
  container: string
  media: MediaDescriptor
  tracks: TrackInfo[]
  duration: Micros | null
  size: number | null
  hasSeekIndex: boolean
}

export interface Demuxer {
  probe(): Promise<MediaDescriptor>
  next(): Promise<DemuxPacket[]>
  seek(time: Micros): Promise<void>
  close(): void
}
```

类构造器接收 Loader 级默认选项；单次 `read` 选项可提供更短生命周期的取消信号或覆盖重试/缓存策略。

## 5. 错误模型

`DemuxError` 扩展 `Error`，公开 `code`、`recoverable` 和只包含安全标量的 `context`。`cause` 可以保留给调用方，但不会序列化响应正文、完整 URL 或查询参数。

Phase 2 至少增加以下稳定错误码：

- `RANGE_INVALID`
- `RANGE_UNSUPPORTED`
- `RANGE_CONTENT_RANGE_INVALID`
- `RANGE_RESPONSE_LENGTH_MISMATCH`
- `RANGE_CORS_FAILED`
- `RANGE_NETWORK_FAILED`
- `RANGE_ABORTED`
- `RANGE_RETRY_EXHAUSTED`
- `RANGE_CLOSED`
- `RANGE_REDIRECTED`
- `RANGE_HEADER_INVALID`
- `RANGE_HTTP_STATUS`
- `RANGE_SOURCE_CHANGED`
- `CONTAINER_UNSUPPORTED`
- `CONTAINER_TRUNCATED`
- `CONTAINER_INVALID`
- `CONTAINER_LIMIT_EXCEEDED`

截断、非法结构和资源超限保持不同错误码。错误上下文可以包含范围、状态码、容器 ID 和 box/element ID，但远程源只暴露 origin、路径 basename 或不可逆 source key，不包含查询参数。

## 6. Range Loader

### 6.1 通用校验与调度

所有范围必须满足：`start` 和 `endExclusive` 均为有限、安全、非负整数，且 `start < endExclusive`。任何加法先验证不会超过 `Number.MAX_SAFE_INTEGER`。

共享 FIFO 调度器提供有界并发。排队任务和活动任务都绑定 Loader 内部 `AbortController`。`close()` 是幂等操作，并执行以下步骤：

1. 标记关闭，拒绝新读取。
2. 中止活动任务和重试等待。
3. 以稳定错误结束排队任务。
4. 清理 Loader 持有的 source cache 引用。
5. 阻止已完成异步回调发布结果。

取消后不再启动下一次重试。重试仅覆盖 fetch 瞬态失败和 HTTP `500-599`；协议错误、4xx、取消和容器错误不重试。退避时间受 `RetryPolicy.maxDelayMs` 限制，所有 timer 都在完成或关闭时清理。

### 6.2 FileRangeLoader

File Loader 以 `File.size` 校验上界，并只调用 `file.slice(start, endExclusive).arrayBuffer()`。它不会读取或复制范围之外的数据。

成功结果中 `sourceLength = file.size`、`contentRange = null`、`etag = null`。如果范围超过 `File.size`，返回 `RANGE_INVALID`。调用方取消或 Loader 关闭时，即使底层 `Blob.arrayBuffer()` 无法真正停止，其结果也会被丢弃且 Promise 以稳定错误结束。

本地文件缓存身份使用运行时 `WeakMap<File, string>` 分配的对象 ID，并附加 size 与 lastModified。名称不作为唯一身份，等名文件不会共享缓存。

### 6.3 HttpRangeLoader

HTTP Loader 只接受可解析的 `http:` 和 `https:` URL。HTTPS 是文档和示例默认值；允许显式 HTTP 以支持本地开发和调用方明确选择的环境。

调用方 header 名和值必须可由 `Headers` 安全构造。Loader 拒绝调用方设置 `Range`、`Content-Length`、`If-Range`、`Host` 和其他由 Loader 控制或浏览器禁止的 header。实际请求固定使用：

```text
GET
Range: bytes=<start>-<endExclusive - 1>
credentials: omit
redirect: manual
```

只接受 `206 Partial Content`。`200 OK` 返回 `RANGE_UNSUPPORTED`，不会把完整正文视为成功。手动重定向或 `opaqueredirect` 返回 `RANGE_REDIRECTED`。

`Content-Range` 必须严格匹配 `bytes start-end/total`：

- start 和 inclusive end 必须与请求一致。
- total 必须是大于 end 的安全整数，或 `*`。
- 已知 total 在同一 Loader 生命周期内必须稳定。
- 响应体长度必须等于请求长度。
- `Content-Length` 存在时必须是安全整数且等于请求长度；缺失时仍以实际响应体长度校验。

`Content-Range` 为 `*/total` 只对不满足范围的错误响应有意义，不作为成功的 206 接受。总长度为 `*` 时 `sourceLength = null`。

第一次获得 ETag 后，Loader 将其固定为当前 source validator。后续非缓存请求发送 `If-Range`。ETag 变化、已知总长度变化或 `If-Range` 导致完整 `200` 时返回 `RANGE_SOURCE_CHANGED` 并清除该源缓存，避免拼接两个版本的文件。

Fetch 在浏览器中不会可靠区分跨源 CORS 拒绝与跨源 DNS/连接失败。错误映射采用确定性规则：中止单独归类；手动重定向单独归类；明确离线或同源 fetch 拒绝归为 `RANGE_NETWORK_FAILED`；跨源 opaque/fetch 拒绝归为 `RANGE_CORS_FAILED`。文档明确跨源网络故障可能被浏览器安全边界隐藏。

### 6.4 LRU 范围缓存

内存缓存同时限制最大条目数和最大总字节数。键包含运行时源身份、精确 ByteRange 和固定 ETag。首次响应前不跨 Loader 复用无 validator 的远程缓存；同一 Loader 内可以使用其私有 source generation。

读取缓存时返回新的 `Uint8Array`，写入缓存时也复制数据，调用方不能修改缓存内容。超出单条缓存预算的数据可以正常返回但不写入缓存。淘汰顺序为最近最少使用，且永不合并不连续范围或用较大范围冒充精确响应。

## 7. 解析安全预算

默认预算可通过 `DemuxLimits` 调低，但不得超过实现硬上限：

| 预算 | 默认值 |
|---|---:|
| 单次 Range | 8 MiB |
| 可缓冲元数据元素 | 16 MiB |
| 声明的 box/EBML span | 1 TiB |
| 嵌套深度 | 16 |
| 轨道数量 | 64 |
| 单 packet | 32 MiB |
| 关键帧索引 | 250,000 项 |
| 无索引前向扫描 | 64 MiB |
| 单次 Worker packet 消息 | 32 MiB |

Segment、Cluster 和 `mdat` 等媒体容器可以大于元数据缓冲预算，但只允许在已知源边界和安全整数内跳过或分段读取，绝不整体分配。任何循环每次必须推进游标；零长度、回退偏移或无法证明推进的输入返回 `CONTAINER_INVALID`。

## 8. 容器选择

Registry 首先读取固定上限的 header，再调用适配器 `canProbe`。文件扩展名和 MIME 只进入诊断提示，不决定容器。

Matroska 与 WebM 共享 EBML magic，因此两个适配器都可能成为候选。Registry 允许多个候选执行受限 probe，并以 EBML Header 的 `DocType` 最终区分 `matroska` 和 `webm`。无法得到唯一合法结果时返回 `CONTAINER_UNSUPPORTED` 或 `CONTAINER_INVALID`，不按注册顺序猜测。

Adapter 将完整内部解析状态放在以返回 `ContainerProbeResult` 对象为键的私有 `WeakMap` 中。`createDemuxer(reader, metadata)` 收到同一结果对象时复用该状态；状态不存在或 reader 不匹配时安全地重新解析。内部 sample table、Cluster 位置和源 URL 不进入公共 Probe 契约。

## 9. Matroska 与 WebM

### 9.1 EBML 原语

EBML reader 支持：

- ID 和 size 可变整数。
- size varint 的全 1 未知长度表示。
- 有符号 EBML lace 差值。
- 无符号整数、有符号整数、IEEE 754 float、UTF-8/string 和 binary。
- 父元素结束边界、未知长度父元素和最大嵌套深度。

ID varint 不能使用 unknown-size 语义。超过 8 字节、被截断、产生不安全整数或声明范围越过已知父边界时立即失败。

### 9.2 元数据

适配器解析 EBML Header、Segment、Info、Tracks、TrackEntry、Video、Audio、Cluster 和 Cues。支持字段包括：

- `TimecodeScale` 与 `Duration`。
- TrackNumber、TrackType、CodecID、CodecPrivate、Language、Name。
- PixelWidth、PixelHeight、FrameRate、DefaultDuration。
- SamplingFrequency、Channels。
- Cluster Timecode、SimpleBlock、BlockGroup/Block、BlockDuration、ReferenceBlock。
- CueTime、CueTrack、CueClusterPosition。

Matroska 时间换算为：`timestampMicros = timecode * TimecodeScale / 1000`。float、乘法和最终微秒值必须有限并位于安全整数范围。缺失 duration 保持 `null`。

CodecID 映射只规范化已知值。未知值仍写入 `TrackInfo.codecId`，`TrackInfo.codec` 保持缺失。CodecPrivate 按精确长度复制到 `ArrayBuffer`。

WebM 必须声明 `DocType=webm`，并基础映射 VP8、VP9、AV1、Opus 和 Vorbis。`DocType=matroska` 不会由 WebM adapter 接受。

### 9.3 Block 与 packet

Block parser 支持无 lacing、Xiph lacing、fixed lacing 和 EBML lacing。每个 lace frame 单独输出一个 `DemuxPacket`。无法证明 lace 总长度与 block payload 精确一致时返回 `CONTAINER_INVALID`。

SimpleBlock 使用其 keyframe flag。BlockGroup 在没有 `ReferenceBlock` 时视为关键帧，存在引用时视为非关键帧。duration 优先使用 BlockDuration，其次使用轨道 DefaultDuration；均缺失时为 `null`。laced block 有总 duration 时，以总 duration 的有理数边界计算每帧 timestamp 和 duration，再将相邻边界转换为整数微秒，确保单调且所有帧 duration 之和等于总 duration；无法建立该边界时所有 lace packet duration 保持 `null`。

### 9.4 Cues 与无索引 seek

Cues 存在且条目未超过预算时建立关键帧索引并设置 `hasSeekIndex = true`。Cue 位置必须落在 Segment 数据范围内。

没有 Cues 时，Demuxer 保存已经扫描的 Cluster 与视频关键帧位置。`seek()` 从不晚于目标时间的已知位置开始，在 `maxForwardScanBytes` 内向前扫描；找到目标附近关键帧后定位下一次 `next()`。超过预算返回 `CONTAINER_LIMIT_EXCEEDED`，不会扫描完整远程文件。

## 10. MP4 / ISO BMFF

### 10.1 Box reader

Box reader 支持 32-bit size、`size=1` 的 64-bit largesize，以及合法的 `size=0`。`size=0` 只扩展到已知父 box 末尾；顶层源长度未知时无法证明边界，返回 `CONTAINER_INVALID`。

普通 box size 不能小于 8，large box 不能小于 16。UUID box 的扩展 header 计入边界。所有 child box 必须完整位于 parent 内，offset + size 使用安全整数检查。

### 10.2 Probe 与尾部 moov

`ftyp` 用于识别 ISO BMFF brand。顶层扫描只读取 box header，并通过已验证 size 跳过 `mdat` payload，因此 `moov` 位于尾部时不会下载整个媒体正文。找到 `moov` 后按子 box 范围增量解析。

适配器解析 `moov/mvhd/trak/mdia/mdhd/hdlr/minf/stbl`，并支持：

- `stsd` sample entry 与 avcC、hvcC、av1C、vpcC、esds、dOps 等基础 Codec private data。
- `stts` 解码时间与 duration。
- `ctts` version 0/1 的 presentation offset。
- `stsc` sample-to-chunk。
- `stsz` 固定或逐 sample 大小。
- `stco` 与 `co64` chunk offset。
- `stss` 关键帧索引。
- `mdat` 数据范围。

`mdhd` timescale 为零、表计数不一致、sample offset 不在任何 `mdat`、64-bit 值超过安全整数或 sample 数超过预算均返回稳定容器错误。

sample table builder 将 1-based MP4 表转换为内部 0-based 索引，并验证每个 sample 恰好映射一个 chunk、一个 size 和一个时间条目。没有 `stss` 时按 ISO BMFF 语义将所有 sample 视为 sync sample。

`DemuxPacket.timestamp` 使用 composition timestamp；无 `ctts` 时等于 decode timestamp。duration 来自 `stts`。内部 sample index 同时保留 decode timestamp。`next()` 按 decode timestamp 和稳定 track ID 顺序输出，以满足依赖帧解码顺序；packet 对外 timestamp 仍为 presentation timestamp，并按精确 sample 范围读取数据。

### 10.3 fragmented MP4

`mvex` 或顶层 `moof` 用于基础 fMP4 识别。存在初始化 `moov` 时仍输出可用轨道 Probe；`hasSeekIndex` 仅反映实际已解析索引。Phase 2 不构造 MediaSource，也不承诺跨 fragment 的完整流媒体播放。请求超出已实现 fragment 能力时返回 `CONTAINER_UNSUPPORTED`，不伪造 sample table。

## 11. Worker 生命周期

Worker 协议只包含结构化克隆数据：

```text
request:  sessionId + epoch + requestId + start/read/seek/close
response: sessionId + epoch + requestId + probe/packets/error/closed
```

`start` 接收 SourceDescriptor 与可选 DemuxLimits，创建 Loader、选择 Adapter 并返回 Probe。`read` 请求下一批 packets。`seek` 提升 epoch 并定位 Demuxer。`close` 提升 epoch，关闭 Demuxer 和 Loader，清理 cache、队列与消息引用。

每个异步步骤在发布消息前再次比较 sessionId、epoch 和 closed 状态。旧 epoch 结果直接丢弃。packet `ArrayBuffer` 使用 transferable 发送，但每条消息的 packet 总字节数不得超过 Worker 消息预算。关闭后不得产生 packet、错误或迟到的 probe 消息，只允许与 close 请求对应的 `closed` 确认。

## 12. 测试策略

所有媒体 fixture 由测试代码手工构造，并在 fixture helper 中说明结构和用途，不提交来源不明或受版权限制的媒体。HTTP 测试只使用 mock fetch。

新增测试文件：

- `packages/demux/tests/range-loader.test.ts`
- `packages/demux/tests/container-matroska.test.ts`
- `packages/demux/tests/container-mp4.test.ts`
- `packages/demux/tests/container-webm.test.ts`
- `packages/demux/tests/worker-lifecycle.test.ts`

覆盖范围包括：

- File 边界、越界、取消、关闭和只读取目标 slice。
- HTTP 206、200、非法 Content-Range、Content-Length mismatch、总长度 `*`。
- 跨源失败、断网、重定向、5xx、重试耗尽和取消后不重试。
- FIFO 并发窗口、缓存命中、源/Range/ETag 隔离、LRU 淘汰和复制隔离。
- EBML varint、未知长度、截断、深度、超大元素和整数溢出。
- MKV 有 Cues、无 Cues 前向扫描、SimpleBlock/BlockGroup 和四种 lacing。
- MP4 faststart、尾部 moov、32/64 位 size、size=0、sample table、ctts 和非法 box。
- WebM DocType 与 VP8/VP9/AV1/Opus/Vorbis 基础轨道。
- Worker seek epoch、close 中止、close 后零 packet 和无未完成 timer。
- 同一 fixture 经 File 与等价 HTTP Range 得到相同 Probe、轨道和 packet。
- 所有默认预算及可调低预算的失败路径。

类型测试同时验证 exact optional property semantics、公开错误码和包入口，不跨包引用内部文件。

## 13. 文档与验收

实现同步更新：

- `packages/types/README.md`
- `packages/demux/README.md`
- `docs/architecture/codec-strategy.md`
- `docs/architecture/security-and-privacy.md`
- `docs/development/phase-2-acceptance.md`
- `CHANGELOG.md`

最终运行：

```text
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Phase 2 验收记录必须区分自动化已通过项目与仍需真实 Chrome、Firefox、Safari 环境执行的 Worker/CORS smoke matrix。没有实际执行的浏览器结果不能标记为通过。

## 14. 非目标与不变量

- 不调用 `VideoDecoder`、`AudioDecoder` 或任何 WebCodecs 解码 API。
- 不构造 HTMLVideo、MediaSource、renderer 或 AudioWorklet。
- 不加载 WASM 或解码器二进制。
- 不根据文件扩展名决定容器。
- 不把容器名称写入 Codec 字段。
- 不执行容器文本、附件、URL、XML、HTML、SVG 或脚本。
- 不解析 Matroska 字体附件或外部引用。
- 不在探测阶段请求完整远程媒体文件。
- 不修改 Phase 1 能力探测和策略契约。
