import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { DelegationDto, DocumentDto, EncounterDto, ObservationDto, RedeemDto, ShareDto } from './patients.dto';
import { PatientsService } from './patients.service';

@ApiTags('M1 · Consentement')
@Controller('me')
export class MeController {
  constructor(private readonly svc: PatientsService) {}

  @Get('summary')
  summary(@CurrentUser() u: AuthUser) {
    return this.svc.summary(u, this.svc.ownPatientId(u));
  }

  @Post('share')
  @HttpCode(200)
  share(@CurrentUser() u: AuthUser, @Body() dto: ShareDto) {
    return this.svc.share(u, dto);
  }

  @Get('consents')
  consents(@CurrentUser() u: AuthUser) {
    return this.svc.consents(u);
  }

  @Delete('consents/:id')
  revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revoke(u, id);
  }

  @Get('access-log')
  accessLog(@CurrentUser() u: AuthUser) {
    return this.svc.accessLog(u);
  }

  @Post('discreet')
  @HttpCode(200)
  discreet(@CurrentUser() u: AuthUser, @Body('on') on: boolean) {
    return this.svc.setDiscreet(u, Boolean(on));
  }

  @Get('delegations')
  delegations(@CurrentUser() u: AuthUser) {
    return this.svc.delegations(u);
  }

  @Post('delegations')
  addDelegation(@CurrentUser() u: AuthUser, @Body() dto: DelegationDto) {
    return this.svc.addDelegation(u, dto);
  }

  @Delete('delegations/:id')
  revokeDelegation(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revokeDelegation(u, id);
  }
}

@ApiTags('M2 · Carnet de santé')
@Controller()
export class PatientsController {
  constructor(private readonly svc: PatientsService) {}

  @Roles('PRACTITIONER', 'NURSE', 'PHARMACIST')
  @Post('share/redeem')
  @HttpCode(200)
  redeem(@CurrentUser() u: AuthUser, @Body() dto: RedeemDto, @Req() req: Request) {
    return this.svc.redeem(u, dto.token, req.ip);
  }

  @Roles('PRACTITIONER', 'NURSE')
  @Get('patients')
  myPatients(@CurrentUser() u: AuthUser) {
    return this.svc.myPatients(u);
  }

  @Get('patients/:id/summary')
  summary(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.summary(u, id, req.ip);
  }

  @Get('patients/:id/timeline')
  timeline(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.timeline(u, id, req.ip);
  }

  @Get('patients/:id/observations')
  observations(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('code') code: string | undefined, @Req() req: Request) {
    return this.svc.observations(u, id, code, req.ip);
  }

  @Post('patients/:id/observations')
  addObservation(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ObservationDto, @Req() req: Request) {
    return this.svc.addObservation(u, id, dto, req.ip);
  }

  @Post('patients/:id/encounters')
  addEncounter(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EncounterDto, @Req() req: Request) {
    return this.svc.addEncounter(u, id, dto, req.ip);
  }

  @Get('patients/:id/documents')
  documents(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.documents(u, id, req.ip);
  }

  /**
   * Ouvre ou télécharge un document. Un lien du navigateur reçoit le fichier lui-même (bon type MIME,
   * `?download=1` pour l'enregistrer) ; un appel `Accept: application/json` reçoit { mime, dataB64 } (carnet hors ligne).
   */
  @Get('patients/:id/documents/:docId')
  @ApiOperation({ summary: 'Fichier du document (volet « documents » exigé, ouverture journalisée)' })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/json')
  @ApiQuery({ name: 'download', required: false, description: '1 : enregistrer le fichier au lieu de l’afficher' })
  async document(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Query('download') download: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const d = await this.svc.document(u, id, docId, req.ip);
    const accept = req.headers.accept ?? '';
    if (download === undefined && accept.includes('application/json')) return d;
    const buf = Buffer.from(d.dataB64, 'base64');
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[d.mime] ?? 'bin';
    const name = `${d.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'document'}.${ext}`;
    res.set({
      'Content-Type': d.mime,
      'Content-Length': String(buf.length),
      'Content-Disposition': `${download !== undefined ? 'attachment' : 'inline'}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-store',
      // Le lecteur PDF du navigateur est un objet intégré : la politique générale (object-src 'none') le bloquerait.
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'",
    });
    return new StreamableFile(buf);
  }

  @Post('patients/:id/documents')
  addDocument(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DocumentDto, @Req() req: Request) {
    return this.svc.addDocument(u, id, dto, req.ip);
  }

  @Get('patients/:id/access-log')
  accessLog(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.accessLog(u, id);
  }
}
