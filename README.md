# AI Agent Fullstack 2026

这是一个基于 Turborepo 的 AI Agent 全栈项目：

- `apps/api`: NestJS 后端，负责 RAG、LangGraph Agent 编排、Ollama 调用、SSE 流式输出和聊天落库。
- `apps/web`: Next.js 前端，提供类 ChatGPT 的流式聊天界面，支持文本、图片粘贴、拖拽上传和文件附件。

## 快速启动

```bash
pnpm install
pnpm db:up
pnpm prisma:generate
pnpm prisma:migrate
pnpm ollama:pull:chat
pnpm ollama:pull:embed
pnpm ollama:pull:vision
pnpm dev
```

默认访问地址：

- Web: `http://localhost:3001`
- API: `http://localhost:3000/api`
- Swagger UI: `http://localhost:3000/api/docs`
- PostgreSQL: `localhost:5433`
- Ollama: `http://127.0.0.1:11434`

## Swagger 文档预览

推荐使用：

```bash
pnpm api:docs
```

这个命令会检查本地 API 是否已经启动：

- 如果 API 已经在运行，会直接用 Chrome 打开 `http://localhost:3000/api/docs`。
- 如果 API 没有运行，会先启动 NestJS watch 服务，再等待 Swagger 可访问后自动打开 Chrome。

也可以手动启动后端：

```bash
pnpm api:dev
```

然后在浏览器打开：

```text
http://localhost:3000/api/docs
```

## 项目架构

```text
.
├─ apps
│  ├─ api
│  │  ├─ prisma                  # Prisma schema、migration、生成的 client
│  │  └─ src
│  │     ├─ agents               # Agent 对话、SSE、聊天记录落库
│  │     ├─ config               # 环境变量校验
│  │     ├─ database             # PrismaService
│  │     ├─ health               # 健康检查
│  │     ├─ ollama               # Ollama chat、embedding、vision 封装
│  │     └─ rag                  # 文档写入、切块、embedding、检索
│  └─ web
│     ├─ app                     # Next.js App Router
│     ├─ components              # 聊天主界面
│     ├─ config                  # 前端运行配置
│     └─ lib                     # SSE 流解析
├─ scripts                       # 本地开发辅助脚本
├─ docker-compose.yml
├─ pnpm-workspace.yaml
└─ turbo.json
```

整体调用链路：

```text
用户输入/上传附件
  -> Next.js ChatExperience
  -> POST /api/agents/chat/stream
  -> AgentsController DTO 校验
  -> AgentsService 编排 RAG + 模型调用
  -> RagService 检索知识库
  -> OllamaService 流式调用 chat/vision 模型
  -> SSE token/status/sources/done 回传前端
  -> ChatPersistenceService 写入会话、消息、附件、run、sources
```

## 前端说明

前端位于 `apps/web`，使用 Next.js App Router、React、TypeScript、`react-dropzone`、`react-markdown`、`react-syntax-highlighter` 和 `lucide-react`。

核心文件：

- `apps/web/components/chat-experience.tsx`: 聊天 UI、输入框、上传、粘贴、流式状态管理。
- `apps/web/lib/sse.ts`: 浏览器端 SSE 文本流解析器。
- `apps/web/config/chat.ts`: API 地址、附件限制、文本扩展名、starter prompts。
- `apps/web/app/globals.css`: 页面布局和组件样式。

已支持能力：

- 输入框发送文本消息。
- `POST /api/agents/chat/stream` SSE 流式读取模型回答。
- 粘贴图片、拖拽上传、点击上传文件。
- 图片以 data URL 发给后端，后端使用 Ollama vision 模型读取图片内容。
- 文本文件在浏览器侧提取内容后随请求发送。
- Markdown 和代码块渲染，代码块支持复制。
- 桌面和移动端响应式布局。

前端环境变量：

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api
```

写入位置：

```text
apps/web/.env.local
```

## 后端说明

后端位于 `apps/api`，使用 NestJS、Prisma、PostgreSQL、LangGraph、LangChain Ollama 和 Swagger。

核心模块：

- `AgentsModule`: 对话入口，提供同步回答、SSE 流式回答、会话查询。
- `RagModule`: 写入知识库文档、切块、生成 embedding、检索相关片段。
- `OllamaModule`: 封装本地/云端 Ollama 模型、embedding 模型、vision 模型。
- `DatabaseModule`: Prisma 连接和生命周期管理。
- `ConfigModule`: 使用 Zod 校验环境变量，避免服务启动后才发现配置错误。

主要 API：

- `GET /api/health`: 健康检查。
- `GET /api`: API 元信息。
- `POST /api/rag/documents`: 写入知识库文档。
- `GET /api/rag/documents`: 查询知识库文档。
- `DELETE /api/rag/documents/:id`: 删除知识库文档。
- `POST /api/rag/search`: 检索知识库。
- `POST /api/agents/chat`: 普通 JSON 对话。
- `POST /api/agents/chat/stream`: SSE 流式对话。
- `GET /api/agents/sessions`: 查询最近聊天会话。
- `GET /api/agents/sessions/:id`: 查询单个会话详情。

SSE 事件类型：

- `session`: 本次请求对应的会话、run、用户消息 id。
- `status`: 当前阶段，例如检索中、生成中。
- `sources`: RAG 命中的知识库片段。
- `token`: 模型增量输出。
- `done`: 完整答案和最终 sources。
- `error`: 流式处理异常。

## 数据库落库

聊天调用会写入以下表：

- `ChatSession`: 会话。
- `ChatMessage`: 用户消息和助手回复。
- `ChatAttachment`: 附件名称、类型、大小、hash、文本内容、图片 data URL 快照。
- `ChatRun`: 一次模型调用的 provider、model、状态、耗时和错误。
- `ChatSource`: 本次回答命中的 RAG sources 快照。

RAG 文档会写入：

- `Document`: 原始文档。
- `DocumentChunk`: 切块内容和 embedding。

当前项目为了本地演示和面试讲解，embedding 存为 JSON 并在服务端计算余弦相似度。生产环境建议改成 PostgreSQL `pgvector` 原生向量列和索引，避免数据量变大后全量扫描。

## 环境变量

根目录 `.env.example`：

```bash
NODE_ENV=development
PORT=3000

DATABASE_URL=postgresql://ai_agent:ai_agent@localhost:5433/ai_agent?schema=public

OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=gpt-oss:20b-cloud
OLLAMA_VISION_MODEL=qwen2.5vl:3b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_DIMENSION=768

RAG_CHUNK_SIZE=900
RAG_CHUNK_OVERLAP=120
RAG_DEFAULT_TOP_K=5
```

如果 `OLLAMA_CHAT_MODEL` 不支持图片，请配置 `OLLAMA_VISION_MODEL`。例如：

```bash
OLLAMA_VISION_MODEL=qwen2.5vl:3b
```

## 常用命令

```bash
pnpm dev                # Turbo 并行启动 api 和 web
pnpm api:docs           # 启动/复用 API，并用 Chrome 打开 Swagger UI
pnpm api:dev            # 只启动 Nest API
pnpm web:dev            # 只启动 Next Web
pnpm build              # 构建所有 app
pnpm lint               # API + Web lint
pnpm test               # 后端 Jest 单测
pnpm prisma:generate    # 生成 Prisma Client
pnpm prisma:migrate     # 本地开发迁移
pnpm prisma:deploy      # 部署环境执行 migration
pnpm prisma:studio      # 打开 Prisma Studio
pnpm db:up              # 启动 PostgreSQL/pgvector
pnpm db:down            # 停止数据库容器
pnpm ollama:pull:chat   # 拉取默认聊天模型
pnpm ollama:pull:embed  # 拉取 embedding 模型
pnpm ollama:pull:vision # 拉取视觉模型
```

## 接口调试示例

同步对话：

```bash
curl.exe -X POST http://localhost:3000/api/agents/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"请结合知识库解释 NestJS 里怎么拆 RAG 模块。\",\"topK\":5}"
```

SSE 流式对话：

```bash
curl.exe -N -X POST http://localhost:3000/api/agents/chat/stream ^
  -H "Accept: text/event-stream" ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"请结合知识库解释 NestJS 里怎么拆 RAG 模块。\",\"topK\":5}"
```

写入知识库：

```bash
curl.exe -X POST http://localhost:3000/api/rag/documents ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"NestJS Agent Notes\",\"content\":\"NestJS modules should separate API controllers, orchestration services, model providers, and database persistence.\"}"
```

## 已做的架构优化

- Monorepo 使用 Turborepo + pnpm workspace，前后端独立 package，根目录统一编排。
- API 使用 DTO + ValidationPipe 做请求校验，Swagger 复用 DTO 生成文档。
- SSE 接口关闭压缩，避免代理或压缩中间件影响流式输出。
- 数据库写入采用 best-effort 策略，数据库不可用时不阻断模型回答。
- 前端把聊天配置从组件抽到 `config/chat.ts`，组件更专注交互状态和渲染。
- 根目录 `.log`、构建产物、缓存、依赖目录均由 `.gitignore` 忽略，开发产生的日志文件不进入代码仓库。

## 后续可优化方向

- 抽出 `packages/shared`：沉淀前后端共用的 DTO type、SSE event type、附件限制常量。
- RAG 改用 pgvector：将 `DocumentChunk.embedding` 改成 vector 类型，并增加 ivfflat/hnsw 索引。
- 附件存储上对象存储：数据库只保存 `storageUri`、hash、metadata 和文本抽取结果。
- 增加鉴权和用户体系：将 `ChatSession`、`Document` 和 API 调用绑定到 user/project。
- 增加队列：大文档切块、embedding、图片 OCR 等任务放入后台队列。
- 增加结构化日志和 tracing：生产环境接入 OpenTelemetry、请求 id、模型耗时统计。
- 增加 CI：在 GitHub Actions 中执行 `pnpm lint`、`pnpm test`、`pnpm build`。
