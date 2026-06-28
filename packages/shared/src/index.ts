export const CHAT_ATTACHMENT_KINDS = ['text', 'image', 'file'] as const;

export type ChatAttachmentKind = (typeof CHAT_ATTACHMENT_KINDS)[number];

export const CHAT_LIMITS = {
  maxAttachments: 6,
  maxAttachmentSize: 4 * 1024 * 1024,
  maxAttachmentTextLength: 200_000,
  maxAttachmentDataUrlLength: 6_000_000,
  maxMessageLength: 20_000,
  minTopK: 1,
  maxTopK: 20,
  defaultTopK: 5,
} as const;

export const TEXT_ATTACHMENT_EXTENSIONS = [
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
] as const;

export type TextAttachmentExtension =
  (typeof TEXT_ATTACHMENT_EXTENSIONS)[number];

export type ChatAttachmentPayload = {
  name: string;
  mimeType: string;
  kind: ChatAttachmentKind;
  size: number;
  content?: string;
  dataUrl?: string;
};

export type ChatRequestPayload = {
  sessionId?: string;
  message?: string;
  topK?: number;
  attachments?: ChatAttachmentPayload[];
};

export type ChatSource = {
  documentId: string;
  chunkId: string;
  title: string | null;
  source: string | null;
  chunkIndex: number;
  score: number;
};

export type AgentSessionEvent = {
  type: 'session';
  sessionId: string;
  runId: string;
  userMessageId: string;
};

export type AgentStatusEvent = {
  type: 'status';
  stage: 'retrieving' | 'generating';
  message: string;
};

export type AgentSourcesEvent = {
  type: 'sources';
  sources: ChatSource[];
};

export type AgentTokenEvent = {
  type: 'token';
  content: string;
};

export type AgentDoneEvent = {
  type: 'done';
  answer: string;
  sources: ChatSource[];
  sessionId?: string;
  runId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
};

export type AgentStreamEvent =
  | AgentSessionEvent
  | AgentStatusEvent
  | AgentSourcesEvent
  | AgentTokenEvent
  | AgentDoneEvent;

export type AgentStreamErrorEvent = {
  type: 'error';
  message: string;
  retryable?: boolean;
};

export type AgentStreamPayload = AgentStreamEvent | AgentStreamErrorEvent;
