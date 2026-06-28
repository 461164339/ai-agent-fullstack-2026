import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export const MAX_CHAT_ATTACHMENTS = 6;
export const MAX_CHAT_ATTACHMENT_SIZE = 4 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENT_TEXT_LENGTH = 200_000;
export const MAX_CHAT_ATTACHMENT_DATA_URL_LENGTH = 6_000_000;
export const MAX_CHAT_MESSAGE_LENGTH = 20_000;

export class ChatAttachmentDto {
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
    enum: ['text', 'image', 'file'],
    example: 'text',
  })
  @IsIn(['text', 'image', 'file'])
  kind!: 'text' | 'image' | 'file';

  @ApiProperty({
    example: 1024,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MAX_CHAT_ATTACHMENT_SIZE)
  size!: number;

  @ApiPropertyOptional({
    description:
      'Plain-text content extracted in the browser for supported files.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CHAT_ATTACHMENT_TEXT_LENGTH)
  content?: string;

  @ApiPropertyOptional({
    description: 'Image preview data URL for supported image attachments.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CHAT_ATTACHMENT_DATA_URL_LENGTH)
  dataUrl?: string;
}

export class ChatRequestDto {
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
  @MaxLength(MAX_CHAT_MESSAGE_LENGTH)
  message?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 20,
    example: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number;

  @ApiPropertyOptional({
    type: [ChatAttachmentDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatAttachmentDto)
  @ArrayMaxSize(MAX_CHAT_ATTACHMENTS)
  attachments?: ChatAttachmentDto[];
}

export type ChatDto = {
  sessionId?: string;
  message: string;
  topK?: number;
  attachments?: ChatAttachmentDto[];
};
