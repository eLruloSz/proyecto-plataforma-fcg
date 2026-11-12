import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Hitos que se marcan solos cuando se envía un correo con ese propósito.
 * Además, cada plantilla puede marcar su propio hito (plantillas_correo.hito_envio):
 * así los correos de resultado de cada etapa, que comparten propósito, marcan cada uno el suyo.
 */
export const HITO_POR_PROPOSITO: Record<string, string[] | undefined> = {
  PRESENTACION: ['MAIL_PRESENTACION'],
  // El correo de inicio presenta la beca y pide las notas a la vez.
  SOLICITUD_NOTAS: ['MAIL_SOLICITUD_NOTAS', 'MAIL_PRESENTACION'],
  SOLICITUD_CONTACTOS: ['MAIL_APROBACION'],
  INVITACION_ESTUDIANTES: ['INVITACION_ESTUDIANTES'],
  AGRADECIMIENTO: ['MAIL_AGRADECIMIENTO'],
};

/** Hito que se marca solo cuando el liceo responde un correo con ese propósito (o plantillas_correo.hito_respuesta). */
export const HITO_RESPUESTA_POR_PROPOSITO: Record<string, string | undefined> = {
  PRESENTACION: 'ACUSO_RECIBO',
  // Responder el correo de inicio es el acuso de recibo; la nómina se marca al subirla.
  SOLICITUD_NOTAS: 'ACUSO_RECIBO',
  SOLICITUD_CONTACTOS: 'APROBACION_CONTACTOS',
};

/** Hitos que marca enviar un correo: los del propósito más el de la plantilla (o la del envío original). */
export async function hitosDeEnvio(
  ds: DataSource, proposito: string, plantillaId?: string | null, envioOrigenId?: string | null,
): Promise<string[]> {
  const hitos = new Set(HITO_POR_PROPOSITO[proposito] ?? []);
  const [p] = await ds.query(
    `SELECT pl.hito_envio FROM plantillas_correo pl
      WHERE pl.id = COALESCE($1::uuid, (SELECT o.plantilla_id FROM envios o WHERE o.id = $2::uuid))`,
    [plantillaId ?? null, envioOrigenId ?? null]);
  if (p?.hito_envio) hitos.add(p.hito_envio);
  return [...hitos];
}

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
    // En un concurso cerrado también se muestran los hitos ya desactivados que se usaron ese año.
    const catalogo: { codigo: string; nombre: string; orden: number; tipos_etapa: string[]; calculado: boolean }[] = await this.ds.query(
      `SELECT c.codigo, c.nombre, c.orden, c.tipos_etapa, c.calculado FROM catalogo_hitos c
        WHERE (c.activo OR ($3 AND EXISTS (SELECT 1 FROM hitos_liceo h WHERE h.codigo = c.codigo AND h.proceso_id = $2)))
          AND ($1::text[] IS NULL OR c.codigo = ANY($1))
        ORDER BY c.orden`,
      [opciones.codigos ?? null, procesoId, !!opciones.cerrado],
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
    await this.agregarCalculados(procesoId, catalogo.filter((h) => h.calculado).map((h) => h.codigo), filas);
    return { catalogo, filas };
  }

  /**
   * Hitos calculados (no se marcan): se completan cuando todos los estudiantes
   * del liceo cumplen. `detalle` muestra el avance, ej. "4/6".
   *  - RESPUESTAS_INVITADOS: invitados que respondieron si aceptan postular.
   *  - ENTREVISTA_FINAL: estudiantes de la etapa del comité con entrevista agendada.
   */
  private async agregarCalculados(procesoId: string, codigos: string[], filas: { id: string; hitos: Record<string, unknown> }[]) {
    if (!codigos.length) return;
    const consultas: Record<string, string> = {
      RESPUESTAS_INVITADOS:
        `SELECT p.liceo_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE p.confirmacion <> 'PENDIENTE')::int AS hechos
           FROM postulaciones p WHERE p.proceso_id = $1 GROUP BY p.liceo_id`,
      ENTREVISTA_FINAL:
        `SELECT p.liceo_id, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE en.fecha_hora IS NOT NULL AND en.estado <> 'CANCELADA')::int AS hechos
           FROM etapas e
           JOIN postulaciones p ON p.proceso_id = e.proceso_id AND p.estado <> 'DESISTIO'
            AND (p.etapa_id = e.id OR EXISTS (SELECT 1 FROM resultados_etapa r WHERE r.postulacion_id = p.id AND r.etapa_id = e.id))
           LEFT JOIN entrevistas en ON en.postulacion_id = p.id AND en.etapa_id = e.id
          WHERE e.proceso_id = $1 AND e.clave = 'ENTREVISTA_COMITE'
          GROUP BY p.liceo_id`,
    };
    for (const codigo of codigos) {
      if (!consultas[codigo]) continue;
      const datos: { liceo_id: string; total: number; hechos: number }[] = await this.ds.query(consultas[codigo], [procesoId]);
      const porLiceo = new Map(datos.map((d) => [d.liceo_id, d]));
      for (const f of filas) {
        const d = porLiceo.get(f.id);
        if (!d) continue; // el liceo no tiene estudiantes en esto: queda pendiente, sin detalle
        f.hitos[codigo] = {
          completado: d.total > 0 && d.hechos === d.total, automatico: true, fecha: null, observaciones: null,
          detalle: `${d.hechos}/${d.total}`,
        };
      }
    }
  }
}