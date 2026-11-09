import { Controller, Get, Module, Param, ParseUUIDPipe, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExportacionService } from './exportacion.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Cabecera de descarga que admite tildes y ñ en el nombre. */
const adjunto = (nombre: string) => `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`;

/** Exportaciones a Excel. Son consultas (GET): también las puede usar una cuenta de solo lectura. */
@ApiTags('exportacion')
@ApiBearerAuth()
@Controller('exportar')
export class ExportacionController {
  constructor(private readonly svc: ExportacionService) {}

  /** Excel de una etapa: sus estudiantes con los datos hasta esa etapa + el Listado Final de Invitados. */
  @Get('etapa/:etapaId/excel')
  async etapa(@Param('etapaId', ParseUUIDPipe) etapaId: string) {
    const r = await this.svc.excelEtapa(etapaId);
    return new StreamableFile(r.buffer, { type: XLSX, disposition: adjunto(r.nombre) });
  }

  /** Solo el Listado Final de Invitados (Invitados, Correos, Envíos y formulario con RSH, Postulantes por liceo). */
  @Get('listado-final-invitados')
  async listadoFinal() {
    const r = await this.svc.excelListadoFinal();
    return new StreamableFile(r.buffer, { type: XLSX, disposition: adjunto(r.nombre) });
  }
}

@Module({ controllers: [ExportacionController], providers: [ExportacionService] })
export class ExportacionModule {}
