# ADR-0001：HTMLVideo 与自定义帧管线采用双渲染路径

## 状态

已接受。

## 决策

普通播放使用 HTMLVideo 原生显示和音画同步。WebCodecs/WASM 以及启用高级处理的 HTMLVideo 使用自定义 Frame Adapter 和 WebGPU/WebGL2/Canvas2D 渲染器。

## 原因

原生路径可以保留硬件解码、低功耗、HDR、DRM 和系统播放能力。强制把所有画面转为 VideoFrame 会引入拷贝、色彩管理、CORS/DRM 限制和额外功耗。

