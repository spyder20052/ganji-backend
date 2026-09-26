import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { PROVIDERS } from './mobile-money';

export const SCHEMES = ['ARCH', 'MUTUELLE', 'AUCUNE'] as const;

export class CoverageDto {
  @ApiProperty({ enum: SCHEMES, example: 'ARCH' })
  @IsIn(SCHEMES)
  scheme: (typeof SCHEMES)[number];

  @ApiPropertyOptional({ description: 'Numéro de bénéficiaire (obligatoire pour ARCH et MUTUELLE)', example: 'ARCH-20241535' })
  @ValidateIf((o: CoverageDto) => o.scheme !== 'AUCUNE')
  @IsString({ message: 'Numéro de bénéficiaire requis' })
  @Length(4, 30, { message: 'Numéro de bénéficiaire : 4 à 30 caractères' })
  @Matches(/^[A-Za-z0-9 .\-/]+$/, { message: 'Numéro : lettres, chiffres et tirets seulement' })
  number?: string;
}

export class EstimateActDto {
  @ApiProperty({ example: 'CONS-GEN' }) @IsString() @Length(2, 20) code: string;
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(60) qty: number;
}

export class EstimateMedicationDto {
  @ApiProperty() @IsUUID() medicationId: string;
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(60) quantity: number;
}

export class EstimateDto {
  @ApiProperty({ type: [EstimateActDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => EstimateActDto)
  acts: EstimateActDto[];

  @ApiProperty({ type: [EstimateMedicationDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => EstimateMedicationDto)
  medications: EstimateMedicationDto[];
}

export class PaymentDto {
  @ApiProperty({ description: 'Jeton signé renvoyé par POST /me/rights/estimate (montant et libellé calculés par le serveur)' })
  @IsString()
  @Length(20, 4000)
  estimateToken: string;
  @ApiProperty({ enum: PROVIDERS }) @IsIn(PROVIDERS) provider: (typeof PROVIDERS)[number];
  @ApiProperty({ example: '01 90 00 00 01' }) @IsString() @Length(8, 20) phone: string;
}
