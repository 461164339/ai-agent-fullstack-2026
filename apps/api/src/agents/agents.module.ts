import { Module } from '@nestjs/common';

import { OllamaModule } from '../ollama/ollama.module';
import { RagModule } from '../rag/rag.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { ChatPersistenceService } from './chat-persistence.service';

@Module({
  imports: [OllamaModule, RagModule],
  controllers: [AgentsController],
  providers: [AgentsService, ChatPersistenceService],
})
export class AgentsModule {}
