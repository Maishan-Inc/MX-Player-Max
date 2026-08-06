# MX-Player-Max Demo

高端产品演示站和在线能力探测入口。演示站使用独立视觉系统，不复用 MX-Player-Pro 的页面布局。

## Docker

```bash
docker compose up --build
```

访问 `http://localhost:4173`。Nginx 会注入 COOP/COEP，使支持条件的环境能够验证多线程 WASM。

