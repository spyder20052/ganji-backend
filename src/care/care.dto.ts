import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';

export const SYMPTOMS = ['fever', 'pain', 'bleeding', 'fatigue', 'vomiting', 'breath', 'bruise', 'other'] as const;

export class SymptomDto {
  @ApiProperty({ enum: SYMPTOMS }) @IsIn(SYMPTOMS) symptom: string;
  @ApiProperty({ minimum: 1, maximum: 3, description: '1 léger, 2 moyen, 3 fort' }) @IsInt() @Min(1) @Max(3) severity: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(280) note?: string;
  @ApiPropertyOptional({ description: 'Pour un aidant agissant au nom du patient' }) @IsOptional() @IsUUID() patientId?: string;
}

export class TeleRequestDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiProperty({ enum: ['HEMATOLOGIE', 'ONCOLOGIE', 'PEDIATRIE', 'GYNECOLOGIE', 'CARDIOLOGIE', 'DERMATOLOGIE', 'MEDECINE_INTERNE'] })
  @IsIn(['HEMATOLOGIE', 'ONCOLOGIE', 'PEDIATRIE', 'GYNECOLOGIE', 'CARDIOLOGIE', 'DERMATOLOGIE', 'MEDECINE_INTERNE'])
  specialty: string;
  @ApiProperty() @IsString() @Length(20, 3000) question: string;
  @ApiProperty({ enum: ['NORMALE', 'URGENTE'] }) @IsIn(['NORMALE', 'URGENTE']) urgency: string;
  @ApiPropertyOptional({ description: 'Photos compressées (base64, 300 Ko max chacune)', isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(420_000, { each: true })
  attachments?: string[];
}

export class TeleAnswerDto {
  @ApiProperty() @IsString() @Length(10, 4000) answer: string;
}
