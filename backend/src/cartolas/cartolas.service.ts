import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { AuditoriaService } from '../common/auditoria.service';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { DIAS_MAXIMOS_ANTIGUEDAD, MIN_CARACTERES } from './cartola-formato';
import { DatosFicha, leerCartola, rutDelArchivo } from './cartola-parser';
import { emparejar, MotivoCoincidencia, Postulante, prepararPostulante } from './emparejar';
import { extraerTexto, PdfIlegibleError } from './lector-pdf';

/**
 * Lectura de cartolas RSH (PDF) para llenar la ficha de postulación.
 *
 * Lo importante de este módulo es lo que NO hace:
 *   - No guarda el PDF (ni en disco ni en la base): se lee en memoria y se descarta.
 *   - No devuelve ni guarda los nombres ni los RUT de los demás integrantes del hogar: los nombres se usan en
 *     memoria solo para reconocer al estudiante (el RUT de la cartola viene tapado, "4.553.XXX-X").
 *   - No escribe la ficha: solo la LEE. Quien confirma la guarda con el endpoint de siempre
 *     (PUT /postulaciones/:id/ficha), con sus validaciones. Aquí solo queda un registro de la lectura
 *     (huella del archivo + fecha de emisión) para no cargar dos veces la misma cartola.
 */

export interface Coincidencia {
  id: string; codigo: string; nombre: string; liceo: string;
  /** Cómo se reconoció: RUT del nombre del archivo, nombre completo, o nombre aproximado (hay que confirmar). */
  por?: MotivoCoincidencia;
  fichaActual: Record<string, unknown> | null;
  /** Si esa misma cartola (el mismo archivo) ya se cargó para este estudiante. */
  yaCargada: string | null;
}

export interface ResultadoCartola {
  archivo: string;
  estado: 'OK' | 'REVISAR' | 'ERROR';
  error?: string;
  hash?: string;
  emitidaEn?: string | null;
  ficha?: DatosFicha;
  integrantes?: number;
  avisos: string[];
  coincidencias: Coincidencia[];
}

const MS_DIA = 24 * 3600 * 1000;


@Injectable()
export class CartolasService {
  private readonly log = new Logger(CartolasService.name);

  constructor(
    private readonly ds: DataSource,
    private readonly proceso: ProcesoActualService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Lee cada PDF (uno tras otro: es lo que menos memoria usa). Un archivo malo no frena a los demás. */
  async leer(archivos: Express.Multer.File[]): Promise<ResultadoCartola[]> {
    const vistos = new Set<string>();
    const salida: ResultadoCartola[] = [];
    const postulantes = archivos?.length ? await this.postulantes() : [];
    for (const a of archivos ?? []) salida.push(await this.leerUna(a, vistos, postulantes));
    return salida;
  }

  private error(archivo: string, mensaje: string): ResultadoCartola {
    return { archivo, estado: 'ERROR', error: mensaje, avisos: [], coincidencias: [] };
  }

  private async leerUna(a: Express.Multer.File, vistos: Set<string>, postulantes: Postulante[]): Promise<ResultadoCartola> {
    const nombre = a.originalname;
    if (!/\.pdf$/i.test(nombre) || a.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return this.error(nombre, 'No es un PDF. Sube la Cartola Hogar tal como se descarga del RSH.');
    }
    const hash = createHash('sha256').update(a.buffer).digest('hex');

    let texto: string;
    try {
      texto = await extraerTexto(a.buffer);
    } catch (e) {
      if (!(e instanceof PdfIlegibleError)) this.log.warn(`No se pudo leer un PDF: ${(e as Error).message}`); // sin el contenido
      return this.error(nombre, (e as Error).message);
    }
    if (texto.trim().length < MIN_CARACTERES) {
      return this.error(nombre, 'El PDF no trae texto (¿es una foto o un escaneo?). Digita la ficha a mano.');
    }
    const c = leerCartola(texto);
    if (!c.esCartola) return this.error(nombre, 'No parece una Cartola Hogar del Registro Social de Hogares.');

    const avisos = [...c.avisos];
    if (vistos.has(hash)) avisos.push('Este mismo archivo ya viene más arriba en esta carga.');
    vistos.add(hash);
    if (c.emitidaEn) {
      const dias = Math.floor((Date.now() - new Date(c.emitidaEn + 'T00:00:00Z').getTime()) / MS_DIA);
      if (dias > DIAS_MAXIMOS_ANTIGUEDAD) avisos.push(`Cartola emitida hace ${dias} días: conviene pedir una más reciente.`);
    } else avisos.push('No se encontró la fecha de emisión de la cartola.');

    const coincidencias = await this.datosDe(emparejar(c.integrantes, rutDelArchivo(nombre), postulantes), hash);
    if (!coincidencias.length) {
      avisos.push('No se reconoció a ningún postulante en esta cartola (por nombre ni por RUT). Asígnalo a mano.');
    } else if (coincidencias.length > 1) {
      avisos.push('Hay varios postulantes en este hogar: la misma cartola se aplica a cada uno.');
    }
    for (const x of coincidencias) {
      if (x.por === 'NOMBRE_APROXIMADO') avisos.push(`${x.nombre}: se reconoció por un nombre parecido; confirma que es la persona correcta.`);
    }
    for (const x of coincidencias) if (x.yaCargada) avisos.push(`Esta cartola ya se cargó para ${x.nombre} el ${x.yaCargada}.`);

    return {
      archivo: nombre, estado: avisos.length ? 'REVISAR' : 'OK', hash, emitidaEn: c.emitidaEn, ficha: c.ficha,
      integrantes: c.integrantes.length, avisos, coincidencias,
    };
  }

  /** Postulantes del proceso, una sola vez por envío (para reconocerlos en cada cartola). */
  private async postulantes(): Promise<Postulante[]> {
    const filas: any[] = await this.ds.query(
      `SELECT p.id, pe.nombres, pe.apellido_paterno, pe.apellido_materno, pe.rut
         FROM postulaciones p JOIN personas pe ON pe.id = p.persona_id WHERE p.proceso_id = $1`,
      [await this.proceso.id()]);
    return filas.map(prepararPostulante);
  }

  /** Datos de los postulantes reconocidos: nombre, liceo, ficha actual y si esta misma cartola ya se cargó. */
  private async datosDe(hallados: { id: string; por: MotivoCoincidencia }[], hash: string): Promise<Coincidencia[]> {
    if (!hallados.length) return [];
    const filas: any[] = await this.ds.query(
      `SELECT p.id, p.codigo, pe.nombres, pe.apellido_paterno, pe.apellido_materno, l.nombre AS liceo,
              (SELECT to_jsonb(fi) - 'postulacion_id' - 'actualizado_por' FROM fichas_postulacion fi WHERE fi.postulacion_id = p.id) AS ficha_actual,
              (SELECT to_char(cl.leida_en AT TIME ZONE 'America/Santiago', 'DD-MM-YYYY') FROM cartolas_leidas cl
                WHERE cl.postulacion_id = p.id AND cl.hash_sha256 = $2) AS ya_cargada
         FROM postulaciones p
         JOIN personas pe ON pe.id = p.persona_id
         JOIN liceos l ON l.id = p.liceo_id
        WHERE p.id = ANY($1)
        ORDER BY p.correlativo`,
      [hallados.map((h) => h.id), hash]);
    const por = new Map(hallados.map((h) => [h.id, h.por]));
    return filas.map((f) => ({
      id: f.id, codigo: f.codigo, liceo: f.liceo, fichaActual: f.ficha_actual, yaCargada: f.ya_cargada, por: por.get(f.id),
      nombre: [f.nombres, f.apellido_paterno, f.apellido_materno].filter(Boolean).join(' '),
    }));
  }

  /** Búsqueda para asignar a mano una cartola cuyo RUT no se reconoció. */
  async estudiantes(q: string | undefined) {
    const texto = (q ?? '').trim();
    if (texto.length < 2) return [];
    const patron = `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const filas: any[] = await this.ds.query(
      `SELECT p.id, p.codigo, pe.nombres, pe.apellido_paterno, pe.apellido_materno, l.nombre AS liceo,
              (SELECT to_jsonb(fi) - 'postulacion_id' - 'actualizado_por' FROM fichas_postulacion fi WHERE fi.postulacion_id = p.id) AS ficha_actual
         FROM postulaciones p JOIN personas pe ON pe.id = p.persona_id JOIN liceos l ON l.id = p.liceo_id
        WHERE p.proceso_id = $1
          AND (p.codigo ILIKE $2 OR (pe.nombres || ' ' || pe.apellido_paterno || ' ' || COALESCE(pe.apellido_materno, '')) ILIKE $2)
        ORDER BY pe.apellido_paterno, pe.nombres LIMIT 15`,
      [await this.proceso.id(), patron]);
    return filas.map((f) => ({
      id: f.id, codigo: f.codigo, liceo: f.liceo, fichaActual: f.ficha_actual, yaCargada: null,
      nombre: [f.nombres, f.apellido_paterno, f.apellido_materno].filter(Boolean).join(' '),
    }));
  }

  /**
   * Deja constancia de que la cartola se cargó (después de guardar la ficha): huella del archivo y fecha de
   * emisión. Con eso se detecta la misma cartola subida dos veces. NO queda nada del contenido del PDF.
   */
  async registrar(postulacionId: string, hash: string, emitidaEn: string | null | undefined, usuarioId: string) {
    const [p] = await this.ds.query(`SELECT 1 FROM postulaciones WHERE id = $1 AND proceso_id = $2`, [postulacionId, await this.proceso.id()]);
    if (!p) throw new NotFoundException('Estudiante no encontrado.');
    await this.ds.query(
      `INSERT INTO cartolas_leidas (postulacion_id, hash_sha256, emitida_en, leida_por) VALUES ($1, $2, $3, $4)
       ON CONFLICT (postulacion_id, hash_sha256) DO NOTHING`,
      [postulacionId, hash, emitidaEn ?? null, usuarioId]);
    await this.auditoria.registrar(usuarioId, 'CARGAR_CARTOLA_RSH', 'postulaciones', postulacionId, { huella: hash.slice(0, 12), emitidaEn: emitidaEn ?? null });
    return { ok: true };
  }
}

