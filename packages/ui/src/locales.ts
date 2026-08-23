import { DEFAULT_LABELS, type PlayerUiLabels, type PlayerUiLocale } from './contracts'

/**
 * Shipped label packs. Every pack is complete: the type requires all keys, so a missing
 * translation is a build error rather than an English string leaking into a localized UI.
 */
const ZH_CN: PlayerUiLabels = {
  aiEnhance: 'AI 增强', aiSuperResolution: '超分辨率', aiInterpolation: '插帧',
  renderMode: '渲染模式', renderModeNative: '原生播放', renderModeWebGpu: 'WebGPU 自定义管线', renderModeFallback: 'WebGL2 自定义管线',
  renderModeHint: 'AI 增强只在 WebGPU 自定义管线下可用。',
  aiUnavailableRendererPath: '把渲染模式切换到 WebGPU 自定义管线后才能开启。',
  aiUnavailableModel: '宿主未配置 AI 模型根目录。',
  aiUnavailableDevice: '此设备没有可用的 WebGPU 适配器。',
  aiUnavailableNotImplemented: '当前版本尚未提供。',
  play: '播放', pause: '暂停', replay: '重新播放', nextEpisode: '下一集', mute: '静音', unmute: '取消静音', volume: '音量',
  seek: '进度', subtitles: '字幕', pictureInPicture: '画中画', exitPictureInPicture: '退出画中画', theater: '影院模式', exitTheater: '退出影院模式', settings: '设置', statistics: '详细统计信息', about: '关于',
  fullscreen: '全屏', exitFullscreen: '退出全屏', close: '关闭', subtitleOff: '关闭字幕', subtitleTracks: '字幕轨道', subtitleStyle: '字幕样式', subtitleFont: '选择字体', subtitleEdit: '编辑字幕样式', subtitleEditHint: '拖动字幕调整位置，拖动上下边框调整大小', subtitleSample: '字幕示例', subtitleHold: '字幕菜单打开时已暂停', done: '完成', lockControls: '锁定控制栏', unlockControls: '解锁控制栏', fontFamily: '字体', fontSize: '字号', fontSystem: '系统默认', fontSans: '黑体', fontSerif: '宋体', fontKai: '楷体', fontRounded: '圆体', fontMono: '等宽', alignment: '对齐方式', horizontalPosition: '水平位置', subtitlePosition: '垂直位置', subtitleColor: '文字颜色', outlineColor: '描边颜色', outlineWidth: '描边宽度', bold: '粗体', italic: '斜体', underline: '下划线', embeddedTrack: '内嵌', localTrack: '本地文件', remoteTrack: '远程地址', reset: '恢复默认', playbackRate: '播放速度', noSubtitles: '没有可用的字幕轨道', loading: '加载中', buffering: '缓冲中', seeking: '跳转中', error: '播放出错', unknownDuration: '直播',
  contextMenu: '播放器菜单', loop: '循环播放', miniPlayer: '迷你播放器', exitMiniPlayer: '退出迷你播放器', copyVideoUrl: '复制视频网址', copyVideoUrlAtTime: '复制当前时间的视频网址', copyEmbedCode: '复制嵌入代码', copyDebugInfo: '复制调试信息', troubleshoot: '排查播放问题', copied: '已复制到剪贴板', copyFailed: '剪贴板不可用',
  statsVideoId: '视频 ID / sCPN', statsViewport: '视口 / 帧数', statsResolution: '当前 / 最佳分辨率', statsVolume: '音量 / 归一化', statsCodecs: '编解码器', statsColor: '色彩', statsConnection: '连接速度', statsNetwork: '网络活动', statsBufferHealth: '缓冲健康度', statsMystery: '调试串', statsDate: '日期', statsFrames: '丢弃 {dropped} / 共 {total} 帧', statsUnknown: '不可用',
  troubleshootHealthy: '没有检测到播放问题。', troubleshootFindings: '检测结果', troubleshootDroppedFrames: '正在丢帧。请降低分辨率、关闭其他占用 GPU 的标签页，或把播放意图切回 Normal。', troubleshootBuffering: '数据供给不足。请检查网络，并确认服务端对 HTTP Range 请求返回 206 Partial Content。', troubleshootError: '引擎报告了错误，下面的错误码指向失败的阶段。', troubleshootNoAudioClock: '音频时钟未运行，视频时序改用媒体墙钟，可能出现漂移。', troubleshootSoftwareDecode: '当前使用 WASM 解码器。这个 Codec 在此浏览器上没有硬件解码。', troubleshootEnvironment: '运行环境', troubleshootCopyReport: '复制报告',
}

const ZH_TW: PlayerUiLabels = {
  aiEnhance: 'AI 增強', aiSuperResolution: '超解析度', aiInterpolation: '補幀',
  renderMode: '算繪模式', renderModeNative: '原生播放', renderModeWebGpu: 'WebGPU 自訂管線', renderModeFallback: 'WebGL2 自訂管線',
  renderModeHint: 'AI 增強僅在 WebGPU 自訂管線下可用。',
  aiUnavailableRendererPath: '將算繪模式切換為 WebGPU 自訂管線後才能開啟。',
  aiUnavailableModel: '宿主未設定 AI 模型根目錄。',
  aiUnavailableDevice: '此裝置沒有可用的 WebGPU 轉接器。',
  aiUnavailableNotImplemented: '目前版本尚未提供。',
  play: '播放', pause: '暫停', replay: '重新播放', nextEpisode: '下一集', mute: '靜音', unmute: '取消靜音', volume: '音量',
  seek: '進度', subtitles: '字幕', pictureInPicture: '子母畫面', exitPictureInPicture: '退出子母畫面', theater: '劇院模式', exitTheater: '退出劇院模式', settings: '設定', statistics: '詳細統計資訊', about: '關於',
  fullscreen: '全螢幕', exitFullscreen: '退出全螢幕', close: '關閉', subtitleOff: '關閉字幕', subtitleTracks: '字幕軌', subtitleStyle: '字幕樣式', subtitleFont: '選擇字型', subtitleEdit: '編輯字幕樣式', subtitleEditHint: '拖動字幕調整位置，拖動上下邊框調整大小', subtitleSample: '字幕範例', subtitleHold: '字幕選單開啟時已暫停', done: '完成', lockControls: '鎖定控制列', unlockControls: '解鎖控制列', fontFamily: '字型', fontSize: '字級', fontSystem: '系統預設', fontSans: '黑體', fontSerif: '宋體', fontKai: '楷體', fontRounded: '圓體', fontMono: '等寬', alignment: '對齊方式', horizontalPosition: '水平位置', subtitlePosition: '垂直位置', subtitleColor: '文字顏色', outlineColor: '外框顏色', outlineWidth: '外框寬度', bold: '粗體', italic: '斜體', underline: '底線', embeddedTrack: '內嵌', localTrack: '本機檔案', remoteTrack: '遠端網址', reset: '回復預設', playbackRate: '播放速度', noSubtitles: '沒有可用的字幕軌', loading: '載入中', buffering: '緩衝中', seeking: '跳轉中', error: '播放發生錯誤', unknownDuration: '直播',
  contextMenu: '播放器選單', loop: '循環播放', miniPlayer: '迷你播放器', exitMiniPlayer: '退出迷你播放器', copyVideoUrl: '複製影片網址', copyVideoUrlAtTime: '複製目前時間的影片網址', copyEmbedCode: '複製嵌入程式碼', copyDebugInfo: '複製除錯資訊', troubleshoot: '排解播放問題', copied: '已複製到剪貼簿', copyFailed: '剪貼簿無法使用',
  statsVideoId: '影片 ID / sCPN', statsViewport: '視區 / 影格', statsResolution: '目前 / 最佳解析度', statsVolume: '音量 / 正規化', statsCodecs: '編解碼器', statsColor: '色彩', statsConnection: '連線速度', statsNetwork: '網路活動', statsBufferHealth: '緩衝健康度', statsMystery: '除錯字串', statsDate: '日期', statsFrames: '丟棄 {dropped} / 共 {total} 影格', statsUnknown: '無法取得',
  troubleshootHealthy: '沒有偵測到播放問題。', troubleshootFindings: '偵測結果', troubleshootDroppedFrames: '正在丟影格。請降低解析度、關閉其他佔用 GPU 的分頁，或把播放意圖切回 Normal。', troubleshootBuffering: '資料供給不足。請檢查網路，並確認伺服器對 HTTP Range 請求回傳 206 Partial Content。', troubleshootError: '引擎回報了錯誤，下面的錯誤碼指向失敗的階段。', troubleshootNoAudioClock: '音訊時鐘未運行，影片時序改用媒體牆鐘，可能出現漂移。', troubleshootSoftwareDecode: '目前使用 WASM 解碼器。這個 Codec 在此瀏覽器上沒有硬體解碼。', troubleshootEnvironment: '執行環境', troubleshootCopyReport: '複製報告',
}

const JA: PlayerUiLabels = {
  aiEnhance: 'AI 補正', aiSuperResolution: '超解像', aiInterpolation: 'フレーム補間',
  renderMode: 'レンダリングモード', renderModeNative: 'ネイティブ再生', renderModeWebGpu: 'WebGPU カスタムパイプライン', renderModeFallback: 'WebGL2 カスタムパイプライン',
  renderModeHint: 'AI 補正は WebGPU カスタムパイプラインでのみ利用できます。',
  aiUnavailableRendererPath: 'WebGPU カスタムパイプラインに切り替えると有効になります。',
  aiUnavailableModel: 'ホストが AI モデルのルートを設定していません。',
  aiUnavailableDevice: 'この端末に利用可能な WebGPU アダプターがありません。',
  aiUnavailableNotImplemented: 'このビルドではまだ利用できません。',
  play: '再生', pause: '一時停止', replay: '最初から再生', nextEpisode: '次のエピソード', mute: 'ミュート', unmute: 'ミュート解除', volume: '音量',
  seek: 'シーク', subtitles: '字幕', pictureInPicture: 'ピクチャー イン ピクチャー', exitPictureInPicture: 'ピクチャー イン ピクチャーを終了', theater: 'シアターモード', exitTheater: 'シアターモードを終了', settings: '設定', statistics: '詳細統計情報', about: 'このプレーヤーについて',
  fullscreen: '全画面', exitFullscreen: '全画面を終了', close: '閉じる', subtitleOff: 'オフ', subtitleTracks: '字幕トラック', subtitleStyle: '字幕スタイル', subtitleFont: 'フォントを選択', subtitleEdit: '字幕スタイルを編集', subtitleEditHint: '字幕をドラッグして位置を調整、上下の枠をドラッグしてサイズを調整', subtitleSample: '字幕サンプル', subtitleHold: '字幕メニュー表示中は一時停止しています', done: '完了', lockControls: 'コントロールをロック', unlockControls: 'コントロールのロックを解除', fontFamily: 'フォント', fontSize: '文字サイズ', fontSystem: 'システム標準', fontSans: 'ゴシック体', fontSerif: '明朝体', fontKai: '楷書体', fontRounded: '丸ゴシック体', fontMono: '等幅', alignment: '配置', horizontalPosition: '水平位置', subtitlePosition: '垂直位置', subtitleColor: '文字色', outlineColor: '縁取りの色', outlineWidth: '縁取りの太さ', bold: '太字', italic: '斜体', underline: '下線', embeddedTrack: '内蔵', localTrack: 'ローカルファイル', remoteTrack: 'リモート URL', reset: '既定に戻す', playbackRate: '再生速度', noSubtitles: '利用できる字幕トラックがありません', loading: '読み込み中', buffering: 'バッファリング中', seeking: 'シーク中', error: '再生エラー', unknownDuration: 'ライブ',
  contextMenu: 'プレーヤーメニュー', loop: 'ループ再生', miniPlayer: 'ミニプレーヤー', exitMiniPlayer: 'ミニプレーヤーを終了', copyVideoUrl: '動画の URL をコピー', copyVideoUrlAtTime: '現在の時間の動画 URL をコピー', copyEmbedCode: '埋め込みコードをコピー', copyDebugInfo: 'デバッグ情報をコピー', troubleshoot: '再生の問題を報告', copied: 'クリップボードにコピーしました', copyFailed: 'クリップボードを利用できません',
  statsVideoId: '動画 ID / sCPN', statsViewport: 'ビューポート / フレーム', statsResolution: '現在 / 最適な解像度', statsVolume: '音量 / 正規化', statsCodecs: 'コーデック', statsColor: '色域', statsConnection: '接続速度', statsNetwork: 'ネットワーク活動', statsBufferHealth: 'バッファの健全性', statsMystery: 'デバッグ文字列', statsDate: '日時', statsFrames: '{total} 中 {dropped} ドロップ', statsUnknown: '取得できません',
  troubleshootHealthy: '再生の問題は検出されませんでした。', troubleshootFindings: '検出結果', troubleshootDroppedFrames: 'フレームがドロップしています。解像度を下げる、GPU を使う他のタブを閉じる、または再生インテントを Normal に戻してください。', troubleshootBuffering: 'データ供給が不足しています。ネットワークを確認し、サーバーが HTTP Range 要求に 206 Partial Content を返すことを確認してください。', troubleshootError: 'エンジンがエラーを報告しました。下のエラーコードが失敗した段階を示します。', troubleshootNoAudioClock: 'オーディオクロックが動作していないため、映像はメディアのウォールクロックに従い、ドリフトする可能性があります。', troubleshootSoftwareDecode: 'WASM デコーダーが有効です。このブラウザではこのコーデックのハードウェアデコードを利用できません。', troubleshootEnvironment: '実行環境', troubleshootCopyReport: 'レポートをコピー',
}

export const PLAYER_UI_LOCALES: Readonly<Record<PlayerUiLocale, PlayerUiLabels>> = Object.freeze({
  en: DEFAULT_LABELS,
  'zh-CN': ZH_CN,
  'zh-TW': ZH_TW,
  ja: JA,
})

export const PLAYER_UI_LOCALE_CODES: readonly PlayerUiLocale[] = Object.freeze(['en', 'zh-CN', 'zh-TW', 'ja'] as const)

/** Matches one BCP 47 tag against the shipped packs. Returns `null` when nothing applies. */
export function matchPlayerUiLocale(tag: string | null | undefined): PlayerUiLocale | null {
  if (typeof tag !== 'string') return null
  const normalized = tag.trim().toLowerCase()
  if (normalized.length === 0) return null
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja'
  if (normalized === 'zh' || normalized.startsWith('zh-') || normalized.startsWith('zh_')) {
    const parts = normalized.replace(/_/g, '-').split('-').slice(1)
    if (parts.includes('hant') || parts.includes('tw') || parts.includes('hk') || parts.includes('mo')) return 'zh-TW'
    return 'zh-CN'
  }
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  return null
}

/** Resolves a single tag, falling back to English. */
export function resolvePlayerUiLocale(tag: string | null | undefined): PlayerUiLocale {
  return matchPlayerUiLocale(tag) ?? 'en'
}

/** Picks the first supported locale from an ordered preference list. */
export function detectPlayerUiLocale(tags: readonly (string | null | undefined)[]): PlayerUiLocale {
  for (const tag of tags) {
    const matched = matchPlayerUiLocale(tag)
    if (matched !== null) return matched
  }
  return 'en'
}

export function playerUiLabels(locale: PlayerUiLocale): PlayerUiLabels {
  return PLAYER_UI_LOCALES[locale]
}
