import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { AgentsService } from './agents.service';
import { ChatAttachmentDto, ChatDto, ChatRequestDto } from './dto/chat.dto';

const DEFAULT_ATTACHMENT_PROMPT = '请分析我上传的附件。';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @ApiOperation({
    summary: '同步调用 Agent',
    description:
      '执行一次 RAG 检索和模型生成，适合服务端脚本或不需要流式输出的调用方。',
  })
  @ApiBody({ type: ChatRequestDto })
  @ApiOkResponse({
    description: '返回完整回答、会话 id、消息 id 和命中的知识库来源。',
    schema: {
      example: {
        sessionId: '5d1c4ad2-40f2-45f5-b5fe-67f0e2bf8577',
        userMessageId: '3805707c-90c0-4d48-a7c2-c7fb970ad1b5',
        assistantMessageId: '39ad5626-b64e-4c22-a1de-c53b18d2a7e1',
        runId: 'ad67f962-1ac0-4c39-a92c-b7276e203c33',
        answer: '可以把 RAG 拆成数据写入、检索和 Agent 编排三层。',
        sources: [],
      },
    },
  })
  @ApiBadRequestResponse({
    description: '请求体无效，或 message 和 attachments 都为空。',
  })
  @Post('chat')
  chat(@Body() body: ChatRequestDto = {}) {
    return this.agentsService.chat(this.toChatDto(body));
  }

  @ApiOperation({
    summary: '流式调用 Agent',
    description:
      '通过 SSE 返回 session、status、sources、token、done、error 事件。前端聊天框使用该接口实现类 ChatGPT 的打字机输出。',
  })
  @ApiBody({ type: ChatRequestDto })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: 'SSE 事件流。',
    schema: {
      type: 'string',
      example:
        ': connected\n\n' +
        'event: token\n' +
        'data: {"type":"token","content":"你好"}\n\n' +
        'event: done\n' +
        'data: {"type":"done","answer":"你好","sources":[]}\n\n',
    },
  })
  @ApiBadRequestResponse({
    description: '请求体无效，或 message 和 attachments 都为空。',
  })
  @Post('chat/stream')
  async streamChat(
    @Body() body: ChatRequestDto = {},
    @Res() response: Response,
  ) {
    const dto = this.toChatDto(body);

    const abortController = new AbortController();
    let closed = false;

    response.on('close', () => {
      closed = true;
      abortController.abort();
    });

    response.status(HttpStatus.OK);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    response.write(': connected\n\n');

    try {
      for await (const event of this.agentsService.streamChat(
        dto,
        abortController.signal,
      )) {
        if (closed) {
          return;
        }

        this.writeSse(response, event.type, event);
      }
    } catch (error) {
      if (!closed) {
        this.writeSse(response, 'error', {
          type: 'error',
          message: this.getErrorMessage(error),
        });
      }
    } finally {
      if (!closed) {
        response.end();
      }
    }
  }

  @ApiOperation({
    summary: '查询最近会话',
    description: '按更新时间倒序返回最近的聊天会话和消息/run 数量。',
  })
  @ApiQuery({
    name: 'take',
    required: false,
    description: '返回数量，范围 1-100，默认 30。',
    example: 30,
  })
  @ApiOkResponse({
    description: '聊天会话列表。',
  })
  @Get('sessions')
  listSessions(@Query() query: Record<string, unknown> = {}) {
    return this.agentsService.listSessions(this.getTakeValue(query.take));
  }

  @ApiOperation({
    summary: '查询单个会话详情',
    description: '返回会话下的消息、附件、RAG sources 和模型运行记录。',
  })
  @ApiParam({
    name: 'id',
    description: 'ChatSession UUID。',
  })
  @ApiOkResponse({
    description: '聊天会话详情。',
  })
  @Get('sessions/:id')
  async getSession(@Param('id', new ParseUUIDPipe()) id: string) {
    const session = await this.agentsService.getSession(id);

    if (!session) {
      throw new NotFoundException('Chat session was not found.');
    }

    return session;
  }

  private getTakeValue(value: unknown) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    const parsed = Number(Array.isArray(value) ? value[0] : value);

    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) {
      return parsed;
    }

    return undefined;
  }

  private toChatDto(body: ChatRequestDto): ChatDto {
    const message = body.message?.trim();
    const attachments = this.normalizeAttachments(body.attachments ?? []);

    if (!message && attachments.length === 0) {
      throw new BadRequestException('message or attachments are required.');
    }

    return {
      ...(body.sessionId ? { sessionId: body.sessionId } : {}),
      message: message ?? DEFAULT_ATTACHMENT_PROMPT,
      ...(body.topK ? { topK: body.topK } : {}),
      attachments,
    };
  }

  private normalizeAttachments(
    attachments: ChatAttachmentDto[],
  ): ChatAttachmentDto[] {
    return attachments.map((attachment) => ({
      content: attachment.content,
      dataUrl: attachment.dataUrl,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      name: attachment.name,
      size: attachment.size,
    }));
  }

  private writeSse(response: Response, event: string, data: unknown) {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown streaming error.';
  }
}
