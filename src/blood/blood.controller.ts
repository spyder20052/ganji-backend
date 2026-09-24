import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { CreateBloodRequestDto, RespondDto, StockDto } from './blood.dto';
import { BloodService } from './blood.service';

@ApiTags('M4 · Sang')
@Controller('blood')
export class BloodController {
  constructor(private readonly svc: BloodService) {}

  @Get('stocks')
  stocks() {
    return this.svc.stocks();
  }

  @Roles('BLOOD_BANK')
  @Put('stocks')
  updateStock(@CurrentUser() u: AuthUser, @Body() dto: StockDto) {
    return this.svc.updateStock(u, dto.siteId, dto.product, dto.bloodGroup, dto.units);
  }

  @Get('requests')
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u);
  }

  @Roles('PRACTITIONER', 'NURSE')
  @Post('requests')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateBloodRequestDto, @Req() req: Request) {
    return this.svc.create(u, dto, req.ip);
  }

  @Get('requests/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }

  @Roles('PRACTITIONER', 'NURSE', 'BLOOD_BANK')
  @Post('requests/:id/alert-donors')
  @HttpCode(200)
  alert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.alertDonors(u, id);
  }

  @Roles('PRACTITIONER', 'NURSE', 'BLOOD_BANK')
  @Post('requests/:id/served')
  @HttpCode(200)
  served(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markServed(u, id);
  }

  @Get('donor/alerts')
  myAlerts(@CurrentUser() u: AuthUser) {
    return this.svc.myAlerts(u);
  }

  @Post('donor/alerts/:id/respond')
  @HttpCode(200)
  respond(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondDto) {
    return this.svc.respondAsUser(u, id, dto.accept);
  }
}
