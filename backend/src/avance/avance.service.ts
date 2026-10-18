import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { AuditoriaService } from '../common/auditoria.service';
import { filas } from '../common/sql';

/** Estados en que el estudiante ya no sigue en el proceso. */
export const FUERA_DEL_PROCESO = ['NO_CONTINUA', 'DESISTIO'];

/**
 * Avance de los estudiantes entre etapas.
 *
 * En cada etapa se marca, por estudiante:
 *   - los requisitos que cumplió (formulario, RSH, notas…), configurables por etapa;
 *   - si PASA o NO PASA. Es una marca provisoria: se puede cambiar libremente.
 * Al CONFIRMAR, se aplican las marcas: los que pasan quedan en la etapa
 * siguiente y los que no, fuera del proceso. Una confirmación se puede
 * deshacer mientras el estudiante no tenga resultados en etapas posteriores.
 */
@Injectable()
export class AvanceService {
  constructor(
    private readonly ds: DataSource,
    private readonly proceso: ProcesoActualService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async etapa(etapaId: string, em: EntityManager | DataSource = this.ds) {
    const procesoId = await this.proceso.id();
    const [e] = await em.query(
      `SELECT e.*,
              (SELECT row_to_json(s) FROM (SELECT id, orden, nombre FROM etapas s
                 WHERE s.proceso_id = e.proceso_id AND s.orden > e.orden ORDER BY s.orden LIMIT 1) s) AS siguiente,
              (SELECT row_to_json(a) FROM (SELECT id, orden, nombre FROM etapas a
                 WHERE a.proceso_id = e.proceso_id AND a.orden < e.orden ORDER BY a.orden DESC LIMIT 1) a) AS anterior
         FROM etapas e WHERE e.id = $1 AND e.proceso_id = $2`,
      [etapaId, procesoId]);
    if (!e) throw new NotFoundException('Etapa no encontrada.');
    return e;
  }

  // -------------------------------------------------------------------------
  // Vista de una etapa
  // -------------------------------------------------------------------------

  /**
   * Estudiantes de la etapa: los que están en ella ahora, más los que ya
   * tienen un resultado confirmado en ella (pasaron o quedaron fuera aquí).
   */
  async vista(etapaId: string) {
    const e = await this.etapa(etapaId);
    const requisitos = await this.ds.query(
      `SELECT id, nombre, orden FROM requisitos_etapa WHERE etapa_id = $1 AND activo ORDER BY orden, creado_en`, [etapaId]);

    const estudiantes = await this.ds.query(
      `SELECT p.id, p.codigo, p.curso, p.promedio::float, p.estado, p.confirmacion,
              pe.nombres, pe.apellido_paterno, pe.apellido_materno, pe.email,
              l.id AS liceo_id, l.codigo AS liceo_codigo, l.nombre AS liceo,
              (p.etapa_id = $1) AS en_esta_etapa,
              r.resultado, COALESCE(r.confirmado, FALSE) AS confirmado, r.confirmado_en, r.avisado_en,
              COALESCE(en.realizada, FALSE) AS entrevista_realizada,
              en.fecha_hora AS entrevista_fecha, en.comentario AS entrevista_comentario,
              COALESCE((SELECT array_agg(c.requisito_id::text) FROM cumplimientos c
                         JOIN requisitos_etapa q ON q.id = c.requisito_id
                        WHERE c.postulacion_id = p.id AND q.etapa_id = $1 AND q.activo), '{}'::text[]) AS cumplidos
         FROM postulaciones p
         JOIN personas pe ON pe.id = p.persona_id
         JOIN liceos l ON l.id = p.liceo_id
         LEFT JOIN resultados_etapa r ON r.postulacion_id = p.id AND r.etapa_id = $1
         LEFT JOIN entrevistas en ON en.postulacion_id = p.id AND en.etapa_id = $1
        WHERE p.etapa_id = $1 OR (r.confirmado AND r.etapa_id = $1)
        ORDER BY p.correlativo`,
      [etapaId]);

    // Los que aún esperan una decisión en esta etapa (incluye a quien rechazó la
    // invitación: también se marca "no pasa" y se confirma).
    const activos = estudiantes.filter((x: any) => x.en_esta_etapa && !x.confirmado);
    const resumen = {
      total: estudiantes.length,
      pendientes_de_decidir: activos.filter((x: any) => !x.resultado).length,
      marcados_pasa: activos.filter((x: any) => x.resultado === 'PASA').length,
      marcados_no_pasa: activos.filter((x: any) => x.resultado === 'NO_PASA').length,
      confirmados_pasa: estudiantes.filter((x: any) => x.confirmado && x.resultado === 'PASA').length,
      confirmados_no_pasa: estudiantes.filter((x: any) => x.confirmado && x.resultado === 'NO_PASA').length,
      sin_avisar_pasa: estudiantes.filter((x: any) => x.confirmado && x.resultado === 'PASA' && !x.avisado_en).length,
      sin_avisar_no_pasa: estudiantes.filter((x: any) => x.confirmado && x.resultado === 'NO_PASA' && !x.avisado_en).length,
      con_requisitos_pendientes: requisitos.length
        ? activos.filter((x: any) => x.cumplidos.length < requisitos.length).length : 0,
      // Solo tiene sentido en etapas de entrevista (clave ENTREVISTA / ENTREVISTA_COMITE),
      // pero se calcula igual: no cuesta nada y el frontend decide si lo muestra.
      sin_entrevistar: activos.filter((x: any) => !x.entrevista_realizada).length,
    };
    return { etapa: e, requisitos, estudiantes, resumen };
  }

  // -------------------------------------------------------------------------
  // Requisitos
  // -------------------------------------------------------------------------

  async marcarRequisito(etapaId: string, postulacionId: string, requisitoId: string, cumplido: boolean, usuarioId: string) {
    const [req] = await this.ds.query(`SELECT 1 FROM requisitos_etapa WHERE id = $1 AND etapa_id = $2`, [requisitoId, etapaId]);
    if (!req) throw new NotFoundException('Requisito no encontrado en esta etapa.');
    await this.postulacionDelProceso(postulacionId);
    if (cumplido) {
      await this.ds.query(
        `INSERT INTO cumplimientos (postulacion_id, requisito_id, marcado_por) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [postulacionId, requisitoId, usuarioId]);
    } else {
      await this.ds.query(`DELETE FROM cumplimientos WHERE postulacion_id = $1 AND requisito_id = $2`, [postulacionId, requisitoId]);
    }
    return { ok: true };
  }

  async crearRequisito(etapaId: string, nombre: string, usuarioId: string) {
    await this.etapa(etapaId);
    const [{ max }] = await this.ds.query(`SELECT COALESCE(MAX(orden), 0) AS max FROM requisitos_etapa WHERE etapa_id = $1`, [etapaId]);
    const [r] = await this.ds.query(
      `INSERT INTO requisitos_etapa (etapa_id, nombre, orden) VALUES ($1, $2, $3) RETURNING id, nombre, orden`,
      [etapaId, nombre.trim(), Number(max) + 1]);
    await this.auditoria.registrar(usuarioId, 'CREAR_REQUISITO', 'etapas', etapaId, { nombre });
    return r;
  }

  async renombrarRequisito(etapaId: string, requisitoId: string, nombre: string) {
    const r = await this.ds.query(
      `UPDATE requisitos_etapa SET nombre = $3 WHERE id = $1 AND etapa_id = $2 RETURNING id`, [requisitoId, etapaId, nombre.trim()]);
    if (!filas(r).length) throw new NotFoundException('Requisito no encontrado.');
    return { ok: true };
  }

  /** Se desactiva (no se borra) para no perder lo que ya se marcó. */
  async quitarRequisito(etapaId: string, requisitoId: string, usuarioId: string) {
    await this.ds.query(`UPDATE requisitos_etapa SET activo = FALSE WHERE id = $1 AND etapa_id = $2`, [requisitoId, etapaId]);
    await this.auditoria.registrar(usuarioId, 'QUITAR_REQUISITO', 'etapas', etapaId, { requisitoId });
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Marcar pasa / no pasa (provisorio)
  // -------------------------------------------------------------------------

  private async postulacionDelProceso(id: string) {
    const [p] = await this.ds.query(
      `SELECT p.* FROM postulaciones p WHERE p.id = $1 AND p.proceso_id = $2`, [id, await this.proceso.id()]);
    if (!p) throw new NotFoundException('Estudiante no encontrado.');
    return p;
  }

  async marcar(etapaId: string, postulacionId: string, resultado: 'PASA' | 'NO_PASA' | null, usuarioId: string) {
    await this.etapa(etapaId);
    const p = await this.postulacionDelProceso(postulacionId);
    if (p.etapa_id !== etapaId) throw new ConflictException('El estudiante no está en esta etapa.');
    const [r] = await this.ds.query(
      `SELECT confirmado FROM resultados_etapa WHERE postulacion_id = $1 AND etapa_id = $2`, [postulacionId, etapaId]);
    if (r?.confirmado) throw new ConflictException('Este resultado ya fue confirmado. Deshazlo primero si necesitas cambiarlo.');

    if (resultado === null) {
      await this.ds.query(`DELETE FROM resultados_etapa WHERE postulacion_id = $1 AND etapa_id = $2`, [postulacionId, etapaId]);
    } else {
      await this.ds.query(
        `INSERT INTO resultados_etapa (postulacion_id, etapa_id, resultado, marcado_por)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (postulacion_id, etapa_id) DO UPDATE SET resultado = $3, marcado_por = $4, marcado_en = NOW()`,
        [postulacionId, etapaId, resultado, usuarioId]);
    }
    return { ok: true };
  }

  /**
   * En la primera etapa, la respuesta a la invitación ya dice quién sigue:
   * aceptó → pasa, rechazó → no pasa. Solo completa a quienes no tienen marca.
   */
  async sugerirDesdeConfirmacion(etapaId: string, usuarioId: string) {
    await this.etapa(etapaId);
    const r = await this.ds.query(
      `INSERT INTO resultados_etapa (postulacion_id, etapa_id, resultado, marcado_por)
       SELECT p.id, $1, CASE p.confirmacion WHEN 'CONFIRMADO' THEN 'PASA' ELSE 'NO_PASA' END, $2
         FROM postulaciones p
        WHERE p.etapa_id = $1 AND p.confirmacion IN ('CONFIRMADO', 'RECHAZADO')
       ON CONFLICT (postulacion_id, etapa_id) DO NOTHING
       RETURNING id`,
      [etapaId, usuarioId]);
    return { marcados: filas(r).length };
  }

  // -------------------------------------------------------------------------
  // Entrevista (Fase 3: etapas con clave ENTREVISTA o ENTREVISTA_COMITE)
  // -------------------------------------------------------------------------

  /**
   * Se puede marcar/editar aunque el estudiante ya no esté en esta etapa
   * (ej. ya avanzó a la siguiente): el programa no bloquea corregir datos de
   * una etapa anterior, solo lo que realmente ya no tiene sentido cambiar
   * (como un resultado confirmado, que tiene su propio candado en marcar()).
   */
  async marcarEntrevista(
    etapaId: string, postulacionId: string,
    realizada: boolean, fechaHora: string | null | undefined, comentario: string | undefined,
    usuarioId: string,
  ) {
    await this.etapa(etapaId);
    await this.postulacionDelProceso(postulacionId);
    await this.ds.query(
      `INSERT INTO entrevistas (postulacion_id, etapa_id, realizada, fecha_hora, comentario, marcado_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (postulacion_id, etapa_id) DO UPDATE
         SET realizada = $3, fecha_hora = $4, comentario = $5, marcado_por = $6, actualizado_en = NOW()`,
      [postulacionId, etapaId, realizada, fechaHora ?? null, comentario ?? null, usuarioId]);
    await this.auditoria.registrar(usuarioId, 'MARCAR_ENTREVISTA', 'postulaciones', postulacionId, { etapaId, realizada });
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Confirmar y deshacer
  // -------------------------------------------------------------------------

  /**
   * Aplica las marcas provisorias de la etapa. Si se pasan ids, solo esas.
   * PASA → el estudiante queda en la etapa siguiente (o BECARIO si era la última).
   * NO_PASA → queda fuera del proceso (NO_CONTINUA; un DESISTIO se mantiene).
   */
  async confirmar(etapaId: string, postulacionIds: string[] | undefined, usuarioId: string) {
    return this.ds.transaction(async (em) => {
      const e = await this.etapa(etapaId, em);
      const marcas = await em.query(
        `SELECT r.id, r.postulacion_id, r.resultado, p.estado
           FROM resultados_etapa r JOIN postulaciones p ON p.id = r.postulacion_id
          WHERE r.etapa_id = $1 AND NOT r.confirmado AND p.etapa_id = $1
            ${postulacionIds?.length ? 'AND r.postulacion_id = ANY($2::uuid[])' : ''}
          FOR UPDATE OF r, p`,
        postulacionIds?.length ? [etapaId, postulacionIds] : [etapaId]);
      if (!marcas.length) throw new BadRequestException('No hay marcas pendientes de confirmar en esta etapa.');

      let pasan = 0;
      let noPasan = 0;
      for (const m of marcas) {
        if (m.resultado === 'PASA') {
          pasan++;
          await em.query(
            `UPDATE postulaciones SET etapa_id = COALESCE($2, etapa_id), estado = $3 WHERE id = $1`,
            [m.postulacion_id, e.siguiente?.id ?? null, e.siguiente ? 'EN_PROCESO' : 'BECARIO']);
        } else {
          noPasan++;
          await em.query(
            `UPDATE postulaciones SET estado = CASE WHEN estado = 'DESISTIO' THEN 'DESISTIO' ELSE 'NO_CONTINUA' END WHERE id = $1`,
            [m.postulacion_id]);
        }
        await em.query(
          `UPDATE resultados_etapa SET confirmado = TRUE, confirmado_por = $2, confirmado_en = NOW(), estado_anterior = $3
            WHERE id = $1`,
          [m.id, usuarioId, m.estado]);
      }
      await this.auditoria.registrar(usuarioId, 'CONFIRMAR_AVANCE', 'etapas', etapaId, { pasan, noPasan }, em);
      return { pasan, noPasan, siguiente: e.siguiente };
    });
  }

  /** Deshace la confirmación de un estudiante (vuelve a quedar como marca provisoria). */
  async deshacer(etapaId: string, postulacionId: string, usuarioId: string) {
    return this.ds.transaction(async (em) => {
      const e = await this.etapa(etapaId, em);
      const [r] = await em.query(
        `SELECT r.*, p.etapa_id AS etapa_actual FROM resultados_etapa r JOIN postulaciones p ON p.id = r.postulacion_id
          WHERE r.postulacion_id = $1 AND r.etapa_id = $2 AND r.confirmado FOR UPDATE OF r, p`,
        [postulacionId, etapaId]);
      if (!r) throw new NotFoundException('No hay un resultado confirmado para deshacer.');
      const [posterior] = await em.query(
        `SELECT 1 FROM resultados_etapa r JOIN etapas x ON x.id = r.etapa_id
          WHERE r.postulacion_id = $1 AND x.proceso_id = $2 AND x.orden > $3 LIMIT 1`,
        [postulacionId, e.proceso_id, e.orden]);
      if (posterior) {
        throw new ConflictException('El estudiante ya tiene resultados en una etapa posterior. Deshaz primero esa etapa.');
      }
      await em.query(`UPDATE postulaciones SET etapa_id = $2, estado = $3 WHERE id = $1`,
        [postulacionId, etapaId, r.estado_anterior ?? 'INVITADO']);
      await em.query(
        `UPDATE resultados_etapa SET confirmado = FALSE, confirmado_por = NULL, confirmado_en = NULL, estado_anterior = NULL
          WHERE id = $1`, [r.id]);
      await this.auditoria.registrar(usuarioId, 'DESHACER_AVANCE', 'postulaciones', postulacionId, { etapaId }, em);
      return { ok: true };
    });
  }
}