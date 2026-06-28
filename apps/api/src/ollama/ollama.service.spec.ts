import { ConfigService } from '@nestjs/config';

import { Env } from '../config/env.validation';
import { OllamaService } from './ollama.service';

describe('OllamaService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves the configured chat model when it supports vision', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        models: [
          {
            name: 'gpt-oss:20b-cloud',
            capabilities: ['completion', 'vision'],
          },
        ],
      }),
    );
    const service = makeService();

    await expect(service.resolveVisionModelName()).resolves.toBe(
      'gpt-oss:20b-cloud',
    );
  });

  it('falls back to a local vision model before cloud vision models', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        models: [
          {
            name: 'chat-only',
            capabilities: ['completion'],
          },
          {
            name: 'qwen3.5:cloud',
            capabilities: ['completion', 'vision'],
            remote_host: 'https://ollama.com:443',
          },
          {
            name: 'moondream:latest',
            capabilities: ['completion', 'vision'],
          },
        ],
      }),
    );
    const service = makeService();

    await expect(service.resolveVisionModelName()).resolves.toBe(
      'moondream:latest',
    );
  });

  it('streams native chat chunks and posts image payloads to Ollama', async () => {
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        controller.enqueue(encoder.encode('{"message":{"content":"hel"}}\n'));
        controller.enqueue(encoder.encode('{"message":{"content":"lo"}}\n'));
        controller.close();
      },
    });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(body, { status: 200 }));
    const service = makeService();
    const chunks = [];

    for await (const chunk of service.streamNativeChat('llava:latest', [
      {
        role: 'user',
        content: 'Describe this image.',
        images: ['base64-image'],
      },
    ])) {
      chunks.push(chunk);
    }

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = typeof request.body === 'string' ? request.body : '';

    expect(chunks.join('')).toBe('hello');
    expect(JSON.parse(requestBody)).toMatchObject({
      model: 'llava:latest',
      stream: true,
      messages: [
        {
          role: 'user',
          content: 'Describe this image.',
          images: ['base64-image'],
        },
      ],
    });
  });
});

function makeService(overrides: Partial<Env> = {}) {
  const values: Partial<Env> = {
    EMBEDDING_DIMENSION: 768,
    OLLAMA_BASE_URL: 'http://ollama.test',
    OLLAMA_CHAT_MODEL: 'gpt-oss:20b-cloud',
    OLLAMA_EMBEDDING_MODEL: 'nomic-embed-text',
    ...overrides,
  };
  const configService = {
    get: jest.fn((key: keyof Env) => values[key]),
    getOrThrow: jest.fn((key: keyof Env) => values[key]),
  } as unknown as ConfigService<Env, true>;

  return new OllamaService(configService);
}

function jsonResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 200,
    }),
  );
}
