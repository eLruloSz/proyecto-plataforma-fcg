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

    // Embudo de invitación: cada paso cuenta a quienes llegaron al menos hasta ahí.
    const [embudo] = await this.ds.query(
      `SELECT COUNT(*)::int AS invitados,
              COUNT(*) FILTER (WHERE confirmacion = 'CONFIRMADO')::int AS confirmaron,
              COUNT(*) FILTER (WHERE confirmacion = 'RECHAZADO')::int AS rechazaron,
              COUNT(*) FILTER (WHERE confirmacion = 'PENDIENTE')::int AS sin_respuesta,
              COUNT(*) FILTER (WHERE asistio_encuentro)::int AS asistieron_encuentro,
              COUNT(*) FILTER (WHERE estado IN ('POSTULO','PRESELECCIONADO_1','FINALISTA','BECARIO'))::int AS postularon,
              COUNT(*) FILTER (WHERE estado IN ('PRESELECCIONADO_1','FINALISTA','BECARIO'))::int AS preseleccionados,
              COUNT(*) FILTER (WHERE estado IN ('FINALISTA','BECARIO'))::int AS finalistas,
              COUNT(*) FILTER (WHERE estado = 'BECARIO')::int AS becarios,
              COUNT(*) FILTER (WHERE confirmacion = 'PENDIENTE' AND p.persona_id IN
                 (SELECT id FROM personas WHERE email IS NULL))::int AS sin_email
         FROM postulaciones p WHERE proceso_id = $1`,
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
      embudo, liceos, porLiceo, rebotados,
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
