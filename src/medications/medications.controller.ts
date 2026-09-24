import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth-user';
import { CreatePrescriptionDto, GeoQueryDto, MedicationSearchDto, OnDutyDto, PharmacyStockDto, PrescriptionPayloadDto } from './medications.dto';
import { MedicationsService } from './medications.service';

@ApiTags('M5 · Médicaments')
@Controller()
export class MedicationsController {
  constructor(private readonly svc: MedicationsService) {}

  @Public()
  @Get('medications/search')
  search(@Query() q: MedicationSearchDto) {
    return this.svc.search(q.q);
  }

  @Public()
  @Get('medications/:id/pharmacies')
  pharmacies(@Param('id', ParseUUIDPipe) id: string, @Query() geo: GeoQueryDto) {
    return this.svc.pharmaciesFor(id, geo.lat, geo.lng);
  }

  @Public()
  @Get('pharmacies/on-duty')
  onDuty(@Query() geo: GeoQueryDto) {
    return this.svc.onDutyPharmacies(geo.lat, geo.lng);
  }
}

@ApiTags('M5 · Médicaments')
@Controller()
export class PrescriptionsController {
  constructor(private readonly svc: MedicationsService) {}

  @Roles('PRACTITIONER')
  @Post('prescriptions')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePrescriptionDto, @Req() req: Request) {
    return this.svc.createPrescription(u, dto, req.ip);
  }

  @Get('prescriptions/mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.svc.myPrescriptions(u);
  }

  @Get('patients/:id/prescriptions')
  forPatient(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.patientPrescriptions(u, id, req.ip);
  }

  @Roles('PHARMACIST')
  @Post('prescriptions/verify')
  @HttpCode(200)
  verify(@CurrentUser() u: AuthUser, @Body() dto: PrescriptionPayloadDto, @Req() req: Request) {
    return this.svc.verify(u, dto.payload, req.ip);
  }

  @Roles('PHARMACIST')
  @Post('prescriptions/dispense')
  @HttpCode(200)
  dispense(@CurrentUser() u: AuthUser, @Body() dto: PrescriptionPayloadDto, @Req() req: Request) {
    return this.svc.dispense(u, dto.payload, req.ip);
  }
}

@ApiTags('M5 · Médicaments')
@Roles('PHARMACIST')
@Controller('pharmacy')
export class PharmacyController {
  constructor(private readonly svc: MedicationsService) {}

  @Get('stock')
  stock(@CurrentUser() u: AuthUser) {
    return this.svc.stock(u);
  }

  @Put('stock')
  setStock(@CurrentUser() u: AuthUser, @Body() dto: PharmacyStockDto) {
    return this.svc.setStock(u, dto);
  }

  @Post('on-duty')
  @HttpCode(200)
  setOnDuty(@CurrentUser() u: AuthUser, @Body() dto: OnDutyDto) {
    return this.svc.setOnDuty(u, dto.onDuty);
  }
}
