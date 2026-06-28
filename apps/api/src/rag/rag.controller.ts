import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CreateDocumentDto } from './dto/create-document.dto';
import { SearchDocumentsDto } from './dto/search-documents.dto';
import { RagService } from './rag.service';

@ApiTags('rag')
@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post('documents')
  createDocument(@Body() dto: CreateDocumentDto) {
    return this.ragService.createDocument(dto);
  }

  @Get('documents')
  listDocuments() {
    return this.ragService.listDocuments();
  }

  @Delete('documents/:id')
  deleteDocument(@Param('id') id: string) {
    return this.ragService.deleteDocument(id);
  }

  @Post('search')
  search(@Body() dto: SearchDocumentsDto) {
    return this.ragService.search(dto);
  }
}
