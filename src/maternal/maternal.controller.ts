import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth-user';
import { DangerSignsDto, ImmunizationGivenDto, PatientQueryDto } from './maternal.dto';
import { MaternalService } from './maternal.service';

@ApiTags('M10 · Mère et enfant')
@Controller('maternal')
export class MaternalController {
  constructor(private readonly svc: MaternalService) {}

  @Public()
  @Get('schedules')
  schedules() {
    return this.svc.schedules();
  }

  @Get('pregnancy')
  pregnancy(@CurrentUser() u: AuthUser, @Query() q: PatientQueryDto, @Req() req: Request) {
    return this.svc.pregnancy(u, q.patientId, req.ip);
  }

  @Post('pregnancy/:id/danger-signs')
  @HttpCode(200)
  dangerSigns(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DangerSignsDto, @Req() req: Request) {
    return this.svc.reportDangerSigns(u, id, dto.codes, req.ip);
  }

  @Get('children')
  children(@CurrentUser() u: AuthUser, @Query() q: PatientQueryDto, @Req() req: Request) {
    return this.svc.children(u, q.patientId, req.ip);
  }

  @Get('children/:childId/immunizations')
  immunizations(@CurrentUser() u: AuthUser, @Param('childId', ParseUUIDPipe) childId: string, @Req() req: Request) {
    return this.svc.immunizations(u, childId, req.ip);
  }

  @Roles('PRACTITIONER', 'NURSE')
  @Post('immunizations/:id/given')
  @HttpCode(200)
  given(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ImmunizationGivenDto, @Req() req: Request) {
    return this.svc.markGiven(u, id, dto, req.ip);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('verify/:payload')
  verify(@Param('payload') payload: string, @Req() req: Request) {
    return this.svc.verifyProof(payload, req.ip);
  }
}
