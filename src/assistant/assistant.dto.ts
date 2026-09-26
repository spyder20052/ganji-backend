import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

const LANGS = ['fr', 'en', 'fon', 'yo', 'bba', 'ddn'] as const;

/** Personne aidée (aidant délégué) ; sans elle, c'est son propre traitement. */
export class ForPatientDto {
  @ApiPropertyOptional({ description: 'Patient aidé (délégation)' }) @IsOptional() @IsUUID() patientId?: string;
}

export class PlanDto {
  @ApiProperty() @IsUUID() prescriptionId: string;
}

export class DoseDto {
  @ApiProperty({ enum: ['PRISE', 'OUBLIEE', 'DECALEE'] }) @IsIn(['PRISE', 'OUBLIEE', 'DECALEE']) status: 'PRISE' | 'OUBLIEE' | 'DECALEE';
  @ApiPropertyOptional({ enum: LANGS }) @IsOptional() @IsIn(LANGS) lang?: string;
}

export class AskDto {
  @ApiProperty({ example: 'J’ai oublié ma dose, que faire ?' }) @IsString() @Length(2, 300) question: string;
  @ApiPropertyOptional({ enum: LANGS }) @IsOptional() @IsIn(LANGS) lang?: string;
}
