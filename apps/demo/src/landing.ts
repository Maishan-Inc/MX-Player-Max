export interface CopyItem {
  readonly title: string
  readonly text: string
}

export interface StepItem extends CopyItem {
  readonly step: string
}

export interface QaItem {
  readonly q: string
  readonly a: string
}

export type SourceOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

const MEDIA_EXTENSIONS = ['.mkv', '.webm', '.mp4', '.mov', '.m4v', '.ogg', '.oga', '.opus', '.mp3', '.flac', '.wav'] as const

export const FEATURES: readonly CopyItem[] = [
  { title: 'Range 读取', text: '按需请求字节区间，长片不会被一次性下载。' },
  { title: '原生优先', text: '普通播放走 HTMLVideo，浏览器自己做硬件解码。' },
  { title: '双渲染路径', text: '逐帧、滤镜与 AI 场景切到 WebCodecs 自定义管线。' },
  { title: 'WebGPU 合成', text: 'WebGPU 优先，WebGL2 与 Canvas2D 自动降级。' },
  { title: 'WASM 兜底', text: '浏览器不支持的 Codec 交给按需加载的 WASM 解码器。' },
  { title: '字幕直出', text: '内嵌与外挂 SRT/ASS 文本轨，字体、字号、位置可调。' },
]

export const REASONS: readonly CopyItem[] = [
  {
    title: '引擎，而不是一个页面播放器',
    text: 'Source、Demuxer、Decoder Strategy、Renderer 和 Audio 各自是独立包，可以单独替换。同一套能力层可以复用到视频编辑器、监控回放、云游戏串流和在线转码预览。',
  },
  {
    title: '按能力选后端，不按浏览器名',
    text: '不写 "Chrome 就用 WebCodecs" 这种分支。先识别容器与 Codec，再用 canPlayType、MediaCapabilities 和 VideoDecoder.isConfigSupported 实测，最后按硬件解码、功耗与启动时间评分选择。',
  },
  {
    title: 'UI 是可选的',
    text: '引擎不反向依赖 UI。控制条、进度预览、字幕样式编辑器与设置浮层都在 @mx-player-max/ui 里，用原生 DOM 实现，`<video>` 与 `<canvas>` 两条路径行为一致。',
  },
  {
    title: '本地处理，无中转',
    text: '本地文件走 File API，远端文件由你的浏览器直接发 Range 请求。播放器不代理远程视频，也不上传任何本地文件。',
  },
]

export const STEPS: readonly StepItem[] = [
  {
    step: '01',
    title: '探测与解析',
    text: '读取容器、视频/音频 Codec、分辨率、帧率、位深与 HDR 信息，同时取出缓存的浏览器能力快照。远端文件用 HTTP Range 分片读取，本地文件走 File API。',
  },
  {
    step: '02',
    title: '策略评分',
    text: '候选后端全部经过真实能力检测，再按硬件解码、低功耗、无拷贝、启动时间和高级处理需求评分。只初始化最终胜出的那一个，失败后按候选顺序原子回退。',
  },
  {
    step: '03',
    title: '解码',
    text: '普通播放交给 HTMLVideo 原生管线。需要逐帧、滤镜或 AI 时切到自定义管线：WebCodecs 优先，缺失的 Codec 由 WASM 解码器管理器按需加载单线程或多线程构建产物。',
  },
  {
    step: '04',
    title: '合成与同步',
    text: '自定义路径统一输出 VideoFrame 与 AudioData，渲染器按主时钟决定显示、等待还是丢帧；有音频时以 AudioContext 时钟为主时钟。字幕在同一时间轴上渲染。',
  },
]

export const FAQ_ITEMS: readonly QaItem[] = [
  {
    q: '和普通 <video> 相比多了什么？',
    a: '普通播放它就是 <video>：同一条原生管线，同样的硬件解码与省电表现。区别在于超出原生能力的部分——浏览器不认的容器、需要逐帧取图或加滤镜的场景、需要 WebGPU 合成的场景，SDK 会自动切到 WebCodecs 或 WASM 自定义管线，而调用方的 API 不变。',
  },
  {
    q: '为什么不直接固定用 WebCodecs？',
    a: '原生路径的启动更快、功耗更低，也能拿到系统级的 PiP、AirPlay 和字幕支持。WebCodecs 的价值在于拿到裸帧，所以只有明确需要逐帧、滤镜或 AI 后处理时才值得付出这份成本。选择由能力评分决定，不由浏览器名决定。',
  },
  {
    q: '远端文件有什么要求？',
    a: 'HTTPS、CORS 放行、支持 GET Range 并返回 206 Partial Content 与正确的 Content-Range，Content-Length 稳定或长度未知但可处理。服务端把整片以 200 返回时，长片会被一次性拉下来。',
  },
  {
    q: 'WASM 解码器什么时候加载？',
    a: '只有在策略层选定 WASM 之后才加载，HTMLVideo 与 WebCodecs 阶段不会碰它。进入 WASM 后才检查 crossOriginIsolated、SharedArrayBuffer、Threads 与 SIMD；多线程初始化失败会自动回退单线程，而不是让播放整体失败。',
  },
  {
    q: '对外发布几个版本？',
    a: '一个。SDK 内部同时包含单线程与多线程 WASM 构建产物，由运行时自行选择。未完成许可证与专利审查的二进制产物不会进入可发布清单，manifest 里会记录被排除的文件和原因。',
  },
  {
    q: '可以只用引擎不用 UI 吗？',
    a: '可以。@mx-player-max/sdk 是纯 API，控制条在 @mx-player-max/ui，React 与 Vue 封装分别在 @mx-player-max/react 与 @mx-player-max/vue。引擎不反向依赖 UI，也不依赖演示站。',
  },
  {
    q: '字幕支持到什么程度？',
    a: '当前支持内嵌与外挂的 SRT、ASS/SSA 文本轨，可切换轨道并调整字体、字号、位置、颜色与描边，样式保存在本地。PGS/VobSub 图形字幕后续加入。',
  },
]

/**
 * Accepts a picked or dropped file when the browser reports a media MIME type or the name
 * carries a container extension the engine can demux. Firefox reports an empty `type` for
 * `.mkv`, so the extension check is not redundant.
 */
export function acceptMediaFile(file: File | undefined): SourceOutcome<File> {
  if (!file) return { ok: false, message: '没有读取到文件。' }
  const name = file.name.toLowerCase()
  const byExtension = MEDIA_EXTENSIONS.some((extension) => name.endsWith(extension))
  const byType = file.type.startsWith('video/') || file.type.startsWith('audio/')
  if (!byExtension && !byType) return { ok: false, message: '请选择视频或音频文件（.mkv、.webm、.mp4、.mov …）。' }
  return { ok: true, value: file }
}

/** Resolves a typed source against the page URL and keeps playback on HTTP(S) only. */
export function normalizeMediaUrl(value: string, pageUrl: string): SourceOutcome<string> {
  const trimmed = value.trim()
  if (!trimmed) return { ok: false, message: '请输入媒体地址。' }
  let parsed: URL
  try {
    parsed = new URL(trimmed, pageUrl)
  } catch {
    return { ok: false, message: '地址无法解析，请检查拼写。' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, message: '媒体地址必须以 http:// 或 https:// 开头。' }
  }
  return { ok: true, value: parsed.href }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

