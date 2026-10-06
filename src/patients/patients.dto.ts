import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';

export const SCOPES = ['summary', 'timeline', 'observations', 'documents', 'prescriptions', 'sensitive'] as const;

export class ShareDto {
  @ApiProperty({ isArray: true, enum: SCOPES, example: ['summary', 'timeline', 'observations'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(SCOPES, { each: true })
  scopes: string[];

  @ApiPropertyOptional({ description: 'Durée en heures (1 à 168, 24 par défaut)', example: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  hours?: number;
}

export class RedeemDto {
  @ApiProperty({ description: 'Jeton du QR ou code à 6 chiffres', example: '482913' })
  @IsString()
  @Length(6, 80)
  token: string;
}

export class DiscreetDto {
  @ApiProperty({ description: 'Mode discret : SMS et messages vocaux sans prénom ni détail' }) @IsBoolean() on: boolean;
}

export class DocumentDto {
  @ApiProperty() @IsString() @Length(1, 80) title: string;
  @ApiProperty({ enum: ['RESULTAT', 'ORDONNANCE', 'COMPTE_RENDU', 'IMAGERIE', 'AUTRE'] })
  @IsIn(['RESULTAT', 'ORDONNANCE', 'COMPTE_RENDU', 'IMAGERIE', 'AUTRE'])
  kind: string;
  @ApiProperty({ enum: ['image/jpeg', 'image/webp', 'image/png', 'application/pdf'] })
  @IsIn(['image/jpeg', 'image/webp', 'image/png', 'application/pdf'])
  mime: string;
  @ApiProperty({ description: 'Contenu en base64, compressé côté téléphone (≤ 300 Ko)' })
  @IsString()
  @MaxLength(420_000, { message: 'Fichier trop lourd : 300 Ko maximum après compression' })
  @Matches(/^[A-Za-z0-9+/=]+$/, { message: 'Contenu base64 invalide' })
  dataB64: string;
}

export class ObservationDto {
  @ApiProperty({ enum: ['HB', 'PLT', 'WBC', 'GLY', 'TA_SYS', 'TA_DIA', 'WEIGHT', 'HEIGHT'] })
  @IsIn(['HB', 'PLT', 'WBC', 'GLY', 'TA_SYS', 'TA_DIA', 'WEIGHT', 'HEIGHT'])
  code: string;
  @ApiProperty() @IsNumber() @Min(0) @Max(100_000) value: number;
  @ApiPropertyOptional({ example: '2026-09-24T08:30:00Z', description: 'Date du prélèvement (par défaut : maintenant)' }) @IsOptional() @IsISO8601() date?: string;
}

export class EncounterDto {
  @ApiProperty({ enum: ['CONSULTATION', 'HOSPITALISATION', 'TRANSFUSION', 'CHIMIOTHERAPIE', 'URGENCE'] })
  @IsIn(['CONSULTATION', 'HOSPITALISATION', 'TRANSFUSION', 'CHIMIOTHERAPIE', 'URGENCE'])
  type: string;
  @ApiProperty() @IsString() @Length(3, 2000) summary: string;
}

export const DELEGATION_SCOPES = ['summary', 'reminders', 'timeline', 'blood', 'appointments', 'orders', 'all'] as const;

export class DelegationDto {
  @ApiProperty({ example: '0197000002', description: 'Numéro béninois de l’aidant (il doit avoir un compte Ganji)' })
  @Matches(/^\+?229\s?0?1?\d{8}$|^01\d{8}$/, { message: 'Numéro de téléphone béninois invalide' })
  phone: string;
  @ApiProperty({ example: 'mère' }) @IsString() @Length(2, 30) relation: string;
  @ApiProperty({ isArray: true, enum: DELEGATION_SCOPES, example: ['summary', 'reminders'], description: 'orders : commander les médicaments et suivre les commandes (module orders)' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(DELEGATION_SCOPES.length)
  @IsIn(DELEGATION_SCOPES, { each: true })
  scopes: string[];
}
