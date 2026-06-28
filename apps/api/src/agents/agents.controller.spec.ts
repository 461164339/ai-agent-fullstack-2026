import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

describe('AgentsController', () => {
  let app: INestApplication;
  const agentsService = {
    chat: jest.fn(),
    streamChat: jest.fn(),
  };

  beforeEach(async () => {
    agentsService.chat.mockReset();
    agentsService.streamChat.mockReset();
    agentsService.streamChat.mockImplementation(async function* () {
      await Promise.resolve();

      yield {
        type: 'status',
        stage: 'retrieving',
        message: 'Retrieving relevant knowledge.',
      };
      yield {
        type: 'token',
        content: 'hello',
      };
      yield {
        type: 'done',
        answer: 'hello',
        sources: [],
      };
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [
        {
          provide: AgentsService,
          useValue: agentsService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('streams chat events as server-sent events', async () => {
    const response = await request(app.getHttpServer() as App)
      .post('/agents/chat/stream')
      .set('Accept', 'text/event-stream')
      .send({
        message: 'hi',
        topK: 3,
        attachments: [
          {
            name: 'notes.txt',
            mimeType: 'text/plain',
            kind: 'text',
            size: 18,
            content: 'hello from a file',
          },
        ],
      })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain(': connected');
    expect(response.text).toContain('event: status');
    expect(response.text).toContain('event: token');
    expect(response.text).toContain('data: {"type":"token","content":"hello"}');
    expect(response.text).toContain('event: done');
    expect(agentsService.streamChat).toHaveBeenCalledWith(
      {
        message: 'hi',
        topK: 3,
        attachments: [
          {
            name: 'notes.txt',
            mimeType: 'text/plain',
            kind: 'text',
            size: 18,
            content: 'hello from a file',
            dataUrl: undefined,
          },
        ],
      },
      expect.any(AbortSignal),
    );
  });
});
