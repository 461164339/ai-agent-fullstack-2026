import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @ApiOperation({
    summary: '健康检查',
    description: '用于本地开发、部署探针或联调时确认 API 服务可用。',
  })
  @ApiOkResponse({
    description: '服务正常。',
    schema: {
      example: {
        status: 'ok',
        service: 'ai-agent-nestjs',
      },
    },
  })
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'ai-agent-nestjs',
    };
  }
}
