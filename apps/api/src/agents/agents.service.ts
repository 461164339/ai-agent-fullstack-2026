import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Env } from '../config/env.validation';
import { OllamaService } from '../ollama/ollama.service';
import { RagService } from '../rag/rag.service';
import { RetrievedChunk } from '../rag/rag.types';
import { ChatPersistenceService } from './chat-persistence.service';
import { ChatAttachmentDto, ChatDto } from './dto/chat.dto';

type ChatSource = {
  documentId: string;
  chunkId: string;
  title: string | null;
  source: string | null;
  chunkIndex: number;
  score: number;
};

export type AgentStreamEvent =
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
      sources: ChatSource[];
    }
  | {
      type: 'token';
      content: string;
    }
  | {
      type: 'done';
      answer: string;
      sources: ChatSource[];
      sessionId?: string;
      runId?: string;
      userMessageId?: string;
      assistantMessageId?: string;
    };

const AgentState = Annotation.Root({
  question: Annotation<string>(),
  topK: Annotation<number>(),
  attachments: Annotation<ChatAttachmentDto[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),
  retrieved: Annotation<RetrievedChunk[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),
  answer: Annotation<string>({
    reducer: (_, update) => update,
    default: () => '',
  }),
});

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);
  private readonly defaultTopK: number;
  private readonly ollamaBaseUrl: string;
  private readonly chatModelName: string;
  private readonly modelMaxAttempts = 2;
  private readonly modelRetryDelayMs = 600;
  private readonly modelFirstTokenTimeoutMs = 60_000;

  constructor(
    private readonly ragService: RagService,
    private readonly ollamaService: OllamaService,
    private readonly chatPersistence: ChatPersistenceService,
    configService: ConfigService<Env, true>,
  ) {
    this.defaultTopK = configService.getOrThrow<number>('RAG_DEFAULT_TOP_K');
    this.ollamaBaseUrl = configService.getOrThrow<string>('OLLAMA_BASE_URL');
    this.chatModelName = configService.getOrThrow<string>('OLLAMA_CHAT_MODEL');
  }

  async chat(dto: ChatDto) {
    const topK = dto.topK ?? this.defaultTopK;
    const attachments = dto.attachments ?? [];
    let modelName = this.getInitialModelName(attachments);
    let turn = await this.chatPersistence.startTurn({
      dto,
      model: modelName,
      topK,
    });

    try {
      const retrieved = await this.retrieveSafely(dto.message, topK);
      const sources = this.toSources(retrieved);

      modelName = await this.resolveGenerationModelName(attachments);
      await this.chatPersistence.updateRunModel(turn, modelName);

      const answer = await this.generateAnswer(
        dto.message,
        retrieved,
        attachments,
        modelName,
      );

      turn = await this.chatPersistence.completeTurn(turn, {
        answer,
        model: modelName,
        sources,
      });

      return {
        answer,
        assistantMessageId: turn.assistantMessageId,
        runId: turn.runId,
        sessionId: turn.sessionId,
        sources,
        userMessageId: turn.userMessageId,
      };
    } catch (error) {
      await this.chatPersistence.failTurn(turn, error);
      throw error;
    }
  }

  async *streamChat(
    dto: ChatDto,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentStreamEvent> {
    const topK = dto.topK ?? this.defaultTopK;
    const attachments = dto.attachments ?? [];
    let modelName = this.getInitialModelName(attachments);
    let turn = await this.chatPersistence.startTurn({
      dto,
      model: modelName,
      topK,
    });

    if (turn.persisted && turn.sessionId && turn.runId && turn.userMessageId) {
      yield {
        type: 'session',
        sessionId: turn.sessionId,
        runId: turn.runId,
        userMessageId: turn.userMessageId,
      };
    }

    yield {
      type: 'status',
      stage: 'retrieving',
      message: 'Retrieving relevant knowledge.',
    };

    const retrieved = await this.retrieveSafely(dto.message, topK);
    const sources = this.toSources(retrieved);

    yield {
      type: 'sources',
      sources,
    };

    if (signal?.aborted) {
      await this.chatPersistence.cancelTurn(turn);
      return;
    }

    yield {
      type: 'status',
      stage: 'generating',
      message: 'Generating answer.',
    };

    let answer = '';

    try {
      modelName = await this.resolveGenerationModelName(attachments);
      await this.chatPersistence.updateRunModel(turn, modelName);

      for await (const content of this.streamAnswerChunks(
        dto.message,
        retrieved,
        attachments,
        signal,
        modelName,
      )) {
        if (signal?.aborted) {
          await this.chatPersistence.cancelTurn(turn, answer);
          return;
        }

        answer += content;

        yield {
          type: 'token',
          content,
        };
      }

      turn = await this.chatPersistence.completeTurn(turn, {
        answer,
        model: modelName,
        sources,
      });

      yield {
        type: 'done',
        answer,
        assistantMessageId: turn.assistantMessageId,
        runId: turn.runId,
        sessionId: turn.sessionId,
        sources,
        userMessageId: turn.userMessageId,
      };
    } catch (error) {
      await this.chatPersistence.failTurn(turn, error, answer);
      throw error;
    }
  }

  listSessions(take?: number) {
    return this.chatPersistence.listSessions(take);
  }

  getSession(sessionId: string) {
    return this.chatPersistence.getSession(sessionId);
  }

  private getInitialModelName(attachments: ChatAttachmentDto[]) {
    return this.hasReadableImages(attachments)
      ? 'vision:unresolved'
      : this.chatModelName;
  }

  private async resolveGenerationModelName(attachments: ChatAttachmentDto[]) {
    if (this.hasReadableImages(attachments)) {
      return this.ollamaService.resolveVisionModelName();
    }

    return this.chatModelName;
  }

  private buildGraph() {
    const retrieve = async (state: typeof AgentState.State) => {
      const retrieved = await this.retrieveSafely(state.question, state.topK);

      return { retrieved };
    };

    const generateAnswer = async (state: typeof AgentState.State) => {
      const answer = await this.generateAnswer(
        state.question,
        state.retrieved,
        state.attachments,
      );

      return { answer };
    };

    return new StateGraph(AgentState)
      .addNode('retrieve', retrieve)
      .addNode('generateAnswer', generateAnswer)
      .addEdge(START, 'retrieve')
      .addEdge('retrieve', 'generateAnswer')
      .addEdge('generateAnswer', END)
      .compile();
  }

  private buildMessages(
    question: string,
    retrieved: RetrievedChunk[],
    attachments: ChatAttachmentDto[],
  ) {
    return [
      new SystemMessage(
        this.buildSystemPrompt(
          this.formatContext(retrieved),
          this.formatAttachments(attachments, false),
          false,
        ),
      ),
      new HumanMessage(question),
    ];
  }

  private async generateAnswer(
    question: string,
    retrieved: RetrievedChunk[],
    attachments: ChatAttachmentDto[],
    modelName?: string,
  ) {
    if (this.hasReadableImages(attachments)) {
      return this.generateVisionAnswer(
        question,
        retrieved,
        attachments,
        modelName,
      );
    }

    const messages = this.buildMessages(question, retrieved, attachments);
    const response = await this.withModelRetries(async () => {
      const model = this.ollamaService.createChatModel();

      return model.invoke(messages);
    });

    return this.messageContentToString(response.content);
  }

  private async *streamAnswerChunks(
    question: string,
    retrieved: RetrievedChunk[],
    attachments: ChatAttachmentDto[],
    signal?: AbortSignal,
    modelName?: string,
  ): AsyncGenerator<string> {
    if (this.hasReadableImages(attachments)) {
      yield* this.streamVisionAnswerChunks(
        question,
        retrieved,
        attachments,
        signal,
        modelName,
      );
      return;
    }

    const messages = this.buildMessages(question, retrieved, attachments);

    for (let attempt = 1; attempt <= this.modelMaxAttempts; attempt += 1) {
      let emittedToken = false;
      let firstTokenTimedOut = false;
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => {
        firstTokenTimedOut = true;
        timeoutController.abort();
      }, this.modelFirstTokenTimeoutMs);

      try {
        const model = this.ollamaService.createChatModel();
        const stream = await model.stream(messages, {
          signal: this.mergeAbortSignals(signal, timeoutController.signal),
        });

        for await (const chunk of stream) {
          if (signal?.aborted) {
            return;
          }

          const content = this.messageContentToString(chunk.content);

          if (!content) {
            continue;
          }

          emittedToken = true;
          clearTimeout(timeout);
          yield content;
        }

        return;
      } catch (error) {
        if (signal?.aborted) {
          return;
        }

        if (firstTokenTimedOut) {
          throw this.toModelRequestError(
            new Error(
              `Ollama did not emit the first token within ${this.modelFirstTokenTimeoutMs / 1000}s.`,
            ),
          );
        }

        if (this.isAbortError(error)) {
          return;
        }

        if (
          !emittedToken &&
          attempt < this.modelMaxAttempts &&
          this.isTransientModelError(error)
        ) {
          this.logger.warn(
            `Ollama stream failed before the first token; retrying (${attempt}/${this.modelMaxAttempts}). ${this.getErrorMessage(error)}`,
          );
          await this.delay(this.modelRetryDelayMs);
          continue;
        }

        throw this.toModelRequestError(error);
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private async withModelRetries<T>(operation: () => Promise<T>) {
    for (let attempt = 1; attempt <= this.modelMaxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (
          attempt < this.modelMaxAttempts &&
          this.isTransientModelError(error)
        ) {
          this.logger.warn(
            `Ollama request failed; retrying (${attempt}/${this.modelMaxAttempts}). ${this.getErrorMessage(error)}`,
          );
          await this.delay(this.modelRetryDelayMs);
          continue;
        }

        throw this.toModelRequestError(error);
      }
    }

    throw new Error('Ollama request failed after all retry attempts.');
  }

  private async generateVisionAnswer(
    question: string,
    retrieved: RetrievedChunk[],
    attachments: ChatAttachmentDto[],
    modelName?: string,
  ) {
    const model =
      modelName ?? (await this.ollamaService.resolveVisionModelName());
    const messages = this.buildNativeVisionMessages(
      question,
      retrieved,
      attachments,
    );

    return this.withModelRetries(() =>
      this.ollamaService.invokeNativeChat(model, messages),
    );
  }

  private async *streamVisionAnswerChunks(
    question: string,
    retrieved: RetrievedChunk[],
    attachments: ChatAttachmentDto[],
    signal?: AbortSignal,
    modelName?: string,
  ): AsyncGenerator<string> {
    const model =
      modelName ?? (await this.ollamaService.resolveVisionModelName());
    const messages = this.buildNativeVisionMessages(
      question,
      retrieved,
      attachments,
    );

    for (let attempt = 1; attempt <= this.modelMaxAttempts; attempt += 1) {
      let emittedToken = false;
      let firstTokenTimedOut = false;
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => {
        firstTokenTimedOut = true;
        timeoutController.abort();
      }, this.modelFirstTokenTimeoutMs);

      try {
        const stream = this.ollamaService.streamNativeChat(
          model,
          messages,
          this.mergeAbortSignals(signal, timeoutController.signal),
        );

        for await (const content of stream) {
          if (signal?.aborted) {
            return;
          }

          emittedToken = true;
          clearTimeout(timeout);
          yield content;
        }

        return;
      } catch (error) {
        if (signal?.aborted) {
          return;
        }

        if (firstTokenTimedOut) {
          throw this.toModelRequestError(
            new Error(
              `Ollama vision model did not emit the first token within ${this.modelFirstTokenTimeoutMs / 1000}s.`,
            ),
            model,
          );
        }

        if (this.isAbortError(error)) {
          return;
        }

        if (
          !emittedToken &&
          attempt < this.modelMaxAttempts &&
          this.isTransientModelError(error)
        ) {
          this.logger.warn(
            `Ollama vision stream failed before the first token; retrying (${attempt}/${this.modelMaxAttempts}). ${this.getErrorMessage(error)}`,
          );
          await this.delay(this.modelRetryDelayMs);
          continue;
        }

        throw this.toModelRequestError(error, model);
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private buildNativeVisionMessages(
    question: string,
    retrieved: RetrievedChunk[],
    attachments: ChatAttachmentDto[],
  ) {
    const images = this.getImageBase64Values(attachments);

    return [
      {
        role: 'system' as const,
        content: this.buildSystemPrompt(
          this.formatContext(retrieved),
          this.formatAttachments(attachments, true),
          true,
        ),
      },
      {
        role: 'user' as const,
        content: [
          question,
          '',
          `There ${images.length === 1 ? 'is' : 'are'} ${images.length} image${images.length === 1 ? '' : 's'} attached to this message. Inspect the pixels directly and answer the user's question.`,
          "Answer in the same language as the user's question.",
        ].join('\n'),
        images,
      },
    ];
  }

  private buildSystemPrompt(
    context: string,
    attachments: string,
    visionEnabled: boolean,
  ) {
    return [
      visionEnabled
        ? 'You are a helpful multimodal AI assistant.'
        : 'You are an engineering mentor for AI full-stack development.',
      'Answer in the same language as the user. If the user writes Chinese, answer in Chinese.',
      'Use the provided knowledge-base context when it is relevant.',
      'Use attached file text when it is relevant.',
      visionEnabled
        ? 'A vision-capable model is being used. Inspect attached image pixels directly and describe visible content accurately.'
        : 'For image-only attachments, only reference filename, type, and size unless a vision-capable model is configured.',
      'If no relevant context is available, answer from your general engineering knowledge instead of refusing.',
      'Keep answers structured, practical, and avoid inventing facts.',
      '',
      'Knowledge-base context:',
      context || 'No relevant context was retrieved.',
      '',
      'Attachments:',
      attachments || 'No files were attached.',
    ].join('\n');
  }

  private formatContext(chunks: RetrievedChunk[]) {
    return chunks
      .map((chunk, index) => {
        const label = chunk.title ?? chunk.source ?? chunk.documentId;

        return [
          `[${index + 1}] ${label} / chunk ${chunk.chunkIndex} / score ${chunk.score.toFixed(4)}`,
          chunk.content,
        ].join('\n');
      })
      .join('\n\n');
  }

  private async retrieveSafely(question: string, topK: number) {
    try {
      return await this.ragService.searchByText(question, topK);
    } catch (error) {
      this.logger.warn(
        `Knowledge retrieval failed; continuing without RAG context. ${this.getErrorMessage(error)}`,
      );

      return [];
    }
  }

  private formatAttachments(
    attachments: ChatAttachmentDto[],
    visionEnabled: boolean,
  ) {
    return attachments
      .map((attachment, index) => {
        const header = [
          `[${index + 1}] ${attachment.name}`,
          `kind: ${attachment.kind}`,
          `mime: ${attachment.mimeType || 'application/octet-stream'}`,
          `size: ${attachment.size} bytes`,
        ].join(' / ');

        if (attachment.content) {
          return [header, 'Extracted text:', attachment.content].join('\n');
        }

        if (attachment.kind === 'image') {
          return [
            header,
            visionEnabled
              ? 'Image binary data is attached to the current user message. Inspect the visual pixels directly.'
              : 'Image preview data was attached by the browser. Treat this as image metadata unless a vision-capable model is configured.',
          ].join('\n');
        }

        return [header, 'No text content was extracted for this file.'].join(
          '\n',
        );
      })
      .join('\n\n');
  }

  private hasReadableImages(attachments: ChatAttachmentDto[]) {
    return attachments.some(
      (attachment) => attachment.kind === 'image' && attachment.dataUrl,
    );
  }

  private getImageBase64Values(attachments: ChatAttachmentDto[]) {
    return attachments
      .filter((attachment) => attachment.kind === 'image' && attachment.dataUrl)
      .map((attachment) => this.dataUrlToBase64(attachment.dataUrl));
  }

  private dataUrlToBase64(dataUrl: string | undefined) {
    if (!dataUrl) {
      return '';
    }

    const match = /^data:[^;]+;base64,(?<base64>.+)$/u.exec(dataUrl);

    if (match?.groups?.base64) {
      return match.groups.base64;
    }

    return dataUrl;
  }

  private toSources(chunks: RetrievedChunk[]): ChatSource[] {
    return chunks.map((chunk) => ({
      documentId: chunk.documentId,
      chunkId: chunk.id,
      title: chunk.title,
      source: chunk.source,
      chunkIndex: chunk.chunkIndex,
      score: chunk.score,
    }));
  }

  private messageContentToString(content: unknown) {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      const parts: unknown[] = content;

      return parts
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }

          if (typeof part === 'object' && part !== null && 'text' in part) {
            const textPart = part as { text?: unknown };

            if (typeof textPart.text === 'string') {
              return textPart.text;
            }
          }

          return JSON.stringify(part);
        })
        .join('');
    }

    return String(content);
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private toModelRequestError(error: unknown, modelName = this.chatModelName) {
    const detail = this.getErrorMessage(error);
    const transientHint = this.isTransientModelError(error)
      ? ' The failure looks network-related.'
      : '';

    return new Error(
      [
        `Ollama model request failed while using ${modelName} at ${this.ollamaBaseUrl}.`,
        `Original error: ${detail || 'unknown error'}.`,
        `${transientHint} Check that Ollama is running, the model is available, and cloud models can reach ollama.com. For image uploads, set OLLAMA_VISION_MODEL to an accessible vision model such as qwen2.5vl, llava, or an authorized cloud vision model.`,
      ].join(' '),
      { cause: error },
    );
  }

  private isTransientModelError(error: unknown) {
    const message = this.getErrorMessage(error).toLowerCase();
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code).toLowerCase()
        : '';

    return [
      'network error',
      'fetch failed',
      'econnrefused',
      'econnreset',
      'etimedout',
      'socket',
      'terminated',
      'timeout',
      'temporarily unavailable',
      'service unavailable',
    ].some((needle) => message.includes(needle) || code.includes(needle));
  }

  private isAbortError(error: unknown) {
    if (!(error instanceof Error)) {
      return false;
    }

    return (
      error.name === 'AbortError' ||
      error.message === 'This operation was aborted'
    );
  }

  private mergeAbortSignals(...signals: Array<AbortSignal | undefined>) {
    const activeSignals = signals.filter((signal): signal is AbortSignal =>
      Boolean(signal),
    );

    if (activeSignals.length === 0) {
      return undefined;
    }

    if (activeSignals.length === 1) {
      return activeSignals[0];
    }

    const controller = new AbortController();

    for (const signal of activeSignals) {
      if (signal.aborted) {
        controller.abort();
        break;
      }

      signal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }

    return controller.signal;
  }

  private delay(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
