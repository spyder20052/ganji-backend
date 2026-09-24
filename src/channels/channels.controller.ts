import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, NotFoundException, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Length, MaxLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { ChannelsService } from './channels.service';

class InboundDto {
  @ApiProperty({ example: '0196000123' }) @IsString() @Length(8, 16) from: string;
  @ApiProperty({ example: '1' }) @IsString() @MaxLength(160) body: string;
}

class UssdDto {
  @ApiProperty({ example: '0196000123' }) @IsString() @Length(8, 16) from: string;
  @ApiProperty({ example: '2*1', description: 'Saisie cumulée de la session USSD' }) @IsString() @MaxLength(40) text: string;
}

function demoOnly() {
  if (process.env.DEMO_MODE !== 'true') throw new NotFoundException();
}

@ApiTags('Canaux · SMS, USSD, voix (simulateur)')
@Public()
@Controller()
export class ChannelsController {
  constructor(
    private readonly svc: ChannelsService,
    private readonly crypto: CryptoService,
  ) {}

  @Get('sms/phones')
  phones() {
    demoOnly();
    return this.svc.demoPhones();
  }

  @Get('sms/outbox')
  outbox(@Query('to') to?: string) {
    demoOnly();
    return to ? this.svc.outboxFor(to) : this.svc.recent();
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('sms/inbound')
  @HttpCode(200)
  inbound(@Body() dto: InboundDto, @Headers('x-ganji-signature') signature?: string) {
    // En production : l'agrégateur signe le webhook (HMAC du corps). En démo : simulateur intégré.
    if (process.env.DEMO_MODE !== 'true' && (!signature || !this.crypto.verify(`${dto.from}:${dto.body}`, signature))) {
      throw new ForbiddenException('Signature du webhook invalide');
    }
    return this.svc.inboundSms(dto.from, dto.body);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('ussd')
  @HttpCode(200)
  ussd(@Body() dto: UssdDto) {
    demoOnly();
    return this.svc.ussd(dto.from, dto.text);
  }

  /** Vercel Cron (GET avec Authorization: Bearer CRON_SECRET) ou bouton de démo (POST). */
  @Get('jobs/tick')
  cron(@Headers('authorization') auth?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret || auth !== `Bearer ${secret}`) throw new UnauthorizedException();
    return this.svc.tick();
  }

  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('jobs/tick')
  @HttpCode(200)
  demoTick(@Body('horizonHours') horizonHours?: number) {
    demoOnly();
    return this.svc.demoTick(Math.min(Number(horizonHours) || 24, 24 * 30));
  }
}
