import { CHAT_LIMITS, TEXT_ATTACHMENT_EXTENSIONS } from '@ai-agent/shared';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api';

export const MAX_ATTACHMENTS = CHAT_LIMITS.maxAttachments;
export const MAX_FILE_SIZE = CHAT_LIMITS.maxAttachmentSize;
export const MAX_TEXT_CHARS = CHAT_LIMITS.maxAttachmentTextLength;

export const TEXT_EXTENSIONS = new Set<string>(TEXT_ATTACHMENT_EXTENSIONS);

export const STARTER_PROMPTS = [
  '帮我解释一下这个项目的 RAG 模块怎么拆分。',
  '结合知识库总结 NestJS agent 的执行链路。',
  '给我一个前后端联调 SSE 的排查清单。',
];
