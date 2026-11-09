import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query,
  StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import JSZip from 'jszip';
import * as path from 'path';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf,
} from 'class-validator';
import { DataSource } from 'typeorm';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { AuditoriaService } from '../common/auditoria.service';
import { ArchivosService, TAMANO_MAXIMO } from '../common/archivos.service';
import { filas } from '../common/sql';
import { Usuario, UsuarioSesion } from '../auth/public.decorator';
import { DatosPauta, empaquetarPautas, generarPauta } from './pauta-docx';
import { textoRsh } from '../common/rsh';

export const ESTADOS_ENTREVISTA = ['POR_SOLICITAR', 'SOLICITADA', 'CONFIRMADA', 'REALIZADA', 'CANCELADA', 'CONFLICTO'] as const;
type EstadoEntrevista = (typeof ESTADOS_ENTREVISTA)[number];

/** La fundación agenda en hora de Chile: los bloqueos (día y hora "de reloj") se comparan en esa zona. */
const ZONA = 'America/Santiago';
const subidaWord = FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO } });
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
    private readonly archivos: ArchivosService,
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

  // -------------------------------------------------------------------------
  // Pauta de entrevista en Word (plantilla de la fundación)
  // -------------------------------------------------------------------------

  /**
   * Datos que el sistema ya tiene de cada estudiante de la etapa para rellenar la pauta.
   * Si se indican `ids` (postulaciones), solo esos estudiantes. Misma regla de pertenencia que el calendario.
   */
  private async datosPauta(etapaId: string, ids?: string[]): Promise<(DatosPauta & { id: string; apellidoPaterno: string; nombres: string })[]> {
    const procesoId = await this.proceso.id();
    const filas = await this.ds.query(
      `SELECT p.id, p.codigo, p.posicion_curso, pe.nombres, pe.apellido_paterno, pe.apellido_materno,
              l.codigo AS liceo_codigo, l.nombre AS liceo, l.comuna,
              en.fecha_hora, f.tramo_rsh, f.rsh_pendiente, f.personas_hogar, f.personas_formulario, f.ingresos_hogar,
              rp.posicion AS ranking, rp.rsh AS ranking_rsh
         FROM postulaciones p
         JOIN personas pe ON pe.id = p.persona_id
         JOIN liceos l ON l.id = p.liceo_id
         LEFT JOIN entrevistas en ON en.postulacion_id = p.id AND en.etapa_id = $1
         LEFT JOIN resultados_etapa r ON r.postulacion_id = p.id AND r.etapa_id = $1
         LEFT JOIN fichas_postulacion f ON f.postulacion_id = p.id
         LEFT JOIN cargas c ON c.proceso_id = p.proceso_id AND c.tipo = 'RANKING'
         LEFT JOIN ranking_postulacion rp ON rp.postulacion_id = p.id AND rp.carga_id = c.id
        WHERE p.proceso_id = $2
          AND (p.etapa_id = $1 OR en.postulacion_id IS NOT NULL OR (r.confirmado AND r.etapa_id = $1))
          AND ($3::uuid[] IS NULL OR p.id = ANY($3::uuid[]))
        ORDER BY en.fecha_hora NULLS LAST, p.correlativo`,
      [etapaId, procesoId, ids ?? null]);
    return filas.map((x: any) => {
      // RSH: el del Excel del ranking; si no hay, lo que se digitó antes en la ficha.
      const tramo = textoRsh(x.ranking_rsh, x.tramo_rsh, x.rsh_pendiente);
      return {
        id: x.id,
        codigo: x.codigo,
        nombreCompleto: [x.nombres, x.apellido_paterno, x.apellido_materno].filter(Boolean).join(' '),
        establecimiento: `${x.liceo_codigo}. ${x.liceo}`,
        comuna: x.comuna,
        posicionNotas: x.posicion_curso,
        rankingPreseleccion: x.ranking,
        fechaHora: x.fecha_hora,
        // N° de personas del hogar: lo que declaró el estudiante; si falta, el de la cartola.
        personasHogar: x.personas_formulario ?? x.personas_hogar,
        tramoRsh: tramo,
        ingresoMensual: x.ingresos_hogar,
        apellidoPaterno: x.apellido_paterno,
        nombres: x.nombres,
      };
    });
  }

  private nombreArchivoPauta(d: { codigo: string; apellidoPaterno: string; nombres: string }) {
    return `Pauta ${d.codigo} ${d.apellidoPaterno} ${d.nombres}.docx`.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ');
  }

  /** Pauta de un estudiante. */
  async pauta(etapaId: string, postulacionId: string) {
    await this.etapa(etapaId);
    const [d] = await this.datosPauta(etapaId, [postulacionId]);
    if (!d) throw new NotFoundException('Estudiante no encontrado en esta etapa.');
    return { nombre: this.nombreArchivoPauta(d), buffer: await generarPauta(d) };
  }

  /**
   * Lista para la ventana "Descargar Word": cada estudiante de la etapa y qué datos le faltan a su pauta.
   * Lo que falta no impide descargarla: esa parte del Word queda en blanco.
   */
  async listaPautas(etapaId: string) {
    await this.etapa(etapaId);
    const subidas = new Map<string, { nombre: string; subido_en: string }>();
    for (const x of await this.ds.query(
      `SELECT pe.postulacion_id, pe.subido_en, a.nombre_original AS nombre
         FROM pautas_entrevista pe JOIN archivos a ON a.id = pe.archivo_id WHERE pe.etapa_id = $1`, [etapaId])) {
      subidas.set(x.postulacion_id, { nombre: x.nombre, subido_en: x.subido_en });
    }
    return (await this.datosPauta(etapaId)).map((d) => {
      const faltan: string[] = [];
      if (!d.fechaHora) faltan.push('Sin fecha de entrevista');
      if (d.posicionNotas == null) faltan.push('Sin posición en notas');
      if (d.rankingPreseleccion == null) faltan.push('Sin ranking');
      if (!d.tramoRsh) faltan.push('Sin RSH');
      if (d.personasHogar == null) faltan.push('Sin personas del hogar');
      if (!d.ingresoMensual) faltan.push('Sin ingreso mensual');
      return {
        id: d.id, codigo: d.codigo, nombre: d.nombreCompleto, apellido_paterno: d.apellidoPaterno, nombres: d.nombres,
        liceo: d.establecimiento, ranking: d.rankingPreseleccion, fecha_hora: d.fechaHora, faltan,
        completada: subidas.get(d.id) ?? null,
      };
    });
  }

  /** Pautas de los estudiantes indicados (o de toda la etapa si no se indica ninguno), en un .zip. */
  async pautasZip(etapaId: string, ids?: string[]) {
    const etapa = await this.etapa(etapaId);
    const todos = await this.datosPauta(etapaId, ids);
    if (!todos.length) throw new NotFoundException('No hay estudiantes para descargar.');
    const pautas: { nombre: string; contenido: Buffer }[] = [];
    for (const d of todos) pautas.push({ nombre: this.nombreArchivoPauta(d), contenido: await generarPauta(d) });
    return { nombre: `Pautas de entrevista - ${etapa.nombre}.zip`, buffer: await empaquetarPautas(pautas), cantidad: pautas.length };
  }

  // -------------------------------------------------------------------------
  // Pauta completada: el Word de la entrevista, ya rellenado, se sube al estudiante
  // -------------------------------------------------------------------------

  /** Estudiante de la etapa (misma regla de pertenencia que el calendario). */
  private async estudianteDeEtapa(etapaId: string, postulacionId: string) {
    const [p] = await this.ds.query(
      `SELECT p.id, p.codigo, pe.nombres, pe.apellido_paterno,
              (p.etapa_id = $2) AS en_esta_etapa,
              EXISTS (SELECT 1 FROM entrevistas e WHERE e.postulacion_id = p.id AND e.etapa_id = $2) AS tiene
         FROM postulaciones p JOIN personas pe ON pe.id = p.persona_id
        WHERE p.id = $1 AND p.proceso_id = $3`,
      [postulacionId, etapaId, await this.proceso.id()]);
    if (!p) throw new NotFoundException('Estudiante no encontrado.');
    if (!p.en_esta_etapa && !p.tiene) throw new ConflictException('El estudiante no está en esta etapa.');
    return p as { id: string; codigo: string; nombres: string; apellido_paterno: string };
  }

  /** Texto plano del Word (sin formato). Falla si el archivo no es un .docx de verdad. */
  private async textoDeDocx(buffer: Buffer): Promise<string> {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const doc = zip.file('word/document.xml');
      if (!doc) throw new Error('sin document.xml');
      const xml = await doc.async('string');
      return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
    } catch {
      throw new BadRequestException('El archivo no es un Word (.docx) válido.');
    }
  }

  private nombrePautaCompletada(p: { codigo: string; apellido_paterno: string; nombres: string }) {
    return `Pauta completada ${p.codigo} ${p.apellido_paterno} ${p.nombres}.docx`.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ');
  }

  /**
   * Guarda el Word completado del estudiante en esta etapa (reemplaza al anterior, si había).
   * Para evitar subirlo al estudiante equivocado se exige que el Word traiga su código; si no lo trae,
   * se avisa y solo se guarda cuando se confirma (`forzar`).
   */
  async subirPautaCompletada(etapaId: string, postulacionId: string, archivo: Express.Multer.File | undefined, forzar: boolean, usuarioId: string) {
    await this.etapa(etapaId);
    const est = await this.estudianteDeEtapa(etapaId, postulacionId);
    if (!archivo) throw new BadRequestException('No se recibió ningún archivo.');
    if (path.extname(archivo.originalname).toLowerCase() !== '.docx') {
      throw new BadRequestException('Sube el Word de la pauta en formato .docx.');
    }
    const texto = await this.textoDeDocx(archivo.buffer);
    const sinEspacios = (x: string) => x.replace(/\s+/g, '').toLowerCase();
    if (!forzar && !sinEspacios(texto).includes(sinEspacios(est.codigo))) {
      throw new ConflictException(
        `Este Word no trae el código ${est.codigo}. Revisa que sea la pauta de ${est.nombres} ${est.apellido_paterno}; ` +
        'si estás segura de que es la correcta, confirma para guardarla igual.');
    }

    const nuevo = await this.archivos.guardar(archivo);
    const [previo] = await this.ds.query(
      `SELECT archivo_id FROM pautas_entrevista WHERE postulacion_id = $1 AND etapa_id = $2`, [postulacionId, etapaId]);
    await this.ds.query(
      `INSERT INTO pautas_entrevista (postulacion_id, etapa_id, archivo_id, subido_por) VALUES ($1, $2, $3, $4)
       ON CONFLICT (postulacion_id, etapa_id) DO UPDATE SET archivo_id = $3, subido_por = $4, subido_en = NOW()`,
      [postulacionId, etapaId, nuevo.id, usuarioId]);
    if (previo) await this.archivos.eliminar(previo.archivo_id);
    await this.auditoria.registrar(usuarioId, 'SUBIR_PAUTA_ENTREVISTA', 'postulaciones', postulacionId,
      { etapaId, archivo: archivo.originalname, reemplaza: !!previo, forzado: forzar });
    return { ok: true, reemplazada: !!previo };
  }

  async pautaCompletada(etapaId: string, postulacionId: string) {
    await this.etapa(etapaId);
    const est = await this.estudianteDeEtapa(etapaId, postulacionId).catch(() => null)
      ?? (await this.ds.query(
        `SELECT p.id, p.codigo, pe.nombres, pe.apellido_paterno FROM postulaciones p JOIN personas pe ON pe.id = p.persona_id
          WHERE p.id = $1 AND p.proceso_id = $2`, [postulacionId, await this.proceso.id()]))[0];
    if (!est) throw new NotFoundException('Estudiante no encontrado.');
    const [fila] = await this.ds.query(
      `SELECT archivo_id FROM pautas_entrevista WHERE postulacion_id = $1 AND etapa_id = $2`, [postulacionId, etapaId]);
    if (!fila) throw new NotFoundException('Este estudiante no tiene pauta completada en esta etapa.');
    const a = await this.archivos.obtener(fila.archivo_id);
    return { nombre: this.nombrePautaCompletada(est), buffer: await this.archivos.leer(a) };
  }

  async quitarPautaCompletada(etapaId: string, postulacionId: string, usuarioId: string) {
    await this.etapa(etapaId);
    const [fila] = filas<{ archivo_id: string }>(await this.ds.query(
      `DELETE FROM pautas_entrevista pe USING postulaciones p
        WHERE pe.postulacion_id = $1 AND pe.etapa_id = $2 AND p.id = pe.postulacion_id AND p.proceso_id = $3
        RETURNING pe.archivo_id`, [postulacionId, etapaId, await this.proceso.id()]));
    if (!fila) throw new NotFoundException('Este estudiante no tiene pauta completada en esta etapa.');
    await this.archivos.eliminar(fila.archivo_id);
    await this.auditoria.registrar(usuarioId, 'QUITAR_PAUTA_ENTREVISTA', 'postulaciones', postulacionId, { etapaId });
    return { ok: true };
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

/** Cabecera de descarga que admite tildes y ñ en el nombre. */
const adjunto = (nombre: string) => `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`;

@ApiTags('entrevistas')
@ApiBearerAuth()
@Controller('entrevistas/:etapaId')
export class EntrevistasController {
  constructor(private readonly svc: EntrevistasService) {}

  @Get()
  calendario(@Param('etapaId', ParseUUIDPipe) etapaId: string) {
    return this.svc.calendario(etapaId);
  }

  /** Estudiantes de la etapa con los datos que le faltan a cada pauta (ventana "Descargar Word"). */
  @Get('pautas/lista')
  listaPautas(@Param('etapaId', ParseUUIDPipe) etapaId: string) {
    return this.svc.listaPautas(etapaId);
  }

  /**
   * Pautas en un .zip. `ids` = postulaciones separadas por coma (se usa GET para que también
   * pueda descargar una cuenta de solo lectura); sin `ids`, toda la etapa.
   */
  @Get('pautas')
  async pautas(@Param('etapaId', ParseUUIDPipe) etapaId: string, @Query('ids') ids?: string) {
    let lista: string[] | undefined;
    if (ids !== undefined && ids !== '') {
      lista = ids.split(',');
      if (lista.length > 300 || lista.some((i) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(i))) {
        throw new BadRequestException('Lista de estudiantes inválida.');
      }
    }
    const r = await this.svc.pautasZip(etapaId, lista);
    return new StreamableFile(r.buffer, { type: 'application/zip', disposition: adjunto(r.nombre) });
  }

  /** Pauta de un estudiante, en Word. */
  @Get('estudiantes/:postulacionId/pauta')
  async pauta(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
  ) {
    const r = await this.svc.pauta(etapaId, postulacionId);
    return new StreamableFile(r.buffer, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', disposition: adjunto(r.nombre),
    });
  }

  /** Sube el Word de la pauta ya rellenado (campo `archivo`; `forzar=true` para guardar aunque no traiga el código). */
  @Post('estudiantes/:postulacionId/pauta-completada')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(subidaWord)
  subirCompletada(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
    @UploadedFile() archivo: Express.Multer.File, @Body('forzar') forzar: string | undefined, @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.subirPautaCompletada(etapaId, postulacionId, archivo, forzar === 'true', u.id);
  }

  /** Descarga el Word completado (también para cuentas de solo lectura). */
  @Get('estudiantes/:postulacionId/pauta-completada')
  async descargarCompletada(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string,
  ) {
    const r = await this.svc.pautaCompletada(etapaId, postulacionId);
    return new StreamableFile(r.buffer, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', disposition: adjunto(r.nombre),
    });
  }

  @Delete('estudiantes/:postulacionId/pauta-completada')
  quitarCompletada(
    @Param('etapaId', ParseUUIDPipe) etapaId: string,
    @Param('postulacionId', ParseUUIDPipe) postulacionId: string, @Usuario() u: UsuarioSesion,
  ) {
    return this.svc.quitarPautaCompletada(etapaId, postulacionId, u.id);
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