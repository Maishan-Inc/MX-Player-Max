import type { CopyItem, QaItem, StepItem } from './landing'

export type DemoLocale = 'zh-CN' | 'zh-TW' | 'en' | 'ja'

export interface DemoLanguage {
  readonly code: DemoLocale
  readonly name: string
  /** Two-character chip shown in the collapsed switcher. */
  readonly short: string
}

export const DEMO_LANGUAGES: readonly DemoLanguage[] = [
  { code: 'zh-CN', name: '简体中文', short: '简' },
  { code: 'zh-TW', name: '繁體中文', short: '繁' },
  { code: 'en', name: 'English', short: 'EN' },
  { code: 'ja', name: '日本語', short: 'JA' },
]

export interface DemoSnippetComments {
  readonly pagesBundle: string
  readonly iifeGlobal: string
  readonly hostRequirement: string
  readonly sharedContainer: string
  readonly sourceSwap: string
  readonly teardown: string
  readonly memoize: string
  readonly adapterOrder: string
  readonly playButton: string
}

export interface DemoDiagnosticsCopy {
  readonly eyebrow: string
  readonly title: string
  readonly sectionLabel: string
  readonly supported: string
  readonly unsupported: string
  readonly unknown: string
  readonly pending: string
  readonly off: string
  readonly nativeClock: string
  readonly probeTitle: string
  readonly probeBrowser: string
  readonly probePlatform: string
  readonly probeNativeMedia: string
  readonly probeWebCodecs: string
  readonly probeWebGpu: string
  readonly probeWasmThreads: string
  readonly probeIsolated: string
  readonly probeLoading: string
  readonly probeFailed: string
  readonly probeEmpty: string
  readonly decisionTitle: string
  readonly decisionBackend: string
  readonly decisionRenderer: string
  readonly decisionContainer: string
  readonly decisionEpoch: string
  readonly decisionCandidates: string
  readonly decisionLoading: string
  readonly decisionEmpty: string
  readonly decisionRanked: string
  readonly runtimeTitle: string
  readonly runtimePlayback: string
  readonly runtimeBackend: string
  readonly runtimeRenderer: string
  readonly runtimeBuffer: string
  readonly runtimeDropped: string
  readonly runtimeClock: string
  readonly runtimeLoading: string
  readonly runtimeEmpty: string
  readonly subtitleTitle: string
  readonly subtitleState: string
  readonly subtitleTracks: string
  readonly subtitleSelected: string
  readonly subtitleFormat: string
  readonly subtitleLoading: string
  readonly subtitleEmpty: string
}

export interface DemoCopy {
  readonly htmlLang: string
  readonly documentTitle: string
  readonly documentDescription: string
  readonly nav: {
    readonly theme: string
    readonly repository: string
    readonly language: string
  }
  readonly player: {
    readonly heading: string
    readonly dropTitle: string
    readonly dropCopy: string
    readonly localFile: string
    readonly remoteUrl: string
    readonly defaultSample: string
    readonly urlLabel: string
    readonly urlPlaceholder: string
    readonly play: string
    readonly openLocal: string
    readonly attachSubtitle: string
    readonly intentLabel: string
    readonly intentNormal: string
    readonly intentFilters: string
    readonly intentFrameAccess: string
    /** `{name}` is substituted with the attached subtitle file name. */
    readonly subtitleAttached: string
    readonly subtitleError: string
    readonly unknownSize: string
    readonly featuresLabel: string
  }
  readonly errors: {
    readonly noFile: string
    readonly notMedia: string
    readonly emptyUrl: string
    readonly badUrl: string
    readonly badProtocol: string
  }
  readonly features: readonly CopyItem[]
  readonly why: { readonly heading: string; readonly intro: string; readonly reasons: readonly CopyItem[] }
  readonly integration: {
    readonly heading: string
    readonly intro: string
    readonly docsLink: string
    /** Trails the docs link so each language keeps its own sentence shape and punctuation. */
    readonly introSuffix: string
    readonly tabsLabel: string
    readonly copy: string
    readonly copied: string
    readonly copyAria: string
    /** `{version}` is substituted with the running build identifier. */
    readonly note: string
    readonly comments: DemoSnippetComments
  }
  readonly how: { readonly heading: string; readonly intro: string; readonly steps: readonly StepItem[] }
  readonly diagnostics: DemoDiagnosticsCopy
  readonly faq: { readonly heading: string; readonly items: readonly QaItem[] }
  readonly footer: { readonly stack: string; readonly license: string }
}

const ZH_CN: DemoCopy = {
  htmlLang: 'zh-CN',
  documentTitle: 'MX Player Max / 媒体引擎',
  documentDescription: 'MX Player Max — 模块化 Web 媒体引擎与播放器 SDK',
  nav: { theme: '切换主题', repository: '代码仓库', language: '切换语言' },
  player: {
    heading: 'MX Player Max 播放工作台',
    dropTitle: '松手即播',
    dropCopy: '本地文件只在这台机器上解析，不会上传',
    localFile: '本地文件',
    remoteUrl: '远程地址',
    defaultSample: '默认 CC0 示例',
    urlLabel: '远程媒体地址',
    urlPlaceholder: 'https://media.example.com/movie.mp4',
    play: '播放',
    openLocal: '打开本地媒体',
    attachSubtitle: '挂载字幕',
    intentLabel: '播放意图',
    intentNormal: 'Normal / 原生优先',
    intentFilters: 'Filters / 自定义管线',
    intentFrameAccess: 'Frame access / 自定义管线',
    subtitleAttached: '已挂载字幕 {name}',
    subtitleError: '字幕文件无法挂载，请检查是否为 SRT 或 ASS 文本轨。',
    unknownSize: '未知大小',
    featuresLabel: '播放器能力',
  },
  errors: {
    noFile: '没有读取到文件。',
    notMedia: '请选择视频或音频文件（.mkv、.webm、.mp4、.mov …）。',
    emptyUrl: '请输入媒体地址。',
    badUrl: '地址无法解析，请检查拼写。',
    badProtocol: '媒体地址必须以 http:// 或 https:// 开头。',
  },
  features: [
    { title: 'Range 读取', text: '按需请求字节区间，长片不会被一次性下载。' },
    { title: '原生优先', text: '普通播放走 HTMLVideo，浏览器自己做硬件解码。' },
    { title: '双渲染路径', text: '逐帧、滤镜与 AI 场景切到 WebCodecs 自定义管线。' },
    { title: 'WebGPU 合成', text: 'WebGPU 优先，WebGL2 与 Canvas2D 自动降级。' },
    { title: 'WASM 兜底', text: '浏览器不支持的 Codec 交给按需加载的 WASM 解码器。' },
    { title: '字幕直出', text: '内嵌与外挂 SRT/ASS 文本轨，字体、字号、位置可调。' },
  ],
  why: {
    heading: '为什么是 MX Player Max',
    intro: '它不是一个页面播放器，而是一层可以复用的媒体能力：容器解析、后端选择、解码、渲染和音频时钟各自独立，可以单独替换或单独接入视频编辑器、监控回放、云游戏串流与在线转码预览。',
    reasons: [
      { title: '引擎，而不是一个页面播放器', text: 'Source、Demuxer、Decoder Strategy、Renderer 和 Audio 各自是独立包，可以单独替换。同一套能力层可以复用到视频编辑器、监控回放、云游戏串流和在线转码预览。' },
      { title: '按能力选后端，不按浏览器名', text: '不写 "Chrome 就用 WebCodecs" 这种分支。先识别容器与 Codec，再用 canPlayType、MediaCapabilities 和 VideoDecoder.isConfigSupported 实测，最后按硬件解码、功耗与启动时间评分选择。' },
      { title: 'UI 是可选的', text: '引擎不反向依赖 UI。控制条、进度预览、字幕样式编辑器与设置浮层都在 @mx-player-max/ui 里，用原生 DOM 实现，`<video>` 与 `<canvas>` 两条路径行为一致。' },
      { title: '本地处理，无中转', text: '本地文件走 File API，远端文件由你的浏览器直接发 Range 请求。播放器不代理远程视频，也不上传任何本地文件。' },
    ],
  },
  integration: {
    heading: '嵌入你自己的应用',
    intro: '引擎、官方 UI 和框架适配层分开发布，按需取用。完整 API 与远程媒体要求见',
    docsLink: '接入文档',
    introSuffix: '。',
    tabsLabel: '接入方式',
    copy: '复制',
    copied: '已复制',
    copyAria: '复制代码',
    note: '当前构建 {version}。远端媒体需要 HTTPS、CORS 放行、Accept-Ranges: bytes 与 206 Partial Content；多线程 WASM 需要宿主自行设置 COOP/COEP，失败时自动回退单线程。',
    comments: {
      pagesBundle: '这份 bundle 与本页一起发布，跟随站点最新一次部署。',
      iifeGlobal: 'IIFE 只暴露一个全局名。',
      hostRequirement: '宿主必须有稳定尺寸和定位上下文：position: relative; aspect-ratio: 16 / 9。',
      sharedContainer: 'UI 与 SDK 共享同一个容器，引擎不反向依赖 UI。',
      sourceSwap: '换源不需要重建实例，ready 始终指向当前 load。',
      teardown: '卸载顺序固定：先 UI，再引擎。',
      memoize: '顶层 identity 变化会分别触发 load() 与 update()，生产组件务必 memoize。',
      adapterOrder: '适配器按 UI -> SDK 顺序清理，但不会自动导入 CSS。',
      playButton: '播放',
    },
  },
  how: {
    heading: '如何运作',
    intro: '从一个地址到画面上的一帧，播放器在你的浏览器里走完四步，媒体数据不经过任何中转服务。',
    steps: [
      { step: '01', title: '探测与解析', text: '读取容器、视频/音频 Codec、分辨率、帧率、位深与 HDR 信息，同时取出缓存的浏览器能力快照。远端文件用 HTTP Range 分片读取，本地文件走 File API。' },
      { step: '02', title: '策略评分', text: '候选后端全部经过真实能力检测，再按硬件解码、低功耗、无拷贝、启动时间和高级处理需求评分。只初始化最终胜出的那一个，失败后按候选顺序原子回退。' },
      { step: '03', title: '解码', text: '普通播放交给 HTMLVideo 原生管线。需要逐帧、滤镜或 AI 时切到自定义管线：WebCodecs 优先，缺失的 Codec 由 WASM 解码器管理器按需加载单线程或多线程构建产物。' },
      { step: '04', title: '合成与同步', text: '自定义路径统一输出 VideoFrame 与 AudioData，渲染器按主时钟决定显示、等待还是丢帧；有音频时以 AudioContext 时钟为主时钟。字幕在同一时间轴上渲染。' },
    ],
  },
  diagnostics: {
    eyebrow: '公共 API 遥测', title: '播放诊断', sectionLabel: '播放诊断',
    supported: '支持', unsupported: '不支持', unknown: '待验证', pending: '待定', off: '关闭', nativeClock: '原生媒体时钟',
    probeTitle: '能力探测', probeBrowser: '浏览器', probePlatform: '平台', probeNativeMedia: '原生媒体', probeWebCodecs: 'WebCodecs', probeWebGpu: 'WebGPU', probeWasmThreads: 'WASM 多线程', probeIsolated: '跨源隔离',
    probeLoading: '正在采集公共能力证据', probeFailed: '探测未完成', probeEmpty: '等待媒体源',
    decisionTitle: '后端决策', decisionBackend: '后端', decisionRenderer: '渲染器', decisionContainer: '容器', decisionEpoch: 'Epoch', decisionCandidates: '候选后端',
    decisionLoading: '正在为候选后端评分', decisionEmpty: '当前 epoch 没有决策记录', decisionRanked: '已评分',
    runtimeTitle: '运行时', runtimePlayback: '播放状态', runtimeBackend: '后端', runtimeRenderer: '渲染器', runtimeBuffer: '缓冲前向', runtimeDropped: '丢帧', runtimeClock: '主时钟',
    runtimeLoading: '等待已提交的运行时', runtimeEmpty: '运行时尚未初始化',
    subtitleTitle: '字幕', subtitleState: '覆盖层状态', subtitleTracks: '轨道数', subtitleSelected: '已选择', subtitleFormat: '格式',
    subtitleLoading: '正在枚举字幕轨道', subtitleEmpty: '没有字幕状态',
  },
  faq: {
    heading: '常见问题',
    items: [
      { q: '和普通 <video> 相比多了什么？', a: '普通播放它就是 <video>：同一条原生管线，同样的硬件解码与省电表现。区别在于超出原生能力的部分——浏览器不认的容器、需要逐帧取图或加滤镜的场景、需要 WebGPU 合成的场景，SDK 会自动切到 WebCodecs 或 WASM 自定义管线，而调用方的 API 不变。' },
      { q: '为什么不直接固定用 WebCodecs？', a: '原生路径的启动更快、功耗更低，也能拿到系统级的 PiP、AirPlay 和字幕支持。WebCodecs 的价值在于拿到裸帧，所以只有明确需要逐帧、滤镜或 AI 后处理时才值得付出这份成本。选择由能力评分决定，不由浏览器名决定。' },
      { q: '远端文件有什么要求？', a: 'HTTPS、CORS 放行、支持 GET Range 并返回 206 Partial Content 与正确的 Content-Range，Content-Length 稳定或长度未知但可处理。服务端把整片以 200 返回时，长片会被一次性拉下来。' },
      { q: 'WASM 解码器什么时候加载？', a: '只有在策略层选定 WASM 之后才加载，HTMLVideo 与 WebCodecs 阶段不会碰它。进入 WASM 后才检查 crossOriginIsolated、SharedArrayBuffer、Threads 与 SIMD；多线程初始化失败会自动回退单线程，而不是让播放整体失败。' },
      { q: '对外发布几个版本？', a: '一个。SDK 内部同时包含单线程与多线程 WASM 构建产物，由运行时自行选择。未完成许可证与专利审查的二进制产物不会进入可发布清单，manifest 里会记录被排除的文件和原因。' },
      { q: '可以只用引擎不用 UI 吗？', a: '可以。@mx-player-max/sdk 是纯 API，控制条在 @mx-player-max/ui，React 与 Vue 封装分别在 @mx-player-max/react 与 @mx-player-max/vue。引擎不反向依赖 UI，也不依赖演示站。' },
      { q: '字幕支持到什么程度？', a: '当前支持内嵌与外挂的 SRT、ASS/SSA 文本轨，可切换轨道并调整字体、字号、位置、颜色与描边，样式保存在本地。PGS/VobSub 图形字幕后续加入。' },
      { q: '播放器上右键有什么？', a: '循环播放、迷你播放器、复制视频网址、复制当前时间的视频网址、复制嵌入代码、复制调试信息、排查播放问题和详细统计信息。详细统计信息是一个非模态浮层，实时显示视口、帧数、编解码器、色彩、连接速度、网络活动与缓冲健康度。' },
    ],
  },
  footer: {
    stack: 'Native + WebCodecs + WASM · WebGPU / WebGL2 / Canvas2D',
    license: 'MX Player Max {version} · PolyForm Noncommercial 1.0.0',
  },
}

const ZH_TW: DemoCopy = {
  htmlLang: 'zh-TW',
  documentTitle: 'MX Player Max / 媒體引擎',
  documentDescription: 'MX Player Max — 模組化 Web 媒體引擎與播放器 SDK',
  nav: { theme: '切換主題', repository: '程式碼倉庫', language: '切換語言' },
  player: {
    heading: 'MX Player Max 播放工作台',
    dropTitle: '放開即播',
    dropCopy: '本機檔案只在這台電腦上解析，不會上傳',
    localFile: '本機檔案',
    remoteUrl: '遠端網址',
    defaultSample: '預設 CC0 範例',
    urlLabel: '遠端媒體網址',
    urlPlaceholder: 'https://media.example.com/movie.mp4',
    play: '播放',
    openLocal: '開啟本機媒體',
    attachSubtitle: '掛載字幕',
    intentLabel: '播放意圖',
    intentNormal: 'Normal / 原生優先',
    intentFilters: 'Filters / 自訂管線',
    intentFrameAccess: 'Frame access / 自訂管線',
    subtitleAttached: '已掛載字幕 {name}',
    subtitleError: '字幕檔案無法掛載，請確認是否為 SRT 或 ASS 文字軌。',
    unknownSize: '大小未知',
    featuresLabel: '播放器能力',
  },
  errors: {
    noFile: '沒有讀取到檔案。',
    notMedia: '請選擇影片或音訊檔案（.mkv、.webm、.mp4、.mov …）。',
    emptyUrl: '請輸入媒體網址。',
    badUrl: '網址無法解析，請檢查拼字。',
    badProtocol: '媒體網址必須以 http:// 或 https:// 開頭。',
  },
  features: [
    { title: 'Range 讀取', text: '按需請求位元組區間，長片不會被一次性下載。' },
    { title: '原生優先', text: '一般播放走 HTMLVideo，由瀏覽器自行做硬體解碼。' },
    { title: '雙渲染路徑', text: '逐格、濾鏡與 AI 情境切到 WebCodecs 自訂管線。' },
    { title: 'WebGPU 合成', text: 'WebGPU 優先，WebGL2 與 Canvas2D 自動降級。' },
    { title: 'WASM 後援', text: '瀏覽器不支援的 Codec 交給按需載入的 WASM 解碼器。' },
    { title: '字幕直出', text: '內嵌與外掛 SRT/ASS 文字軌，字型、字級、位置皆可調。' },
  ],
  why: {
    heading: '為什麼選 MX Player Max',
    intro: '它不是一個頁面播放器，而是一層可以重複使用的媒體能力：容器解析、後端選擇、解碼、渲染與音訊時鐘各自獨立，可以單獨替換或單獨接入影片編輯器、監控回放、雲端遊戲串流與線上轉檔預覽。',
    reasons: [
      { title: '引擎，而不是一個頁面播放器', text: 'Source、Demuxer、Decoder Strategy、Renderer 與 Audio 各自是獨立套件，可以單獨替換。同一套能力層可以重複用在影片編輯器、監控回放、雲端遊戲串流與線上轉檔預覽。' },
      { title: '按能力選後端，不按瀏覽器名', text: '不寫「Chrome 就用 WebCodecs」這種分支。先識別容器與 Codec，再用 canPlayType、MediaCapabilities 與 VideoDecoder.isConfigSupported 實測，最後按硬體解碼、功耗與啟動時間評分選擇。' },
      { title: 'UI 是可選的', text: '引擎不反向依賴 UI。控制列、進度預覽、字幕樣式編輯器與設定浮層都在 @mx-player-max/ui 裡，以原生 DOM 實作，`<video>` 與 `<canvas>` 兩條路徑行為一致。' },
      { title: '本機處理，無中轉', text: '本機檔案走 File API，遠端檔案由你的瀏覽器直接發 Range 請求。播放器不代理遠端影片，也不上傳任何本機檔案。' },
    ],
  },
  integration: {
    heading: '嵌入你自己的應用',
    intro: '引擎、官方 UI 與框架轉接層分開發布，按需取用。完整 API 與遠端媒體要求請見',
    docsLink: '接入文件',
    introSuffix: '。',
    tabsLabel: '接入方式',
    copy: '複製',
    copied: '已複製',
    copyAria: '複製程式碼',
    note: '目前建置 {version}。遠端媒體需要 HTTPS、CORS 放行、Accept-Ranges: bytes 與 206 Partial Content；多執行緒 WASM 需要宿主自行設定 COOP/COEP，失敗時自動回退單執行緒。',
    comments: {
      pagesBundle: '這份 bundle 與本頁一起發布，跟隨網站最新一次部署。',
      iifeGlobal: 'IIFE 只暴露一個全域名稱。',
      hostRequirement: '宿主必須有穩定尺寸與定位脈絡：position: relative; aspect-ratio: 16 / 9。',
      sharedContainer: 'UI 與 SDK 共用同一個容器，引擎不反向依賴 UI。',
      sourceSwap: '換源不需要重建實例，ready 永遠指向目前的 load。',
      teardown: '卸載順序固定：先 UI，再引擎。',
      memoize: '頂層 identity 變化會分別觸發 load() 與 update()，生產元件務必 memoize。',
      adapterOrder: '轉接層按 UI -> SDK 順序清理，但不會自動匯入 CSS。',
      playButton: '播放',
    },
  },
  how: {
    heading: '如何運作',
    intro: '從一個網址到畫面上的一格，播放器在你的瀏覽器裡走完四步，媒體資料不經過任何中轉服務。',
    steps: [
      { step: '01', title: '探測與解析', text: '讀取容器、影像／音訊 Codec、解析度、影格率、位元深度與 HDR 資訊，同時取出快取的瀏覽器能力快照。遠端檔案用 HTTP Range 分段讀取，本機檔案走 File API。' },
      { step: '02', title: '策略評分', text: '候選後端全部經過真實能力檢測，再按硬體解碼、低功耗、無複製、啟動時間與進階處理需求評分。只初始化最終勝出的那一個，失敗後按候選順序原子回退。' },
      { step: '03', title: '解碼', text: '一般播放交給 HTMLVideo 原生管線。需要逐格、濾鏡或 AI 時切到自訂管線：WebCodecs 優先，缺少的 Codec 由 WASM 解碼器管理器按需載入單執行緒或多執行緒建置產物。' },
      { step: '04', title: '合成與同步', text: '自訂路徑統一輸出 VideoFrame 與 AudioData，渲染器按主時鐘決定顯示、等待還是丟格；有音訊時以 AudioContext 時鐘為主時鐘。字幕在同一時間軸上渲染。' },
    ],
  },
  diagnostics: {
    eyebrow: '公開 API 遙測', title: '播放診斷', sectionLabel: '播放診斷',
    supported: '支援', unsupported: '不支援', unknown: '待驗證', pending: '待定', off: '關閉', nativeClock: '原生媒體時鐘',
    probeTitle: '能力探測', probeBrowser: '瀏覽器', probePlatform: '平台', probeNativeMedia: '原生媒體', probeWebCodecs: 'WebCodecs', probeWebGpu: 'WebGPU', probeWasmThreads: 'WASM 多執行緒', probeIsolated: '跨來源隔離',
    probeLoading: '正在採集公開能力證據', probeFailed: '探測未完成', probeEmpty: '等待媒體來源',
    decisionTitle: '後端決策', decisionBackend: '後端', decisionRenderer: '渲染器', decisionContainer: '容器', decisionEpoch: 'Epoch', decisionCandidates: '候選後端',
    decisionLoading: '正在為候選後端評分', decisionEmpty: '目前 epoch 沒有決策紀錄', decisionRanked: '已評分',
    runtimeTitle: '執行期', runtimePlayback: '播放狀態', runtimeBackend: '後端', runtimeRenderer: '渲染器', runtimeBuffer: '緩衝前向', runtimeDropped: '丟格', runtimeClock: '主時鐘',
    runtimeLoading: '等待已提交的執行期', runtimeEmpty: '執行期尚未初始化',
    subtitleTitle: '字幕', subtitleState: '覆蓋層狀態', subtitleTracks: '軌道數', subtitleSelected: '已選擇', subtitleFormat: '格式',
    subtitleLoading: '正在列舉字幕軌', subtitleEmpty: '沒有字幕狀態',
  },
  faq: {
    heading: '常見問題',
    items: [
      { q: '和一般 <video> 相比多了什麼？', a: '一般播放它就是 <video>：同一條原生管線，同樣的硬體解碼與省電表現。差別在於超出原生能力的部分——瀏覽器不認的容器、需要逐格取圖或加濾鏡的情境、需要 WebGPU 合成的情境，SDK 會自動切到 WebCodecs 或 WASM 自訂管線，而呼叫方的 API 不變。' },
      { q: '為什麼不直接固定用 WebCodecs？', a: '原生路徑啟動更快、功耗更低，也能取得系統層級的子母畫面、AirPlay 與字幕支援。WebCodecs 的價值在於取得裸影格，所以只有明確需要逐格、濾鏡或 AI 後處理時才值得付出這份成本。選擇由能力評分決定，不由瀏覽器名決定。' },
      { q: '遠端檔案有什麼要求？', a: 'HTTPS、CORS 放行、支援 GET Range 並回傳 206 Partial Content 與正確的 Content-Range，Content-Length 穩定或長度未知但可處理。伺服器把整片以 200 回傳時，長片會被一次性抓下來。' },
      { q: 'WASM 解碼器什麼時候載入？', a: '只有在策略層選定 WASM 之後才載入，HTMLVideo 與 WebCodecs 階段不會碰它。進入 WASM 後才檢查 crossOriginIsolated、SharedArrayBuffer、Threads 與 SIMD；多執行緒初始化失敗會自動回退單執行緒，而不是讓播放整體失敗。' },
      { q: '對外發布幾個版本？', a: '一個。SDK 內部同時包含單執行緒與多執行緒 WASM 建置產物，由執行期自行選擇。未完成授權與專利審查的二進位產物不會進入可發布清單，manifest 裡會記錄被排除的檔案與原因。' },
      { q: '可以只用引擎不用 UI 嗎？', a: '可以。@mx-player-max/sdk 是純 API，控制列在 @mx-player-max/ui，React 與 Vue 封裝分別在 @mx-player-max/react 與 @mx-player-max/vue。引擎不反向依賴 UI，也不依賴示範站。' },
      { q: '字幕支援到什麼程度？', a: '目前支援內嵌與外掛的 SRT、ASS/SSA 文字軌，可切換軌道並調整字型、字級、位置、顏色與外框，樣式儲存在本機。PGS/VobSub 圖形字幕後續加入。' },
      { q: '在播放器上按右鍵有什麼？', a: '循環播放、迷你播放器、複製影片網址、複製目前時間的影片網址、複製嵌入程式碼、複製除錯資訊、排解播放問題與詳細統計資訊。詳細統計資訊是一個非模態浮層，即時顯示視區、影格、編解碼器、色彩、連線速度、網路活動與緩衝健康度。' },
    ],
  },
  footer: {
    stack: 'Native + WebCodecs + WASM · WebGPU / WebGL2 / Canvas2D',
    license: 'MX Player Max {version} · PolyForm Noncommercial 1.0.0',
  },
}

const EN: DemoCopy = {
  htmlLang: 'en',
  documentTitle: 'MX Player Max / Media Engine',
  documentDescription: 'MX Player Max — a modular web media engine and player SDK',
  nav: { theme: 'Toggle theme', repository: 'Repository', language: 'Change language' },
  player: {
    heading: 'MX Player Max playback workbench',
    dropTitle: 'Drop to play',
    dropCopy: 'Local files are parsed on this machine and never uploaded',
    localFile: 'LOCAL FILE',
    remoteUrl: 'REMOTE URL',
    defaultSample: 'Default CC0 sample',
    urlLabel: 'Remote media address',
    urlPlaceholder: 'https://media.example.com/movie.mp4',
    play: 'Play',
    openLocal: 'Open local media',
    attachSubtitle: 'Attach subtitles',
    intentLabel: 'Playback intent',
    intentNormal: 'Normal / native first',
    intentFilters: 'Filters / custom pipeline',
    intentFrameAccess: 'Frame access / custom pipeline',
    subtitleAttached: '{name} subtitle attached',
    subtitleError: 'The subtitle file could not be attached. Check that it is an SRT or ASS text track.',
    unknownSize: 'unknown size',
    featuresLabel: 'Player capabilities',
  },
  errors: {
    noFile: 'No file was read.',
    notMedia: 'Pick a video or audio file (.mkv, .webm, .mp4, .mov …).',
    emptyUrl: 'Enter a media address.',
    badUrl: 'The address could not be parsed. Check the spelling.',
    badProtocol: 'A media address has to start with http:// or https://.',
  },
  features: [
    { title: 'Range reads', text: 'Byte ranges are requested on demand, so a long film is never pulled down at once.' },
    { title: 'Native first', text: 'Ordinary playback runs on HTMLVideo and the browser does its own hardware decoding.' },
    { title: 'Two render paths', text: 'Frame-accurate, filtered and AI work switches to the WebCodecs custom pipeline.' },
    { title: 'WebGPU compositing', text: 'WebGPU leads, with automatic fallback to WebGL2 and Canvas2D.' },
    { title: 'WASM backstop', text: 'Codecs the browser refuses go to a WASM decoder loaded on demand.' },
    { title: 'Subtitles built in', text: 'Embedded and external SRT/ASS text tracks with adjustable font, size and position.' },
  ],
  why: {
    heading: 'Why MX Player Max',
    intro: 'It is not a page player but a reusable media capability layer: container parsing, backend selection, decoding, rendering and the audio clock are independent, so each one can be replaced or wired into a video editor, surveillance replay, cloud game streaming or an online transcode preview.',
    reasons: [
      { title: 'An engine, not a page player', text: 'Source, Demuxer, Decoder Strategy, Renderer and Audio ship as separate packages and can be replaced one at a time. The same capability layer serves video editors, surveillance replay, cloud game streaming and online transcode previews.' },
      { title: 'Backends chosen by capability, not by browser name', text: 'There is no "Chrome means WebCodecs" branch. The container and codec are identified first, then verified with canPlayType, MediaCapabilities and VideoDecoder.isConfigSupported, and finally scored on hardware decoding, power draw and start-up time.' },
      { title: 'The UI is optional', text: 'The engine never depends on the UI. The control bar, scrubbing preview, subtitle style editor and settings sheet all live in @mx-player-max/ui, built on plain DOM, and behave identically over `<video>` and `<canvas>`.' },
      { title: 'Local processing, no relay', text: 'Local files go through the File API and remote files are fetched by your own browser with Range requests. The player proxies no remote video and uploads no local file.' },
    ],
  },
  integration: {
    heading: 'Embed it in your own application',
    intro: 'The engine, the official UI and the framework adapters ship separately, so you take only what you need. The full API and the remote media requirements are in the',
    docsLink: 'integration guide',
    introSuffix: '.',
    tabsLabel: 'Integration style',
    copy: 'Copy',
    copied: 'Copied',
    copyAria: 'Copy code',
    note: 'Build {version}. Remote media needs HTTPS, permissive CORS, Accept-Ranges: bytes and 206 Partial Content; multi-threaded WASM needs the host to set COOP/COEP itself and falls back to single-threaded on failure.',
    comments: {
      pagesBundle: 'This bundle is published alongside the page and tracks its latest deployment.',
      iifeGlobal: 'The IIFE exposes exactly one global name.',
      hostRequirement: 'The host needs a stable size and a positioning context: position: relative; aspect-ratio: 16 / 9.',
      sharedContainer: 'The UI and the SDK share one container; the engine never depends on the UI.',
      sourceSwap: 'Swapping the source needs no new instance; ready always tracks the current load.',
      teardown: 'Teardown order is fixed: UI first, then the engine.',
      memoize: 'A change of top-level identity triggers load() and update() separately, so memoize in production components.',
      adapterOrder: 'The adapter cleans up UI before SDK, but it does not import the CSS for you.',
      playButton: 'Play',
    },
  },
  how: {
    heading: 'How it works',
    intro: 'From an address to a frame on screen the player takes four steps inside your browser, and the media data passes through no relay service.',
    steps: [
      { step: '01', title: 'Probe and parse', text: 'The container, video and audio codecs, resolution, frame rate, bit depth and HDR metadata are read while the cached browser capability snapshot is loaded. Remote files are read in HTTP Range slices; local files go through the File API.' },
      { step: '02', title: 'Score the strategy', text: 'Every candidate backend passes real capability detection, then is scored on hardware decoding, low power, zero copy, start-up time and advanced processing needs. Only the winner is initialized, and failure falls back atomically down the candidate order.' },
      { step: '03', title: 'Decode', text: 'Ordinary playback goes to the HTMLVideo native pipeline. Frame access, filters or AI switch to the custom pipeline: WebCodecs first, with missing codecs served by the WASM decoder manager loading a single- or multi-threaded build on demand.' },
      { step: '04', title: 'Composite and sync', text: 'The custom path emits VideoFrame and AudioData uniformly, and the renderer decides per frame whether to present, wait or drop against the master clock; the AudioContext clock leads whenever there is audio. Subtitles render on the same timeline.' },
    ],
  },
  diagnostics: {
    eyebrow: 'Public API telemetry', title: 'Playback diagnostics', sectionLabel: 'Playback diagnostics',
    supported: 'Supported', unsupported: 'Unsupported', unknown: 'Pending verification', pending: 'Pending', off: 'Off', nativeClock: 'Native media clock',
    probeTitle: 'Probe', probeBrowser: 'Browser', probePlatform: 'Platform', probeNativeMedia: 'Native media', probeWebCodecs: 'WebCodecs', probeWebGpu: 'WebGPU', probeWasmThreads: 'WASM threads', probeIsolated: 'Cross-origin isolated',
    probeLoading: 'Collecting public capability evidence', probeFailed: 'Probe did not complete', probeEmpty: 'Waiting for a media source',
    decisionTitle: 'Decision', decisionBackend: 'Backend', decisionRenderer: 'Renderer', decisionContainer: 'Container', decisionEpoch: 'Epoch', decisionCandidates: 'Playback candidates',
    decisionLoading: 'Ranking available playback candidates', decisionEmpty: 'No decision trace for this epoch', decisionRanked: 'ranked',
    runtimeTitle: 'Runtime', runtimePlayback: 'Playback', runtimeBackend: 'Backend', runtimeRenderer: 'Renderer', runtimeBuffer: 'Buffer ahead', runtimeDropped: 'Dropped frames', runtimeClock: 'Master clock',
    runtimeLoading: 'Waiting for the committed runtime', runtimeEmpty: 'Runtime is not initialized',
    subtitleTitle: 'Subtitles', subtitleState: 'Overlay state', subtitleTracks: 'Tracks', subtitleSelected: 'Selected', subtitleFormat: 'Format',
    subtitleLoading: 'Enumerating subtitle tracks', subtitleEmpty: 'No subtitle state available',
  },
  faq: {
    heading: 'Frequently asked questions',
    items: [
      { q: 'What does it add over a plain <video>?', a: 'For ordinary playback it is <video>: the same native pipeline, the same hardware decoding and the same battery behaviour. The difference shows up beyond native reach — containers the browser refuses, work that needs per-frame access or filters, scenes that need WebGPU compositing — where the SDK switches to the WebCodecs or WASM custom pipeline without changing the caller API.' },
      { q: 'Why not just always use WebCodecs?', a: 'The native path starts faster, draws less power and gets system-level PiP, AirPlay and subtitle support. WebCodecs earns its cost only when raw frames are genuinely needed for frame access, filters or AI post-processing. The choice comes from capability scoring, not from the browser name.' },
      { q: 'What do remote files have to support?', a: 'HTTPS, permissive CORS, GET Range answered with 206 Partial Content and a correct Content-Range, plus a stable Content-Length or a length that is unknown but handled. When a server answers the whole file with 200, a long film is pulled down in one go.' },
      { q: 'When is the WASM decoder loaded?', a: 'Only after the strategy layer has selected WASM; the HTMLVideo and WebCodecs stages never touch it. crossOriginIsolated, SharedArrayBuffer, Threads and SIMD are checked once WASM is entered, and a failed multi-threaded start falls back to single-threaded instead of failing playback.' },
      { q: 'How many versions are published?', a: 'One. The SDK carries both single- and multi-threaded WASM builds internally and the runtime picks between them. Binaries without a finished licence and patent review never enter the publishable set, and the manifest records which files were excluded and why.' },
      { q: 'Can the engine be used without the UI?', a: 'Yes. @mx-player-max/sdk is a pure API, the control bar lives in @mx-player-max/ui, and the React and Vue wrappers are @mx-player-max/react and @mx-player-max/vue. The engine depends on neither the UI nor this demo site.' },
      { q: 'How far does subtitle support go?', a: 'Embedded and external SRT and ASS/SSA text tracks are supported today, with track switching and adjustable font, size, position, colour and outline saved locally. PGS/VobSub bitmap subtitles come later.' },
      { q: 'What is in the right-click menu?', a: 'Loop, miniplayer, copy video URL, copy video URL at the current time, copy embed code, copy debug info, troubleshoot playback issue and stats for nerds. Stats for nerds is a non-modal sheet that live-reports viewport, frames, codecs, colour, connection speed, network activity and buffer health.' },
    ],
  },
  footer: {
    stack: 'Native + WebCodecs + WASM · WebGPU / WebGL2 / Canvas2D',
    license: 'MX Player Max {version} · PolyForm Noncommercial 1.0.0',
  },
}

const JA: DemoCopy = {
  htmlLang: 'ja',
  documentTitle: 'MX Player Max / メディアエンジン',
  documentDescription: 'MX Player Max — モジュール構成の Web メディアエンジンとプレーヤー SDK',
  nav: { theme: 'テーマを切り替える', repository: 'リポジトリ', language: '言語を変更' },
  player: {
    heading: 'MX Player Max 再生ワークベンチ',
    dropTitle: 'ドロップで再生',
    dropCopy: 'ローカルファイルはこの端末で解析され、アップロードされません',
    localFile: 'ローカルファイル',
    remoteUrl: 'リモート URL',
    defaultSample: '既定の CC0 サンプル',
    urlLabel: 'リモートメディアのアドレス',
    urlPlaceholder: 'https://media.example.com/movie.mp4',
    play: '再生',
    openLocal: 'ローカルメディアを開く',
    attachSubtitle: '字幕を読み込む',
    intentLabel: '再生インテント',
    intentNormal: 'Normal / ネイティブ優先',
    intentFilters: 'Filters / カスタムパイプライン',
    intentFrameAccess: 'Frame access / カスタムパイプライン',
    subtitleAttached: '字幕 {name} を読み込みました',
    subtitleError: '字幕ファイルを読み込めません。SRT または ASS のテキストトラックか確認してください。',
    unknownSize: 'サイズ不明',
    featuresLabel: 'プレーヤーの機能',
  },
  errors: {
    noFile: 'ファイルを読み取れませんでした。',
    notMedia: '動画または音声ファイルを選んでください（.mkv、.webm、.mp4、.mov …）。',
    emptyUrl: 'メディアのアドレスを入力してください。',
    badUrl: 'アドレスを解析できません。綴りを確認してください。',
    badProtocol: 'メディアのアドレスは http:// または https:// で始まる必要があります。',
  },
  features: [
    { title: 'Range 読み込み', text: 'バイト範囲を必要な分だけ要求するので、長尺でも一度に落としません。' },
    { title: 'ネイティブ優先', text: '通常再生は HTMLVideo に任せ、ブラウザ自身がハードウェアデコードします。' },
    { title: '二つの描画経路', text: 'フレーム単位、フィルター、AI の用途では WebCodecs のカスタムパイプラインへ切り替えます。' },
    { title: 'WebGPU 合成', text: 'WebGPU を優先し、WebGL2 と Canvas2D へ自動で降格します。' },
    { title: 'WASM の受け皿', text: 'ブラウザが対応しないコーデックは必要時に読み込む WASM デコーダーが担います。' },
    { title: '字幕を標準搭載', text: '内蔵と外部の SRT/ASS テキストトラックに対応し、フォント、サイズ、位置を調整できます。' },
  ],
  why: {
    heading: 'MX Player Max を選ぶ理由',
    intro: 'これはページ用プレーヤーではなく、再利用できるメディア能力の層です。コンテナ解析、バックエンド選択、デコード、描画、オーディオクロックがそれぞれ独立しているため、単体で差し替えたり、動画編集ツール、監視映像の再生、クラウドゲームのストリーミング、オンライン変換のプレビューに組み込めます。',
    reasons: [
      { title: 'ページ用プレーヤーではなくエンジン', text: 'Source、Demuxer、Decoder Strategy、Renderer、Audio はそれぞれ独立したパッケージで、個別に差し替えられます。同じ能力層を動画編集ツール、監視映像の再生、クラウドゲームのストリーミング、オンライン変換のプレビューで再利用できます。' },
      { title: 'ブラウザ名ではなく能力でバックエンドを選ぶ', text: '「Chrome なら WebCodecs」のような分岐は書きません。まずコンテナとコーデックを識別し、canPlayType、MediaCapabilities、VideoDecoder.isConfigSupported で実測してから、ハードウェアデコード、消費電力、起動時間で採点して選びます。' },
      { title: 'UI は任意', text: 'エンジンは UI に依存しません。コントロールバー、シークプレビュー、字幕スタイルエディター、設定シートはすべて @mx-player-max/ui にあり、素の DOM で実装されているため `<video>` と `<canvas>` の両経路で同じ挙動になります。' },
      { title: 'ローカル処理、中継なし', text: 'ローカルファイルは File API を通り、リモートファイルはあなたのブラウザが直接 Range 要求を出します。プレーヤーはリモート動画を代理取得せず、ローカルファイルをアップロードしません。' },
    ],
  },
  integration: {
    heading: '自分のアプリに組み込む',
    intro: 'エンジン、公式 UI、フレームワークアダプターは別々に配布されるため、必要な分だけ取り込めます。API 全体とリモートメディアの要件は',
    docsLink: '導入ドキュメント',
    introSuffix: 'にあります。',
    tabsLabel: '導入方法',
    copy: 'コピー',
    copied: 'コピーしました',
    copyAria: 'コードをコピー',
    note: '現在のビルドは {version} です。リモートメディアには HTTPS、CORS の許可、Accept-Ranges: bytes、206 Partial Content が必要です。マルチスレッド WASM はホスト側で COOP/COEP を設定する必要があり、失敗時は自動でシングルスレッドに戻ります。',
    comments: {
      pagesBundle: 'この bundle はこのページと一緒に配布され、サイトの最新デプロイに追従します。',
      iifeGlobal: 'IIFE が公開するグローバル名は一つだけです。',
      hostRequirement: 'ホストには安定したサイズと配置コンテキストが必要です: position: relative; aspect-ratio: 16 / 9。',
      sharedContainer: 'UI と SDK は同じコンテナを共有し、エンジンは UI に依存しません。',
      sourceSwap: 'ソースの差し替えにインスタンスの再作成は不要で、ready は常に現在の load を指します。',
      teardown: '破棄の順序は固定です: まず UI、次にエンジン。',
      memoize: '最上位の identity が変わると load() と update() が別々に走るため、本番コンポーネントでは必ず memoize してください。',
      adapterOrder: 'アダプターは UI -> SDK の順に片付けますが、CSS は自動で読み込みません。',
      playButton: '再生',
    },
  },
  how: {
    heading: '仕組み',
    intro: 'アドレスから画面上の一フレームまで、プレーヤーはあなたのブラウザ内で四段階を進みます。メディアデータは中継サービスを通りません。',
    steps: [
      { step: '01', title: '探索と解析', text: 'コンテナ、映像／音声コーデック、解像度、フレームレート、ビット深度、HDR 情報を読み取りつつ、キャッシュ済みのブラウザ能力スナップショットを取り出します。リモートファイルは HTTP Range で分割読み込み、ローカルファイルは File API を使います。' },
      { step: '02', title: '戦略の採点', text: '候補バックエンドはすべて実際の能力検出を通り、ハードウェアデコード、低消費電力、ゼロコピー、起動時間、高度な処理要件で採点されます。初期化するのは最終的に勝った一つだけで、失敗すると候補順に原子的にフォールバックします。' },
      { step: '03', title: 'デコード', text: '通常再生は HTMLVideo のネイティブパイプラインに任せます。フレーム単位、フィルター、AI が必要な場合はカスタムパイプラインへ切り替え、WebCodecs を優先し、足りないコーデックは WASM デコーダーマネージャーがシングル／マルチスレッドのビルドを必要時に読み込みます。' },
      { step: '04', title: '合成と同期', text: 'カスタム経路は VideoFrame と AudioData を統一して出力し、レンダラーはマスタークロックに合わせて表示・待機・ドロップを判断します。音声があるときは AudioContext クロックがマスターです。字幕も同じタイムライン上で描画されます。' },
    ],
  },
  diagnostics: {
    eyebrow: '公開 API テレメトリ', title: '再生診断', sectionLabel: '再生診断',
    supported: '対応', unsupported: '非対応', unknown: '検証待ち', pending: '保留', off: 'オフ', nativeClock: 'ネイティブメディアクロック',
    probeTitle: '能力検出', probeBrowser: 'ブラウザ', probePlatform: 'プラットフォーム', probeNativeMedia: 'ネイティブメディア', probeWebCodecs: 'WebCodecs', probeWebGpu: 'WebGPU', probeWasmThreads: 'WASM スレッド', probeIsolated: 'クロスオリジン分離',
    probeLoading: '公開能力の証跡を収集中', probeFailed: '能力検出が完了しませんでした', probeEmpty: 'メディアソースを待機中',
    decisionTitle: 'バックエンド決定', decisionBackend: 'バックエンド', decisionRenderer: 'レンダラー', decisionContainer: 'コンテナ', decisionEpoch: 'Epoch', decisionCandidates: '候補バックエンド',
    decisionLoading: '候補バックエンドを採点中', decisionEmpty: 'この epoch の決定記録はありません', decisionRanked: '採点済み',
    runtimeTitle: 'ランタイム', runtimePlayback: '再生状態', runtimeBackend: 'バックエンド', runtimeRenderer: 'レンダラー', runtimeBuffer: 'バッファ先読み', runtimeDropped: 'ドロップフレーム', runtimeClock: 'マスタークロック',
    runtimeLoading: '確定したランタイムを待機中', runtimeEmpty: 'ランタイムは初期化されていません',
    subtitleTitle: '字幕', subtitleState: 'オーバーレイ状態', subtitleTracks: 'トラック数', subtitleSelected: '選択中', subtitleFormat: '形式',
    subtitleLoading: '字幕トラックを列挙中', subtitleEmpty: '字幕の状態がありません',
  },
  faq: {
    heading: 'よくある質問',
    items: [
      { q: '素の <video> と比べて何が増えるのですか？', a: '通常再生では <video> そのものです。同じネイティブパイプライン、同じハードウェアデコード、同じ省電力性能です。違いはネイティブの範囲を超えた部分に現れます。ブラウザが受け付けないコンテナ、フレーム単位の取得やフィルターが必要な場面、WebGPU 合成が必要な場面では、SDK が WebCodecs または WASM のカスタムパイプラインへ自動で切り替えますが、呼び出し側の API は変わりません。' },
      { q: 'なぜ常に WebCodecs を使わないのですか？', a: 'ネイティブ経路は起動が速く消費電力も低く、システムレベルの PiP、AirPlay、字幕対応も得られます。WebCodecs の価値は生フレームを取れることなので、フレーム単位、フィルター、AI 後処理が本当に必要なときだけコストに見合います。選択はブラウザ名ではなく能力の採点で決まります。' },
      { q: 'リモートファイルの要件は何ですか？', a: 'HTTPS、CORS の許可、GET Range に対する 206 Partial Content と正しい Content-Range、そして安定した Content-Length（または長さ不明でも扱える形）が必要です。サーバーが全体を 200 で返すと、長尺は一度に取得されます。' },
      { q: 'WASM デコーダーはいつ読み込まれますか？', a: '戦略層が WASM を選んだ後だけです。HTMLVideo と WebCodecs の段階では触れません。WASM に入ってから crossOriginIsolated、SharedArrayBuffer、Threads、SIMD を確認し、マルチスレッドの初期化に失敗すると再生全体を失敗させる代わりにシングルスレッドへ戻ります。' },
      { q: '公開するバージョンはいくつですか？', a: '一つです。SDK は内部にシングルスレッドとマルチスレッドの WASM ビルドを両方持ち、ランタイムが選択します。ライセンスと特許の審査が終わっていないバイナリは公開対象に入らず、manifest に除外したファイルと理由が記録されます。' },
      { q: 'UI を使わずエンジンだけ使えますか？', a: '使えます。@mx-player-max/sdk は純粋な API で、コントロールバーは @mx-player-max/ui、React と Vue のラッパーは @mx-player-max/react と @mx-player-max/vue です。エンジンは UI にもこのデモサイトにも依存しません。' },
      { q: '字幕はどこまで対応していますか？', a: '現時点で内蔵と外部の SRT、ASS/SSA テキストトラックに対応し、トラック切り替えとフォント、サイズ、位置、色、縁取りの調整ができ、スタイルはローカルに保存されます。PGS/VobSub のビットマップ字幕は今後追加します。' },
      { q: 'プレーヤー上の右クリックには何がありますか？', a: 'ループ再生、ミニプレーヤー、動画の URL をコピー、現在の時間の動画 URL をコピー、埋め込みコードをコピー、デバッグ情報をコピー、再生の問題を報告、詳細統計情報です。詳細統計情報は非モーダルのシートで、ビューポート、フレーム、コーデック、色域、接続速度、ネットワーク活動、バッファの健全性をリアルタイムに表示します。' },
    ],
  },
  footer: {
    stack: 'Native + WebCodecs + WASM · WebGPU / WebGL2 / Canvas2D',
    license: 'MX Player Max {version} · PolyForm Noncommercial 1.0.0',
  },
}

export const DEMO_COPY: Readonly<Record<DemoLocale, DemoCopy>> = Object.freeze({
  'zh-CN': ZH_CN,
  'zh-TW': ZH_TW,
  en: EN,
  ja: JA,
})

export const DEMO_LOCALE_STORAGE_KEY = 'mx-player-max:locale'

export function isDemoLocale(value: unknown): value is DemoLocale {
  return typeof value === 'string' && DEMO_LANGUAGES.some((language) => language.code === value)
}

/** Normalizes one BCP 47 tag. Returns `null` when no shipped pack applies. */
export function matchDemoLocale(tag: string | null | undefined): DemoLocale | null {
  if (typeof tag !== 'string') return null
  const normalized = tag.trim().toLowerCase().replace(/_/g, '-')
  if (normalized.length === 0) return null
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja'
  if (normalized === 'zh' || normalized.startsWith('zh-')) {
    const parts = normalized.split('-').slice(1)
    return parts.includes('hant') || parts.includes('tw') || parts.includes('hk') || parts.includes('mo') ? 'zh-TW' : 'zh-CN'
  }
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  return null
}

/**
 * A stored choice always wins; otherwise the browser preference order decides. The site ships
 * Simplified Chinese first, so an unmatched preference lands there rather than on English.
 */
export function detectDemoLocale(stored: string | null | undefined, preferences: readonly (string | null | undefined)[]): DemoLocale {
  if (isDemoLocale(stored)) return stored
  for (const preference of preferences) {
    const matched = matchDemoLocale(preference)
    if (matched !== null) return matched
  }
  return 'zh-CN'
}

export function demoCopy(locale: DemoLocale): DemoCopy {
  return DEMO_COPY[locale]
}

/** Substitutes `{name}`-style placeholders. Unknown keys are left in place. */
export function format(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}
