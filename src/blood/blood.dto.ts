import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { BLOOD_GROUPS } from '../common/geo';

export class CreateBloodRequestDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiProperty({ enum: ['CGR', 'PLAQUETTES', 'PLASMA'] }) @IsIn(['CGR', 'PLAQUETTES', 'PLASMA']) product: string;
  @ApiPropertyOptional({ enum: BLOOD_GROUPS }) @IsOptional() @IsIn(BLOOD_GROUPS) bloodGroup?: string;
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) @Max(10) quantity: number;
  @ApiProperty({ enum: ['VITALE', 'URGENTE', 'PROGRAMMEE'] }) @IsIn(['VITALE', 'URGENTE', 'PROGRAMMEE']) urgency: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() neededBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() facilityId?: string;
}

export class StockDto {
  @ApiProperty() @IsUUID() siteId: string;
  @ApiProperty({ enum: ['CGR', 'PLAQUETTES', 'PLASMA'] }) @IsIn(['CGR', 'PLAQUETTES', 'PLASMA']) product: string;
  @ApiProperty({ enum: BLOOD_GROUPS }) @IsIn(BLOOD_GROUPS) bloodGroup: string;
  @ApiProperty() @IsInt() @Min(0) @Max(5000) units: number;
}

export class RespondDto {
  @ApiProperty() @IsBoolean() accept: boolean;
}

/** Inscription (ou mise à jour) comme donneur : patient ou aidant. Les champs absents gardent leur valeur. */
export class DonorProfileDto {
  @ApiPropertyOptional({ enum: BLOOD_GROUPS, description: 'Prérempli depuis la fiche vitale' }) @IsOptional() @IsIn(BLOOD_GROUPS) bloodGroup?: string;
  @ApiPropertyOptional({ description: 'Commune de résidence : le donneur est placé à son centre' }) @IsOptional() @IsUUID() communeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() available?: boolean;
  @ApiPropertyOptional({ description: 'Smartphone : alerte dans l’application ; sinon SMS ou appel vocal' }) @IsOptional() @IsBoolean() hasSmartphone?: boolean;
  @ApiPropertyOptional({ enum: ['F', 'M'], description: 'Seulement sans fiche patient' }) @IsOptional() @IsIn(['F', 'M']) sex?: string;
  @ApiPropertyOptional({ description: 'Âge, seulement sans fiche patient (18 à 60 ans pour donner)' }) @IsOptional() @IsInt() @Min(10) @Max(110) age?: number;
  @ApiPropertyOptional({ description: 'Pèse au moins 50 kg (question facultative)' }) @IsOptional() @IsBoolean() weightOk?: boolean;
}

export class ReserveDto {
  @ApiProperty({ example: 2, description: 'Poches à mettre de côté, prises dans le stock du site connecté' }) @IsInt() @Min(1) @Max(10) units: number;
}

export class ServedDto {
  @ApiPropertyOptional({ isArray: true, description: 'Appels (donneurs) dont on confirme qu’ils ont réellement donné ; aucun par défaut' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  donorAlertIds?: string[];
}
