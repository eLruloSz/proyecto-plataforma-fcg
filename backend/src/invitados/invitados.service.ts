import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { AuditoriaService } from '../common/auditoria.service';
import { HitosService } from '../hitos/hitos.service';
import { normalizarRut } from '../common/rut';
import { filas } from '../common/sql';

export interface ActualizarInvitado {
  email?: string | null;
  telefono?: string | null;
  rut?: string | null;
  confirmacion?: 'PENDIENTE' | 'CONFIRMADO' | 'RECHAZADO';
  encuentroEventoId?: string | null;
  asistioEncuentro?: boolean | null;
}

/** Id del invitado: código del liceo + correlativo del año (3 dígitos) + sufijo. Ej: 01.006a */
export function generarCodigo(codigoLiceo: string, correlativo: number, sufijo: string): string {
  return `${codigoLiceo}.${String(correlativo).padStart(3, '0')}${sufijo}`;
}

@Injectable()
export class InvitadosService {
  constructor(
    private readonly ds: DataSource,
    private readonly proceso: ProcesoActualService,
    private readonly auditoria: AuditoriaService,
    private readonly hitos: HitosService,
  ) {}

  /**
   * Convierte alumnos de la nómina en invitados. Cada uno recibe el siguiente
   * correlativo del proceso. El proceso se bloquea durante la transacción para
   * que dos personas invitando al mismo tiempo no obtengan el mismo número.
   */
  async invitar(alumnoIds: string[], usuarioId: string) {
    if (!alumnoIds.length) throw new BadRequestException('Selecciona al menos un alumno.');
    const procesoId = await this.proceso.id();

    const creados = await this.ds.transaction(async (em) => {
      const [p] = await em.query(
        `SELECT sufijo_id, ultimo_correlativo FROM procesos WHERE id = $1 FOR UPDATE`, [procesoId]);

      const alumnos = await em.query(
        `SELECT a.*, l.codigo AS liceo_codigo, p.codigo AS ya_invitado
           FROM alumnos_nomina a
           JOIN liceos l ON l.id = a.liceo_id
           LEFT JOIN postulaciones p ON p.alumno_nomina_id = a.id
          WHERE a.id = ANY($1::uuid[]) AND a.proceso_id = $2
          ORDER BY l.codigo, a.curso, a.posicion_curso, a.apellido_paterno`,
        [alumnoIds, procesoId],
      );
      if (alumnos.length !== new Set(alumnoIds).size) {
        throw new NotFoundException('Algunos alumnos no existen en la nómina actual. Recarga la página.');
      }
      const repetidos = alumnos.filter((a: any) => a.ya_invitado);
      if (repetidos.length) {
        throw new ConflictException(
          `Ya están invitados: ${repetidos.map((a: any) => `${a.nombres} ${a.apellido_paterno} (${a.ya_invitado})`).join(', ')}.`);
      }

      let correlativo: number = p.ultimo_correlativo;
      const resultado: { id: string; codigo: string; nombre: string }[] = [];
      for (const a of alumnos) {
        correlativo += 1;
        const codigo = generarCodigo(a.liceo_codigo, correlativo, p.sufijo_id);
        const [persona] = await em.query(
          `INSERT INTO personas (nombres, apellido_paterno, apellido_materno) VALUES ($1, $2, $3) RETURNING id`,
          [a.nombres, a.apellido_paterno, a.apellido_materno],
        );
        const [post] = await em.query(
          `INSERT INTO postulaciones (proceso_id, persona_id, liceo_id, alumno_nomina_id, codigo, correlativo,
                                      curso, promedio, posicion_curso)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [procesoId, persona.id, a.liceo_id, a.id, codigo, correlativo, a.curso, a.promedio, a.posicion_curso],
        );
        resultado.push({ id: post.id, codigo, nombre: `${a.nombres} ${a.apellido_paterno}` });
      }
      await em.query(`UPDATE procesos SET ultimo_correlativo = $2 WHERE id = $1`, [procesoId, correlativo]);
      for (const liceoId of new Set<string>(alumnos.map((a: any) => a.liceo_id))) {
        await this.hitos.marcarAutomatico(procesoId, liceoId, 'DEFINICION_INVITADOS', em);
      }
      await this.auditoria.registrar(usuarioId, 'INVITAR', 'postulaciones', null,
        { codigos: resultado.map((r) => r.codigo) }, em);
      return resultado;
    });
    return { invitados: creados };
  }

  async listar(filtros: { liceoId?: string; confirmacion?: string; q?: string }) {
    const procesoId = await this.proceso.id();
    const cond: string[] = ['p.proceso_id = $1'];
    const params: unknown[] = [procesoId];
    if (filtros.liceoId) { params.push(filtros.liceoId); cond.push(`p.liceo_id = $${params.length}`); }
    if (filtros.confirmacion) { params.push(filtros.confirmacion); cond.push(`p.confirmacion = $${params.length}`); }
    if (filtros.q) {
      params.push(`%${filtros.q.toLowerCase()}%`);
      cond.push(`(lower(pe.nombres || ' ' || pe.apellido_paterno || ' ' || COALESCE(pe.apellido_materno,'')) LIKE $${params.length}
                  OR lower(p.codigo) LIKE $${params.length})`);
    }
    return this.ds.query(
      `SELECT p.id, p.codigo, p.curso, p.promedio::float, p.posicion_curso, p.estado, p.confirmacion, p.confirmacion_en,
              p.encuentro_evento_id, p.asistio_encuentro,
              pe.nombres, pe.apellido_paterno, pe.apellido_materno, pe.email, pe.telefono, pe.rut,
              l.id AS liceo_id, l.codigo AS liceo_codigo, l.nombre AS liceo,
              (SELECT COUNT(*)::int FROM comentarios_postulacion c WHERE c.postulacion_id = p.id) AS comentarios
         FROM postulaciones p
         JOIN personas pe ON pe.id = p.persona_id
         JOIN liceos l ON l.id = p.liceo_id
        WHERE ${cond.join(' AND ')}
        ORDER BY p.correlativo`,
      params,
    );
  }

  private async obtenerBase(id: string) {
    const procesoId = await this.proceso.id();
    const [p] = await this.ds.query(
      `SELECT p.*, pe.id AS persona_id FROM postulaciones p JOIN personas pe ON pe.id = p.persona_id
        WHERE p.id = $1 AND p.proceso_id = $2`, [id, procesoId]);
    if (!p) throw new NotFoundException('Invitado no encontrado.');
    return p;
  }

  async actualizar(id: string, dto: ActualizarInvitado, usuarioId: string) {
    const p = await this.obtenerBase(id);

    let rut: string | null | undefined = undefined;
    if (dto.rut !== undefined) {
      if (dto.rut === null || dto.rut.trim() === '') rut = null;
      else {
        rut = normalizarRut(dto.rut);
        if (!rut) throw new BadRequestException('El RUT no es válido (revisa el dígito verificador).');
      }
    }

    await this.ds.transaction(async (em) => {
      const sets: string[] = [];
      const params: unknown[] = [p.persona_id];
      const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
      if (dto.email !== undefined) set('email', dto.email?.trim().toLowerCase() || null);
      if (dto.telefono !== undefined) set('telefono', dto.telefono?.trim() || null);
      if (rut !== undefined) set('rut', rut);
      if (sets.length) {
        try {
          await em.query(`UPDATE personas SET ${sets.join(', ')} WHERE id = $1`, params);
        } catch (e: any) {
          if (e.code === '23505') throw new ConflictException('Ese RUT ya está registrado en otra persona.');
          throw e;
        }
      }

      const psets: string[] = [];
      const pparams: unknown[] = [id];
      const pset = (col: string, v: unknown) => { pparams.push(v); psets.push(`${col} = $${pparams.length}`); };
      if (dto.confirmacion !== undefined && dto.confirmacion !== p.confirmacion) {
        pset('confirmacion', dto.confirmacion);
        pset('confirmacion_en', dto.confirmacion === 'PENDIENTE' ? null : new Date());
        // El estado solo se mueve mientras la persona está en la etapa de invitación.
        if (['INVITADO', 'CONFIRMADO', 'DESISTIO'].includes(p.estado)) {
          pset('estado', dto.confirmacion === 'CONFIRMADO' ? 'CONFIRMADO' : dto.confirmacion === 'RECHAZADO' ? 'DESISTIO' : 'INVITADO');
        }
      }
      if (dto.encuentroEventoId !== undefined) {
        if (dto.encuentroEventoId) {
          const [ev] = await em.query(
            `SELECT 1 FROM eventos WHERE id = $1 AND proceso_id = $2 AND tipo = 'ENCUENTRO_ONLINE'`,
            [dto.encuentroEventoId, p.proceso_id]);
          if (!ev) throw new BadRequestException('El encuentro elegido no existe.');
        }
        pset('encuentro_evento_id', dto.encuentroEventoId);
      }
      if (dto.asistioEncuentro !== undefined) pset('asistio_encuentro', dto.asistioEncuentro);
      if (psets.length) await em.query(`UPDATE postulaciones SET ${psets.join(', ')} WHERE id = $1`, pparams);
      await this.auditoria.registrar(usuarioId, 'ACTUALIZAR_INVITADO', 'postulaciones', id, dto, em);
    });
    const [r] = (await this.listar({})).filter((x: any) => x.id === id);
    return r;
  }

  /** Quita a un invitado. Su Id no se vuelve a usar. */
  async eliminar(id: string, usuarioId: string) {
    const p = await this.obtenerBase(id);
    if (p.estado !== 'INVITADO' || p.confirmacion !== 'PENDIENTE') {
      throw new ConflictException('Solo se puede quitar a un invitado que aún no ha respondido.');
    }
    await this.ds.transaction(async (em) => {
      await em.query(`DELETE FROM postulaciones WHERE id = $1`, [id]);
      await em.query(`DELETE FROM personas WHERE id = $1`, [p.persona_id]);
      await this.auditoria.registrar(usuarioId, 'QUITAR_INVITADO', 'postulaciones', id, { codigo: p.codigo }, em);
    });
    return { ok: true, codigoLiberado: false };
  }

  async comentarios(id: string) {
    await this.obtenerBase(id);
    return this.ds.query(
      `SELECT c.id, c.texto, c.creado_en, u.nombre_completo AS autor
         FROM comentarios_postulacion c LEFT JOIN usuarios u ON u.id = c.autor_id
        WHERE c.postulacion_id = $1 ORDER BY c.creado_en DESC`, [id]);
  }

  async comentar(id: string, texto: string, usuarioId: string) {
    await this.obtenerBase(id);
    const r = await this.ds.query(
      `INSERT INTO comentarios_postulacion (postulacion_id, autor_id, texto) VALUES ($1, $2, $3) RETURNING id`,
      [id, usuarioId, texto.trim()]);
    return filas(r)[0];
  }

  async encuentros() {
    return this.ds.query(
      `SELECT e.id, e.fecha, e.enlace,
              (SELECT COUNT(*)::int FROM postulaciones p WHERE p.encuentro_evento_id = e.id) AS inscritos,
              (SELECT COUNT(*)::int FROM postulaciones p WHERE p.encuentro_evento_id = e.id AND p.asistio_encuentro) AS asistentes
         FROM eventos e WHERE e.proceso_id = $1 AND e.tipo = 'ENCUENTRO_ONLINE' ORDER BY e.fecha`,
      [await this.proceso.id()]);
  }
}
