import { Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { ProcesoActualService } from '../src/common/proceso-actual.service';
import { AuditoriaService } from '../src/common/auditoria.service';
import { Usuario, UsuarioSesion } from '../src/auth/public.decorator';

class ActualizarProcesoDto {
  @IsOptional() @IsString() @MaxLength(200) nombre?: string;
  @IsOptional() @Matches(/^[a-z]{1,2}$/, { message: 'El sufijo debe ser una o dos letras minúsculas.' })
  sufijoId?: string;
}

@Injectable()
export class ProcesosService {
  constructor(
    private readonly ds: DataSource,
    private readonly actual: ProcesoActualService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async procesoActual() {
    const p = await this.actual.obtener();
    const etapas = await this.ds.query(
      `SELECT id, orden, nombre, descripcion, estado, fecha_inicio, fecha_fin
         FROM etapas WHERE proceso_id = $1 ORDER BY orden`,
      [p.id],
    );
    return { ...p, etapas };
  }

  async actualizar(dto: ActualizarProcesoDto, usuarioId: string) {
    const p = await this.actual.obtener();
    await this.ds.query(
      `UPDATE procesos SET nombre = COALESCE($2, nombre), sufijo_id = COALESCE($3, sufijo_id) WHERE id = $1`,
      [p.id, dto.nombre ?? null, dto.sufijoId ?? null],
    );
    await this.auditoria.registrar(usuarioId, 'ACTUALIZAR_PROCESO', 'procesos', p.id, dto);
    return this.procesoActual();
  }

  /**
   * Activa una etapa: las anteriores quedan CERRADAS (verde), la elegida
   * ACTIVA (amarillo) y las siguientes PENDIENTES (gris). Permite volver
   * atrás si se activó una etapa por error.
   */
  async activarEtapa(etapaId: string, usuarioId: string) {
    const p = await this.actual.obtener();
    await this.ds.transaction(async (em) => {
      const [e] = await em.query(`SELECT orden FROM etapas WHERE id = $1 AND proceso_id = $2`, [etapaId, p.id]);
      if (!e) throw new NotFoundException('Etapa no encontrada.');
      // Primero se libera la etapa activa (índice único de una activa por proceso).
      await em.query(`UPDATE etapas SET estado = 'PENDIENTE' WHERE proceso_id = $1 AND estado = 'ACTIVA'`, [p.id]);
      await em.query(
        `UPDATE etapas SET
           estado = CASE WHEN orden < $2 THEN 'CERRADA' WHEN orden = $2 THEN 'ACTIVA' ELSE 'PENDIENTE' END,
           fecha_inicio = CASE WHEN orden = $2 AND fecha_inicio IS NULL THEN CURRENT_DATE ELSE fecha_inicio END,
           fecha_fin = CASE WHEN orden < $2 AND fecha_fin IS NULL THEN CURRENT_DATE
                            WHEN orden >= $2 THEN NULL ELSE fecha_fin END
         WHERE proceso_id = $1`,
        [p.id, e.orden],
      );
    });
    await this.auditoria.registrar(usuarioId, 'ACTIVAR_ETAPA', 'etapas', etapaId);
    return this.procesoActual();
  }
}

@ApiTags('procesos')
@ApiBearerAuth()
@Controller('proceso')
export class ProcesosController {
  constructor(private readonly svc: ProcesosService) {}

  @Get()
  actual() {
    return this.svc.procesoActual();
  }

  @Patch()
  actualizar(@Body() dto: ActualizarProcesoDto, @Usuario() u: UsuarioSesion) {
    return this.svc.actualizar(dto, u.id);
  }

  @Post('etapas/:id/activar')
  @HttpCode(200)
  activar(@Param('id', ParseUUIDPipe) id: string, @Usuario() u: UsuarioSesion) {
    return this.svc.activarEtapa(id, u.id);
  }
}

@Module({ controllers: [ProcesosController], providers: [ProcesosService] })
export class ProcesosModule {}
