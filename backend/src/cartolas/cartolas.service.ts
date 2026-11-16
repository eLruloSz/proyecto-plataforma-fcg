import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { AuditoriaService } from '../common/auditoria.service';
import { ProcesoActualService } from '../common/proceso-actual.service';
import { DIAS_MAXIMOS_ANTIGUEDAD, MIN_CARACTERES } from './cartola-formato';
import { DatosFicha, Integrante, leerCartola, rutDelArchivo } from './cartola-parser';
import { buscarIntegrante, emparejar, MotivoCoincidencia, Postulante, prepararPostulante, rutTapado } from './emparejar';
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
  /** Cómo aparece ESTE estudiante en la cartola (solo él: de los demás integrantes nunca sale el nombre). */
  nombreCartola?: string | null;
  rutCartola?: string | null;
  rutCoincide?: boolean | null;
}

/** Resultado de comparar la cartola con un estudiante elegido de antemano. */
export interface Verificacion {
  estado: 'COINCIDE' | 'APROXIMADO' | 'NO_COINCIDE';
  nombreSistema: string;
  nombreCartola: string | null;
  rutCartola: string | null;
  /** true si el RUT cargado calza con el comienzo del RUT de la cartola; null si el estudiante no tiene RUT cargado. */
  rutCoincide: boolean | null;
  motivo: 'NOMBRE_NO_APARECE' | 'RUT_DISTINTO' | null;
}

/** Estudiante al que se le quiere cargar la cartola (pantalla "Cartolas RSH", botón Cargar). */
interface Objetivo { post: Postulante; nombre: string }

export interface ResultadoCartola {
  archivo: string;
  estado: 'OK' | 'REVISAR' | 'ERROR';
  error?: string;
  hash?: string;
  emitidaEn?: string | null;
  ficha?: DatosFicha;
  integrantes?: number;
  avisos: string[];
  /** Solo si se leyó para un estudiante concreto. */
  verificacion?: Verificacion;
  /** Con un estudiante elegido: los OTROS postulantes a quienes parece pertenecer la cartola. Sin elegir: todos los reconocidos. */
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
  async leer(archivos: Express.Multer.File[], postulacionId?: string): Promise<ResultadoCartola[]> {
    const vistos = new Set<string>();
    const salida: ResultadoCartola[] = [];
    const postulantes = archivos?.length ? await this.postulantes() : [];
    const objetivo = postulacionId ? await this.objetivo(postulacionId) : null;
    for (const a of archivos ?? []) salida.push(await this.leerUna(a, vistos, postulantes, objetivo));
    return salida;
  }

  private async objetivo(postulacionId: string): Promise<Objetivo> {
    const [f] = await this.ds.query(
      `SELECT p.id, pe.nombres, pe.apellido_paterno, pe.apellido_materno, pe.rut
         FROM postulaciones p JOIN personas pe ON pe.id = p.persona_id WHERE p.id = $1 AND p.proceso_id = $2`,
      [postulacionId, await this.proceso.id()]);
    if (!f) throw new NotFoundException('Estudiante no encontrado.');
    return { post: prepararPostulante(f), nombre: [f.nombres, f.apellido_paterno, f.apellido_materno].filter(Boolean).join(' ') };
  }

  /** ¿Esta cartola es de este estudiante? Se compara su nombre (y su RUT, si lo tenemos) con los integrantes. */
  private verificar(o: Objetivo, integrantes: Integrante[], rutArchivo: string | null): Verificacion {
    const base = { nombreSistema: o.nombre };
    const dato = (m: { integrante: Integrante } | null) => ({ nombreCartola: m?.integrante.nombre ?? null, rutCartola: rutTapado(m?.integrante.rutParcial) });
    if (rutArchivo && o.post.rut && o.post.rut === rutArchivo) {
      return { ...base, estado: 'COINCIDE', ...dato(buscarIntegrante(o.post, integrantes)), rutCoincide: true, motivo: null };
    }
    const m = buscarIntegrante(o.post, integrantes);
    if (m) return { ...base, estado: m.por === 'NOMBRE' ? 'COINCIDE' : 'APROXIMADO', ...dato(m), rutCoincide: o.post.rut ? true : null, motivo: null };
    if (o.post.rut) {
      // El nombre puede estar, pero con otro RUT (un homónimo): se dice, en vez de "no aparece".
      const sinRut = buscarIntegrante({ ...o.post, rut: null }, integrantes);
      if (sinRut) return { ...base, estado: 'NO_COINCIDE', ...dato(sinRut), rutCoincide: false, motivo: 'RUT_DISTINTO' };
    }
    return { ...base, estado: 'NO_COINCIDE', nombreCartola: null, rutCartola: null, rutCoincide: null, motivo: 'NOMBRE_NO_APARECE' };
  }

  private error(archivo: string, mensaje: string): ResultadoCartola {
    return { archivo, estado: 'ERROR', error: mensaje, avisos: [], coincidencias: [] };
  }

  private async leerUna(a: Express.Multer.File, vistos: Set<string>, postulantes: Postulante[], objetivo: Objetivo | null): Promise<ResultadoCartola> {
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

    const rutArchivo = rutDelArchivo(nombre);
    const porId = new Map(postulantes.map((p) => [p.id, p]));
    const todas = (await this.datosDe(emparejar(c.integrantes, rutArchivo, postulantes), hash)).map((x) => {
      const post = porId.get(x.id);
      const m = post ? buscarIntegrante(post, c.integrantes) : null;
      return { ...x, nombreCartola: m?.integrante.nombre ?? null, rutCartola: rutTapado(m?.integrante.rutParcial), rutCoincide: post?.rut && m ? true : null };
    });

    let coincidencias = todas;
    let verificacion: Verificacion | undefined;
    if (objetivo) {
      // Con un estudiante elegido solo importa si la cartola es de él; de los demás se dice a quién parece pertenecer.
      verificacion = this.verificar(objetivo, c.integrantes, rutArchivo);
      coincidencias = todas.filter((x) => x.id !== objetivo.post.id);
      if (verificacion.estado === 'NO_COINCIDE') {
        avisos.push(verificacion.motivo === 'RUT_DISTINTO'
          ? `El nombre de ${objetivo.nombre} aparece en la cartola, pero su RUT (${verificacion.rutCartola}) no calza con el RUT cargado: puede ser un homónimo.`
          : `El nombre de ${objetivo.nombre} no aparece entre los integrantes de esta cartola. Revisa que sea la de este estudiante.`);
        if (coincidencias.length) avisos.push(`Esta cartola parece ser de: ${coincidencias.map((x) => `${x.nombre} (${x.codigo})`).join(', ')}.`);
      } else if (verificacion.estado === 'APROXIMADO') {
        avisos.push('Se reconoció por un nombre parecido: confirma que es la persona correcta.');
      }
      const [previa] = await this.ds.query(
        `SELECT to_char(leida_en AT TIME ZONE 'America/Santiago', 'DD-MM-YYYY') AS dia FROM cartolas_leidas WHERE postulacion_id = $1 AND hash_sha256 = $2`,
        [objetivo.post.id, hash]);
      if (previa) avisos.push(`Esta cartola ya se cargó para ${objetivo.nombre} el ${previa.dia}.`);
    } else {
      if (!coincidencias.length) {
        avisos.push('No se reconoció a ningún postulante en esta cartola (por nombre ni por RUT). Asígnalo a mano.');
      } else if (coincidencias.length > 1) {
        avisos.push('Hay varios postulantes en este hogar: la misma cartola se aplica a cada uno.');
      }
      for (const x of coincidencias) {
        if (x.por === 'NOMBRE_APROXIMADO') avisos.push(`${x.nombre}: se reconoció por un nombre parecido; confirma que es la persona correcta.`);
      }
      for (const x of coincidencias) if (x.yaCargada) avisos.push(`Esta cartola ya se cargó para ${x.nombre} el ${x.yaCargada}.`);
    }

    return {
      archivo: nombre, estado: avisos.length ? 'REVISAR' : 'OK', hash, emitidaEn: c.emitidaEn, ficha: c.ficha,
      integrantes: c.integrantes.length, avisos, coincidencias, verificacion,
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

  /**
   * Estudiantes de Preselección N°1 (los que están en esa etapa o ya la pasaron) con el estado de su ficha RSH:
   * qué datos tienen, si hay una cartola leída y de cuándo es. Es lo que muestra la pantalla "Cartolas RSH".
   * Si el proceso no tiene una etapa con clave PRESELECCION, se listan todos los postulantes.
   */
  async listado() {
    const procesoId = await this.proceso.id();
    const [etapa] = await this.ds.query(`SELECT id FROM etapas WHERE proceso_id = $1 AND clave = 'PRESELECCION' LIMIT 1`, [procesoId]);
    const filas: any[] = await this.ds.query(
      `SELECT p.id, p.codigo, pe.nombres, pe.apellido_paterno, pe.apellido_materno,
              l.id AS liceo_id, l.codigo AS liceo_codigo, l.nombre AS liceo,
              (SELECT to_jsonb(fi) - 'postulacion_id' - 'actualizado_por' FROM fichas_postulacion fi WHERE fi.postulacion_id = p.id) AS ficha,
              (SELECT rp.posicion FROM ranking_postulacion rp JOIN cargas ca ON ca.id = rp.carga_id
                WHERE rp.postulacion_id = p.id AND ca.tipo = 'RANKING' AND ca.proceso_id = p.proceso_id
                ORDER BY ca.cargado_en DESC LIMIT 1) AS ranking,
              (SELECT jsonb_build_object('emitida_en', to_char(cl.emitida_en, 'YYYY-MM-DD'), 'leida_en', cl.leida_en,
                        'cantidad', (SELECT COUNT(*) FROM cartolas_leidas x WHERE x.postulacion_id = p.id))
                 FROM cartolas_leidas cl WHERE cl.postulacion_id = p.id ORDER BY cl.leida_en DESC LIMIT 1) AS cartola
         FROM postulaciones p
         JOIN personas pe ON pe.id = p.persona_id
         JOIN liceos l ON l.id = p.liceo_id
         LEFT JOIN resultados_etapa r ON r.postulacion_id = p.id AND r.etapa_id = $2::uuid
        WHERE p.proceso_id = $1 AND ($2::uuid IS NULL OR p.etapa_id = $2::uuid OR (r.confirmado AND r.etapa_id = $2::uuid))
        ORDER BY p.correlativo`,
      [procesoId, etapa?.id ?? null]);
    return { diasMaximos: DIAS_MAXIMOS_ANTIGUEDAD, estudiantes: filas };
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

