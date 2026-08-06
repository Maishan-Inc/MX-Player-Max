# 安全、隐私与供应链

## 媒体隐私

本地文件只在用户浏览器读取。远程文件由浏览器直接请求源站。SDK 默认不上传媒体、不建立后台转码任务、不记录完整 URL 查询参数。

## 网络边界

Range Loader 只允许 `http`/`https` 和明确的 `File` 输入。响应状态、Content-Range、长度和 Range 边界必须校验。请求失败不得把响应正文插入 DOM。

## 字幕安全

SRT/ASS 文本按纯文本输出。只对白名单解析 ASS 样式和换行，禁止把 `Dialogue`、字体名或外挂字幕内容拼接成 HTML、CSS URL 或脚本。

## WASM 供应链

每个 WASM 文件必须记录上游仓库、commit、编译器版本、编译 flags、许可证、SHA-256 和来源 URL。运行时下载后校验哈希，失败时停止加载该变体并尝试安全回退。

## 响应头与 CSP

Docker 演示站配置 COOP/COEP 以开启跨源隔离。生产站还应配置 CSP、`X-Content-Type-Options: nosniff`、严格 HTTPS 和受限的 Worker/WASM 来源。第三方 CDN 资源必须支持 CORS/CORP，否则 COEP 页面可能阻止加载。

## DRM 边界

首阶段不实现 DRM。未来 FairPlay、Widevine 和 PlayReady 必须作为独立 EME 适配器，不得把密钥、许可证 Token 或私有媒体响应写入日志。

