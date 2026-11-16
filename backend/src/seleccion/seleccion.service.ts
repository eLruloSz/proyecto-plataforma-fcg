import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AvanceService } from '../avance/avance.service';
import { agregarHoja, Columna, crearLibro, nombreArchivo } from '../exportacion/excel-util';
import { ArchivosService } from '../common/archivos.service';
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
export type Decision = 'PASA' | 'NO_PASA' | 'ESPERA';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TEXTO_APRECIACION: Record<Apreciacion, string> = {
  ACEPTARIA: 'Aceptaría', ACEPTARIA_CON_DUDAS: 'Aceptaría con dudas', NO_ACEPTARIA: 'No aceptaría',
};
const etapaCorta = (n: string) => n.replace(/^Preselección.*/i, 'Preselección').replace(/^Selección.*/i, 'Selección');

@Injectable()
export class SeleccionService {
  constructor(
    private readonly ds: DataSource,
    private readonly proceso: ProcesoActualService,
    private readonly auditoria: AuditoriaService,
    private readonly avance: AvanceService,
    private readonly archivos: ArchivosService,
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
              (COALESCE(sx.en_espera, FALSE) AND r.resultado IS NULL) AS en_espera, sx.notas,
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
         LEFT JOIN seleccion_extra sx ON sx.postulacion_id = p.id AND sx.etapa_id = $1
        WHERE p.proceso_id = $3 AND (p.etapa_id = $1 OR (r.confirmado AND r.etapa_id = $1))
        ORDER BY (SELECT rp.posicion FROM ranking_postulacion rp JOIN cargas ca ON ca.id = rp.carga_id
                   WHERE rp.postulacion_id = p.id AND ca.tipo = 'RANKING' AND ca.proceso_id = p.proceso_id
                   ORDER BY ca.cargado_en DESC LIMIT 1) NULLS LAST, p.correlativo`,
      [etapaId, e.orden, await this.proceso.id()]);

    // La lista de espera sigue el ranking (las filas ya vienen ordenadas por él): el primero es el N°1.
    let puesto = 0;
    const candidatos: Fila[] = filas.map((f) => ({
      ...f, sugerencia: this.sugerir(f.entrevistas), puesto_espera: f.en_espera && !f.confirmado ? ++puesto : null,
    }));
    const vivos = candidatos.filter((c) => c.en_esta_etapa && !c.confirmado);
    const becarios = candidatos.filter((c) => c.confirmado && c.resultado === 'PASA').length;
    const marcadosPasa = vivos.filter((c) => c.resultado === 'PASA').length;
    const resumen = {
      cupo: e.cupo as number | null,
      total: candidatos.length,
      becarios_confirmados: becarios,
      marcados_pasa: marcadosPasa,
      marcados_no_pasa: vivos.filter((c) => c.resultado === 'NO_PASA').length,
      en_espera: vivos.filter((c) => !c.resultado && c.en_espera).length,
      sin_decidir: vivos.filter((c) => !c.resultado && !c.en_espera).length,
      // Cupos que quedan si se confirman todas las marcas "pasa".
      cupos_libres: e.cupo === null ? null : e.cupo - becarios - marcadosPasa,
      con_apreciacion: candidatos.filter((c) => c.sugerencia).length,
      sugeridos_pasa: vivos.filter((c) => !c.resultado && !c.en_espera && c.sugerencia?.resultado === 'PASA').length,
      sugeridos_no_pasa: vivos.filter((c) => !c.resultado && !c.en_espera && c.sugerencia?.resultado === 'NO_PASA').length,
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
          AND NOT EXISTS (SELECT 1 FROM seleccion_extra sx WHERE sx.postulacion_id = p.id AND sx.etapa_id = $1 AND sx.en_espera)
       ON CONFLICT (postulacion_id, etapa_id) DO NOTHING
       RETURNING id`,
      [etapaId, usuarioId, e.orden]);
    // Según la versión del driver, RETURNING llega como [filas, n] o como filas.
    const marcados = Array.isArray(r[0]) ? (r[0] as unknown as Fila[]).length : r.length;
    await this.auditoria.registrar(usuarioId, 'SUGERENCIAS_SELECCION', 'etapas', etapaId, { marcados });
    return { marcados };
  }

  // -------------------------------------------------------------------------
  // Decisión con tres opciones, notas del comité, Excel y correo a la dirección
  // -------------------------------------------------------------------------

  /**
   * Seleccionar / No seleccionar usan lo mismo que "Resultados" (marca provisoria, se confirma aparte).
   * "En espera" no es un resultado: quita la marca provisoria y deja la anotación en esta pantalla.
   */
  async decidir(etapaId: string, postulacionId: string, decision: Decision | null, usuarioId: string) {
    await this.etapaFinal(etapaId);
    if (decision === 'ESPERA') {
      await this.avance.marcar(etapaId, postulacionId, null, usuarioId); // falla si ya está confirmado
      await this.ds.query(
        `INSERT INTO seleccion_extra (postulacion_id, etapa_id, en_espera, actualizado_por) VALUES ($1, $2, TRUE, $3)
         ON CONFLICT (postulacion_id, etapa_id) DO UPDATE SET en_espera = TRUE, actualizado_por = $3, actualizado_en = NOW()`,
        [postulacionId, etapaId, usuarioId]);
    } else {
      await this.avance.marcar(etapaId, postulacionId, decision, usuarioId);
      await this.ds.query(
        `UPDATE seleccion_extra SET en_espera = FALSE, actualizado_por = $3, actualizado_en = NOW()
          WHERE postulacion_id = $1 AND etapa_id = $2 AND en_espera`, [postulacionId, etapaId, usuarioId]);
    }
    await this.auditoria.registrar(usuarioId, 'DECISION_SELECCION', 'postulaciones', postulacionId, { etapaId, decision });
    return { ok: true };
  }

  async guardarNotas(etapaId: string, postulacionId: string, notas: string | null, usuarioId: string) {
    await this.etapaFinal(etapaId);
    const [p] = await this.ds.query(`SELECT id FROM postulaciones WHERE id = $1 AND proceso_id = $2`, [postulacionId, await this.proceso.id()]);
    if (!p) throw new NotFoundException('Estudiante no encontrado.');
    const limpia = notas?.trim() || null;
    await this.ds.query(
      `INSERT INTO seleccion_extra (postulacion_id, etapa_id, notas, actualizado_por) VALUES ($1, $2, $3, $4)
       ON CONFLICT (postulacion_id, etapa_id) DO UPDATE SET notas = $3, actualizado_por = $4, actualizado_en = NOW()`,
      [postulacionId, etapaId, limpia, usuarioId]);
    await this.auditoria.registrar(usuarioId, 'NOTAS_COMITE', 'postulaciones', postulacionId, { etapaId });
    return { ok: true };
  }

  /** Excel para la dirección: solo lo importante para decidir (de los puntajes va únicamente la posición del ranking). */
  async excelDireccion(etapaId: string) {
    const v = await this.vista(etapaId);
    const decision = (f: Fila) =>
      f.confirmado ? (f.resultado === 'PASA' ? 'Becario/a' : 'No seleccionado/a')
        : f.resultado === 'PASA' ? 'Seleccionado/a' : f.resultado === 'NO_PASA' ? 'No seleccionado/a'
        : f.en_espera ? `En espera (N°${f.puesto_espera})` : null;
    const tramo = (f: Fila) => (f.ficha?.rsh_pendiente ? 'Pendiente' : f.ficha?.tramo_rsh != null ? `${f.ficha.tramo_rsh}%` : null);
    const observaciones = (f: Fila) => (f.entrevistas as Fila[])
      .filter((e) => e.observaciones).map((e) => `${etapaCorta(e.etapa)}: ${e.observaciones}`).join('\n') || null;
    const cols: Columna<Fila>[] = [
      { titulo: 'Ranking', valor: (f) => f.ranking?.posicion, ancho: 9 },
      { titulo: 'Id', valor: (f) => f.codigo, ancho: 11 },
      { titulo: 'Nombre', valor: (f) => `${f.nombres} ${f.apellido_paterno}${f.apellido_materno ? ' ' + f.apellido_materno : ''}`, ancho: 28 },
      { titulo: 'Liceo', valor: (f) => f.liceo, ancho: 30 },
      { titulo: 'Comuna', valor: (f) => f.comuna },
      { titulo: 'Curso', valor: (f) => f.curso },
      { titulo: 'Promedio', valor: (f) => f.promedio, formato: '0.00' },
      { titulo: 'Posición en el curso', valor: (f) => f.posicion_curso },
      { titulo: 'Tramo RSH', valor: tramo },
      { titulo: 'Personas del hogar', valor: (f) => f.ficha?.personas_hogar ?? f.ficha?.personas_formulario },
      { titulo: 'Apreciación de la entrevista', valor: (f) => (f.sugerencia ? TEXTO_APRECIACION[f.sugerencia.apreciacion as Apreciacion] : null), ancho: 20 },
      { titulo: 'Observaciones de la entrevista', valor: observaciones, ancho: 45 },
      { titulo: 'Decisión', valor: decision, ancho: 18 },
      { titulo: 'Notas del comité', valor: (f) => f.notas, ancho: 40 },
    ];
    const wb = crearLibro();
    agregarHoja(wb, 'Selección final', cols, v.candidatos);
    const hoja = wb.getWorksheet('Selección final');
    hoja?.eachRow((row) => row.eachCell((c) => { c.alignment = { ...c.alignment, vertical: 'top', wrapText: true }; }));
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const r = v.resumen;
    return {
      buffer, nombre: nombreArchivo(`Selección final - ${v.etapa.nombre}.xlsx`),
      resumen: { total: r.total, cupo: r.cupo, asignadas: r.becarios_confirmados + r.marcados_pasa, espera: r.en_espera },
    };
  }

  /**
   * Deja el Excel guardado como archivo para adjuntarlo en un correo desde Comunicación. Es una copia del
   * momento: si después cambia una decisión, se vuelve a generar al tocar «Enviar a los directivos».
   */
  async excelComoAdjunto(etapaId: string) {
    const x = await this.excelDireccion(etapaId);
    const a = await this.archivos.guardar({ originalname: x.nombre, buffer: x.buffer, mimetype: XLSX, size: x.buffer.length } as Express.Multer.File);
    return { id: a.id as string, nombre: a.nombre_original as string };
  }
}
