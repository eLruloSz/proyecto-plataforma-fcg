import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { AvanceService } from '../avance/avance.service';

/** Qué tipo de trabajo se hace en una etapa (según su clave o su posición). */
export type TipoEtapa = 'INVITACION' | 'ENCUENTRO' | 'PRESELECCION' | 'ENTREVISTA' | 'GENERAL';
export function tipoEtapa(e: { clave: string | null; orden: number }): TipoEtapa {
  if (e.clave === 'ENCUENTRO') return 'ENCUENTRO';
  if (e.clave === 'PRESELECCION') return 'PRESELECCION';
  if (e.clave === 'ENTREVISTA' || e.clave === 'ENTREVISTA_COMITE') return 'ENTREVISTA';
  if (e.orden === 1) return 'INVITACION';
  return 'GENERAL';
}

export interface Tarea {
  clave: string;
  titulo: string;
  detalle: string;
  hecha: boolean;
  accion?: { texto: string; ruta: string };
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Lista de tareas de una etapa ("qué hay que hacer ahora"), calculada con los
 * datos reales. La pantalla de Inicio la muestra como checklist y ofrece
 * terminar la etapa cuando todo está hecho.
 */
@Injectable()
export class TareasService {
  constructor(
    private readonly ds: DataSource,
    private readonly proceso: ProcesoActualService,
    private readonly avance: AvanceService,
  ) {}

  async tareas(etapaId?: string) {
    const p = await this.proceso.obtener();
    const etapas: { id: string; orden: number; nombre: string; clave: string | null; estado: string; cupo: number | null }[] =
      await this.ds.query(`SELECT id, orden, nombre, clave, estado, cupo FROM etapas WHERE proceso_id = $1 ORDER BY orden`, [p.id]);
    const etapa = etapas.find((e) => e.id === etapaId) ?? etapas.find((e) => e.estado === 'ACTIVA') ?? etapas[0];
    const siguiente = etapas.find((e) => e.orden > etapa.orden) ?? null;
    const tipo = tipoEtapa(etapa);
    const v = await this.avance.vista(etapa.id);
    const activos = v.estudiantes.filter((x: any) => x.en_esta_etapa && !x.confirmado);
    // Para las tareas de trabajo (fichas, encuentro, entrevistas) cuentan también los que ya
    // avanzaron desde esta etapa; no cuentan los que quedaron fuera.
    const base = v.estudiantes.filter((x: any) => !(x.confirmado && x.resultado === 'NO_PASA'));
    const r = v.resumen;
    const ruta = `/avance/${etapa.id}`;
    const tareas: Tarea[] = [];

    if (tipo === 'INVITACION') tareas.push(...(await this.invitacion(p.id)));

    if (tipo === 'ENCUENTRO') {
      const encuentros: { fecha: string; inscritos: number; asistentes: number }[] = await this.ds.query(
        `SELECT e.fecha,
                (SELECT COUNT(*)::int FROM postulaciones x WHERE x.encuentro_evento_id = e.id) AS inscritos,
                (SELECT COUNT(*)::int FROM postulaciones x WHERE x.encuentro_evento_id = e.id AND x.asistio_encuentro) AS asistentes
           FROM eventos e WHERE e.proceso_id = $1 AND e.tipo = 'ENCUENTRO_ONLINE' ORDER BY e.fecha`, [p.id]);
      const sinFecha = base.filter((x: any) => !x.encuentro_evento_id).length;
      const pasados = encuentros.filter((e) => new Date(e.fecha) < new Date());
      const asistentes = encuentros.reduce((s, e) => s + e.asistentes, 0);
      const inscritosPasados = pasados.reduce((s, e) => s + e.inscritos, 0);
      tareas.push(
        { clave: 'fechas', titulo: 'Crear las fechas del encuentro online', hecha: encuentros.length > 0,
          detalle: encuentros.length ? plural(encuentros.length, 'fecha creada', 'fechas creadas') : 'Aún no hay fechas.',
          accion: { texto: 'Ver fechas', ruta } },
        { clave: 'inscripcion', titulo: 'Inscribir a cada estudiante en una fecha', hecha: base.length > 0 && sinFecha === 0,
          detalle: sinFecha ? `${plural(sinFecha, 'estudiante', 'estudiantes')} sin fecha` : 'Todos tienen fecha.',
          accion: { texto: 'Inscribir', ruta } },
        { clave: 'asistencia', titulo: 'Registrar la asistencia', hecha: encuentros.length > 0 && pasados.length === encuentros.length && asistentes > 0,
          detalle: pasados.length ? `${asistentes} asistieron de ${inscritosPasados} inscritos en fechas ya realizadas` : 'Ningún encuentro realizado todavía.',
          accion: { texto: 'Marcar asistencia', ruta } },
      );
    }

    if (tipo === 'PRESELECCION') {
      const sinFicha = base.filter((x: any) => !x.ficha).length;
      const [ranking] = await this.ds.query(
        `SELECT nombre_archivo, cargado_en FROM cargas WHERE proceso_id = $1 AND tipo = 'RANKING'`, [p.id]);
      tareas.push(
        { clave: 'fichas', titulo: 'Completar la ficha RSH de cada estudiante', hecha: base.length > 0 && sinFicha === 0,
          detalle: sinFicha ? `${plural(sinFicha, 'estudiante', 'estudiantes')} sin ficha` : 'Todas las fichas completas.',
          accion: { texto: 'Completar fichas', ruta } },
        { clave: 'ranking', titulo: 'Subir el ranking', hecha: !!ranking,
          detalle: ranking ? `Cargado: ${ranking.nombre_archivo}` : 'Aún no se sube el Excel del ranking.',
          accion: { texto: ranking ? 'Ver ranking' : 'Subir ranking', ruta } },
      );
    }

    if (tipo === 'ENTREVISTA') {
      const sinFecha = base.filter((x: any) => !x.entrevista_fecha || x.entrevista_estado === 'CANCELADA').length;
      const realizadas = base.filter((x: any) => x.entrevista_realizada).length;
      const calendario = `/entrevistas/${etapa.id}`;
      tareas.push(
        { clave: 'agendar', titulo: 'Agendar las entrevistas', hecha: base.length > 0 && sinFecha === 0,
          detalle: sinFecha ? `${plural(sinFecha, 'estudiante', 'estudiantes')} sin fecha` : 'Todos tienen fecha.',
          accion: { texto: 'Abrir calendario', ruta: calendario } },
        { clave: 'realizar', titulo: 'Hacer las entrevistas', hecha: base.length > 0 && realizadas === base.length,
          detalle: `${realizadas} de ${base.length} realizadas`, accion: { texto: 'Abrir calendario', ruta: calendario } },
      );
    }

    // Documentos (requisitos de la etapa), en cualquier etapa que los tenga.
    if (v.requisitos.length) {
      const n = r.con_requisitos_pendientes;
      tareas.push({
        clave: 'requisitos', titulo: 'Recibir los documentos de los estudiantes', hecha: n === 0,
        detalle: n ? `${plural(n, 'estudiante', 'estudiantes')} con documentos pendientes` : 'Todos entregaron sus documentos.',
        accion: n ? { texto: 'Enviar recordatorio', ruta: `/comunicacion?nuevo=1&etapa=${etapa.id}&tipo=FALTAN_REQUISITOS` } : { texto: 'Ver', ruta },
      });
    }

    // Decidir y confirmar quién avanza.
    const sinConfirmar = r.marcados_pasa + r.marcados_no_pasa;
    const confirmados = r.confirmados_pasa + r.confirmados_no_pasa;
    const totalPasan = r.marcados_pasa + r.confirmados_pasa;
    tareas.push({
      clave: 'decidir', titulo: siguiente ? `Decidir quién avanza a ${siguiente.nombre}` : 'Decidir quiénes quedan como becarios',
      hecha: r.pendientes_de_decidir === 0 && sinConfirmar === 0 && confirmados > 0,
      detalle: [
        r.pendientes_de_decidir && `${r.pendientes_de_decidir} sin decidir`,
        sinConfirmar && `${sinConfirmar} marcados sin confirmar`,
        `${totalPasan} avanzan${etapa.cupo ? ` (cupo ${etapa.cupo})` : ''}`,
      ].filter(Boolean).join(' · '),
      accion: { texto: sinConfirmar ? 'Revisar y confirmar' : 'Decidir', ruta },
    });
    tareas.push({
      clave: 'avisar', titulo: 'Avisar el resultado a los estudiantes',
      hecha: confirmados > 0 && r.sin_avisar_pasa + r.sin_avisar_no_pasa === 0,
      detalle: confirmados ? `${r.sin_avisar_pasa + r.sin_avisar_no_pasa} sin avisar` : 'Primero hay que confirmar los resultados.',
      accion: { texto: 'Avisar', ruta },
    });

    if (tipo === 'ENTREVISTA') {
      const [l] = await this.ds.query(
        `SELECT COUNT(DISTINCT p.liceo_id)::int AS liceos,
                COUNT(DISTINCT p.liceo_id) FILTER (WHERE EXISTS (SELECT 1 FROM hitos_liceo h WHERE h.proceso_id = p.proceso_id
                  AND h.liceo_id = p.liceo_id AND h.codigo = 'AVISO_RESULTADOS' AND h.completado))::int AS avisados
           FROM postulaciones p
           LEFT JOIN resultados_etapa r ON r.postulacion_id = p.id AND r.etapa_id = $1
          WHERE p.etapa_id = $1 OR r.etapa_id = $1`, [etapa.id]);
      tareas.push({
        clave: 'liceos', titulo: 'Avisar los resultados a los liceos', hecha: l.liceos > 0 && l.avisados >= l.liceos,
        detalle: `${l.avisados} de ${plural(l.liceos, 'liceo', 'liceos')} avisados`,
        accion: { texto: 'Escribir a los liceos', ruta: '/comunicacion?nuevo=1&proposito=INFORME_LICEO' },
      });
    }

    return {
      etapa: { ...etapa, tipo },
      siguiente,
      total_etapas: etapas.length,
      resumen: { ...r, en_etapa: activos.length },
      tareas,
      lista: tareas.every((t) => t.hecha),
    };
  }

  /** Etapa 1: del correo de presentación a la respuesta de los invitados. */
  private async invitacion(procesoId: string): Promise<Tarea[]> {
    const [d] = await this.ds.query(
      `WITH lic AS (
         SELECT l.id, COALESCE(pl.estado, 'PENDIENTE') AS estado,
                EXISTS (SELECT 1 FROM hitos_liceo h WHERE h.proceso_id = $1 AND h.liceo_id = l.id AND h.codigo = 'MAIL_PRESENTACION' AND h.completado) AS presentado,
                EXISTS (SELECT 1 FROM hitos_liceo h WHERE h.proceso_id = $1 AND h.liceo_id = l.id AND h.codigo = 'INVITACION_ESTUDIANTES' AND h.completado) AS invitacion,
                EXISTS (SELECT 1 FROM cargas c WHERE c.proceso_id = $1 AND c.liceo_id = l.id AND c.tipo = 'NOMINA_NOTAS') AS nomina,
                (SELECT COUNT(*)::int FROM postulaciones p WHERE p.proceso_id = $1 AND p.liceo_id = l.id) AS invitados
           FROM liceos l LEFT JOIN participaciones_liceo pl ON pl.liceo_id = l.id AND pl.proceso_id = $1
          WHERE l.activo AND pl.incluido IS NOT FALSE)
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE presentado)::int AS presentados,
              COUNT(*) FILTER (WHERE estado = 'PARTICIPA')::int AS participan,
              COUNT(*) FILTER (WHERE estado = 'NO_PARTICIPA')::int AS no_participan,
              COUNT(*) FILTER (WHERE estado = 'PENDIENTE')::int AS sin_respuesta,
              COUNT(*) FILTER (WHERE estado = 'PARTICIPA' AND NOT nomina)::int AS sin_nomina,
              COUNT(*) FILTER (WHERE estado = 'PARTICIPA' AND nomina AND invitados = 0)::int AS sin_invitados,
              COUNT(*) FILTER (WHERE invitados > 0)::int AS con_invitados,
              COUNT(*) FILTER (WHERE invitados > 0 AND NOT invitacion)::int AS sin_invitacion
         FROM lic`, [procesoId]);
    const [i] = await this.ds.query(
      `SELECT COUNT(*)::int AS invitados,
              COUNT(*) FILTER (WHERE pe.email IS NULL AND p.estado NOT IN ('NO_CONTINUA','DESISTIO'))::int AS sin_email,
              COUNT(*) FILTER (WHERE p.confirmacion = 'PENDIENTE' AND p.estado NOT IN ('NO_CONTINUA','DESISTIO'))::int AS sin_respuesta,
              COUNT(*) FILTER (WHERE p.confirmacion = 'CONFIRMADO')::int AS aceptaron
         FROM postulaciones p JOIN personas pe ON pe.id = p.persona_id
        WHERE p.proceso_id = $1`, [procesoId]);
    return [
      { clave: 'presentacion', titulo: 'Enviar el correo de presentación a los liceos', hecha: d.total > 0 && d.presentados >= d.total,
        detalle: `${d.presentados} de ${plural(d.total, 'liceo', 'liceos')}`,
        accion: { texto: 'Escribir correo', ruta: '/comunicacion?nuevo=1&proposito=PRESENTACION' } },
      { clave: 'participacion', titulo: 'Saber qué liceos participan', hecha: d.total > 0 && d.sin_respuesta === 0,
        detalle: `${d.participan} participan · ${d.no_participan} no · ${d.sin_respuesta} sin respuesta`,
        accion: { texto: 'Ver respuestas', ruta: '/comunicacion' } },
      { clave: 'nominas', titulo: 'Recibir y subir las nóminas de notas', hecha: d.participan > 0 && d.sin_nomina === 0,
        detalle: d.sin_nomina ? `Faltan ${plural(d.sin_nomina, 'nómina', 'nóminas')}` : 'Todas recibidas.',
        accion: { texto: 'Liceos y nóminas', ruta: '/liceos' } },
      { clave: 'invitados', titulo: 'Elegir a los invitados de cada liceo', hecha: d.con_invitados > 0 && d.sin_invitados === 0,
        detalle: d.sin_invitados ? `${plural(d.sin_invitados, 'liceo', 'liceos')} con nómina y sin invitados` : `${i.invitados} invitados`,
        accion: { texto: 'Liceos y nóminas', ruta: '/liceos' } },
      { clave: 'invitacion', titulo: 'Enviar la invitación a los estudiantes', hecha: d.con_invitados > 0 && d.sin_invitacion === 0,
        detalle: d.sin_invitacion ? `${plural(d.sin_invitacion, 'liceo', 'liceos')} sin invitación enviada` : 'Enviada en todos los liceos.',
        accion: { texto: 'Escribir correo', ruta: '/comunicacion?nuevo=1&proposito=INVITACION_ESTUDIANTES' } },
      { clave: 'contactos', titulo: 'Completar email y teléfono de los invitados', hecha: i.invitados > 0 && i.sin_email === 0,
        detalle: i.sin_email ? `${plural(i.sin_email, 'invitado', 'invitados')} sin email` : 'Todos tienen email.',
        accion: { texto: 'Invitados', ruta: '/invitados' } },
      { clave: 'respuestas', titulo: 'Registrar quién acepta postular', hecha: i.invitados > 0 && i.sin_respuesta === 0,
        detalle: `${i.aceptaron} aceptaron · ${i.sin_respuesta} sin respuesta`,
        accion: { texto: 'Invitados', ruta: '/invitados' } },
    ];
  }
}