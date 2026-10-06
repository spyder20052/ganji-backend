import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Public } from '../common/auth-user';
import { CareMapService } from './care-map.service';

/** « ?openNow=false » vaut faux : `Boolean('false')` vaudrait vrai. */
const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

class NearbyDto {
  @ApiProperty({ example: 6.3654 }) @Type(() => Number) @IsLatitude() lat: number;
  @ApiProperty({ example: 2.4183 }) @Type(() => Number) @IsLongitude() lng: number;
  @ApiPropertyOptional({ example: 'maternite' }) @IsOptional() @IsString() @MaxLength(40) service?: string;
  @ApiPropertyOptional({ example: 'PHARMACIE' }) @IsOptional() @IsString() @MaxLength(40) type?: string;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @Transform(toBool) @IsBoolean() openNow?: boolean;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @Transform(toBool) @IsBoolean() onDuty?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit?: number;
}

class FacilitiesDto {
  @ApiPropertyOptional({ example: 'PHARMACIE' }) @IsOptional() @IsString() @MaxLength(40) type?: string;
  @ApiPropertyOptional({ example: 'BJ-AL', description: 'Code du département' }) @IsOptional() @IsString() @MaxLength(10) department?: string;
}

class TriageDto {
  @ApiProperty({ example: [0, 7], description: "Index des réponses choisies, dans l'ordre" })
  @IsArray()
  @ArrayMaxSize(8)
  @IsInt({ each: true })
  @Min(0, { each: true })
  answers: number[];
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
}

@ApiTags('M11 · Orientation et lieux de soin')
@Public()
@Controller()
export class CareMapController {
  constructor(private readonly svc: CareMapService) {}

  @Get('geo/departments')
  departments() {
    return this.svc.departments();
  }

  @Get('facilities')
  facilities(@Query() q: FacilitiesDto) {
    return this.svc.facilities(q.type, q.department);
  }

  @Get('facilities/nearby')
  nearby(@Query() q: NearbyDto) {
    return this.svc.nearby({ ...q, types: q.type ? [q.type] : undefined });
  }

  @Get('facilities/:id')
  facility(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.facility(id);
  }

  @Get('triage/tree')
  tree() {
    return this.svc.triageTree();
  }

  @Post('triage')
  @HttpCode(200)
  triage(@Body() dto: TriageDto) {
    return this.svc.triage(dto.answers, dto.lat, dto.lng);
  }
}
