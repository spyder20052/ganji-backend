import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { SymptomDto, TeleAnswerDto, TeleRequestDto } from './care.dto';
import { CareService } from './care.service';

@ApiTags('M3 · Parcours de soins chronique')
@Controller('care')
export class CareController {
  constructor(private readonly svc: CareService) {}

  @Get('plan')
  plan(@CurrentUser() u: AuthUser, @Query('patientId') patientId?: string) {
    return this.svc.plan(u, patientId);
  }

  @Post('reminders/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.confirmReminder(u, id);
  }

  @Post('symptoms')
  symptom(@CurrentUser() u: AuthUser, @Body() dto: SymptomDto) {
    return this.svc.logSymptom(u, dto);
  }

  @Get('symptoms')
  symptoms(@CurrentUser() u: AuthUser, @Query('patientId') patientId?: string) {
    return this.svc.symptoms(u, patientId);
  }
}

@ApiTags('M6 · Télé-expertise')
@Roles('PRACTITIONER', 'NURSE')
@Controller('tele-expertise')
export class TeleController {
  constructor(private readonly svc: CareService) {}

  @Get()
  inbox(@CurrentUser() u: AuthUser) {
    return this.svc.teleInbox(u);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: TeleRequestDto, @Req() req: Request) {
    return this.svc.requestTele(u, dto, req.ip);
  }

  @Get(':id')
  detail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.teleDetail(u, id, req.ip);
  }

  @Post(':id/answer')
  @HttpCode(200)
  answer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TeleAnswerDto, @Req() req: Request) {
    return this.svc.answerTele(u, id, dto, req.ip);
  }
}
