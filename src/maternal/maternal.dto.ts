import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { DANGER_SIGNS_PREGNANCY } from '../data/vaccines';

export const DANGER_SIGN_CODES = DANGER_SIGNS_PREGNANCY.map((s) => s.code);

export class PatientQueryDto {
  @ApiPropertyOptional({ description: 'Par défaut : le carnet de la personne connectée' })
  @IsOptional()
  @IsUUID()
  patientId?: string;
}

export class DangerSignsDto {
  @ApiProperty({ isArray: true, enum: DANGER_SIGN_CODES, example: ['SAIGNEMENT'] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(DANGER_SIGN_CODES.length)
  @IsIn(DANGER_SIGN_CODES, { each: true, message: 'Signe de danger inconnu' })
  codes: string[];
}

export class ImmunizationGivenDto {
  @ApiPropertyOptional({ example: 'BCG-2026-0412' }) @IsOptional() @IsString() @Length(1, 40) lot?: string;
  @ApiPropertyOptional({ example: 'CS de Zogbadjè' }) @IsOptional() @IsString() @Length(2, 120) place?: string;
}
