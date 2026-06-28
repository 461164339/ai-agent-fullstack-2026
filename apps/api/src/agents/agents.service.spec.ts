import { ConfigService } from '@nestjs/config';

import { Env } from '../config/env.validation';
import { OllamaService } from '../ollama/ollama.service';
import { RagService } from '../rag/rag.service';
import { AgentStreamEvent, AgentsService } from './agents.service';
import {
  ChatPersistenceService,
  PersistedChatTurn,
} from './chat-persistence.service';

describe('AgentsService', () => {
  it('streams image attachments through the native Ollama vision API', async () => {
    const ragService = {
      searchByText: jest.fn().mockResolvedValue([]),
    } as unknown as RagService;
    const streamNativeChat = jest.fn(async function* () {
      await Promise.resolve();

      yield 'vision answer';
    });
    const ollamaService = {
      resolveVisionModelName: jest.fn().mockResolvedValue('llava:latest'),
      streamNativeChat,
    } as unknown as OllamaService;
    const persistedTurn: PersistedChatTurn = {
      persisted: true,
      runId: 'run-id',
      sessionId: 'session-id',
      startedAt: 1000,
      userMessageId: 'user-message-id',
    };
    const completeTurn = jest.fn((turn: PersistedChatTurn) =>
      Promise.resolve({
        ...turn,
        assistantMessageId: 'assistant-message-id',
      }),
    );
    const startTurn = jest.fn(
      (input: { dto: { message: string }; model: string; topK: number }) => {
        void input;

        return Promise.resolve(persistedTurn);
      },
    );
    const updateRunModel = jest.fn(() => Promise.resolve());
    const chatPersistence = {
      completeTurn,
      startTurn,
      updateRunModel,
    } as unknown as ChatPersistenceService;
    const configService = makeConfigService();
    const service = new AgentsService(
      ragService,
      ollamaService,
      chatPersistence,
      configService,
    );

    const events: AgentStreamEvent[] = [];

    for await (const event of service.streamChat({
      message: 'Describe this image.',
      attachments: [
        {
          name: 'sample.png',
          mimeType: 'image/png',
          kind: 'image',
          size: 70,
          dataUrl: 'data:image/png;base64,aW1hZ2UtYnl0ZXM=',
        },
      ],
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'session',
      'status',
      'sources',
      'status',
      'token',
      'done',
    ]);
    expect(streamNativeChat).toHaveBeenCalledWith(
      'llava:latest',
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          images: ['aW1hZ2UtYnl0ZXM='],
        }),
      ]),
      expect.any(AbortSignal),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      answer: 'vision answer',
      assistantMessageId: 'assistant-message-id',
      runId: 'run-id',
      sessionId: 'session-id',
      userMessageId: 'user-message-id',
    });
    expect(completeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-id',
        sessionId: 'session-id',
      }),
      {
        answer: 'vision answer',
        model: 'llava:latest',
        sources: [],
      },
    );
    expect(updateRunModel).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-id',
      }),
      'llava:latest',
    );
    const startTurnInput = startTurn.mock.calls[0]?.[0];

    expect(startTurnInput).toBeDefined();
    expect(startTurnInput?.dto.message).toBe('Describe this image.');
    expect(startTurnInput?.model).toBe('vision:unresolved');
    expect(startTurnInput?.topK).toBe(5);
  });
});

function makeConfigService() {
  return {
    getOrThrow: jest.fn((key: keyof Env) => {
      const values: Partial<Env> = {
        OLLAMA_BASE_URL: 'http://ollama.test',
        OLLAMA_CHAT_MODEL: 'chat-model',
        RAG_DEFAULT_TOP_K: 5,
      };

      return values[key];
    }),
  } as unknown as ConfigService<Env, true>;
}
