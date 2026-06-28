'use client';

import {
  Bot,
  Check,
  ChevronDown,
  CircleStop,
  Copy,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  SendHorizontal,
  Sparkles,
  UploadCloud,
  UserRound,
  X,
} from 'lucide-react';
import {
  type ComponentProps,
  type FormEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

import {
  API_BASE_URL,
  MAX_ATTACHMENTS,
  MAX_FILE_SIZE,
  MAX_TEXT_CHARS,
  STARTER_PROMPTS,
  TEXT_EXTENSIONS,
} from '@/config/chat';
import { readSseStream } from '@/lib/sse';

type Source = {
  documentId: string;
  chunkId: string;
  title: string | null;
  source: string | null;
  chunkIndex: number;
  score: number;
};

type AttachmentKind = 'text' | 'image' | 'file';

type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  size: number;
  content?: string;
  dataUrl?: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
  sources?: Source[];
};

type StreamPayload =
  | {
      type: 'session';
      sessionId: string;
      runId: string;
      userMessageId: string;
    }
  | {
      type: 'status';
      stage: 'retrieving' | 'generating';
      message: string;
    }
  | {
      type: 'sources';
      sources: Source[];
    }
  | {
      type: 'token';
      content: string;
    }
  | {
      type: 'done';
      answer: string;
      assistantMessageId?: string;
      runId?: string;
      sessionId?: string;
      sources: Source[];
      userMessageId?: string;
    }
  | {
      type: 'error';
      message: string;
      retryable?: boolean;
    };

type ApiErrorBody = {
  message?: unknown;
  error?: unknown;
  statusCode?: unknown;
};

type MarkdownCodeProps = ComponentProps<'code'> & {
  node?: unknown;
};

const languageAliases: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  ps: 'powershell',
  ps1: 'powershell',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  tsx: 'tsx',
};

const markdownComponents: Components = {
  pre({ children }) {
    return <>{children}</>;
  },
  code: MarkdownCode,
};

export function ChatExperience() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isReadingFiles, setIsReadingFiles] = useState(false);
  const [error, setError] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const canSubmit =
    (input.trim().length > 0 || attachments.length > 0) &&
    !isStreaming &&
    !isReadingFiles;
  const title = useMemo(
    () =>
      messages.length === 0 ? 'What can I help you build?' : 'AI Agent Nest',
    [messages.length],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || isStreaming) {
        return;
      }

      const remaining = MAX_ATTACHMENTS - attachments.length;

      if (remaining <= 0) {
        setError(`最多只能添加 ${MAX_ATTACHMENTS} 个附件。`);
        return;
      }

      const accepted = files
        .filter((file) => {
          if (file.size > MAX_FILE_SIZE) {
            setError(`${file.name} 超过 ${formatBytes(MAX_FILE_SIZE)}。`);
            return false;
          }

          return true;
        })
        .slice(0, remaining);

      if (accepted.length < files.length) {
        setError(`最多只能添加 ${MAX_ATTACHMENTS} 个附件。`);
      } else {
        setError('');
      }

      if (accepted.length === 0) {
        return;
      }

      setIsReadingFiles(true);

      try {
        const parsed = await Promise.all(accepted.map(readAttachment));
        setAttachments((current) =>
          [...current, ...parsed].slice(0, MAX_ATTACHMENTS),
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '读取附件失败。');
      } finally {
        setIsReadingFiles(false);
      }
    },
    [attachments.length, isStreaming],
  );

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      if (fileRejections.length > 0) {
        const first = fileRejections[0];
        setError(
          `${first.file.name} 无法添加：${
            first.errors[0]?.message ?? '文件不符合要求。'
          }`,
        );
      }

      void addFiles(acceptedFiles);
    },
    [addFiles],
  );

  const { getInputProps, getRootProps, isDragActive, open } = useDropzone({
    disabled: isStreaming,
    maxFiles: MAX_ATTACHMENTS,
    maxSize: MAX_FILE_SIZE,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    onDrop,
  });

  async function submitMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    const message = input.trim();
    const outgoingAttachments = attachments;

    if ((!message && outgoingAttachments.length === 0) || isStreaming) {
      return;
    }

    const prompt = message || '请分析我上传的附件。';
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      attachments: outgoingAttachments,
    };
    const assistantId = crypto.randomUUID();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      sources: [],
    };

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setInput('');
    setAttachments([]);
    setError('');
    setStatus('connecting');
    setIsStreaming(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const response = await fetch(`${API_BASE_URL}/agents/chat/stream`, {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attachments: outgoingAttachments.map(toApiAttachment),
          message: prompt,
          ...(sessionId ? { sessionId } : {}),
          topK: 5,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      await readSseStream(response, ({ data }) => {
        const payload = JSON.parse(data) as StreamPayload;

        if (payload.type === 'session') {
          setSessionId(payload.sessionId);
          return;
        }

        if (payload.type === 'status') {
          setStatus(payload.message);
          return;
        }

        if (payload.type === 'sources') {
          updateAssistant(assistantId, {
            sources: payload.sources,
          });
          return;
        }

        if (payload.type === 'token') {
          appendAssistantContent(assistantId, payload.content);
          return;
        }

        if (payload.type === 'done') {
          if (payload.sessionId) {
            setSessionId(payload.sessionId);
          }

          updateAssistant(assistantId, {
            content: payload.answer,
            sources: payload.sources,
          });
          setStatus('');
          return;
        }

        if (payload.type === 'error') {
          const errorMessage = normalizeRequestError(payload.message);

          setError(errorMessage);
          updateAssistant(assistantId, {
            content: `请求失败：${errorMessage}`,
          });
          setStatus('');
        }
      });
    } catch (caught) {
      if (abortController.signal.aborted) {
        setStatus('');
        return;
      }

      const message =
        caught instanceof Error ? caught.message : 'Streaming request failed.';
      const normalizedMessage = normalizeRequestError(message);

      setError(normalizedMessage);
      updateAssistant(assistantId, {
        content: `请求失败：${normalizedMessage}`,
      });
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      setStatus('');
    }
  }

  function appendAssistantContent(id: string, chunk: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id
          ? {
              ...message,
              content: message.content + chunk,
            }
          : message,
      ),
    );
  }

  function updateAssistant(id: string, patch: Partial<ChatMessage>) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id
          ? {
              ...message,
              ...patch,
            }
          : message,
      ),
    );
  }

  function removeAttachment(id: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id),
    );
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  function applyStarterPrompt(prompt: string) {
    if (isStreaming) {
      return;
    }

    setInput(prompt);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          <span>AI Agent Nest</span>
        </div>
        <button className="model-button" type="button" title="Agent runtime">
          <Bot size={16} />
          <span>LangGraph + Ollama</span>
          <ChevronDown size={15} />
        </button>
      </header>

      <section className="conversation" aria-label="Chat conversation">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true">
              <Sparkles size={28} />
            </div>
            <h1>{title}</h1>
            <div className="starter-grid">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  className="starter"
                  type="button"
                  onClick={() => applyStarterPrompt(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="message-list">
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="avatar" aria-hidden="true">
                  {message.role === 'assistant' ? (
                    <Bot size={18} />
                  ) : (
                    <UserRound size={18} />
                  )}
                </div>
                <div className="message-body">
                  {message.content ? (
                    <ReactMarkdown components={markdownComponents}>
                      {message.content}
                    </ReactMarkdown>
                  ) : (
                    <div className="typing">
                      <Loader2 size={16} />
                      <span>{status || 'thinking'}</span>
                    </div>
                  )}
                  {message.attachments && message.attachments.length > 0 ? (
                    <AttachmentList attachments={message.attachments} />
                  ) : null}
                  {message.role === 'assistant' &&
                  message.sources &&
                  message.sources.length > 0 ? (
                    <div className="sources">
                      {message.sources.map((source) => (
                        <span className="source-chip" key={source.chunkId}>
                          {source.title || source.source || 'Document'} #
                          {source.chunkIndex + 1}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div
        {...getRootProps({
          className: `composer-wrap${isDragActive ? ' dragging' : ''}`,
        })}
      >
        <input {...getInputProps()} />
        {isDragActive ? (
          <div className="drop-overlay" aria-hidden="true">
            <UploadCloud size={22} />
            <span>松开即可添加</span>
          </div>
        ) : null}
        <div className="composer-stack">
          {error ? <p className="error-line">{error}</p> : null}
          {attachments.length > 0 ? (
            <div className="pending-attachments">
              {attachments.map((attachment) => (
                <AttachmentPill
                  attachment={attachment}
                  key={attachment.id}
                  onRemove={() => removeAttachment(attachment.id)}
                />
              ))}
            </div>
          ) : null}
          <form className="composer" onSubmit={submitMessage}>
            <button
              className={`icon-button attach${
                isReadingFiles ? ' loading' : ''
              }`}
              disabled={isStreaming || isReadingFiles}
              onClick={() => open()}
              title="Attach files"
              type="button"
            >
              {isReadingFiles ? <Loader2 size={18} /> : <Paperclip size={18} />}
            </button>
            <textarea
              aria-label="Message"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);

                if (files.length > 0) {
                  event.preventDefault();
                  void addFiles(files);
                }
              }}
              placeholder="Message the agent"
              rows={1}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submitMessage();
                }
              }}
            />
            {isStreaming ? (
              <button
                className="icon-button stop"
                type="button"
                onClick={stopStreaming}
                title="Stop"
              >
                <CircleStop size={18} />
              </button>
            ) : (
              <button
                className="icon-button send"
                type="submit"
                disabled={!canSubmit}
                title="Send"
              >
                <SendHorizontal size={18} />
              </button>
            )}
          </form>
        </div>
      </div>
    </main>
  );
}

function MarkdownCode({
  className,
  children,
  node,
  ...props
}: MarkdownCodeProps) {
  void node;

  const [copied, setCopied] = useState(false);
  const rawCode = stringifyCode(children);
  const language = getLanguage(className);
  const isBlock = Boolean(language) || rawCode.includes('\n');

  if (!isBlock) {
    return (
      <code className="inline-code" {...props}>
        {children}
      </code>
    );
  }

  const code = rawCode.replace(/\n$/, '');
  const highlightedLanguage = language ? normalizeLanguage(language) : 'text';
  const languageLabel = language ? language.toUpperCase() : 'TEXT';
  const showLineNumbers = code.split('\n').length > 1;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-shell">
      <div className="code-titlebar">
        <div className="code-title-left">
          <span className="code-dot" aria-hidden="true" />
          <span className="code-lang">{languageLabel}</span>
        </div>
        <button
          className="code-copy"
          type="button"
          title={copied ? 'Copied' : 'Copy code'}
          onClick={() => void copyCode()}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
      <div className="code-scroll">
        <SyntaxHighlighter
          codeTagProps={{
            style: {
              fontFamily: 'inherit',
            },
          }}
          customStyle={{
            margin: 0,
            padding: '18px 20px',
            background: '#1e1e1e',
            fontFamily:
              'Cascadia Code, Consolas, Monaco, "SFMono-Regular", "Liberation Mono", monospace',
            fontSize: '13.5px',
            lineHeight: 1.72,
          }}
          language={highlightedLanguage}
          lineNumberStyle={{
            minWidth: '2.75em',
            marginRight: '16px',
            paddingRight: '12px',
            borderRight: '1px solid #333337',
            color: '#858585',
            textAlign: 'right',
            userSelect: 'none',
          }}
          showLineNumbers={showLineNumbers}
          style={vscDarkPlus}
          wrapLongLines={false}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

function AttachmentList({ attachments }: { attachments: ChatAttachment[] }) {
  return (
    <div className="message-attachments">
      {attachments.map((attachment) => (
        <div className="message-attachment" key={attachment.id}>
          <AttachmentIcon attachment={attachment} />
          <span>{attachment.name}</span>
        </div>
      ))}
    </div>
  );
}

function AttachmentPill({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove: () => void;
}) {
  return (
    <div className="attachment-pill">
      <AttachmentIcon attachment={attachment} />
      <div className="attachment-meta">
        <span>{attachment.name}</span>
        <small>{formatBytes(attachment.size)}</small>
      </div>
      <button
        className="remove-attachment"
        onClick={onRemove}
        title="Remove attachment"
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function AttachmentIcon({ attachment }: { attachment: ChatAttachment }) {
  if (attachment.kind === 'image' && attachment.dataUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={attachment.name}
        className="attachment-thumb"
        src={attachment.dataUrl}
      />
    );
  }

  if (attachment.kind === 'image') {
    return <ImageIcon className="attachment-icon" size={18} />;
  }

  return <FileText className="attachment-icon" size={18} />;
}

function stringifyCode(children: ComponentProps<'code'>['children']) {
  if (Array.isArray(children)) {
    return children
      .map((child) => (typeof child === 'string' ? child : ''))
      .join('');
  }

  return typeof children === 'string' ? children : String(children ?? '');
}

function getLanguage(className?: string) {
  return /language-([\w-]+)/.exec(className ?? '')?.[1];
}

function normalizeLanguage(language: string) {
  return languageAliases[language.toLowerCase()] ?? language;
}

async function readApiError(response: Response) {
  const fallback = `API request failed with ${response.status}.`;

  try {
    const text = await response.text();

    if (!text.trim()) {
      return fallback;
    }

    try {
      const body = JSON.parse(text) as ApiErrorBody;
      const message = getUnknownMessage(body.message) ?? body.error;

      if (typeof message === 'string' && message.trim().length > 0) {
        return `API ${response.status}: ${message.trim()}`;
      }
    } catch {
      return text.trim();
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function getUnknownMessage(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .join(', ');
  }

  return undefined;
}

function normalizeRequestError(message: string) {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  if (
    lower.includes('ollama model request failed') ||
    lower.includes('network error')
  ) {
    return [
      '模型服务网络异常。',
      '请确认 Ollama 正在运行、cloud 模型已登录且网络可达，或把 OLLAMA_CHAT_MODEL 改成本地模型。',
      trimmed,
    ].join(' ');
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed') ||
    lower.includes('econnrefused')
  ) {
    return [
      '无法连接 API 服务。',
      '请确认 Nest API 在 http://localhost:3000 运行，并检查 NEXT_PUBLIC_API_BASE_URL。',
      trimmed,
    ].join(' ');
  }

  return trimmed || 'Streaming request failed.';
}

function toApiAttachment(attachment: ChatAttachment) {
  return {
    content: attachment.content,
    dataUrl: attachment.dataUrl,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    name: attachment.name,
    size: attachment.size,
  };
}

async function readAttachment(file: File): Promise<ChatAttachment> {
  const kind = getAttachmentKind(file);
  const attachment: ChatAttachment = {
    id: crypto.randomUUID(),
    kind,
    mimeType: file.type || 'application/octet-stream',
    name: file.name || 'pasted-file',
    size: file.size,
  };

  if (kind === 'image') {
    attachment.dataUrl = await readFileAsDataUrl(file);
    return attachment;
  }

  if (kind === 'text') {
    const text = await file.text();
    attachment.content =
      text.length > MAX_TEXT_CHARS
        ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[content truncated]`
        : text;
  }

  return attachment;
}

function getAttachmentKind(file: File): AttachmentKind {
  if (file.type.startsWith('image/')) {
    return 'image';
  }

  if (isTextFile(file)) {
    return 'text';
  }

  return 'file';
}

function isTextFile(file: File) {
  if (file.type.startsWith('text/')) {
    return true;
  }

  const extension = file.name.split('.').pop()?.toLowerCase();

  return extension ? TEXT_EXTENSIONS.has(extension) : false;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('图片读取失败。'));
    });
    reader.addEventListener('error', () => reject(new Error('图片读取失败。')));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
