import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { AgentsService } from './agents.service';
import { ChatAttachmentDto } from './dto/chat.dto';

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_SIZE = 4 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_LENGTH = 200_000;
const MAX_ATTACHMENT_DATA_URL_LENGTH = 6_000_000;

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post('chat')
  chat(
    @Body() body: Record<string, unknown> = {},
    @Query() query: Record<string, unknown> = {},
  ) {
    const sessionId = this.getStringValue(body.sessionId, query.sessionId);
    const message = this.getStringValue(body.message, query.message);
    const topK = this.getTopKValue(body.topK, query.topK);
    const attachments = this.getAttachmentsValue(body.attachments);

    if (!message && attachments.length === 0) {
      throw new BadRequestException('message or attachments are required.');
    }

    return this.agentsService.chat({
      ...(sessionId ? { sessionId } : {}),
      message: message ?? '请分析我上传的附件。',
      topK,
      attachments,
    });
  }

  @Post('chat/stream')
  async streamChat(
    @Body() body: Record<string, unknown> = {},
    @Query() query: Record<string, unknown> = {},
    @Res() response: Response,
  ) {
    const sessionId = this.getStringValue(body.sessionId, query.sessionId);
    const message = this.getStringValue(body.message, query.message);
    const topK = this.getTopKValue(body.topK, query.topK);
    const attachments = this.getAttachmentsValue(body.attachments);

    if (!message && attachments.length === 0) {
      throw new BadRequestException('message or attachments are required.');
    }

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
        {
          ...(sessionId ? { sessionId } : {}),
          message: message ?? '请分析我上传的附件。',
          topK,
          attachments,
        },
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

  @Get('sessions')
  listSessions(@Query() query: Record<string, unknown> = {}) {
    return this.agentsService.listSessions(this.getTakeValue(query.take));
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string) {
    const session = await this.agentsService.getSession(id);

    if (!session) {
      throw new NotFoundException('Chat session was not found.');
    }

    return session;
  }

  private getStringValue(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }

      if (Array.isArray(value)) {
        const arrayValue = value as unknown[];
        const first = arrayValue[0];

        if (typeof first === 'string' && first.trim().length > 0) {
          return first.trim();
        }
      }
    }

    return undefined;
  }

  private getTopKValue(...values: unknown[]) {
    for (const value of values) {
      if (value === undefined || value === null || value === '') {
        continue;
      }

      const parsed = Number(value);

      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 20) {
        return parsed;
      }
    }

    return undefined;
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

  private getAttachmentsValue(value: unknown): ChatAttachmentDto[] {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadRequestException('attachments must be an array.');
    }

    if (value.length > MAX_ATTACHMENTS) {
      throw new BadRequestException(
        `attachments cannot contain more than ${MAX_ATTACHMENTS} files.`,
      );
    }

    return value.map((item, index) => this.parseAttachment(item, index));
  }

  private parseAttachment(value: unknown, index: number): ChatAttachmentDto {
    if (typeof value !== 'object' || value === null) {
      throw new BadRequestException(`attachments[${index}] must be an object.`);
    }

    const record = value as Record<string, unknown>;
    const name = this.getRequiredString(
      record.name,
      `attachments[${index}].name`,
    );
    const mimeType =
      this.getOptionalString(record.mimeType)?.slice(0, 100) ??
      'application/octet-stream';
    const kind = this.getAttachmentKind(record.kind, mimeType, index);
    const size = Number(record.size ?? 0);

    if (!Number.isFinite(size) || size < 0 || size > MAX_ATTACHMENT_SIZE) {
      throw new BadRequestException(
        `attachments[${index}].size must be between 0 and ${MAX_ATTACHMENT_SIZE}.`,
      );
    }

    const content = this.getOptionalString(record.content);
    const dataUrl = this.getOptionalString(record.dataUrl);

    if (content && content.length > MAX_ATTACHMENT_TEXT_LENGTH) {
      throw new BadRequestException(
        `attachments[${index}].content is too large.`,
      );
    }

    if (dataUrl && dataUrl.length > MAX_ATTACHMENT_DATA_URL_LENGTH) {
      throw new BadRequestException(
        `attachments[${index}].dataUrl is too large.`,
      );
    }

    return {
      name: name.slice(0, 160),
      mimeType,
      kind,
      size,
      content,
      dataUrl,
    };
  }

  private getRequiredString(value: unknown, field: string) {
    const parsed = this.getOptionalString(value);

    if (!parsed) {
      throw new BadRequestException(`${field} is required.`);
    }

    return parsed;
  }

  private getOptionalString(value: unknown) {
    return typeof value === 'string' ? value.trim() : undefined;
  }

  private getAttachmentKind(
    value: unknown,
    mimeType: string,
    index: number,
  ): ChatAttachmentDto['kind'] {
    if (value === 'text' || value === 'image' || value === 'file') {
      return value;
    }

    if (value !== undefined && value !== null && value !== '') {
      throw new BadRequestException(
        `attachments[${index}].kind must be text, image, or file.`,
      );
    }

    if (mimeType.startsWith('image/')) {
      return 'image';
    }

    if (mimeType.startsWith('text/')) {
      return 'text';
    }

    return 'file';
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
