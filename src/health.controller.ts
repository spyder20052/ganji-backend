import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './common/auth-user';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('État du service')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  root() {
    return { service: 'API Alafia', docs: '/docs', health: '/health' };
  }

  @Public()
  @Get('health')
  async health() {
    const started = Date.now();
    let db = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'indisponible';
    }
    return {
      status: db === 'ok' ? 'ok' : 'degrade',
      database: db,
      sms: 'simulateur',
      latencyMs: Date.now() - started,
      demo: process.env.DEMO_MODE === 'true',
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    };
  }
}
