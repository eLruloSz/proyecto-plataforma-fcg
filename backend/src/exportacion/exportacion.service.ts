import { Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { tipoEtapa } from '../dashboard/tareas.service';
import { agregarHoja, colDia, colFecha, Columna, crearLibro, nombreArchivo, nombreHoja } from './excel-util';

/**
 * Exportaciones a Excel.
 *
 *  - Excel de una etapa: una hoja con los estudiantes de la etapa y los datos que se tienen HASTA
 *    esa etapa (colegio → contacto y encuentro → ficha RSH y ranking → entrevistas), más las hojas
 *    del "Listado Final de Invitados".
 *  - Solo se LEE de la base. La lógica del RSH y del ranking (de otra persona del equipo) no se toca;
 *    de los puntajes del ranking solo se exporta la posición (el Excel de Puntajes es aparte).
 *  - Celda sin dato → vacía. Columna sin ningún dato → no se incluye (lo resuelve agregarHoja).
 */

/** Hasta qué punto del proceso llega cada tipo de etapa. Una etapa "GENERAL" (sin clave) muestra todo. */
const NIVEL: Record<string, number> = { INVITACION: 1, ENCUENTRO: 2, PRESELECCION: 3, ENTREVISTA: 4, GENERAL: 4 };

type Fila = Record<string, any>;
type EtapaFila = { id: string; orden: number; nombre: string; clave: string | null };

const si = (v: boolean | null | undefined) => (v === true ? 'Sí' : v === false ? 'No' : null);
const RESPUESTA: Record<string, string | undefined> = { CONFIRMADO: 'Aceptó', RECHAZADO: 'Rechazó' }; // PENDIENTE = sin dato
const ENTREGA: Record<string, string | undefined> = {
  ENVIADO: 'Enviado', ENTREGADO: 'Entregado', REBOTADO: 'Rebotó', FALLIDO: 'Falló',
};
const ESTADO_ENTREVISTA: Record<string, string | undefined> = {
  POR_SOLICITAR: 'Por solicitar', SOLICITADA: 'Solicitada', CONFIRMADA: 'Confirmada',
  REALIZADA: 'Realizada', CANCELADA: 'Cancelada', CONFLICTO: 'Con conflicto',
};

/** Misma regla que usa la pauta en Word: lo digitado en la ficha; si no hay, lo que traía el ranking. */
function tramoRsh(x: Fila): string | null {
  if (x.rsh_pendiente) return 'Pendiente';
  if (x.tramo_rsh) return `${x.tramo_rsh}%`;
  if (x.ranking_rsh) return String(x.ranking_rsh).toUpperCase() === 'P' ? 'Pendiente' : String(x.ranking_rsh);
  return null;
}

/** Cómo va el estudiante en el proceso (mismas etiquetas que ve la fundación en pantalla). */
function situacion(x: Fila): string {
  if (x.estado === 'BECARIO') return 'Becario/a';
  if (x.estado === 'DESISTIO' || x.confirmacion === 'RECHAZADO') return 'No postula';
  if (x.estado === 'NO_CONTINUA') return 'No continúa';
  return 'En proceso';
}

const nombreCompleto = (x: Fila) => [x.nombres, x.apellido_paterno, x.apellido_materno].filter(Boolean).join(' ');

@Injectable()
export class ExportacionService {
  constructor(
    private readonly ds: DataSource,
    private readonly proceso: ProcesoActualService,
  ) {}

  /**
   * Postulantes del proceso con todo lo que el sistema sabe de ellos. Con `etapaId`, solo los de esa
   * etapa (los que están en ella o ya tienen resultado confirmado): la misma regla que la pantalla "Avance".
   */
  private estudiantes(procesoId: string, etapaId: string | null): Promise<Fila[]> {
    return this.ds.query(
      `WITH pos_liceo AS (
         SELECT id, RANK() OVER (PARTITION BY carga_id ORDER BY promedio DESC NULLS LAST)::int AS posicion_liceo
           FROM alumnos_nomina WHERE proceso_id = $1
       )
       SELECT p.id, p.codigo, p.correlativo, p.curso, p.promedio::float AS promedio, p.posicion_curso, pl.posicion_liceo,
              p.estado, p.confirmacion, p.confirmacion_en, p.asistio_encuentro, ev.fecha AS encuentro_fecha,
              pe.rut, pe.nombres, pe.apellido_paterno, pe.apellido_materno, pe.email, pe.telefono,
              l.codigo AS liceo_codigo, l.nombre AS liceo, l.comuna, et.nombre AS etapa_actual,
              fi.tramo_rsh, fi.rsh_pendiente, to_char(fi.rsh_actualizada, 'YYYY-MM-DD') AS rsh_actualizada, fi.personas_hogar, fi.personas_formulario,
              fi.menores_18, fi.mayores_60, fi.con_discapacidad, fi.con_dependencia, fi.con_invalidez, fi.con_nee,
              fi.ingresos_hogar, fi.observaciones AS ficha_observaciones,
              rk.posicion AS ranking_posicion, rk.rsh AS ranking_rsh,
              inv.enviado_en AS invitacion_enviada, inv.entrega AS invitacion_entrega
         FROM postulaciones p
         JOIN personas pe ON pe.id = p.persona_id
         JOIN liceos l ON l.id = p.liceo_id
         LEFT JOIN etapas et ON et.id = p.etapa_id
         LEFT JOIN pos_liceo pl ON pl.id = p.alumno_nomina_id
         LEFT JOIN eventos ev ON ev.id = p.encuentro_evento_id
         LEFT JOIN fichas_postulacion fi ON fi.postulacion_id = p.id
         LEFT JOIN LATERAL (
           SELECT rp.posicion, rp.rsh
             FROM ranking_postulacion rp JOIN cargas ca ON ca.id = rp.carga_id
            WHERE rp.postulacion_id = p.id AND ca.tipo = 'RANKING' AND ca.proceso_id = p.proceso_id
            ORDER BY ca.cargado_en DESC LIMIT 1) rk ON TRUE
         LEFT JOIN LATERAL (
           SELECT en.enviado_en, ed.entrega
             FROM envio_destinatarios ed JOIN envios en ON en.id = ed.envio_id
            WHERE ed.postulacion_id = p.id AND en.proposito = 'INVITACION_ESTUDIANTES'
            ORDER BY en.enviado_en DESC LIMIT 1) inv ON TRUE
         LEFT JOIN resultados_etapa r ON r.postulacion_id = p.id AND r.etapa_id = $2::uuid
        WHERE p.proceso_id = $1
          AND ($2::uuid IS NULL OR p.etapa_id = $2::uuid OR (r.confirmado AND r.etapa_id = $2::uuid))
        ORDER BY p.correlativo`,
      [procesoId, etapaId]);
  }

  // -------------------------------------------------------------------------
  // Excel de una etapa
  // -------------------------------------------------------------------------

  async excelEtapa(etapaId: string) {
    const procesoId = await this.proceso.id();
    const [etapa] = await this.ds.query(
      `SELECT id, orden, nombre, clave FROM etapas WHERE id = $1 AND proceso_id = $2`, [etapaId, procesoId]);
    if (!etapa) throw new NotFoundException('Etapa no encontrada.');
    const nivel = NIVEL[tipoEtapa(etapa)] ?? 4;

    const filas = await this.estudiantes(procesoId, etapaId);
    const ids: string[] = filas.map((f) => f.id);
    const hasta: EtapaFila[] = await this.ds.query(
      `SELECT id, orden, nombre, clave FROM etapas WHERE proceso_id = $1 AND orden <= $2 ORDER BY orden`,
      [procesoId, etapa.orden]);
    const etapasEntrevista = hasta.filter((e) => tipoEtapa(e) === 'ENTREVISTA');

    // Lo que cuelga de cada estudiante: resultados por etapa, entrevistas y requisitos cumplidos.
    for (const f of filas) { f.resultados = {}; f.entrevistas = {}; f.cumplidos = new Set<string>(); }
    const porId = new Map<string, Fila>(filas.map((f) => [f.id, f]));
    if (ids.length) {
      const resultados: Fila[] = await this.ds.query(
        `SELECT postulacion_id, etapa_id, resultado, confirmado FROM resultados_etapa
          WHERE postulacion_id = ANY($1::uuid[]) AND etapa_id = ANY($2::uuid[])`,
        [ids, hasta.map((e) => e.id)]);
      for (const r of resultados) if (r.resultado) porId.get(r.postulacion_id)!.resultados[r.etapa_id] = r;

      if (etapasEntrevista.length) {
        const entrevistas: Fila[] = await this.ds.query(
          `SELECT postulacion_id, etapa_id, fecha_hora, estado, realizada, comentario FROM entrevistas
            WHERE postulacion_id = ANY($1::uuid[]) AND etapa_id = ANY($2::uuid[])`,
          [ids, etapasEntrevista.map((e) => e.id)]);
        for (const en of entrevistas) porId.get(en.postulacion_id)!.entrevistas[en.etapa_id] = en;
      }

      const cumplimientos: Fila[] = await this.ds.query(
        `SELECT c.postulacion_id, c.requisito_id FROM cumplimientos c
           JOIN requisitos_etapa q ON q.id = c.requisito_id
          WHERE q.etapa_id = $1 AND q.activo AND c.postulacion_id = ANY($2::uuid[])`,
        [etapaId, ids]);
      for (const c of cumplimientos) porId.get(c.postulacion_id)!.cumplidos.add(c.requisito_id);
    }
    const requisitos: Fila[] = await this.ds.query(
      `SELECT id, nombre FROM requisitos_etapa WHERE etapa_id = $1 AND activo ORDER BY orden, creado_en`, [etapaId]);

    // ---- Columnas, de lo más básico a lo más avanzado ------------------------------------------
    const col: Columna<Fila>[] = [
      { titulo: 'Id', valor: (f) => f.codigo, ancho: 9 },
      { titulo: 'Nombres', valor: (f) => f.nombres },
      { titulo: 'Apellido paterno', valor: (f) => f.apellido_paterno },
      { titulo: 'Apellido materno', valor: (f) => f.apellido_materno },
      // Etapa 1: datos del colegio (vienen de la nómina que manda cada liceo).
      { titulo: 'Cód. liceo', valor: (f) => f.liceo_codigo, ancho: 8 },
      { titulo: 'Establecimiento', valor: (f) => f.liceo },
      { titulo: 'Comuna', valor: (f) => f.comuna },
      { titulo: 'Curso', valor: (f) => f.curso, ancho: 7 },
      { titulo: 'Promedio', valor: (f) => f.promedio, formato: '0.000', ancho: 9 },
      { titulo: 'Posición en el curso', valor: (f) => f.posicion_curso, ancho: 10 },
      { titulo: 'Posición en el liceo', valor: (f) => f.posicion_liceo, ancho: 10 },
      { titulo: 'Respuesta a la invitación', valor: (f) => RESPUESTA[f.confirmacion] ?? null, ancho: 13 },
      colFecha('Fecha de la respuesta', (f) => f.confirmacion_en),
    ];
    if (nivel >= 2) {
      // Etapa 2: contacto y asistencia al encuentro online.
      col.push(
        { titulo: 'RUT', valor: (f) => f.rut, ancho: 12 },
        { titulo: 'Correo', valor: (f) => f.email },
        { titulo: 'Teléfono', valor: (f) => f.telefono, ancho: 13 },
        colFecha('Fecha del encuentro online', (f) => f.encuentro_fecha, true),
        { titulo: 'Asistió al encuentro', valor: (f) => si(f.asistio_encuentro), ancho: 11 },
      );
    }
    if (nivel >= 3) {
      // Siguientes etapas: ficha RSH y posición en el ranking (solo lectura).
      col.push(
        { titulo: 'Tramo RSH', valor: tramoRsh, ancho: 10 },
        { titulo: 'Personas del hogar (cartola)', valor: (f) => f.personas_hogar, ancho: 12 },
        { titulo: 'Personas del hogar (formulario)', valor: (f) => f.personas_formulario, ancho: 12 },
        { titulo: 'Menores de 18', valor: (f) => f.menores_18, ancho: 9 },
        { titulo: 'Mayores de 60', valor: (f) => f.mayores_60, ancho: 9 },
        { titulo: 'Con discapacidad', valor: (f) => f.con_discapacidad, ancho: 11 },
        { titulo: 'Con dependencia', valor: (f) => f.con_dependencia, ancho: 11 },
        { titulo: 'Con invalidez', valor: (f) => f.con_invalidez, ancho: 9 },
        { titulo: 'Con NEE', valor: (f) => f.con_nee, ancho: 8 },
        { titulo: 'Ingresos del hogar', valor: (f) => f.ingresos_hogar },
        colDia('RSH actualizada', (f) => f.rsh_actualizada),
        { titulo: 'Observaciones de la ficha', valor: (f) => f.ficha_observaciones, ancho: 30 },
        { titulo: 'Posición en el ranking', valor: (f) => f.ranking_posicion, ancho: 10 },
      );
    }
    // Entrevistas: una tanda de columnas por cada etapa de entrevista hasta esta (con su nombre si hay más de una).
    for (const e of etapasEntrevista) {
      const sufijo = etapasEntrevista.length > 1 ? ` (${e.nombre})` : '';
      const de = (f: Fila) => f.entrevistas[e.id];
      col.push(
        colFecha(`Fecha y hora de la entrevista${sufijo}`, (f) => de(f)?.fecha_hora, true),
        { titulo: `Estado de la entrevista${sufijo}`, valor: (f) => ESTADO_ENTREVISTA[de(f)?.estado] ?? null, ancho: 14 },
        { titulo: `Entrevista realizada${sufijo}`, valor: (f) => (de(f)?.realizada ? 'Sí' : null), ancho: 11 },
        { titulo: `Comentarios de la entrevista${sufijo}`, valor: (f) => de(f)?.comentario, ancho: 30 },
      );
    }
    // Requisitos de esta etapa (formulario, RSH, notas…): "Sí" si lo cumplió.
    for (const q of requisitos) {
      col.push({ titulo: `Cumple: ${q.nombre}`, valor: (f) => (f.cumplidos.has(q.id) ? 'Sí' : null), ancho: 12 });
    }
    // Resultado (pasa / no pasa) de cada etapa hasta esta; "sin confirmar" si la marca aún es provisoria.
    for (const e of hasta) {
      col.push({
        titulo: `Resultado: ${e.nombre}`,
        valor: (f) => {
          const r = f.resultados[e.id];
          return r ? `${r.resultado === 'PASA' ? 'Pasa' : 'No pasa'}${r.confirmado ? '' : ' (sin confirmar)'}` : null;
        },
        ancho: 14,
      });
    }
    col.push(
      { titulo: 'Etapa actual', valor: (f) => f.etapa_actual },
      { titulo: 'Situación', valor: situacion, ancho: 12 },
    );

    const wb = crearLibro();
    const usados = new Set<string>();
    agregarHoja(wb, nombreHoja(`${etapa.orden}. ${etapa.nombre}`, usados), col, filas);
    await this.hojasListadoFinal(wb, usados, procesoId);

    return {
      nombre: `${nombreArchivo(`Etapa ${etapa.orden} - ${etapa.nombre}`)}.xlsx`,
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    };
  }

  // -------------------------------------------------------------------------
  // Listado Final de Invitados
  // -------------------------------------------------------------------------

  /** Solo el listado final (las 4 hojas), sin la hoja de una etapa. */
  async excelListadoFinal() {
    const procesoId = await this.proceso.id();
    const wb = crearLibro();
    await this.hojasListadoFinal(wb, new Set<string>(), procesoId);
    return { nombre: 'Listado Final de Invitados.xlsx', buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  }

  /**
   * Hojas del formato "Listado Final de Invitados": Invitados, Correos postulantes,
   * Envíos y formulario con RSH, Postulantes por liceo. Siempre con todos los invitados del proceso.
   */
  private async hojasListadoFinal(wb: ExcelJS.Workbook, usados: Set<string>, procesoId: string) {
    const invitados = await this.estudiantes(procesoId, null);

    agregarHoja<Fila>(wb, nombreHoja('Invitados', usados), [
      { titulo: 'Id', valor: (f) => f.codigo, ancho: 9 },
      { titulo: 'Nombres', valor: (f) => f.nombres },
      { titulo: 'Apellido paterno', valor: (f) => f.apellido_paterno },
      { titulo: 'Apellido materno', valor: (f) => f.apellido_materno },
      { titulo: 'RUT', valor: (f) => f.rut, ancho: 12 },
      { titulo: 'Cód. liceo', valor: (f) => f.liceo_codigo, ancho: 8 },
      { titulo: 'Establecimiento', valor: (f) => f.liceo },
      { titulo: 'Comuna', valor: (f) => f.comuna },
      { titulo: 'Curso', valor: (f) => f.curso, ancho: 7 },
      { titulo: 'Promedio', valor: (f) => f.promedio, formato: '0.000', ancho: 9 },
      { titulo: 'Posición en el curso', valor: (f) => f.posicion_curso, ancho: 10 },
      { titulo: 'Posición en el liceo', valor: (f) => f.posicion_liceo, ancho: 10 },
      { titulo: 'Respuesta a la invitación', valor: (f) => RESPUESTA[f.confirmacion] ?? null, ancho: 13 },
      colFecha('Fecha de la respuesta', (f) => f.confirmacion_en),
      { titulo: 'Etapa actual', valor: (f) => f.etapa_actual },
      { titulo: 'Situación', valor: situacion, ancho: 12 },
    ], invitados);

    agregarHoja<Fila>(wb, nombreHoja('Correos postulantes', usados), [
      { titulo: 'Id', valor: (f) => f.codigo, ancho: 9 },
      { titulo: 'Nombre completo', valor: nombreCompleto },
      { titulo: 'Correo', valor: (f) => f.email, ancho: 28 },
      { titulo: 'Teléfono', valor: (f) => f.telefono, ancho: 13 },
      { titulo: 'Establecimiento', valor: (f) => f.liceo },
    ], invitados);

    // "Envíos" (la invitación que se les mandó) junto al formulario con la ficha RSH.
    agregarHoja<Fila>(wb, nombreHoja('Envíos y formulario con RSH', usados), [
      { titulo: 'Id', valor: (f) => f.codigo, ancho: 9 },
      { titulo: 'Nombre completo', valor: nombreCompleto },
      { titulo: 'Establecimiento', valor: (f) => f.liceo },
      { titulo: 'Correo', valor: (f) => f.email, ancho: 28 },
      colFecha('Invitación enviada', (f) => f.invitacion_enviada, true),
      { titulo: 'Estado del envío', valor: (f) => ENTREGA[f.invitacion_entrega] ?? null, ancho: 12 },
      { titulo: 'Respuesta a la invitación', valor: (f) => RESPUESTA[f.confirmacion] ?? null, ancho: 13 },
      colFecha('Fecha de la respuesta', (f) => f.confirmacion_en),
      { titulo: 'Tramo RSH', valor: tramoRsh, ancho: 10 },
      { titulo: 'Personas del hogar (cartola)', valor: (f) => f.personas_hogar, ancho: 12 },
      { titulo: 'Personas del hogar (formulario)', valor: (f) => f.personas_formulario, ancho: 12 },
      { titulo: 'Menores de 18', valor: (f) => f.menores_18, ancho: 9 },
      { titulo: 'Mayores de 60', valor: (f) => f.mayores_60, ancho: 9 },
      { titulo: 'Con discapacidad', valor: (f) => f.con_discapacidad, ancho: 11 },
      { titulo: 'Con dependencia', valor: (f) => f.con_dependencia, ancho: 11 },
      { titulo: 'Con invalidez', valor: (f) => f.con_invalidez, ancho: 9 },
      { titulo: 'Con NEE', valor: (f) => f.con_nee, ancho: 8 },
      { titulo: 'Ingresos del hogar', valor: (f) => f.ingresos_hogar },
      colDia('RSH actualizada', (f) => f.rsh_actualizada),
      { titulo: 'Observaciones de la ficha', valor: (f) => f.ficha_observaciones, ancho: 30 },
    ], invitados);

    // Una fila por liceo que tenga invitados, con su contraparte y cuántos aceptaron.
    const liceos: Fila[] = await this.ds.query(
      `SELECT l.codigo, l.nombre, l.comuna, c.nombre AS contraparte, c.cargo AS contraparte_cargo,
              c.email AS contraparte_email, c.telefono AS contraparte_telefono,
              (SELECT COUNT(*)::int FROM alumnos_nomina a WHERE a.liceo_id = l.id AND a.proceso_id = $1) AS en_nomina,
              COUNT(p.id)::int AS invitados,
              COUNT(*) FILTER (WHERE p.confirmacion = 'CONFIRMADO')::int AS aceptaron,
              COUNT(*) FILTER (WHERE p.confirmacion = 'RECHAZADO')::int AS rechazaron,
              COUNT(*) FILTER (WHERE p.confirmacion = 'PENDIENTE')::int AS sin_respuesta
         FROM liceos l
         JOIN postulaciones p ON p.liceo_id = l.id AND p.proceso_id = $1
         LEFT JOIN LATERAL (
           SELECT nombre, cargo, email, telefono FROM contactos_liceo
            WHERE liceo_id = l.id AND tipo = 'CONTRAPARTE' ORDER BY creado_en LIMIT 1) c ON TRUE
        GROUP BY l.id, c.nombre, c.cargo, c.email, c.telefono
        ORDER BY l.codigo`,
      [procesoId]);
    agregarHoja<Fila>(wb, nombreHoja('Postulantes por liceo', usados), [
      { titulo: 'Cód. liceo', valor: (f) => f.codigo, ancho: 8 },
      { titulo: 'Establecimiento', valor: (f) => f.nombre },
      { titulo: 'Comuna', valor: (f) => f.comuna },
      { titulo: 'Contraparte', valor: (f) => f.contraparte },
      { titulo: 'Cargo', valor: (f) => f.contraparte_cargo },
      { titulo: 'Correo de la contraparte', valor: (f) => f.contraparte_email, ancho: 28 },
      { titulo: 'Teléfono de la contraparte', valor: (f) => f.contraparte_telefono, ancho: 13 },
      { titulo: 'Alumnos en la nómina', valor: (f) => f.en_nomina, ancho: 11 },
      { titulo: 'Invitados', valor: (f) => f.invitados, ancho: 9 },
      { titulo: 'Aceptaron', valor: (f) => f.aceptaron, ancho: 9 },
      { titulo: 'Rechazaron', valor: (f) => f.rechazaron, ancho: 10 },
      { titulo: 'Sin respuesta', valor: (f) => f.sin_respuesta, ancho: 10 },
    ], liceos);
  }
}
