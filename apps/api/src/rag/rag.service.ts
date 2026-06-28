import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

import { Env } from '../config/env.validation';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { OllamaService } from '../ollama/ollama.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SearchDocumentsDto } from './dto/search-documents.dto';

type ChunkWithDocument = {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  metadata: unknown;
  embedding: unknown;
  document: {
    title: string | null;
    source: string | null;
  };
};

@Injectable()
export class RagService {
  private readonly splitter: RecursiveCharacterTextSplitter;
  private readonly embeddingDimension: number;
  private readonly defaultTopK: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ollama: OllamaService,
    configService: ConfigService<Env, true>,
  ) {
    const chunkSize = configService.getOrThrow<number>('RAG_CHUNK_SIZE');
    const chunkOverlap = configService.getOrThrow<number>('RAG_CHUNK_OVERLAP');

    this.embeddingDimension = configService.getOrThrow<number>(
      'EMBEDDING_DIMENSION',
    );
    this.defaultTopK = configService.getOrThrow<number>('RAG_DEFAULT_TOP_K');
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });
  }

  async createDocument(dto: CreateDocumentDto) {
    const chunks = await this.splitter.splitText(dto.content);

    if (chunks.length === 0) {
      throw new BadRequestException('Document content produced no chunks.');
    }

    const embeddings = await this.ollama.embedDocuments(chunks);
    embeddings.forEach((embedding) => this.assertEmbedding(embedding));

    return this.prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          title: dto.title,
          source: dto.source,
          content: dto.content,
          metadata:
            dto.metadata === undefined
              ? undefined
              : (dto.metadata as Prisma.InputJsonValue),
        },
      });

      await tx.documentChunk.createMany({
        data: chunks.map((chunk, index) => ({
          documentId: document.id,
          content: chunk,
          chunkIndex: index,
          metadata:
            dto.metadata === undefined
              ? undefined
              : (dto.metadata as Prisma.InputJsonValue),
          embedding: embeddings[index],
        })),
      });

      return {
        ...document,
        chunkCount: chunks.length,
      };
    });
  }

  async listDocuments() {
    return this.prisma.document.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        _count: {
          select: {
            chunks: true,
          },
        },
      },
    });
  }

  async deleteDocument(id: string) {
    return this.prisma.document.delete({
      where: {
        id,
      },
    });
  }

  async search(dto: SearchDocumentsDto) {
    const topK = dto.topK ?? this.defaultTopK;
    const embedding = await this.ollama.embedQuery(dto.query);

    return this.searchByEmbedding(embedding, topK);
  }

  async searchByText(query: string, topK = this.defaultTopK) {
    const embedding = await this.ollama.embedQuery(query);

    return this.searchByEmbedding(embedding, topK);
  }

  private async searchByEmbedding(embedding: number[], topK: number) {
    this.assertEmbedding(embedding);

    const rows = await this.prisma.documentChunk.findMany({
      include: {
        document: {
          select: {
            title: true,
            source: true,
          },
        },
      },
    });

    return (rows as ChunkWithDocument[])
      .map((row) => ({
        id: row.id,
        documentId: row.documentId,
        title: row.document.title,
        source: row.document.source,
        content: row.content,
        chunkIndex: row.chunkIndex,
        metadata: row.metadata,
        score: this.cosineSimilarity(
          embedding,
          this.parseEmbedding(row.embedding),
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private assertEmbedding(embedding: number[]) {
    if (embedding.length !== this.embeddingDimension) {
      throw new BadRequestException(
        `Embedding dimension mismatch. Expected ${this.embeddingDimension}, got ${embedding.length}.`,
      );
    }

    if (embedding.some((value) => !Number.isFinite(value))) {
      throw new BadRequestException('Embedding contains non-finite values.');
    }
  }

  private parseEmbedding(value: unknown) {
    if (!Array.isArray(value)) {
      throw new BadRequestException('Stored embedding is not an array.');
    }

    const embedding = value.map(Number);
    this.assertEmbedding(embedding);

    return embedding;
  }

  private cosineSimilarity(left: number[], right: number[]) {
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;

    for (let index = 0; index < left.length; index += 1) {
      dot += left[index] * right[index];
      leftNorm += left[index] * left[index];
      rightNorm += right[index] * right[index];
    }

    if (leftNorm === 0 || rightNorm === 0) {
      return 0;
    }

    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }
}
