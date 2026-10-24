import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Foto de una generación (un proceso anual). Se guarda en procesos.resumen al
 * cerrar el proceso, así el histórico no cambia aunque después se editen
 * liceos, contactos o etapas.
 *
 * Solo guarda números y la lista de becarios: los datos personales de los
 * demás postulantes no se copian aquí.
 *
 * En las generaciones históricas (ingresadas a mano) muchos campos pueden
 * venir en null: se muestran como "sin dato".
 */
export interface ResumenGeneracion {
  version: 1;
  calculado_en: string;
  liceos: { convocados: number | null; con_invitados: number | null };
  invitados: number | null;
  aceptaron: number | null;
  becarios: number | null;
  /** llegaron = estudiantes que alcanzaron esa etapa (la etapa 1 = todos los invitados). */
  etapas: { orden: number; nombre: string; cupo: number | null; llegaron: number | null; fecha_inicio: string | null; fecha_fin: string | null }[];
  /** llegaron[i] corresponde a etapas[i]. */
  por_liceo: { codigo: string; nombre: string; invitados: number; aceptaron: number; llegaron: number[]; becarios: number }[];
  lista_becarios: { codigo: string | null; nombre: string; liceo: string | null }[];
  material: {
    nominas: number;
    ranking: { nombre_archivo: string; cargado_en: string } | null;
    entrevistas: number;
    envios: { asunto: string; proposito: string; grupo: string; total: number; enviado_en: string }[];
    correos: number;
  } | null;
}

@Injectable()
export class ResumenGeneracionService {
  constructor(private readonly ds: DataSource) {}

  /** Calcula el resumen de un proceso con los datos que tiene en este momento. */
  async calcular(procesoId: string, em?: EntityManager): Promise<ResumenGeneracion> {
    const q = (sql: string, params: unknown[]) => (em ?? this.ds).query(sql, params);

    const [totales] = await q(
      `SELECT COUNT(*)::int AS invitados,
              COUNT(*) FILTER (WHERE confirmacion = 'CONFIRMADO')::int AS aceptaron,
              COUNT(*) FILTER (WHERE estado = 'BECARIO')::int AS becarios,
              COUNT(DISTINCT liceo_id)::int AS con_invitados
         FROM postulaciones WHERE proceso_id = $1`, [procesoId]);

    const [{ convocados }] = await q(
      `SELECT COUNT(*)::int AS convocados FROM participaciones_liceo
        WHERE proceso_id = $1 AND incluido AND estado <> 'NO_PARTICIPA'`, [procesoId]);

    // Un estudiante "llegó" a una etapa si su etapa actual es esa o una posterior
    // (los que no pasaron se quedan en la etapa donde salieron).
    const etapas = await q(
      `SELECT e.orden, e.nombre, e.cupo, e.fecha_inicio::text AS fecha_inicio, e.fecha_fin::text AS fecha_fin,
              (SELECT COUNT(*) FROM postulaciones p LEFT JOIN etapas pe ON pe.id = p.etapa_id
                WHERE p.proceso_id = e.proceso_id AND COALESCE(pe.orden, 1) >= e.orden)::int AS llegaron
         FROM etapas e WHERE e.proceso_id = $1 ORDER BY e.orden`, [procesoId]);

    const liceos = await q(
      `SELECT l.id, l.codigo, l.nombre,
              COUNT(p.id)::int AS invitados,
              COUNT(p.id) FILTER (WHERE p.confirmacion = 'CONFIRMADO')::int AS aceptaron,
              COUNT(p.id) FILTER (WHERE p.estado = 'BECARIO')::int AS becarios
         FROM liceos l
         LEFT JOIN participaciones_liceo pl ON pl.liceo_id = l.id AND pl.proceso_id = $1
         LEFT JOIN postulaciones p ON p.liceo_id = l.id AND p.proceso_id = $1
        WHERE (pl.incluido AND pl.estado <> 'NO_PARTICIPA') OR p.id IS NOT NULL
        GROUP BY l.id
        ORDER BY becarios DESC, invitados DESC, l.codigo`, [procesoId]);

    const llegadas: { liceo_id: string; orden: number; n: number }[] = await q(
      `SELECT p.liceo_id, e.orden, COUNT(*)::int AS n
         FROM postulaciones p
         LEFT JOIN etapas pe ON pe.id = p.etapa_id
         JOIN etapas e ON e.proceso_id = p.proceso_id AND e.orden <= COALESCE(pe.orden, 1)
        WHERE p.proceso_id = $1
        GROUP BY p.liceo_id, e.orden`, [procesoId]);
    const llegaron = (liceoId: string, orden: number) =>
      llegadas.find((x) => x.liceo_id === liceoId && x.orden === orden)?.n ?? 0;

    const becarios = await q(
      `SELECT p.codigo, TRIM(pe.nombres || ' ' || pe.apellido_paterno || COALESCE(' ' || pe.apellido_materno, '')) AS nombre,
              l.nombre AS liceo
         FROM postulaciones p JOIN personas pe ON pe.id = p.persona_id JOIN liceos l ON l.id = p.liceo_id
        WHERE p.proceso_id = $1 AND p.estado = 'BECARIO'
        ORDER BY l.codigo, pe.apellido_paterno, pe.nombres`, [procesoId]);

    const [{ nominas }] = await q(
      `SELECT COUNT(*)::int AS nominas FROM cargas WHERE proceso_id = $1 AND tipo = 'NOMINA_NOTAS'`, [procesoId]);
    const [ranking] = await q(
      `SELECT nombre_archivo, cargado_en FROM cargas WHERE proceso_id = $1 AND tipo = 'RANKING'
        ORDER BY cargado_en DESC LIMIT 1`, [procesoId]);
    const [{ entrevistas }] = await q(
      `SELECT COUNT(*)::int AS entrevistas FROM entrevistas en JOIN etapas e ON e.id = en.etapa_id
        WHERE e.proceso_id = $1 AND en.realizada`, [procesoId]);
    const envios = await q(
      `SELECT asunto, proposito, grupo, total, enviado_en FROM envios
        WHERE proceso_id = $1 ORDER BY enviado_en`, [procesoId]);
    const [{ correos }] = await q(
      `SELECT COUNT(*)::int AS correos FROM envio_destinatarios d JOIN envios e ON e.id = d.envio_id
        WHERE e.proceso_id = $1`, [procesoId]);

    return {
      version: 1,
      calculado_en: new Date().toISOString(),
      liceos: { convocados, con_invitados: totales.con_invitados },
      invitados: totales.invitados,
      aceptaron: totales.aceptaron,
      becarios: totales.becarios,
      etapas,
      por_liceo: liceos.map((l: any) => ({
        codigo: l.codigo, nombre: l.nombre, invitados: l.invitados, aceptaron: l.aceptaron, becarios: l.becarios,
        llegaron: etapas.map((e: any) => llegaron(l.id, e.orden)),
      })),
      lista_becarios: becarios,
      material: { nominas, ranking: ranking ?? null, entrevistas, envios, correos },
    };
  }

  /** Calcula y guarda el resumen (se usa al cerrar el proceso). */
  async guardar(procesoId: string, em?: EntityManager): Promise<ResumenGeneracion> {
    const r = await this.calcular(procesoId, em);
    await (em ?? this.ds).query(`UPDATE procesos SET resumen = $2 WHERE id = $1`, [procesoId, JSON.stringify(r)]);
    return r;
  }
}
