import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { asuntoVisible } from '../comunicacion/variables';

@Injectable()
export class DashboardService {
  constructor(private readonly ds: DataSource, private readonly proceso: ProcesoActualService) {}

  async resumen() {
    const p = await this.proceso.obtener();

    // Invitación: respuesta de los invitados.
    const [embudo] = await this.ds.query(
      `SELECT COUNT(*)::int AS invitados,
              COUNT(*) FILTER (WHERE confirmacion = 'CONFIRMADO')::int AS confirmaron,
              COUNT(*) FILTER (WHERE confirmacion = 'RECHAZADO')::int AS rechazaron,
              COUNT(*) FILTER (WHERE confirmacion = 'PENDIENTE' AND estado NOT IN ('NO_CONTINUA','DESISTIO'))::int AS sin_respuesta,
              COUNT(*) FILTER (WHERE asistio_encuentro)::int AS asistieron_encuentro,
              COUNT(*) FILTER (WHERE estado = 'BECARIO')::int AS becarios,
              COUNT(*) FILTER (WHERE estado NOT IN ('NO_CONTINUA','DESISTIO') AND pe.email IS NULL)::int AS sin_email
         FROM postulaciones p JOIN personas pe ON pe.id = p.persona_id WHERE p.proceso_id = $1`,
      [p.id],
    );

    // Avance: cuántos llegaron a cada etapa y cuántos siguen en ella.
    const porEtapa = await this.ds.query(
      `SELECT e.id, e.orden, e.nombre, e.estado, e.cupo,
              COUNT(p.id) FILTER (WHERE pe2.orden >= e.orden)::int AS llegaron,
              COUNT(p.id) FILTER (WHERE p.etapa_id = e.id AND p.estado NOT IN ('NO_CONTINUA','DESISTIO','BECARIO'))::int AS en_etapa
         FROM etapas e
         LEFT JOIN postulaciones p ON p.proceso_id = e.proceso_id
         LEFT JOIN etapas pe2 ON pe2.id = p.etapa_id
        WHERE e.proceso_id = $1
        GROUP BY e.id ORDER BY e.orden`,
      [p.id],
    );

    // Pendientes por etapa: requisitos que faltan, marcas sin confirmar, resultados sin avisar.
    const requisitosPendientes = await this.ds.query(
      `SELECT e.id AS etapa_id, e.nombre AS etapa, q.nombre AS requisito,
              COUNT(p.id) FILTER (WHERE NOT EXISTS (SELECT 1 FROM cumplimientos c
                                   WHERE c.requisito_id = q.id AND c.postulacion_id = p.id))::int AS faltan
         FROM etapas e
         JOIN requisitos_etapa q ON q.etapa_id = e.id AND q.activo
         JOIN postulaciones p ON p.etapa_id = e.id AND p.estado NOT IN ('NO_CONTINUA','DESISTIO','BECARIO')
        WHERE e.proceso_id = $1
        GROUP BY e.id, q.id ORDER BY e.orden, q.orden`,
      [p.id],
    );
    const [{ con_requisitos_pendientes }] = await this.ds.query(
      `SELECT COUNT(*)::int AS con_requisitos_pendientes FROM postulaciones p
        WHERE p.proceso_id = $1 AND p.estado NOT IN ('NO_CONTINUA','DESISTIO','BECARIO')
          AND EXISTS (SELECT 1 FROM requisitos_etapa q WHERE q.etapa_id = p.etapa_id AND q.activo
                        AND NOT EXISTS (SELECT 1 FROM cumplimientos c WHERE c.requisito_id = q.id AND c.postulacion_id = p.id))`,
      [p.id],
    );
    const resultadosPendientes = await this.ds.query(
      `SELECT e.id AS etapa_id, e.nombre AS etapa,
              COUNT(*) FILTER (WHERE NOT r.confirmado)::int AS sin_confirmar,
              COUNT(*) FILTER (WHERE r.confirmado AND r.avisado_en IS NULL)::int AS sin_avisar
         FROM resultados_etapa r JOIN etapas e ON e.id = r.etapa_id
        WHERE e.proceso_id = $1
        GROUP BY e.id
       HAVING COUNT(*) FILTER (WHERE NOT r.confirmado) > 0 OR COUNT(*) FILTER (WHERE r.confirmado AND r.avisado_en IS NULL) > 0
        ORDER BY e.orden`,
      [p.id],
    );

    const [liceos] = await this.ds.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE COALESCE(pl.estado,'PENDIENTE') = 'PARTICIPA')::int AS participan,
              COUNT(*) FILTER (WHERE pl.estado = 'NO_PARTICIPA')::int AS no_participan,
              COUNT(*) FILTER (WHERE COALESCE(pl.estado,'PENDIENTE') = 'PENDIENTE')::int AS sin_respuesta,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM cargas c WHERE c.liceo_id = l.id AND c.proceso_id = $1
                                             AND c.tipo = 'NOMINA_NOTAS'))::int AS con_nomina
         FROM liceos l LEFT JOIN participaciones_liceo pl ON pl.liceo_id = l.id AND pl.proceso_id = $1
        WHERE l.activo`,
      [p.id],
    );

    const porLiceo = await this.ds.query(
      `SELECT l.id, l.codigo, l.nombre, COALESCE(pl.estado,'PENDIENTE') AS participacion,
              (SELECT COUNT(*)::int FROM alumnos_nomina a WHERE a.liceo_id = l.id AND a.proceso_id = $1) AS alumnos_nomina,
              COUNT(po.id)::int AS invitados,
              COUNT(po.id) FILTER (WHERE po.confirmacion = 'CONFIRMADO')::int AS confirmaron,
              COUNT(po.id) FILTER (WHERE po.confirmacion = 'PENDIENTE')::int AS sin_respuesta
         FROM liceos l
         LEFT JOIN participaciones_liceo pl ON pl.liceo_id = l.id AND pl.proceso_id = $1
         LEFT JOIN postulaciones po ON po.liceo_id = l.id AND po.proceso_id = $1
        WHERE l.activo
        GROUP BY l.id, pl.estado
        ORDER BY l.codigo`,
      [p.id],
    );

    // Correos que esperan respuesta (los 5 envíos más recientes con pendientes)
    const correosPendientes = await this.ds.query(
      `SELECT e.id, e.asunto, e.grupo, e.enviado_en,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE d.respuesta = 'PENDIENTE')::int AS sin_respuesta
         FROM envios e JOIN envio_destinatarios d ON d.envio_id = e.id
        WHERE e.proceso_id = $1
        GROUP BY e.id
       HAVING COUNT(*) FILTER (WHERE d.respuesta = 'PENDIENTE') > 0
        ORDER BY e.enviado_en DESC LIMIT 5`,
      [p.id],
    );

    const [{ rebotados }] = await this.ds.query(
      `SELECT COUNT(*)::int AS rebotados FROM envio_destinatarios d JOIN envios e ON e.id = d.envio_id
        WHERE e.proceso_id = $1 AND d.entrega IN ('REBOTADO','FALLIDO')`,
      [p.id],
    );

    return {
      proceso: { id: p.id, nombre: p.nombre, anio: p.anio },
      embudo, porEtapa, liceos, porLiceo, rebotados,
      pendientes: {
        con_requisitos_pendientes,
        requisitos: requisitosPendientes.filter((r: any) => r.faltan > 0),
        resultados: resultadosPendientes,
      },
      correosPendientes: correosPendientes.map((c: any) => ({ ...c, asunto: asuntoVisible(c.asunto, p.anio) })),
    };
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}
  @Get() resumen() { return this.svc.resumen(); }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
