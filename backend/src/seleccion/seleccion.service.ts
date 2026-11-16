import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditoriaService } from '../common/auditoria.service';
import { ProcesoActualService } from '../common/proceso-actual.service';

/**
 * Selección final (la última etapa, clave ENTREVISTA_COMITE).
 *
 * Junta en un solo lugar lo que necesita quien decide quién recibe la beca: los datos de cada finalista,
 * cómo le fue en las entrevistas (apreciación, observaciones y el Word de la pauta completada) y cuántos
 * cupos quedan. La decisión (pasa / no pasa) y su confirmación usan lo que ya existe en "Avance":
 * confirmar en la última etapa deja al estudiante como BECARIO. Aquí solo se LEE y se anota la apreciación.
 */

export const APRECIACIONES = ['ACEPTARIA', 'ACEPTARIA_CON_DUDAS', 'NO_ACEPTARIA'] as const;
export type Apreciacion = (typeof APRECIACIONES)[number];

/** Qué sugiere cada apreciación. Con dudas no sugiere nada: lo decide una persona. */
const SUGERENCIA: Record<Apreciacion, 'PASA' | 'NO_PASA' | null> = {
  ACEPTARIA: 'PASA', ACEPTARIA_CON_DUDAS: null, NO_ACEPTARIA: 'NO_PASA',
};

type Fila = Record<string, any>;

@Injectable()
export class SeleccionService {
  constructor(
    private readonly ds: DataSource,
    private readonly proceso: ProcesoActualService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Solo la etapa de selección final tiene esta pantalla. */
  private async etapaFinal(etapaId: string) {
    const [e] = await this.ds.query(
      `SELECT id, orden, nombre, clave, cupo, estado FROM etapas WHERE id = $1 AND proceso_id = $2`,
      [etapaId, await this.proceso.id()]);
    if (!e) throw new NotFoundException('Etapa no encontrada.');
    if (e.clave !== 'ENTREVISTA_COMITE') {
      throw new ConflictException('La selección final está en la etapa "Selección de becarios".');
    }
    return e;
  }

  /** Apreciación más reciente (la de la última entrevista que la tenga) → qué sugiere. */
  private sugerir(entrevistas: Fila[]) {
    const con = [...entrevistas].filter((x) => x.apreciacion).sort((a, b) => b.orden - a.orden)[0];
    if (!con) return null;
    return { apreciacion: con.apreciacion as Apreciacion, etapa: con.etapa as string, resultado: SUGERENCIA[con.apreciacion as Apreciacion] };
  }

  async vista(etapaId: string) {
    const e = await this.etapaFinal(etapaId);
    const filas: Fila[] = await this.ds.query(
      `SELECT p.id, p.codigo, p.curso, p.promedio::float AS promedio, p.posicion_curso, p.estado,
              pe.nombres, pe.apellido_paterno, pe.apellido_materno, pe.email, pe.telefono,
              l.codigo AS liceo_codigo, l.nombre AS liceo, l.comuna,
              (p.etapa_id = $1) AS en_esta_etapa,
              r.resultado, COALESCE(r.confirmado, FALSE) AS confirmado,
              (SELECT to_jsonb(fi) - 'postulacion_id' - 'actualizado_por' FROM fichas_postulacion fi WHERE fi.postulacion_id = p.id) AS ficha,
              (SELECT jsonb_build_object('posicion', rp.posicion, 'puntaje_total', rp.puntaje_total::float, 'rsh', rp.rsh)
                 FROM ranking_postulacion rp JOIN cargas ca ON ca.id = rp.carga_id
                WHERE rp.postulacion_id = p.id AND ca.tipo = 'RANKING' AND ca.proceso_id = p.proceso_id
                ORDER BY ca.cargado_en DESC LIMIT 1) AS ranking,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                         'etapa_id', x.id, 'etapa', x.nombre, 'orden', x.orden,
                         'fecha_hora', en.fecha_hora, 'estado', en.estado, 'realizada', COALESCE(en.realizada, FALSE),
                         'comentario', en.comentario, 'apreciacion', en.apreciacion,
                         'observaciones', en.apreciacion_observaciones, 'apreciacion_en', en.apreciacion_en,
                         'pauta', CASE WHEN pt.id IS NULL THEN NULL
                                       ELSE jsonb_build_object('nombre', ar.nombre_original, 'subido_en', pt.subido_en) END
                       ) ORDER BY x.orden)
                  FROM etapas x
                  LEFT JOIN entrevistas en ON en.postulacion_id = p.id AND en.etapa_id = x.id
                  LEFT JOIN pautas_entrevista pt ON pt.postulacion_id = p.id AND pt.etapa_id = x.id
                  LEFT JOIN archivos ar ON ar.id = pt.archivo_id
                 WHERE x.proceso_id = p.proceso_id AND x.clave IN ('ENTREVISTA', 'ENTREVISTA_COMITE') AND x.orden <= $2
                   AND (en.id IS NOT NULL OR pt.id IS NOT NULL)), '[]'::jsonb) AS entrevistas
         FROM postulaciones p
         JOIN personas pe ON pe.id = p.persona_id
         JOIN liceos l ON l.id = p.liceo_id
         LEFT JOIN resultados_etapa r ON r.postulacion_id = p.id AND r.etapa_id = $1
        WHERE p.proceso_id = $3 AND (p.etapa_id = $1 OR (r.confirmado AND r.etapa_id = $1))
        ORDER BY (SELECT rp.posicion FROM ranking_postulacion rp JOIN cargas ca ON ca.id = rp.carga_id
                   WHERE rp.postulacion_id = p.id AND ca.tipo = 'RANKING' AND ca.proceso_id = p.proceso_id
                   ORDER BY ca.cargado_en DESC LIMIT 1) NULLS LAST, p.correlativo`,
      [etapaId, e.orden, await this.proceso.id()]);

    const candidatos: Fila[] = filas.map((f) => ({ ...f, sugerencia: this.sugerir(f.entrevistas) }));
    const vivos = candidatos.filter((c) => c.en_esta_etapa && !c.confirmado);
    const becarios = candidatos.filter((c) => c.confirmado && c.resultado === 'PASA').length;
    const marcadosPasa = vivos.filter((c) => c.resultado === 'PASA').length;
    const resumen = {
      cupo: e.cupo as number | null,
      total: candidatos.length,
      becarios_confirmados: becarios,
      marcados_pasa: marcadosPasa,
      marcados_no_pasa: vivos.filter((c) => c.resultado === 'NO_PASA').length,
      sin_decidir: vivos.filter((c) => !c.resultado).length,
      // Cupos que quedan si se confirman todas las marcas "pasa".
      cupos_libres: e.cupo === null ? null : e.cupo - becarios - marcadosPasa,
      con_apreciacion: candidatos.filter((c) => c.sugerencia).length,
      sugeridos_pasa: vivos.filter((c) => !c.resultado && c.sugerencia?.resultado === 'PASA').length,
      sugeridos_no_pasa: vivos.filter((c) => !c.resultado && c.sugerencia?.resultado === 'NO_PASA').length,
    };
    return { etapa: e, resumen, candidatos };
  }

  /** Anota (o corrige) la apreciación de una entrevista. Solo cambia lo que viene en el cuerpo. */
  async guardarApreciacion(
    entrevistaEtapaId: string, postulacionId: string,
    apreciacionNueva: Apreciacion | null | undefined, observacionesNuevas: string | null | undefined, usuarioId: string,
  ) {
    if (apreciacionNueva === undefined && observacionesNuevas === undefined) {
      throw new BadRequestException('No hay nada que guardar.');
    }
    const procesoId = await this.proceso.id();
    const [x] = await this.ds.query(
      `SELECT id FROM etapas WHERE id = $1 AND proceso_id = $2 AND clave IN ('ENTREVISTA', 'ENTREVISTA_COMITE')`,
      [entrevistaEtapaId, procesoId]);
    if (!x) throw new NotFoundException('Etapa de entrevista no encontrada.');
    const [p] = await this.ds.query(
      `SELECT p.id, (p.etapa_id = $2) AS en_esta_etapa,
              en.apreciacion, en.apreciacion_observaciones,
              (en.id IS NOT NULL OR EXISTS (SELECT 1 FROM pautas_entrevista t WHERE t.postulacion_id = p.id AND t.etapa_id = $2)) AS tiene
         FROM postulaciones p LEFT JOIN entrevistas en ON en.postulacion_id = p.id AND en.etapa_id = $2
        WHERE p.id = $1 AND p.proceso_id = $3`,
      [postulacionId, entrevistaEtapaId, procesoId]);
    if (!p) throw new NotFoundException('Estudiante no encontrado.');
    // Misma regla que el calendario: sin entrevista en esa etapa no se crea una de la nada.
    if (!p.en_esta_etapa && !p.tiene) throw new ConflictException('El estudiante no tiene entrevista en esa etapa.');

    const apreciacion = apreciacionNueva !== undefined ? apreciacionNueva : p.apreciacion;
    const observaciones = observacionesNuevas !== undefined ? (observacionesNuevas?.trim() || null) : p.apreciacion_observaciones;
    await this.ds.query(
      `INSERT INTO entrevistas (postulacion_id, etapa_id, apreciacion, apreciacion_observaciones, apreciacion_por, apreciacion_en)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (postulacion_id, etapa_id) DO UPDATE
         SET apreciacion = $3, apreciacion_observaciones = $4, apreciacion_por = $5, apreciacion_en = NOW()`,
      [postulacionId, entrevistaEtapaId, apreciacion ?? null, observaciones, usuarioId]);
    await this.auditoria.registrar(usuarioId, 'APRECIACION_ENTREVISTA', 'postulaciones', postulacionId,
      { etapaId: entrevistaEtapaId, apreciacion: apreciacion ?? null });
    return { ok: true };
  }

  /**
   * Marca pasa / no pasa según la apreciación, solo a quienes todavía no tienen marca (la marca es provisoria:
   * sigue haciendo falta confirmarla). "Aceptaría con dudas" no se marca: lo decide una persona.
   */
  async aplicarSugerencias(etapaId: string, usuarioId: string) {
    const e = await this.etapaFinal(etapaId);
    const r: Fila[] = await this.ds.query(
      `INSERT INTO resultados_etapa (postulacion_id, etapa_id, resultado, marcado_por)
       SELECT p.id, $1, CASE a.apreciacion WHEN 'ACEPTARIA' THEN 'PASA' ELSE 'NO_PASA' END, $2
         FROM postulaciones p
         JOIN LATERAL (
           SELECT en.apreciacion FROM entrevistas en JOIN etapas x ON x.id = en.etapa_id
            WHERE en.postulacion_id = p.id AND en.apreciacion IS NOT NULL
              AND x.clave IN ('ENTREVISTA', 'ENTREVISTA_COMITE') AND x.orden <= $3
            ORDER BY x.orden DESC LIMIT 1) a ON TRUE
        WHERE p.etapa_id = $1 AND a.apreciacion IN ('ACEPTARIA', 'NO_ACEPTARIA')
       ON CONFLICT (postulacion_id, etapa_id) DO NOTHING
       RETURNING id`,
      [etapaId, usuarioId, e.orden]);
    // Según la versión del driver, RETURNING llega como [filas, n] o como filas.
    const marcados = Array.isArray(r[0]) ? (r[0] as unknown as Fila[]).length : r.length;
    await this.auditoria.registrar(usuarioId, 'SUGERENCIAS_SELECCION', 'etapas', etapaId, { marcados });
    return { marcados };
  }
}
