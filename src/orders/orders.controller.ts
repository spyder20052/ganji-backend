import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { CreateOrderDto, DeliverOrderDto, DispatchOrderDto, FailOrderDto, MyOrdersQueryDto, OrderOptionsDto, PharmacyOrdersQueryDto, RefuseOrderDto } from './orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('Commandes · patient')
@Roles('PATIENT', 'CAREGIVER')
@Controller('me/orders')
export class MyOrdersController {
  constructor(private readonly svc: OrdersService) {}

  /** Préparer une commande : médicaments, pharmacies qui ont tout en stock, frais, valeurs par défaut. */
  @Get('options')
  options(@CurrentUser() u: AuthUser, @Query() q: OrderOptionsDto) {
    return this.svc.options(u, q);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateOrderDto, @Req() req: Request) {
    return this.svc.create(u, dto, req.ip);
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: MyOrdersQueryDto, @Req() req: Request) {
    return this.svc.listMine(u, q.patientId, req.ip);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.getMine(u, id, req.ip);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(u, id);
  }
}

@ApiTags('Commandes · pharmacie')
@Roles('PHARMACIST')
@Controller('pharmacy/orders')
export class PharmacyOrdersController {
  constructor(private readonly svc: OrdersService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: PharmacyOrdersQueryDto, @Req() req: Request) {
    return this.svc.listForPharmacy(u, q.status, req.ip);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.accept(u, id, req.ip);
  }

  @Post(':id/refuse')
  @HttpCode(200)
  refuse(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefuseOrderDto, @Req() req: Request) {
    return this.svc.refuse(u, id, dto.reason, req.ip);
  }

  @Post(':id/ready')
  @HttpCode(200)
  ready(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.ready(u, id);
  }

  @Post(':id/dispatch')
  @HttpCode(200)
  dispatch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DispatchOrderDto) {
    return this.svc.dispatch(u, id, dto.courierName, dto.courierPhone);
  }

  /** Remise contre le code à 4 chiffres du patient : livrée ou retirée. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/deliver')
  @HttpCode(200)
  deliver(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliverOrderDto, @Req() req: Request) {
    return this.svc.deliver(u, id, dto.code, req.ip);
  }

  /** Remise impossible (patient absent, code bloqué, ordonnance expirée…) : échec, stock rendu, remboursement. */
  @Post(':id/fail')
  @HttpCode(200)
  fail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FailOrderDto, @Req() req: Request) {
    return this.svc.fail(u, id, dto.reason, req.ip);
  }

  /** Nouveau code de remise envoyé par SMS au patient (jamais montré à l'officine) ; 3 fois au plus. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/new-code')
  @HttpCode(200)
  newCode(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.newCode(u, id, req.ip);
  }
}
