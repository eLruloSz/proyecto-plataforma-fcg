import {
  Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param,
  ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { DataSource } from 'typeorm';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { AuditoriaService } from '../common/auditoria.service';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';

class ActualizarProcesoDto {
  @IsOptional() @IsString() @MaxLength(200) nombre?: string;
  @IsOptional() @Matches(/^[a-z]{1,2}$/, { message: 'El sufijo debe ser una o dos letras minúsculas.' })
  sufijoId?: string;
}

class NuevaEtapaDto {
  @IsString() @MinLength(1) @MaxLength(150) nombre: string;
  @IsOptional() @IsString() @MaxLength(1000) descripcion?: string;
  /** La etapa nueva queda inmediatamente después de esta. */
  @IsUUID() despuesDe: string;
  @IsOptional() @IsInt() @Min(1) cupo?: number;
}
class EditarEtapaDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(150) nombre?: string;
  @IsOptional() @IsString() @MaxLength(1000) descripcion?: string;
  @IsOptional() @ValidateIf((o) => o.cupo !== null) @IsInt() @Min(1) cupo?: number | null;
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
      `SELECT e.id, e.orden, e.nombre, e.descripcion, e.estado, e.fecha_inicio, e.fecha_fin, e.cupo,
              (SELECT COUNT(*)::int FROM postulaciones p WHERE p.etapa_id = e.id
                 AND p.estado NOT IN ('NO_CONTINUA', 'DESISTIO')) AS estudiantes,
              (SELECT COUNT(*)::int FROM requisitos_etapa r WHERE r.etapa_id = e.id AND r.activo) AS requisitos
         FROM etapas e WHERE e.proceso_id = $1 ORDER BY e.orden`,
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

  /**
   * Inserta una etapa nueva justo después de otra (ej. entre la 2 y la 3).
   * Las siguientes se corren un lugar. Si la etapa nueva queda antes de la
   * etapa activa, queda como cerrada; si no, como pendiente.
   */
  async crearEtapa(dto: NuevaEtapaDto, usuarioId: string) {
    const p = await this.actual.obtener();
    await this.ds.transaction(async (em) => {
      const [base] = await em.query(`SELECT orden FROM etapas WHERE id = $1 AND proceso_id = $2`, [dto.despuesDe, p.id]);
      if (!base) throw new NotFoundException('Etapa no encontrada.');
      await em.query(`SET CONSTRAINTS ux_etapas_orden DEFERRED`);
      await em.query(`UPDATE etapas SET orden = orden + 1 WHERE proceso_id = $1 AND orden > $2`, [p.id, base.orden]);
      const [{ hay_posterior_iniciada }] = await em.query(
        `SELECT EXISTS (SELECT 1 FROM etapas WHERE proceso_id = $1 AND orden > $2 AND estado <> 'PENDIENTE') AS hay_posterior_iniciada`,
        [p.id, base.orden + 1]);
      await em.query(
        `INSERT INTO etapas (proceso_id, orden, nombre, descripcion, estado, cupo) VALUES ($1, $2, $3, $4, $5, $6)`,
        [p.id, base.orden + 1, dto.nombre.trim(), dto.descripcion ?? null, hay_posterior_iniciada ? 'CERRADA' : 'PENDIENTE', dto.cupo ?? null]);
    });
    await this.auditoria.registrar(usuarioId, 'CREAR_ETAPA', 'procesos', p.id, dto);
    return this.procesoActual();
  }

  async editarEtapa(id: string, dto: EditarEtapaDto, usuarioId: string) {
    const p = await this.actual.obtener();
    const [e] = await this.ds.query(`SELECT 1 FROM etapas WHERE id = $1 AND proceso_id = $2`, [id, p.id]);
    if (!e) throw new NotFoundException('Etapa no encontrada.');
    await this.ds.query(
      `UPDATE etapas SET nombre = COALESCE($2, nombre), descripcion = COALESCE($3, descripcion),
              cupo = CASE WHEN $4::boolean THEN $5::int ELSE cupo END
        WHERE id = $1`,
      [id, dto.nombre?.trim() ?? null, dto.descripcion ?? null, dto.cupo !== undefined, dto.cupo ?? null]);
    await this.auditoria.registrar(usuarioId, 'EDITAR_ETAPA', 'etapas', id, dto);
    return this.procesoActual();
  }

  /** Solo se puede eliminar una etapa vacía (sin estudiantes ni resultados) y que no esté activa. */
  async eliminarEtapa(id: string, usuarioId: string) {
    const p = await this.actual.obtener();
    await this.ds.transaction(async (em) => {
      const [e] = await em.query(
        `SELECT e.orden, e.estado,
                (SELECT COUNT(*) FROM postulaciones x WHERE x.etapa_id = e.id)::int AS estudiantes,
                (SELECT COUNT(*) FROM resultados_etapa r WHERE r.etapa_id = e.id)::int AS resultados,
                (SELECT COUNT(*) FROM etapas o WHERE o.proceso_id = e.proceso_id)::int AS total
           FROM etapas e WHERE e.id = $1 AND e.proceso_id = $2`, [id, p.id]);
      if (!e) throw new NotFoundException('Etapa no encontrada.');
      if (e.estado === 'ACTIVA') throw new ConflictException('No se puede eliminar la etapa activa.');
      if (e.estudiantes || e.resultados) throw new ConflictException('La etapa tiene estudiantes o resultados registrados; no se puede eliminar.');
      if (e.total <= 1) throw new ConflictException('El proceso debe tener al menos una etapa.');
      await em.query(`SET CONSTRAINTS ux_etapas_orden DEFERRED`);
      await em.query(`DELETE FROM etapas WHERE id = $1`, [id]);
      await em.query(`UPDATE etapas SET orden = orden - 1 WHERE proceso_id = $1 AND orden > $2`, [p.id, e.orden]);
    });
    await this.auditoria.registrar(usuarioId, 'ELIMINAR_ETAPA', 'etapas', id);
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

  @Post('etapas')
  crearEtapa(@Body() dto: NuevaEtapaDto, @Usuario() u: UsuarioSesion) {
    return this.svc.crearEtapa(dto, u.id);
  }

  @Patch('etapas/:id')
  editarEtapa(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EditarEtapaDto, @Usuario() u: UsuarioSesion) {
    return this.svc.editarEtapa(id, dto, u.id);
  }

  @Delete('etapas/:id')
  eliminarEtapa(@Param('id', ParseUUIDPipe) id: string, @Usuario() u: UsuarioSesion) {
    return this.svc.eliminarEtapa(id, u.id);
  }

  @Post('etapas/:id/activar')
  @HttpCode(200)
  activar(@Param('id', ParseUUIDPipe) id: string, @Usuario() u: UsuarioSesion) {
    return this.svc.activarEtapa(id, u.id);
  }
}

@Module({ controllers: [ProcesosController], providers: [ProcesosService] })
export class ProcesosModule {}
