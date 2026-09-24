import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
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
