import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHAT_ATTACHMENT_KINDS,
  CHAT_LIMITS,
  type ChatAttachmentPayload,
  type ChatRequestPayload,
} from '@ai-agent/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ChatAttachmentDto implements ChatAttachmentPayload {
  @ApiProperty({
    example: 'notes.md',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiProperty({
    example: 'text/markdown',
  })
  @IsString()
  @MaxLength(100)
  mimeType!: string;

  @ApiProperty({
    enum: CHAT_ATTACHMENT_KINDS,
    example: 'text',
  })
  @IsIn(CHAT_ATTACHMENT_KINDS)
  kind!: ChatAttachmentPayload['kind'];

  @ApiProperty({
    example: 1024,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(CHAT_LIMITS.maxAttachmentSize)
  size!: number;

  @ApiPropertyOptional({
    description:
      'Plain-text content extracted in the browser for supported files.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CHAT_LIMITS.maxAttachmentTextLength)
  content?: string;

  @ApiPropertyOptional({
    description: 'Image preview data URL for supported image attachments.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CHAT_LIMITS.maxAttachmentDataUrlLength)
  dataUrl?: string;
}

export class ChatRequestDto implements ChatRequestPayload {
  @ApiPropertyOptional({
    description: 'Existing chat session id. Omit to create a new session.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({
    example: 'Explain how to split the RAG module in a NestJS project.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(CHAT_LIMITS.maxMessageLength)
  message?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 20,
    example: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(CHAT_LIMITS.minTopK)
  @Max(CHAT_LIMITS.maxTopK)
  topK?: number;

  @ApiPropertyOptional({
    type: [ChatAttachmentDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatAttachmentDto)
  @ArrayMaxSize(CHAT_LIMITS.maxAttachments)
  attachments?: ChatAttachmentDto[];
}

export type ChatDto = {
  sessionId?: string;
  message: string;
  topK?: number;
  attachments?: ChatAttachmentDto[];
};
