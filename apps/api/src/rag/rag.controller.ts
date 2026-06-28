import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CreateDocumentDto } from './dto/create-document.dto';
import { SearchDocumentsDto } from './dto/search-documents.dto';
import { RagService } from './rag.service';

@ApiTags('rag')
@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @ApiOperation({
    summary: '写入知识库文档',
    description:
      '把一段文本切分成 chunks，调用 Ollama embedding 后保存到 PostgreSQL。用于构建 RAG 检索语料。',
  })
  @ApiBody({ type: CreateDocumentDto })
  @ApiCreatedResponse({
    description: '文档写入成功，并返回 chunk 数量。',
    schema: {
      example: {
        id: 'f18f7f1a-6546-4e73-9a13-fd9bf3bd8472',
        title: 'NestJS Agent Notes',
        source: 'notes/nestjs-agent.md',
        chunkCount: 3,
      },
    },
  })
  @Post('documents')
  createDocument(@Body() dto: CreateDocumentDto) {
    return this.ragService.createDocument(dto);
  }

  @ApiOperation({
    summary: '查询知识库文档',
    description: '返回已写入的文档和每篇文档的 chunk 数量。',
  })
  @ApiOkResponse({
    description: '知识库文档列表。',
  })
  @Get('documents')
  listDocuments() {
    return this.ragService.listDocuments();
  }

  @ApiOperation({
    summary: '删除知识库文档',
    description: '删除文档及其关联 chunks。',
  })
  @ApiParam({
    name: 'id',
    description: 'Document UUID。',
  })
  @ApiOkResponse({
    description: '被删除的文档。',
  })
  @Delete('documents/:id')
  deleteDocument(@Param('id') id: string) {
    return this.ragService.deleteDocument(id);
  }

  @ApiOperation({
    summary: '检索知识库',
    description: '把 query 转成 embedding 后做相似度检索，返回最相关 chunks。',
  })
  @ApiBody({ type: SearchDocumentsDto })
  @ApiOkResponse({
    description: 'RAG 检索结果。',
    schema: {
      example: [
        {
          id: '7c39bbcf-7f7b-42b8-9496-854695c65fe2',
          documentId: 'f18f7f1a-6546-4e73-9a13-fd9bf3bd8472',
          title: 'NestJS Agent Notes',
          source: 'notes/nestjs-agent.md',
          content:
            'NestJS modules keep infrastructure and agent orchestration separated.',
          chunkIndex: 0,
          score: 0.82,
        },
      ],
    },
  })
  @Post('search')
  search(@Body() dto: SearchDocumentsDto) {
    return this.ragService.search(dto);
  }
}
