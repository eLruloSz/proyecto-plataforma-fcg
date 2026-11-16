import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { APRECIACIONES, Apreciacion, SeleccionService } from './seleccion.service';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';

class ApreciacionDto {
  @IsOptional() @ValidateIf((o) => o.apreciacion !== null) @IsIn(APRECIACIONES) apreciacion?: Apreciacion | null;
  @IsOptional() @ValidateIf((o) => o.observaciones !== null) @IsString() @MaxLength(4000) observaciones?: string | null;
}

@ApiTags('seleccion')
@ApiBearerAuth()
@Controller('seleccion')
export class SeleccionController {
  constructor(private readonly svc: SeleccionService) {}

  /** Finalistas con todo lo que se sabe de ellos, y los cupos. Consulta: también la ve una cuenta de solo lectura. */
  @Get(':etapaId')
  vista(@Param('etapaId', ParseUUIDPipe) etapaId: string) {
    return this.svc.vista(etapaId);
  }

  @Post(':etapaId/aplicar-sugerencias')
  aplicar(@Param('etapaId', ParseUUIDPipe) etapaId: string, @Usuario() u: UsuarioSesion) {
    return this.svc.aplicarSugerencias(etapaId, u.id);
  }

  /** La apreciación es de una entrevista concreta: `entrevistaEtapaId` es la etapa de esa entrevista. */
  @Put('entrevistas/:entrevistaEtapaId/estudiantes/:postulacionId/apreciacion')
  apreciacion(
    @Param('entrevistaEtapaId', ParseUUIDPipe) entrevistaEtapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
    @Body() dto: ApreciacionDto, @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.guardarApreciacion(entrevistaEtapaId, postulacionId, dto.apreciacion, dto.observaciones, u.id);
  }
}

@Module({ controllers: [SeleccionController], providers: [SeleccionService] })
export class SeleccionModule {}
