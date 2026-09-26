import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { SERVICE_CODES } from './appointments.logic';

export class FacilitiesQuery {
  @ApiPropertyOptional({ example: 'Abomey-Calavi' }) @IsOptional() @IsString() @MaxLength(60) commune?: string;
  @ApiPropertyOptional({ enum: SERVICE_CODES }) @IsOptional() @IsIn(SERVICE_CODES) specialty?: string;
}

export class CreateAppointmentDto {
  @ApiProperty() @IsUUID() facilityId: string;
  @ApiProperty({ enum: SERVICE_CODES, example: 'HEMATOLOGIE' }) @IsIn(SERVICE_CODES) specialty: string;
  @ApiPropertyOptional({ example: 'Contrôle après la cure' }) @IsOptional() @IsString() @MaxLength(200) reason?: string;
  @ApiProperty({ example: '2026-10-03T08:00:00.000Z', description: 'Jour et moment souhaités (matin 9 h, après-midi 15 h)' }) @IsDateString() preferredAt: string;
  @ApiPropertyOptional({ description: 'Personne aidée (aidant avec le droit « rendez-vous »)' }) @IsOptional() @IsUUID() patientId?: string;
}

export class ConfirmDto {
  @ApiProperty({ example: '2026-10-03T09:00:00.000Z' }) @IsDateString() scheduledAt: string;
  @ApiPropertyOptional({ example: 'Venez à jeun, avec votre carnet.' }) @IsOptional() @IsString() @MaxLength(300) answer?: string;
}

export class RefuseDto {
  @ApiProperty({ example: 'Complet cette semaine : redemandez pour la semaine prochaine.' }) @IsString() @Length(3, 300) answer: string;
}
