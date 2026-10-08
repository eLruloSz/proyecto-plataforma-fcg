import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/** Hito que se marca solo cuando se envía un correo con ese propósito. */
export const HITO_POR_PROPOSITO: Record<string, string | undefined> = {
  PRESENTACION: 'MAIL_PRESENTACION',
  SOLICITUD_NOTAS: 'MAIL_SOLICITUD_NOTAS',
  SOLICITUD_CONTACTOS: 'MAIL_APROBACION',
  INVITACION_ESTUDIANTES: 'INVITACION_ESTUDIANTES',
  AGRADECIMIENTO: 'MAIL_AGRADECIMIENTO',
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

  /** Grilla de seguimiento: una fila por liceo, una columna por hito del catálogo. */
  async grilla(procesoId: string) {
    const catalogo = await this.ds.query(
      `SELECT codigo, nombre, orden FROM catalogo_hitos WHERE activo ORDER BY orden`,
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
        WHERE l.activo
        GROUP BY l.id, c.nombre, c.cargo, pl.estado
        ORDER BY l.codigo`,
      [procesoId],
    );
    return { catalogo, filas };
  }
}
