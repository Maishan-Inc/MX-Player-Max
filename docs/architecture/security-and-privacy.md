# 安全、隐私与供应链

## 媒体隐私

本地文件只在用户浏览器读取。远程文件由浏览器直接请求源站。SDK 默认不上传媒体、不建立后台转码任务、不记录完整 URL 查询参数。

## 网络边界

Range Loader 只允许 `http`/`https` 和明确的 `File` 输入。响应状态、Content-Range、长度和 Range 边界必须校验。请求失败不得把响应正文插入 DOM。

Phase 2 的 HTTP Loader 固定使用由 SDK 生成的 `Range`，默认 `credentials: 'omit'` 和 `redirect: 'manual'`。调用方不能覆盖 `Range`、`If-Range`、`Content-Length`、`Host` 等受控 header。只有范围完全匹配的 `206 Partial Content` 才成功；`200`、重定向、错误 `Content-Range`、错误长度和源 ETag/总长度变化均返回独立稳定错误。

远程诊断上下文只包含 origin 与路径 basename，不包含查询参数、响应正文或自定义 header 值。缓存内部按 URL、header 集合、运行时源身份、精确 Range 和必要 ETag 隔离；缓存数据读写均复制，不能跨源或跨文件对象复用。

Fetch API 不向脚本可靠暴露跨源 CORS 拒绝与所有跨源网络故障的差异。实现将明确离线或同源失败报告为 `RANGE_NETWORK_FAILED`，跨源 opaque/fetch 拒绝报告为 `RANGE_CORS_FAILED`，并保留这一平台限制说明，不伪造更具体的诊断。

NativeMediaPipeline 不代理远程媒体，也不把响应正文、完整 URL、查询参数、CodecPrivate 或自定义 header 值写入日志。远程 URL 只接受 HTTP(S)，直接设置到 HTMLVideo；默认 `crossOrigin="anonymous"` 且必须在 `src` 之前设置。HTMLVideo 无法发送 `SourceDescriptor.headers`，因此返回 `NATIVE_CUSTOM_HEADERS_UNSUPPORTED`，不静默忽略。File 源仅创建和撤销浏览器 Object URL，不复制完整文件到 ArrayBuffer。

`loadedmetadata` 超时、网络、CORS、解码、Abort、autoplay、全屏和 PiP 失败均映射为稳定 `NATIVE_*`/`ENGINE_*` 错误；对外消息只描述安全的来源类别/协议上下文，不暴露原始 DOMException 名称。

## 容器输入边界

MP4 box、EBML element、offset、size、varint、时间刻度和 sample table 全部按不可信输入处理。默认限制单次 Range、元数据缓冲、声明 span、嵌套深度、轨道数、packet、关键帧索引、前向扫描和 Worker 消息大小。所有 offset 加法必须保持安全整数并位于父元素及已知源边界内。

Matroska 附件、字体、外部引用、标签文本和章节内容不在 Phase 2 解析范围。容器内字符串只作为 UTF-8 元数据返回，不执行为 URL、XML、HTML、SVG、CSS 或脚本。MP4 `mdat`、Matroska Segment/Cluster 只跳过或分段读取，不整体分配。

Worker 的 start/read/seek/close 消息使用 session 与 epoch 隔离。close 会取消 Range 请求、重试 timer 和排队任务，关闭 Demuxer，并阻止迟到 probe/packet 发布。

## 字幕安全

SRT/ASS 文本按纯文本输出。只对白名单解析 ASS 样式和换行，禁止把 `Dialogue`、字体名或外挂字幕内容拼接成 HTML、CSS URL 或脚本。

## WASM 供应链

每个 WASM 文件必须记录上游仓库、commit、编译器版本、编译 flags、许可证、SHA-256 和来源 URL。运行时下载后校验哈希，失败时停止加载该变体并尝试安全回退。

## 响应头与 CSP

Docker 演示站配置 COOP/COEP 以开启跨源隔离。生产站还应配置 CSP、`X-Content-Type-Options: nosniff`、严格 HTTPS 和受限的 Worker/WASM 来源。第三方 CDN 资源必须支持 CORS/CORP，否则 COEP 页面可能阻止加载。

## DRM 边界

首阶段不实现 DRM。未来 FairPlay、Widevine 和 PlayReady 必须作为独立 EME 适配器，不得把密钥、许可证 Token 或私有媒体响应写入日志。
