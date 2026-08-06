# ADR-0002：单一 SDK API，内部选择 WASM 变体

## 状态

已接受。

## 决策

对外只发布一个 SDK 版本和一套 API。WASM 包内部可以同时包含单线程、SIMD 和多线程产物。只有选定 WASM Decoder 后才选择变体；未满足跨源隔离或初始化失败时自动回退单线程。

## 原因

开发者无需理解浏览器安全头和 WASM 编译差异，同时保证 GitHub/Docker/CDN 等不同部署环境都能运行。单线程与多线程通常需要不同的 WASM 编译配置，不能假设一个 pthread 二进制在无 SharedArrayBuffer 环境中正常运行。

