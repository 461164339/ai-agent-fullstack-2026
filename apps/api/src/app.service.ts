import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      name: 'ai-agent-nestjs',
      stack: [
        'NestJS',
        'Prisma',
        'PostgreSQL',
        'pgvector',
        'LangGraph',
        'RAG',
        'Ollama',
        'Next.js',
        'SSE',
      ],
      docs: '/docs',
      health: '/api/health',
      examples: {
        addKnowledge: {
          method: 'POST',
          path: '/api/rag/documents',
          body: {
            title: 'NestJS Agent Notes',
            content: 'Write your local knowledge-base text here.',
          },
        },
        chat: {
          method: 'POST',
          path: '/api/agents/chat',
          body: {
            message: '你的问题',
            topK: 5,
          },
        },
        streamChat: {
          method: 'POST',
          path: '/api/agents/chat/stream',
          body: {
            message: '你的问题',
            topK: 5,
          },
        },
      },
    };
  }
}
