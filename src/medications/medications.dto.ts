import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class MedicationSearchDto {
  @ApiProperty({ example: 'amoxi', description: 'DCI, classe thérapeutique ou code ATC (2 caractères minimum)' })
  @IsString()
  @Length(2, 60)
  q: string;
}

/** Position facultative de l'usager, pour trier les pharmacies par distance. */
export class GeoQueryDto {
  @ApiPropertyOptional({ example: 6.3654 }) @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional({ example: 2.4183 }) @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
}

export class PrescriptionItemDto {
  @ApiProperty() @IsUUID() medicationId: string;
  @ApiProperty({ example: '1 comprimé matin et soir' }) @IsString() @Length(2, 120) dosage: string;
  @ApiProperty({ example: '7 jours' }) @IsString() @Length(1, 60) duration: string;
  @ApiProperty({ example: 1, description: 'Nombre de boîtes, flacons ou ampoules' }) @IsInt() @Min(1) @Max(20) quantity: number;
}

export class CreatePrescriptionDto {
  @ApiProperty() @IsUUID() patientId: string;

  @ApiProperty({ type: [PrescriptionItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Une ordonnance comporte au moins un médicament' })
  @ArrayMaxSize(10, { message: 'Une ordonnance comporte au plus 10 médicaments' })
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items: PrescriptionItemDto[];

  @ApiPropertyOptional({ example: 30, description: 'Durée de validité en jours (30 par défaut)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  validityDays?: number;
}

export class PrescriptionPayloadDto {
  @ApiProperty({ example: 'alafia:rx:3f0c…-…-….Zk3…', description: 'Contenu du QR code de l’ordonnance' })
  @IsString()
  @Length(10, 200)
  payload: string;
}

export class PharmacyStockDto {
  @ApiProperty() @IsUUID() medicationId: string;
  @ApiProperty({ example: 40 }) @IsInt() @Min(0) @Max(100_000) quantity: number;
  @ApiPropertyOptional({ example: 1500 }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) priceFcfa?: number;
}

export class OnDutyDto {
  @ApiProperty() @IsBoolean() onDuty: boolean;
}
