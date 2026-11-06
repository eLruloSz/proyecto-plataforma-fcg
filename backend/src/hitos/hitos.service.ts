import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/** Hito que se marca solo cuando se envía un correo con ese propósito. */
export const HITO_POR_PROPOSITO: Record<string, string | undefined> = {
  PRESENTACION: 'MAIL_PRESENTACION',
  SOLICITUD_NOTAS: 'MAIL_SOLICITUD_NOTAS',
  SOLICITUD_CONTACTOS: 'MAIL_APROBACION',
  INVITACION_ESTUDIANTES: 'INVITACION_ESTUDIANTES',
  AGRADECIMIENTO: 'MAIL_AGRADECIMIENTO',
  INFORME_LICEO: 'AVISO_RESULTADOS',
};

/** Hito que se marca solo cuando el liceo responde un correo con ese propósito. */
export const HITO_RESPUESTA_POR_PROPOSITO: Record<string, string | undefined> = {
  PRESENTACION: 'ACUSO_RECIBO',
  SOLICITUD_NOTAS: 'RECEPCION_NOMINA',
  SOLICITUD_CONTACTOS: 'APROBACION_CONTACTOS',
};

@Injectable()
export class HitosService {
  constructor(private readonly ds: DataSource) {}

  /** Marca un hito como completado por el sistema (no pisa una marca manual). */
  async marcarAutomatico(procesoId: string, liceoId: string, codigo: string, em?: EntityManager) {
    await (em ?? this.ds).query(
      `INSERT INTO hitos_liceo (proceso_id, liceo_id, codigo, completado, automatico, fecha)
       VALUES ($1, $2, $3, TRUE, TRUE, NOW())
       ON CONFLICT (proceso_id, liceo_id, codigo)
       DO UPDATE SET completado = TRUE,
                     fecha = COALESCE(hitos_liceo.fecha, NOW())`,
      [procesoId, liceoId, codigo],
    );
  }

  async marcarManual(
    procesoId: string,
    liceoId: string,
    codigo: string,
    completado: boolean,
    observaciones: string | null | undefined,
    usuarioId: string,
  ) {
    await this.ds.query(
      `INSERT INTO hitos_liceo (proceso_id, liceo_id, codigo, completado, automatico, fecha, observaciones, actualizado_por)
       VALUES ($1, $2, $3, $4, FALSE, CASE WHEN $4 THEN NOW() END, $5, $6)
       ON CONFLICT (proceso_id, liceo_id, codigo)
       DO UPDATE SET completado = $4, automatico = FALSE,
                     fecha = CASE WHEN $4 THEN COALESCE(hitos_liceo.fecha, NOW()) END,
                     observaciones = COALESCE($5, hitos_liceo.observaciones),
                     actualizado_por = $6`,
      [procesoId, liceoId, codigo, completado, observaciones ?? null, usuarioId],
    );
  }

  /**
   * Grilla de seguimiento: una fila por liceo, una columna por hito del catálogo.
   *  - codigos: solo esas columnas (null = todos los hitos).
   *  - etapaId: solo los liceos con estudiantes en esa etapa (o con resultado en ella).
   *  - cerrado: concurso anterior → solo los liceos que participaron ese año.
   */
  async grilla(procesoId: string, opciones: { codigos?: string[] | null; etapaId?: string; cerrado?: boolean } = {}) {
    const catalogo = await this.ds.query(
      `SELECT codigo, nombre, orden, tipos_etapa FROM catalogo_hitos
        WHERE activo AND ($1::text[] IS NULL OR codigo = ANY($1))
        ORDER BY orden`,
      [opciones.codigos ?? null],
    );
    const filas = await this.ds.query(
      `SELECT l.id, l.codigo, l.nombre, l.comuna,
              c.nombre AS contraparte, c.cargo AS contraparte_cargo,
              COALESCE(pl.estado, 'PENDIENTE') AS participacion,
              COALESCE(
                jsonb_object_agg(h.codigo, jsonb_build_object(
                  'completado', h.completado, 'automatico', h.automatico,
                  'fecha', h.fecha, 'observaciones', h.observaciones))
                FILTER (WHERE h.codigo IS NOT NULL), '{}'::jsonb) AS hitos
         FROM liceos l
         LEFT JOIN contactos_liceo c ON c.liceo_id = l.id AND c.tipo = 'CONTRAPARTE'
         LEFT JOIN participaciones_liceo pl ON pl.liceo_id = l.id AND pl.proceso_id = $1
         LEFT JOIN hitos_liceo h ON h.liceo_id = l.id AND h.proceso_id = $1
        WHERE pl.incluido IS NOT FALSE
          AND (CASE WHEN $3 THEN pl.id IS NOT NULL OR h.id IS NOT NULL ELSE l.activo END)
          AND ($2::uuid IS NULL OR EXISTS (
                SELECT 1 FROM postulaciones p
                  LEFT JOIN resultados_etapa r ON r.postulacion_id = p.id AND r.etapa_id = $2
                 WHERE p.liceo_id = l.id AND (p.etapa_id = $2 OR r.etapa_id = $2)))
        GROUP BY l.id, c.nombre, c.cargo, pl.estado
        ORDER BY l.codigo`,
      [procesoId, opciones.etapaId ?? null, !!opciones.cerrado],
    );
    return { catalogo, filas };
  }
}