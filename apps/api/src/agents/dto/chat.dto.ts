import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

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
  @IsNumber()
  @Min(0)
  @Max(4 * 1024 * 1024)
  size!: number;

  @ApiPropertyOptional({
    description:
      'Plain-text content extracted in the browser for supported files.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  content?: string;

  @ApiPropertyOptional({
    description: 'Image preview data URL for supported image attachments.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(6_000_000)
  dataUrl?: string;
}

export class ChatDto {
  @ApiPropertyOptional({
    description: 'Existing chat session id. Omit to create a new session.',
  })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiProperty({
    example: 'Explain how to split the RAG module in a NestJS project.',
  })
  @IsString()
  @MinLength(1)
  message!: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 20,
    example: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number;

  @ApiPropertyOptional({
    type: [ChatAttachmentDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ChatAttachmentDto)
  @ArrayMaxSize(6)
  attachments?: ChatAttachmentDto[];
}
