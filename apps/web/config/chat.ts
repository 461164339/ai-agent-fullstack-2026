export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api';

export const MAX_ATTACHMENTS = 6;
export const MAX_FILE_SIZE = 4 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;

export const TEXT_EXTENSIONS = new Set([
  'csv',
  'css',
  'html',
  'js',
  'jsx',
  'json',
  'md',
  'sql',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
]);

export const STARTER_PROMPTS = [
  '帮我解释一下这个项目的 RAG 模块怎么拆分。',
  '结合知识库总结 NestJS agent 的执行链路。',
  '给我一个前后端联调 SSE 的排查清单。',
];
