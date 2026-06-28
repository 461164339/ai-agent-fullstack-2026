import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateDocumentDto {
  @ApiPropertyOptional({
    example: 'NestJS Agent Notes',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    example: 'notes/nestjs-agent.md',
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiProperty({
    example:
      'NestJS modules keep infrastructure, RAG, and agent orchestration separated.',
  })
  @IsString()
  @MinLength(1)
  content!: string;

  @ApiPropertyOptional({
    example: { topic: 'architecture', tags: ['nestjs', 'rag'] },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
