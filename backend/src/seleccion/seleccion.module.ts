import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { APRECIACIONES, Apreciacion, SeleccionService } from './seleccion.service';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';
import { AvanceModule } from '../avance/avance.module';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Cabecera de descarga que admite tildes y ñ en el nombre. */
const adjunto = (nombre: string) => `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`;

class ApreciacionDto {
  @IsOptional() @ValidateIf((o) => o.apreciacion !== null) @IsIn(APRECIACIONES) apreciacion?: Apreciacion | null;
  @IsOptional() @ValidateIf((o) => o.observaciones !== null) @IsString() @MaxLength(4000) observaciones?: string | null;
}
class DecisionDto {
  @ValidateIf((o) => o.decision !== null) @IsIn(['PASA', 'NO_PASA', 'ESPERA']) decision: 'PASA' | 'NO_PASA' | 'ESPERA' | null;
}
class NotasDto {
  @ValidateIf((o) => o.notas !== null) @IsString() @MaxLength(4000) notas: string | null;
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

  /** Excel con lo importante para decidir. Consulta (GET): también lo puede bajar una cuenta de solo lectura. */
  @Get(':etapaId/excel')
  async excel(@Param('etapaId', ParseUUIDPipe) etapaId: string) {
    const r = await this.svc.excelDireccion(etapaId);
    return new StreamableFile(r.buffer, { type: XLSX, disposition: adjunto(r.nombre) });
  }

  /**
   * Guarda el Excel como archivo y devuelve su id: «Enviar a los directivos» lo adjunta en un correo nuevo
   * de Comunicación (que es donde se revisan los destinatarios y se envía).
   */
  @Post(':etapaId/excel-adjunto')
  @HttpCode(200)
  excelAdjunto(@Param('etapaId', ParseUUIDPipe) etapaId: string) {
    return this.svc.excelComoAdjunto(etapaId);
  }

  @Post(':etapaId/aplicar-sugerencias')
  aplicar(@Param('etapaId', ParseUUIDPipe) etapaId: string, @Usuario() u: UsuarioSesion) {
    return this.svc.aplicarSugerencias(etapaId, u.id);
  }

  /** Seleccionar / en espera / no seleccionar (null = quitar la marca). */
  @Put(':etapaId/estudiantes/:postulacionId/decision')
  decision(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
    @Body() dto: DecisionDto, @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.decidir(etapaId, postulacionId, dto.decision, u.id);
  }

  @Put(':etapaId/estudiantes/:postulacionId/notas')
  notas(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
    @Body() dto: NotasDto, @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.guardarNotas(etapaId, postulacionId, dto.notas, u.id);
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

@Module({ imports: [AvanceModule], controllers: [SeleccionController], providers: [SeleccionService] })
export class SeleccionModule {}
