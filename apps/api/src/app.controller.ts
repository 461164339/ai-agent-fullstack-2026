import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AppService } from './app.service';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({
    summary: 'API 信息',
    description: '返回当前服务的技术栈、文档地址和常用接口示例。',
  })
  @ApiOkResponse({
    description: 'API 元信息。',
    schema: {
      example: {
        name: 'ai-agent-nestjs',
        docs: '/api/docs',
        health: '/api/health',
      },
    },
  })
  @Get()
  getInfo() {
    return this.appService.getInfo();
  }
}
