import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';

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

export class GrantDto extends ShareDto {
  @ApiProperty() @IsUUID() granteeUserId: string;
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
  @ApiProperty() @IsNumber() value: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) date?: string;
}

export class EncounterDto {
  @ApiProperty({ enum: ['CONSULTATION', 'HOSPITALISATION', 'TRANSFUSION', 'CHIMIOTHERAPIE', 'URGENCE'] })
  @IsIn(['CONSULTATION', 'HOSPITALISATION', 'TRANSFUSION', 'CHIMIOTHERAPIE', 'URGENCE'])
  type: string;
  @ApiProperty() @IsString() @Length(3, 2000) summary: string;
}

export class DelegationDto {
  @ApiProperty({ example: '0197000002' }) @IsString() phone: string;
  @ApiProperty({ example: 'mère' }) @IsString() @Length(2, 30) relation: string;
  @ApiProperty({ isArray: true, example: ['summary', 'reminders'], description: 'orders : commander les médicaments et suivre les commandes (module orders)' })
  @IsArray()
  @IsIn(['summary', 'reminders', 'timeline', 'blood', 'appointments', 'orders', 'all'], { each: true })
  scopes: string[];
}
