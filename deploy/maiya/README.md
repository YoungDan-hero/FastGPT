# Maiya Studio 单机部署

Compose 从仓库内的当前源码构建 Maiya Studio，并启动 AI Proxy、工作流代码沙箱、MCP SSE 和 MinerU PDF 增强服务。空库初始化时写入 9 个模型和「知识库销售陪练」模板。使用模板新建应用后，在知识库检索节点绑定实际业务知识库。

## 启动

1. 在本目录复制 `.env.example` 为 `.env.local`，权限设成 `0600`。填写阿里百炼和火山方舟的 API Key，其余内部密钥各自使用 `openssl rand -hex 24` 生成。数据库密码使用纯字母数字。
2. 用 Docker Compose v2 或兼容版本构建和启动。

   ```sh
   docker compose --env-file .env.local config --quiet
   docker compose --env-file .env.local build app pdf-parser
   docker compose --env-file .env.local up -d --wait --wait-timeout 240
   ```

   App 镜像使用仓库的 Webpack 生产构建入口，包含类型检查、静态页面和 standalone 服务。构建默认给 Node 分配 5632 MiB 堆，可用 `--build-arg BUILD_NODE_HEAP_MB=…` 调整。构建环境使用网络代理时，传入构建容器可访问的 `--build-arg HTTP_PROXY=…` 和 `--build-arg HTTPS_PROXY=…`。

   已有对应架构的 App 和 PDF 镜像时，填写 `MAIYA_APP_IMAGE` 和 `MAIYA_PDF_IMAGE` 后可执行 `docker compose --env-file .env.local up -d --no-build --wait --wait-timeout 240`。

3. 本机打开 [Maiya Studio](http://127.0.0.1:13100)，使用 `root` 和初始密码 `123456` 登录，按页面提示完成激活和改密。MCP SSE 网关在 `http://127.0.0.1:13103`，完整地址在工作台「MCP 服务」中生成。
4. 在知识库导入 PDF 时打开「PDF 增强解析」。首次解析会下载 MinerU 模型权重，后续使用 `pdf-cache` 卷。按服务器的网络环境填写 `PDF_MODEL_SOURCE`（`auto`、`huggingface` 或 `modelscope`）和可选的 `PDF_MODEL_HTTPS_PROXY`。AI Proxy 使用 SQLite 单机持久化。数据库、文件、模型渠道和缓存均由 Compose 命名卷保存。

`docker compose --env-file .env.local down` 停止这一套服务并保留数据。模型渠道在首次启动时创建，后续换上游 Key 可在管理员的模型渠道页面更新。

## 接入正式域名和飞书

1. 在 `.env.local` 填写正式的 `MAIYA_PUBLIC_URL` 和 `MCP_SSE_PUBLIC_URL`，将 `MAIYA_COOKIE_SECURE` 设为 `true`。若复用已初始化的卷，同步通过管理员的实例配置保存站点地址、MCP SSE 地址和安全 Cookie 设置。
2. 在同一台主机的 HTTPS 反向代理转发应用和 MCP 的对应端口，保留原始 Host 和 HTTPS 协议信息。给 MCP 使用独立域名，保留请求路径，关闭 SSE 响应缓冲和含密钥路径的访问日志。Compose 自带的 MCP 网关会清除外部请求中的身份代理头。
3. 将 `https://<正式应用域名>/api/support/user/account/login/feishu/callback` 配到飞书自建应用的重定向 URL。填写飞书登录应用和受保护管理员的配置后启用 `FEISHU_ORG_ENABLED`。转人工机器人使用独立的 `FEISHU_BOT_APP_ID` 和 `FEISHU_BOT_APP_SECRET` 配置。

生产首次开放入口前先在回环地址完成 root 激活。单独保存 `.env.local` 和持久化卷备份，恢复已初始化的卷时使用原有的 `AES256_SECRET_KEY`。
