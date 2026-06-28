import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOllama, OllamaEmbeddings } from '@langchain/ollama';

import { Env } from '../config/env.validation';

type OllamaChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
};

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
    remote_host?: string;
    capabilities?: string[];
  }>;
};

type OllamaChatChunk = {
  message?: {
    content?: string;
  };
  error?: string;
};

@Injectable()
export class OllamaService {
  private readonly baseUrl: string;
  private readonly chatModelName: string;
  private readonly visionModelName?: string;
  private readonly embeddingModelName: string;
  private readonly embeddingDimension: number;

  constructor(private readonly configService: ConfigService<Env, true>) {
    this.baseUrl = this.configService.getOrThrow<string>('OLLAMA_BASE_URL');
    this.chatModelName =
      this.configService.getOrThrow<string>('OLLAMA_CHAT_MODEL');
    this.visionModelName =
      this.configService.get<string>('OLLAMA_VISION_MODEL') || undefined;
    this.embeddingModelName = this.configService.getOrThrow<string>(
      'OLLAMA_EMBEDDING_MODEL',
    );
    this.embeddingDimension = this.configService.getOrThrow<number>(
      'EMBEDDING_DIMENSION',
    );
  }

  createChatModel() {
    return new ChatOllama({
      baseUrl: this.baseUrl,
      model: this.chatModelName,
      temperature: 0.2,
    });
  }

  createEmbeddings() {
    return new OllamaEmbeddings({
      baseUrl: this.baseUrl,
      model: this.embeddingModelName,
      dimensions: this.embeddingDimension,
      truncate: true,
    });
  }

  async embedDocuments(texts: string[]) {
    return this.createEmbeddings().embedDocuments(texts);
  }

  async embedQuery(text: string) {
    return this.createEmbeddings().embedQuery(text);
  }

  async resolveVisionModelName(): Promise<string> {
    if (this.visionModelName) {
      return this.visionModelName;
    }

    const tags = await this.getTags();
    const chatModel = tags.models?.find(
      (model) =>
        model.name === this.chatModelName || model.model === this.chatModelName,
    );

    if (chatModel?.capabilities?.includes('vision')) {
      return this.chatModelName;
    }

    const visionModels = (tags.models ?? []).filter((model) =>
      model.capabilities?.includes('vision'),
    );
    const visionModel =
      visionModels.find((model) => !model.remote_host) ?? visionModels[0];

    const resolvedVisionModel = visionModel?.name ?? visionModel?.model;

    if (resolvedVisionModel) {
      return resolvedVisionModel;
    }

    throw new Error(
      'No Ollama vision model is available. Set OLLAMA_VISION_MODEL to a model with vision capability, for example qwen2.5vl, llava, or a cloud vision model that your Ollama account can access.',
    );
  }

  async invokeNativeChat(model: string, messages: OllamaChatMessage[]) {
    const response = await this.fetchOllama('/api/chat', {
      model,
      messages,
      stream: false,
    });
    const body = (await response.json()) as OllamaChatChunk;

    if (body.error) {
      throw new Error(body.error);
    }

    return body.message?.content ?? '';
  }

  async *streamNativeChat(
    model: string,
    messages: OllamaChatMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const response = await this.fetchOllama(
      '/api/chat',
      {
        model,
        messages,
        stream: true,
      },
      signal,
    );
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('Ollama response body is not readable.');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = drainJsonLines(buffer);
      buffer = lines.remaining;

      for (const line of lines.complete) {
        const chunk = this.parseOllamaChunk(line);

        if (chunk.error) {
          throw new Error(chunk.error);
        }

        const content = chunk.message?.content;

        if (content) {
          yield content;
        }
      }
    }

    buffer += decoder.decode();

    for (const line of drainJsonLines(`${buffer}\n`).complete) {
      const chunk = this.parseOllamaChunk(line);

      if (chunk.error) {
        throw new Error(chunk.error);
      }

      const content = chunk.message?.content;

      if (content) {
        yield content;
      }
    }
  }

  private async getTags() {
    const response = await this.fetchOllama('/api/tags');

    return (await response.json()) as OllamaTagsResponse;
  }

  private async fetchOllama(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined
          ? undefined
          : {
              'Content-Type': 'application/json',
            },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        `Ollama API ${path} failed with ${response.status}. ${text}`,
      );
    }

    return response;
  }

  private parseOllamaChunk(line: string): OllamaChatChunk {
    try {
      return JSON.parse(line) as OllamaChatChunk;
    } catch {
      return {
        error: `Unable to parse Ollama stream chunk: ${line}`,
      };
    }
  }
}

function drainJsonLines(buffer: string) {
  const lines = buffer.split(/\r?\n/);
  const remaining = lines.pop() ?? '';

  return {
    complete: lines.filter((line) => line.trim().length > 0),
    remaining,
  };
}
