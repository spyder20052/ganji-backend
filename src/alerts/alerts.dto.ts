import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class ReportDto {
  @ApiProperty({ enum: ['DIARRHEE', 'FIEVRE_ERUPTION', 'TOUX', 'PARALYSIE', 'FIEVRE_HEMORRAGIQUE', 'DECES_INEXPLIQUE'] })
  @IsIn(['DIARRHEE', 'FIEVRE_ERUPTION', 'TOUX', 'PARALYSIE', 'FIEVRE_HEMORRAGIQUE', 'DECES_INEXPLIQUE'])
  syndrome: string;
  @ApiProperty({ example: 3 }) @IsInt() @Min(1) @Max(200) cases: number;
  @ApiProperty({ example: 'Djougou' }) @IsString() @Length(2, 60) commune: string;
  @ApiPropertyOptional({ example: 'Kolokondé' }) @IsOptional() @IsString() @Length(1, 60) village?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() offline?: boolean;
  @ApiPropertyOptional({ description: 'Date réelle de l’observation (saisie hors ligne)' }) @IsOptional() @IsDateString() observedAt?: string;
}

export class CreateAlertDto {
  @ApiProperty({ enum: ['EPIDEMIE', 'VACCINATION', 'RUPTURE', 'CANICULE', 'INONDATION'] })
  @IsIn(['EPIDEMIE', 'VACCINATION', 'RUPTURE', 'CANICULE', 'INONDATION'])
  kind: string;
  @ApiProperty({ enum: ['INFO', 'ATTENTION', 'URGENCE'] }) @IsIn(['INFO', 'ATTENTION', 'URGENCE']) severity: string;
  @ApiProperty() @IsString() @Length(4, 90) title: string;
  @ApiProperty() @IsString() @Length(10, 400) message: string;
  @ApiPropertyOptional({ isArray: true, example: ['Djougou'] }) @IsOptional() @IsArray() @IsString({ each: true }) communes?: string[];
  @ApiPropertyOptional({ example: 14 }) @IsOptional() @IsInt() @Min(1) @Max(90) days?: number;
}
