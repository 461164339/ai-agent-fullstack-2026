import { Module } from '@nestjs/common';

import { OllamaModule } from '../ollama/ollama.module';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';

@Module({
  imports: [OllamaModule],
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
