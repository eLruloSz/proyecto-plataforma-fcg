import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { AuditoriaService } from '../common/auditoria.service';
import { normalizar } from '../nominas/parser';
import { filas as filasDe } from '../common/sql';
import { FilaRanking, leerRanking } from './ranking-parser';

/** Campos de la ficha (todos opcionales: se guarda lo que se tenga). */
export interface Ficha {
  tramoRsh?: number | null;
  rshPendiente?: boolean;
  rshActualizada?: string | null;
  personasHogar?: number | null;
  menores18?: number | null;
  mayores60?: number | null;
  conDiscapacidad?: number | null;
  conDependencia?: number | null;
  conInvalidez?: number | null;
  conNee?: number | null;
  ingresosHogar?: string | null;
  personasFormulario?: number | null;
  observaciones?: string | null;
}

const COLUMNAS_FICHA: [keyof Ficha, string][] = [
  ['tramoRsh', 'tramo_rsh'], ['rshPendiente', 'rsh_pendiente'], ['rshActualizada', 'rsh_actualizada'],
  ['personasHogar', 'personas_hogar'], ['menores18', 'menores_18'], ['mayores60', 'mayores_60'],
  ['conDiscapacidad', 'con_discapacidad'], ['conDependencia', 'con_dependencia'], ['conInvalidez', 'con_invalidez'],
  ['conNee', 'con_nee'], ['ingresosHogar', 'ingresos_hogar'], ['personasFormulario', 'personas_formulario'],
  ['observaciones', 'observaciones'],
];

/**
 * Preselección N°1:
 *   - ficha de postulación de cada estudiante (datos de la cartola RSH);
 *   - ranking: el Excel calculado por la fundación, cruzado por el Id;
 *   - marcar pasa / no pasa en la etapa según el ranking.
 */
@Injectable()
export class PreseleccionService {
  constructor(
    private readonly ds: DataSource,
    private readonly proceso: ProcesoActualService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // -------------------------------------------------------------------------
  // Ficha
  // -------------------------------------------------------------------------

  async guardarFicha(postulacionId: string, ficha: Ficha, usuarioId: string) {
    const [p] = await this.ds.query(`SELECT 1 FROM postulaciones WHERE id = $1 AND proceso_id = $2`,
      [postulacionId, await this.proceso.id()]);
    if (!p) throw new NotFoundException('Estudiante no encontrado.');
    const cols = COLUMNAS_FICHA.filter(([k]) => ficha[k] !== undefined);
    const valores = cols.map(([k]) => {
      const v = ficha[k];
      return typeof v === 'string' ? v.trim() || null : v;
    });
    await this.ds.query(
      `INSERT INTO fichas_postulacion (postulacion_id, actualizado_por${cols.map(([, c]) => `, ${c}`).join('')})
       VALUES ($1, $2${cols.map((_, i) => `, $${i + 3}`).join('')})
       ON CONFLICT (postulacion_id) DO UPDATE SET actualizado_por = $2${cols.map(([, c], i) => `, ${c} = $${i + 3}`).join('')}`,
      [postulacionId, usuarioId, ...valores]);
    await this.auditoria.registrar(usuarioId, 'GUARDAR_FICHA', 'postulaciones', postulacionId);
    // to_jsonb deja las fechas como "AAAA-MM-DD" (igual que en la vista de la etapa).
    const [f] = await this.ds.query(
      `SELECT to_jsonb(fi) - 'postulacion_id' - 'actualizado_por' AS ficha FROM fichas_postulacion fi WHERE fi.postulacion_id = $1`,
      [postulacionId]);
    return f.ficha;
  }

  // -------------------------------------------------------------------------
  // Ranking
  // -------------------------------------------------------------------------

  private async leer(file: Express.Multer.File, hoja?: string) {
    if (!file) throw new BadRequestException('Adjunta el Excel del ranking.');
    if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('El archivo debe ser .xlsx.');
    let lectura;
    try { lectura = await leerRanking(file.buffer, hoja); } catch {
      throw new BadRequestException('No se pudo leer el archivo. ¿Es el Excel del ranking?');
    }
    const procesoId = await this.proceso.id();
    const invitados: { id: string; codigo: string; nombres: string; apellido_paterno: string; liceo: string }[] = await this.ds.query(
      `SELECT p.id, p.codigo, pe.nombres, pe.apellido_paterno, l.nombre AS liceo
         FROM postulaciones p JOIN personas pe ON pe.id = p.persona_id JOIN liceos l ON l.id = p.liceo_id
        WHERE p.proceso_id = $1`, [procesoId]);
    const clave = (s: string) => s.toLowerCase().replace(/\s+/g, '');
    const porCodigo = new Map(invitados.map((i) => [clave(i.codigo), i]));

    // Si el archivo no trae "Ranking", se ordena por Puntaje Total (empates comparten lugar).
    if (lectura.filas.length && lectura.filas.every((f) => f.posicion === null)) {
      const orden = [...lectura.filas].sort((a, b) => (b.puntajeTotal ?? -1) - (a.puntajeTotal ?? -1));
      orden.forEach((f, i) => {
        f.posicion = i > 0 && orden[i - 1].puntajeTotal === f.puntajeTotal ? orden[i - 1].posicion : i + 1;
      });
    }

    const vistos = new Set<string>();
    const filas = lectura.filas.map((f) => {
      const inv = f.id ? porCodigo.get(clave(f.id)) : undefined;
      const avisos: string[] = [];
      if (f.id && !inv) avisos.push(`El Id ${f.id} no corresponde a ningún invitado de este proceso.`);
      if (inv && f.apellidoPaterno && !normalizar(f.apellidoPaterno).includes(normalizar(inv.apellido_paterno))
          && !normalizar(inv.apellido_paterno).includes(normalizar(f.apellidoPaterno))) {
        avisos.push(`El Id ${f.id} es de ${inv.nombres} ${inv.apellido_paterno}, pero el Excel dice ${f.nombre ?? ''} ${f.apellidoPaterno}. Revisa el Id.`);
      }
      if (inv && vistos.has(inv.id)) avisos.push(`El Id ${f.id} aparece más de una vez; se usa la primera fila.`);
      const duplicada = !!inv && vistos.has(inv.id);
      if (inv) vistos.add(inv.id);
      return {
        ...f,
        postulacion: inv && !duplicada ? { id: inv.id, codigo: inv.codigo, nombre: `${inv.nombres} ${inv.apellido_paterno}`, liceo: inv.liceo } : null,
        avisos,
      };
    });
    filas.sort((a, b) => (a.posicion ?? Infinity) - (b.posicion ?? Infinity));
    return { ...lectura, filas, procesoId };
  }

  async previsualizar(file: Express.Multer.File, hoja?: string) {
    const { procesoId, ...r } = await this.leer(file, hoja);
    const [anterior] = await this.ds.query(
      `SELECT nombre_archivo, cargado_en FROM cargas WHERE proceso_id = $1 AND tipo = 'RANKING'`, [procesoId]);
    return {
      ...r,
      anterior: anterior ?? null,
      resumen: {
        filas: r.filas.length,
        calzan: r.filas.filter((f) => f.postulacion).length,
        sinCalce: r.filas.filter((f) => !f.postulacion).length,
        finalistas: r.filas.filter((f) => f.finalista).length,
        conAvisos: r.filas.filter((f) => f.avisos.length).length,
      },
    };
  }

  /** Guarda el ranking (reemplaza al anterior). Solo se guardan las filas que calzan con un invitado. */
  async confirmar(file: Express.Multer.File, hoja: string | undefined, usuarioId: string) {
    const { procesoId, filas, advertencias, hoja: hojaUsada } = await this.leer(file, hoja);
    const validas = filas.filter((f) => f.postulacion);
    if (!validas.length) throw new BadRequestException('Ninguna fila del Excel calza con un invitado (revisa la columna "Id.").');
    const avisos = [...advertencias, ...filas.flatMap((f) => f.avisos)];
    await this.ds.transaction(async (em) => {
      await em.query(`DELETE FROM cargas WHERE proceso_id = $1 AND tipo = 'RANKING'`, [procesoId]);
      const [c] = await em.query(
        `INSERT INTO cargas (proceso_id, tipo, nombre_archivo, filas_ok, advertencias, cargado_por)
         VALUES ($1, 'RANKING', $2, $3, $4, $5) RETURNING id`,
        [procesoId, `${file.originalname}${hojaUsada ? ` (${hojaUsada})` : ''}`.slice(0, 255), validas.length,
          JSON.stringify(avisos.map((mensaje) => ({ mensaje }))), usuarioId]);
      for (const f of validas) {
        const { postulacion, avisos: _a, ...datos } = f;
        await em.query(
          `INSERT INTO ranking_postulacion (carga_id, postulacion_id, posicion, puntaje_total, puntaje_academico,
             puntaje_socioeconomico, puntaje_compromiso, finalista, rsh, datos)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [c.id, postulacion!.id, f.posicion, f.puntajeTotal, f.puntajeAcademico, f.puntajeSocioeconomico,
            f.puntajeCompromiso, f.finalista, f.rsh?.slice(0, 20) ?? null, JSON.stringify(datos)]);
      }
      await this.auditoria.registrar(usuarioId, 'CARGAR_RANKING', 'cargas', c.id, { filas: validas.length }, em);
    });
    return this.estado();
  }

  async estado() {
    const [c] = await this.ds.query(
      `SELECT id, nombre_archivo, cargado_en, filas_ok, advertencias FROM cargas WHERE proceso_id = $1 AND tipo = 'RANKING'`,
      [await this.proceso.id()]);
    return { carga: c ?? null };
  }

  async eliminar(usuarioId: string) {
    await this.ds.query(`DELETE FROM cargas WHERE proceso_id = $1 AND tipo = 'RANKING'`, [await this.proceso.id()]);
    await this.auditoria.registrar(usuarioId, 'ELIMINAR_RANKING', 'cargas', null);
    return { carga: null };
  }

  /**
   * Marca "pasa" / "no pasa" en la etapa según el ranking cargado:
   *   finalistas → pasan los marcados como finalistas en el Excel;
   *   primeros   → pasan los `n` primeros lugares (empates incluidos).
   * Solo toca a quienes están en la etapa, tienen ranking y aún no tienen
   * un resultado confirmado. Reemplaza las marcas provisorias que tuvieran.
   */
  async marcarSegunRanking(etapaId: string, criterio: 'finalistas' | 'primeros', n: number | undefined, usuarioId: string) {
    const procesoId = await this.proceso.id();
    const [e] = await this.ds.query(`SELECT 1 FROM etapas WHERE id = $1 AND proceso_id = $2`, [etapaId, procesoId]);
    if (!e) throw new NotFoundException('Etapa no encontrada.');
    if (criterio === 'primeros' && !(n && n > 0)) throw new BadRequestException('Indica cuántos pasan.');
    const { carga } = await this.estado();
    if (!carga) throw new ConflictException('Primero sube el Excel del ranking.');

    const pasa = criterio === 'finalistas' ? 'rp.finalista' : 'rp.posicion <= $4';
    const r = await this.ds.query(
      `INSERT INTO resultados_etapa (postulacion_id, etapa_id, resultado, marcado_por)
       SELECT p.id, $1, CASE WHEN ${pasa} THEN 'PASA' ELSE 'NO_PASA' END, $2
         FROM postulaciones p
         JOIN ranking_postulacion rp ON rp.postulacion_id = p.id AND rp.carga_id = $3
         LEFT JOIN resultados_etapa x ON x.postulacion_id = p.id AND x.etapa_id = $1
        WHERE p.etapa_id = $1 AND NOT COALESCE(x.confirmado, FALSE)
       ON CONFLICT (postulacion_id, etapa_id) DO UPDATE SET resultado = EXCLUDED.resultado, marcado_por = $2, marcado_en = NOW()
       RETURNING resultado`,
      criterio === 'finalistas' ? [etapaId, usuarioId, carga.id] : [etapaId, usuarioId, carga.id, n]);
    const marcas = filasDe(r) as { resultado: string }[];
    const [{ sin_ranking }] = await this.ds.query(
      `SELECT COUNT(*)::int AS sin_ranking FROM postulaciones p
        WHERE p.etapa_id = $1 AND NOT EXISTS (SELECT 1 FROM ranking_postulacion rp WHERE rp.postulacion_id = p.id AND rp.carga_id = $2)`,
      [etapaId, carga.id]);
    await this.auditoria.registrar(usuarioId, 'MARCAR_SEGUN_RANKING', 'etapas', etapaId, { criterio, n });
    return {
      pasan: marcas.filter((m) => m.resultado === 'PASA').length,
      noPasan: marcas.filter((m) => m.resultado === 'NO_PASA').length,
      sinRanking: sin_ranking,
    };
  }
}

export type { FilaRanking };