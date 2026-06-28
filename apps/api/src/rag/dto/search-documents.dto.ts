import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class SearchDocumentsDto {
  @ApiProperty({
    example: 'How should I structure a NestJS RAG service?',
  })
  @IsString()
  @MinLength(1)
  query!: string;

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
}
