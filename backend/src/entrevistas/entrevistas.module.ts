import {
  Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf,
} from 'class-validator';
import { DataSource } from 'typeorm';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { AuditoriaService } from '../common/auditoria.service';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';

export const ESTADOS_ENTREVISTA = ['POR_SOLICITAR', 'SOLICITADA', 'CONFIRMADA', 'REALIZADA', 'CANCELADA', 'CONFLICTO'] as const;
type EstadoEntrevista = (typeof ESTADOS_ENTREVISTA)[number];

/** La fundación agenda en hora de Chile: los bloqueos (día y hora "de reloj") se comparan en esa zona. */
const ZONA = 'America/Santiago';
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

class EntrevistaDto {
  @IsOptional() @ValidateIf((o) => o.fechaHora !== null) @IsISO8601() fechaHora?: string | null;
  @IsOptional() @IsIn(ESTADOS_ENTREVISTA) estado?: EstadoEntrevista;
  @IsOptional() @ValidateIf((o) => o.comentario !== null) @IsString() @MaxLength(2000) comentario?: string | null;
}
class BloqueoDto {
  @IsISO8601({ strict: true }) fecha: string;
  @IsOptional() @ValidateIf((o) => o.hora !== null) @Matches(HORA, { message: 'La hora debe ser HH:MM.' }) hora?: string | null;
  @IsString() @MinLength(1) @MaxLength(150) motivo: string;
}
class HorasDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(16) @Matches(HORA, { each: true, message: 'Cada hora debe ser HH:MM.' }) horas: string[];
}

/**
 * Calendario de entrevistas (Preselección N°2 y Selección de becarios).
 * Usa la tabla `entrevistas` (una por estudiante y etapa) y le agrega el
 * estado, los bloques horarios de la etapa y los días u horas bloqueados.
 */
@Injectable()
export class EntrevistasService {
  constructor(
    private readonly ds: DataSource,
    private readonly proceso: ProcesoActualService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async etapa(etapaId: string) {
    const [e] = await this.ds.query(
      `SELECT id, orden, nombre, clave, cupo, estado, horas_entrevista AS horas FROM etapas WHERE id = $1 AND proceso_id = $2`,
      [etapaId, await this.proceso.id()]);
    if (!e) throw new NotFoundException('Etapa no encontrada.');
    return e;
  }

  /** Todo lo que necesita el calendario de una etapa. */
  async calendario(etapaId: string) {
    const etapa = await this.etapa(etapaId);
    const estudiantes = await this.ds.query(
      `SELECT p.id, p.codigo, pe.nombres, pe.apellido_paterno, pe.apellido_materno, pe.email, pe.telefono,
              l.codigo AS liceo_codigo, l.nombre AS liceo,
              (p.etapa_id = $1) AS en_esta_etapa, r.resultado, COALESCE(r.confirmado, FALSE) AS confirmado,
              CASE WHEN en.postulacion_id IS NULL THEN NULL ELSE jsonb_build_object(
                'fecha_hora', en.fecha_hora, 'estado', en.estado, 'comentario', en.comentario, 'actualizado_en', en.actualizado_en) END AS entrevista
         FROM postulaciones p
         JOIN personas pe ON pe.id = p.persona_id
         JOIN liceos l ON l.id = p.liceo_id
         LEFT JOIN entrevistas en ON en.postulacion_id = p.id AND en.etapa_id = $1
         LEFT JOIN resultados_etapa r ON r.postulacion_id = p.id AND r.etapa_id = $1
        WHERE p.etapa_id = $1 OR en.postulacion_id IS NOT NULL OR (r.confirmado AND r.etapa_id = $1)
        ORDER BY p.correlativo`,
      [etapaId]);
    const bloqueos = await this.ds.query(
      `SELECT id, to_char(fecha, 'YYYY-MM-DD') AS fecha, hora, motivo FROM bloqueos_agenda WHERE etapa_id = $1 ORDER BY fecha, hora NULLS FIRST`,
      [etapaId]);
    return { etapa, estudiantes, bloqueos };
  }

  /** Agenda, reagenda, cambia el estado o comenta una entrevista. Solo cambia lo que viene. */
  async guardar(etapaId: string, postulacionId: string, dto: EntrevistaDto, usuarioId: string) {
    await this.etapa(etapaId);
    const [p] = await this.ds.query(
      `SELECT p.id, (p.etapa_id = $2) AS en_esta_etapa,
              EXISTS (SELECT 1 FROM entrevistas e WHERE e.postulacion_id = p.id AND e.etapa_id = $2) AS tiene
         FROM postulaciones p WHERE p.id = $1 AND p.proceso_id = $3`,
      [postulacionId, etapaId, await this.proceso.id()]);
    if (!p) throw new NotFoundException('Estudiante no encontrado.');
    if (!p.en_esta_etapa && !p.tiene) throw new ConflictException('El estudiante no está en esta etapa.');

    if (dto.fechaHora) {
      const [b] = await this.ds.query(
        `SELECT motivo, hora FROM bloqueos_agenda
          WHERE etapa_id = $1 AND fecha = ($2::timestamptz AT TIME ZONE '${ZONA}')::date
            AND (hora IS NULL OR hora = to_char($2::timestamptz AT TIME ZONE '${ZONA}', 'HH24:MI'))
          LIMIT 1`, [etapaId, dto.fechaHora]);
      if (b) throw new ConflictException(`Ese ${b.hora ? 'horario' : 'día'} está bloqueado (${b.motivo}).`);
    }

    const fecha = dto.fechaHora !== undefined;
    const estado = dto.estado !== undefined;
    const comentario = dto.comentario !== undefined;
    await this.ds.query(
      `INSERT INTO entrevistas (postulacion_id, etapa_id, fecha_hora, estado, realizada, comentario, marcado_por)
       VALUES ($1, $2, $3::timestamptz,
               COALESCE($4::varchar, CASE WHEN $3::timestamptz IS NULL THEN 'POR_SOLICITAR' ELSE 'SOLICITADA' END),
               COALESCE($4::varchar, '') = 'REALIZADA', $5::text, $6)
       ON CONFLICT (postulacion_id, etapa_id) DO UPDATE SET
         fecha_hora = CASE WHEN $7::boolean THEN $3::timestamptz ELSE entrevistas.fecha_hora END,
         estado     = CASE WHEN $8::boolean THEN $4::varchar ELSE entrevistas.estado END,
         realizada  = CASE WHEN $8::boolean THEN $4::varchar = 'REALIZADA' ELSE entrevistas.realizada END,
         comentario = CASE WHEN $9::boolean THEN $5::text ELSE entrevistas.comentario END,
         marcado_por = $6, actualizado_en = NOW()`,
      [postulacionId, etapaId, dto.fechaHora ?? null, dto.estado ?? null, dto.comentario?.trim() || null, usuarioId,
        fecha, estado, comentario]);
    await this.auditoria.registrar(usuarioId, 'GUARDAR_ENTREVISTA', 'postulaciones', postulacionId, { etapaId, ...dto });
    return this.calendario(etapaId);
  }

  async bloquear(etapaId: string, dto: BloqueoDto, usuarioId: string) {
    await this.etapa(etapaId);
    try {
      await this.ds.query(
        `INSERT INTO bloqueos_agenda (etapa_id, fecha, hora, motivo, creado_por) VALUES ($1, $2, $3, $4, $5)`,
        [etapaId, dto.fecha.slice(0, 10), dto.hora ?? null, dto.motivo.trim(), usuarioId]);
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('Ese día u horario ya está bloqueado.');
      throw e;
    }
    return this.calendario(etapaId);
  }

  async desbloquear(etapaId: string, bloqueoId: string) {
    await this.etapa(etapaId);
    await this.ds.query(`DELETE FROM bloqueos_agenda WHERE id = $1 AND etapa_id = $2`, [bloqueoId, etapaId]);
    return this.calendario(etapaId);
  }

  async cambiarHoras(etapaId: string, horas: string[], usuarioId: string) {
    await this.etapa(etapaId);
    const orden = [...new Set(horas)].sort();
    await this.ds.query(`UPDATE etapas SET horas_entrevista = $2 WHERE id = $1`, [etapaId, orden]);
    await this.auditoria.registrar(usuarioId, 'HORARIOS_ENTREVISTA', 'etapas', etapaId, { horas: orden });
    return this.calendario(etapaId);
  }
}

@ApiTags('entrevistas')
@ApiBearerAuth()
@Controller('entrevistas/:etapaId')
export class EntrevistasController {
  constructor(private readonly svc: EntrevistasService) {}

  @Get()
  calendario(@Param('etapaId', ParseUUIDPipe) etapaId: string) {
    return this.svc.calendario(etapaId);
  }

  @Put('estudiantes/:postulacionId')
  guardar(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
    @Body() dto: EntrevistaDto, @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.guardar(etapaId, postulacionId, dto, u.id);
  }

  @Post('bloqueos')
  bloquear(@Param('etapaId', ParseUUIDPipe) etapaId: string, @Body() dto: BloqueoDto, @Usuario() u: UsuarioSesion) {
    return this.svc.bloquear(etapaId, dto, u.id);
  }

  @Delete('bloqueos/:bloqueoId')
  desbloquear(@Param('etapaId', ParseUUIDPipe) etapaId: string, @Param('bloqueoId', ParseUUIDPipe) bloqueoId: string) {
    return this.svc.desbloquear(etapaId, bloqueoId);
  }

  @Put('horas')
  horas(@Param('etapaId', ParseUUIDPipe) etapaId: string, @Body() dto: HorasDto, @Usuario() u: UsuarioSesion) {
    return this.svc.cambiarHoras(etapaId, dto.horas, u.id);
  }
}

@Module({ controllers: [EntrevistasController], providers: [EntrevistasService] })
export class EntrevistasModule {}