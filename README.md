# AI Agent Turborepo

这是一个 Turborepo monorepo：后端是 NestJS AI agent API，前端是 Next.js 流式聊天界面。

## 项目结构

```text
apps/
  api/   NestJS + LangGraph + RAG + Ollama + Prisma
  web/   Next.js App Router + React + SSE chat UI
```

## 快速启动

```bash
pnpm install
pnpm db:up
pnpm prisma:generate
pnpm prisma:migrate
pnpm ollama:pull:chat
pnpm ollama:pull:embed
pnpm api:dev
pnpm web:dev
```

默认地址：

- Web: `http://localhost:3001`
- API: `http://localhost:3000/api`
- Swagger: `http://localhost:3000/docs`
- PostgreSQL: `localhost:5433`
- Ollama: `http://127.0.0.1:11434`

前端默认调用 `http://localhost:3000/api`。如果要改 API 地址，在 `apps/web/.env.local` 写：

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api
```

## 图片和附件

聊天框支持拖拽上传、点击上传、粘贴图片和文本文件。文本文件会在浏览器里提取文本后随请求发送；图片会以 data URL 形式发送到后端，后端会剥离 base64 并调用 Ollama 原生 `/api/chat` vision 请求。

如果 `OLLAMA_CHAT_MODEL` 本身不支持 vision，请在 `.env` 配置一个可访问的视觉模型：

```bash
OLLAMA_VISION_MODEL=qwen2.5vl:3b
```

也可以先拉取本地视觉模型：

```bash
pnpm ollama:pull:vision
```

## SSE Agent API

普通 JSON：

```bash
curl.exe -X POST http://localhost:3000/api/agents/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"请结合知识库解释 NestJS 里怎么拆 RAG 模块。\",\"topK\":5}"
```

SSE 流式输出：

```bash
curl.exe -N -X POST http://localhost:3000/api/agents/chat/stream ^
  -H "Accept: text/event-stream" ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"请结合知识库解释 NestJS 里怎么拆 RAG 模块。\",\"topK\":5}"
```

事件类型：

- `session`: 本次请求对应的会话、run、用户消息 id
- `status`: 检索或生成阶段
- `sources`: RAG 命中的知识库片段
- `token`: 模型增量输出
- `done`: 完整答案和最终 sources
- `error`: 流式处理异常

## 聊天落库

Web 端调用 `POST /api/agents/chat/stream` 时，后端会写入：

- `ChatSession`: 会话
- `ChatMessage`: 用户消息和助手最终回复
- `ChatAttachment`: 附件名称、类型、大小、hash、文本内容和本地 data URL 快照
- `ChatRun`: 本次模型调用的状态、模型、耗时和错误信息
- `ChatSource`: 本次回答命中的 RAG sources 快照

查询接口：

```bash
curl.exe http://localhost:3000/api/agents/sessions
curl.exe http://localhost:3000/api/agents/sessions/<sessionId>
```

新增或更新聊天落库表后，执行：

```bash
pnpm prisma:generate
pnpm prisma:deploy
```

生产环境建议把大文件和图片原始二进制放到对象存储，数据库保留 `storageUri`、hash、metadata 和文本抽取结果；当前项目为了本地可验收，会把浏览器传来的图片 data URL 快照也保存下来。

## 常用脚本

```bash
pnpm dev                # Turbo 并行启动 api 和 web
pnpm build              # Turbo 构建所有 app
pnpm test               # 后端 Jest 单测
pnpm lint               # API + Web lint
pnpm api:dev            # 只启动 Nest API
pnpm web:dev            # 只启动 Next Web
pnpm prisma:generate    # 生成 Prisma Client
pnpm prisma:migrate     # 执行开发迁移
pnpm db:up              # 启动 PostgreSQL/pgvector
pnpm ollama:up          # 用 Docker 启动 Ollama
pnpm ollama:pull:vision # 拉取本地视觉模型
```

## 技术栈

- Monorepo: Turborepo + pnpm workspace
- API: NestJS 11, LangGraph JS, LangChain Ollama, Prisma 7, PostgreSQL
- Web: Next.js 16 App Router, React 19, TypeScript, SSE streaming, Markdown rendering
- AI runtime: Ollama chat model + embedding model, RAG retrieval, LangGraph orchestration
