import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth-user';
import { BreakGlassDto, SosDto } from './emergency.dto';
import { EmergencyService } from './emergency.service';

@ApiTags('M7 · Urgence')
@Controller('emergency')
export class EmergencyController {
  constructor(private readonly svc: EmergencyService) {}

  /** Lecture sans compte par les secours : limitée pour empêcher l'énumération. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('card/:qrToken')
  card(@Param('qrToken') qrToken: string, @CurrentUser() viewer: AuthUser | undefined, @Req() req: Request) {
    return this.svc.card(qrToken, viewer, req.ip);
  }

  @Roles('PRACTITIONER', 'NURSE')
  @Post('break-glass')
  @HttpCode(200)
  breakGlass(@CurrentUser() u: AuthUser, @Body() dto: BreakGlassDto, @Req() req: Request) {
    return this.svc.breakGlass(u, dto, req.ip);
  }

  @Post('sos')
  @HttpCode(200)
  sos(@CurrentUser() u: AuthUser, @Body() dto: SosDto, @Req() req: Request) {
    return this.svc.sos(u, dto, req.ip);
  }
}
