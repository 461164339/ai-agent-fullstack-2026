import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { ChatAttachmentDto, ChatDto } from './dto/chat.dto';

type ChatSourceSnapshot = {
  documentId: string;
  chunkId: string;
  title: string | null;
  source: string | null;
  chunkIndex: number;
  score: number;
};

type StartTurnInput = {
  dto: ChatDto;
  model: string;
  topK: number;
};

type CompleteTurnInput = {
  answer: string;
  model: string;
  sources: ChatSourceSnapshot[];
};

export type PersistedChatTurn = {
  persisted: boolean;
  sessionId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  runId?: string;
  startedAt: number;
};

@Injectable()
export class ChatPersistenceService {
  private readonly logger = new Logger(ChatPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async startTurn(input: StartTurnInput): Promise<PersistedChatTurn> {
    const startedAt = Date.now();

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const session = input.dto.sessionId
          ? await tx.chatSession.upsert({
              where: {
                id: input.dto.sessionId,
              },
              create: {
                id: input.dto.sessionId,
                title: this.buildSessionTitle(input.dto),
                metadata: this.toJson({
                  createdBy: 'api',
                }),
              },
              update: {
                updatedAt: new Date(),
              },
            })
          : await tx.chatSession.create({
              data: {
                title: this.buildSessionTitle(input.dto),
                metadata: this.toJson({
                  createdBy: 'api',
                }),
              },
            });

        const userMessage = await tx.chatMessage.create({
          data: {
            sessionId: session.id,
            role: 'user',
            content: input.dto.message,
            metadata: this.toJson({
              attachmentCount: input.dto.attachments?.length ?? 0,
            }),
            attachments: {
              create: this.toAttachmentRows(input.dto.attachments ?? []),
            },
          },
        });

        const run = await tx.chatRun.create({
          data: {
            sessionId: session.id,
            userMessageId: userMessage.id,
            provider: 'ollama',
            model: input.model,
            topK: input.topK,
            metadata: this.toJson({
              streaming: true,
            }),
          },
        });

        return {
          runId: run.id,
          sessionId: session.id,
          userMessageId: userMessage.id,
        };
      });

      return {
        ...result,
        persisted: true,
        startedAt,
      };
    } catch (error) {
      this.logger.warn(
        `Chat persistence start failed; continuing without persisted turn. ${this.getErrorMessage(error)}`,
      );

      return {
        persisted: false,
        startedAt,
      };
    }
  }

  async updateRunModel(turn: PersistedChatTurn, model: string) {
    if (!turn.persisted || !turn.runId) {
      return;
    }

    try {
      await this.prisma.chatRun.update({
        where: {
          id: turn.runId,
        },
        data: {
          model,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Chat persistence model update failed. ${this.getErrorMessage(error)}`,
      );
    }
  }

  async completeTurn(
    turn: PersistedChatTurn,
    input: CompleteTurnInput,
  ): Promise<PersistedChatTurn> {
    if (!turn.persisted || !turn.sessionId || !turn.runId) {
      return turn;
    }

    try {
      const completedAt = new Date();
      const result = await this.prisma.$transaction(async (tx) => {
        const assistantMessage = await tx.chatMessage.create({
          data: {
            sessionId: turn.sessionId!,
            role: 'assistant',
            content: input.answer,
            model: input.model,
            metadata: this.toJson({
              sourceCount: input.sources.length,
            }),
            sources: {
              create: input.sources.map((source) => ({
                chunkId: source.chunkId,
                chunkIndex: source.chunkIndex,
                documentId: source.documentId,
                score: source.score,
                source: source.source,
                title: source.title,
              })),
            },
          },
        });

        await tx.chatRun.update({
          where: {
            id: turn.runId!,
          },
          data: {
            assistantMessageId: assistantMessage.id,
            completedAt,
            latencyMs: Math.max(0, Date.now() - turn.startedAt),
            model: input.model,
            status: 'completed',
          },
        });

        await tx.chatSession.update({
          where: {
            id: turn.sessionId!,
          },
          data: {
            updatedAt: completedAt,
          },
        });

        return {
          assistantMessageId: assistantMessage.id,
        };
      });

      return {
        ...turn,
        ...result,
      };
    } catch (error) {
      this.logger.warn(
        `Chat persistence completion failed. ${this.getErrorMessage(error)}`,
      );

      return turn;
    }
  }

  async failTurn(turn: PersistedChatTurn, error: unknown, partialAnswer = '') {
    if (!turn.persisted || !turn.sessionId || !turn.runId) {
      return turn;
    }

    try {
      const completedAt = new Date();
      const errorMessage = this.getErrorMessage(error);
      const assistantMessage = await this.prisma.chatMessage.create({
        data: {
          sessionId: turn.sessionId,
          role: 'assistant',
          content: partialAnswer,
          error: errorMessage,
          status: 'failed',
          metadata: this.toJson({
            partialAnswer: partialAnswer.length > 0,
          }),
        },
      });

      await this.prisma.chatRun.update({
        where: {
          id: turn.runId,
        },
        data: {
          assistantMessageId: assistantMessage.id,
          completedAt,
          error: errorMessage,
          latencyMs: Math.max(0, Date.now() - turn.startedAt),
          status: 'failed',
        },
      });

      return {
        ...turn,
        assistantMessageId: assistantMessage.id,
      };
    } catch (persistenceError) {
      this.logger.warn(
        `Chat persistence failure update failed. ${this.getErrorMessage(persistenceError)}`,
      );

      return turn;
    }
  }

  async cancelTurn(turn: PersistedChatTurn, partialAnswer = '') {
    if (!turn.persisted || !turn.runId) {
      return;
    }

    try {
      await this.prisma.chatRun.update({
        where: {
          id: turn.runId,
        },
        data: {
          completedAt: new Date(),
          error: partialAnswer ? 'Client aborted after partial answer.' : null,
          latencyMs: Math.max(0, Date.now() - turn.startedAt),
          status: 'cancelled',
        },
      });
    } catch (error) {
      this.logger.warn(
        `Chat persistence cancellation failed. ${this.getErrorMessage(error)}`,
      );
    }
  }

  listSessions(take = 30) {
    return this.prisma.chatSession.findMany({
      take: Math.min(Math.max(take, 1), 100),
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        _count: {
          select: {
            messages: true,
            runs: true,
          },
        },
      },
    });
  }

  getSession(sessionId: string) {
    return this.prisma.chatSession.findUnique({
      where: {
        id: sessionId,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
          include: {
            attachments: true,
            sources: true,
          },
        },
        runs: {
          orderBy: {
            startedAt: 'asc',
          },
        },
      },
    });
  }

  private toAttachmentRows(attachments: ChatAttachmentDto[]) {
    return attachments.map((attachment) => ({
      content: attachment.content,
      dataUrl: attachment.dataUrl,
      kind: attachment.kind,
      metadata: this.toJson({
        contentLength: attachment.content?.length ?? 0,
        hasDataUrl: Boolean(attachment.dataUrl),
      }),
      mimeType: attachment.mimeType,
      name: attachment.name,
      sha256: this.hashAttachment(attachment),
      size: attachment.size,
    }));
  }

  private hashAttachment(attachment: ChatAttachmentDto) {
    return createHash('sha256')
      .update(attachment.name)
      .update('\0')
      .update(attachment.mimeType)
      .update('\0')
      .update(attachment.content ?? '')
      .update('\0')
      .update(attachment.dataUrl ?? '')
      .digest('hex');
  }

  private buildSessionTitle(dto: ChatDto) {
    const messageTitle = dto.message.trim().replace(/\s+/g, ' ').slice(0, 80);

    if (messageTitle) {
      return messageTitle;
    }

    const firstAttachment = dto.attachments?.[0]?.name;

    return firstAttachment ? `Attachment: ${firstAttachment}` : 'New chat';
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
