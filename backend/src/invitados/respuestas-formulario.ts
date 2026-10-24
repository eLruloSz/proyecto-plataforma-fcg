import * as ExcelJS from 'exceljs';
import { normalizar, valorCelda } from '../nominas/parser';
import { normalizarRut } from '../common/rut';

/**
 * Lectura del Excel de respuestas de Microsoft Forms (o cualquier planilla
 * con una fila de encabezados y una respuesta por fila).
 *
 * Microsoft Forms agrega columnas propias al exportar: "Id", "Hora de inicio",
 * "Hora de finalización", "Correo electrónico" y "Nombre". Esas dos últimas son
 * la cuenta de quien respondió ("anonymous" si no inició sesión), NO las
 * respuestas del estudiante; por eso las columnas se eligen mirando también
 * los valores, y se pueden corregir a mano desde la pantalla.
 */

export type Campo = 'nombre' | 'apellido1' | 'apellido2' | 'rut' | 'liceo' | 'email' | 'telefono';
export const CAMPOS: Campo[] = ['nombre', 'apellido1', 'apellido2', 'rut', 'liceo', 'email', 'telefono'];
export type Mapeo = Partial<Record<Campo, number | null>>;

export interface RespuestaLeida {
  fila: number;
  nombre: string | null;
  rut: string | null;
  liceo: string | null;
  email: string | null;
  telefono: string | null;
}

export interface LecturaRespuestas {
  hoja: string;
  columnas: { indice: number; titulo: string; ejemplo: string | null }[];
  mapeo: Mapeo;
  respuestas: RespuestaLeida[];
}

/** Columnas que Microsoft Forms agrega solo (no son preguntas del formulario). */
const COLUMNAS_DE_FORMS = new Set([
  'id', 'hora de inicio', 'hora de finalizacion', 'hora de la ultima modificacion', 'correo electronico', 'nombre',
  'start time', 'completion time', 'last modified time', 'email', 'name',
]);

const pareceEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const digitos = (s: string) => s.replace(/\D/g, '');

/** Lee el archivo. Si `mapeo` viene, se usa tal cual; si no, se detectan las columnas. */
export async function leerRespuestas(buffer: Buffer, mapeo?: Mapeo): Promise<LecturaRespuestas> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  // La primera hoja con datos (Forms exporta una sola).
  const ws = wb.worksheets.find((w) => w.actualRowCount > 1) ?? wb.worksheets[0];
  if (!ws) return { hoja: '', columnas: [], mapeo: {}, respuestas: [] };

  const texto = (c: ExcelJS.Cell | undefined) => {
    const v = valorCelda(c);
    if (v === null) return null;
    const t = String(v).replace(/\s+/g, ' ').trim();
    return t === '' ? null : t;
  };

  const encabezado = ws.getRow(1);
  const columnas: LecturaRespuestas['columnas'] = [];
  encabezado.eachCell({ includeEmpty: false }, (cell, col) => {
    const titulo = texto(cell);
    if (!titulo) return;
    let ejemplo: string | null = null;
    for (let r = 2; r <= Math.min(ws.rowCount, 30) && !ejemplo; r++) ejemplo = texto(ws.getRow(r).getCell(col));
    columnas.push({ indice: col, titulo, ejemplo });
  });

  // Valores de cada columna (para decidir por contenido, no solo por título).
  const valores = new Map<number, string[]>();
  for (const c of columnas) {
    const vs: string[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const t = texto(ws.getRow(r).getCell(c.indice));
      if (t) vs.push(t);
    }
    valores.set(c.indice, vs);
  }

  const m = mapeo ?? detectarColumnas(columnas, valores);

  const respuestas: RespuestaLeida[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const leer = (campo: Campo) => (m[campo] ? texto(row.getCell(m[campo]!)) : null);
    const partes = [leer('nombre'), leer('apellido1'), leer('apellido2')].filter(Boolean);
    const fila: RespuestaLeida = {
      fila: r,
      nombre: partes.length ? partes.join(' ') : null,
      rut: leer('rut'),
      liceo: leer('liceo'),
      email: leer('email'),
      telefono: leer('telefono'),
    };
    if (fila.nombre || fila.rut || fila.email || fila.telefono) respuestas.push(fila);
  }
  return { hoja: ws.name, columnas, mapeo: m, respuestas };
}

/**
 * Elige la columna de cada dato. Para cada campo se puntúan las columnas por
 * título y por contenido; las columnas propias de Forms se usan solo si no hay
 * otra mejor.
 */
export function detectarColumnas(
  columnas: { indice: number; titulo: string }[],
  valores: Map<number, string[]>,
): Mapeo {
  const proporcion = (col: number, prueba: (v: string) => boolean) => {
    const vs = valores.get(col) ?? [];
    return vs.length ? vs.filter(prueba).length / vs.length : 0;
  };
  const usadas = new Set<number>();
  const elegir = (puntaje: (c: { indice: number; titulo: string; t: string }) => number): number | null => {
    let mejor: number | null = null;
    let max = 0;
    for (const c of columnas) {
      if (usadas.has(c.indice)) continue;
      const t = normalizar(c.titulo);
      let p = puntaje({ ...c, t });
      if (p > 0 && COLUMNAS_DE_FORMS.has(t)) p -= 2; // la de Forms pierde contra una pregunta real
      if (p > max) { max = p; mejor = c.indice; }
    }
    if (mejor !== null) usadas.add(mejor);
    return mejor;
  };
  const tiene = (t: string, ...palabras: string[]) => palabras.some((p) => t.includes(p));

  const mapeo: Mapeo = {};
  mapeo.email = elegir(({ indice, t }) =>
    (tiene(t, 'correo', 'mail') ? 2 : 0) + 4 * proporcion(indice, (v) => pareceEmail(v)));
  mapeo.rut = elegir(({ indice, t }) =>
    (/\b(rut|run)\b/.test(t) ? 3 : 0) + 3 * proporcion(indice, (v) => !!normalizarRut(v)));
  mapeo.telefono = elegir(({ indice, t }) => {
    if (tiene(t, 'correo', 'mail', 'rut')) return 0;
    const porTitulo = tiene(t, 'telefono', 'celular', 'fono', 'whatsapp', 'movil') ? 3 : tiene(t, 'numero', 'contacto') ? 1 : 0;
    const porValor = proporcion(indice, (v) => { const d = digitos(v); return d.length >= 8 && d.length <= 12 && !/[a-z@]/i.test(v); });
    return porTitulo ? porTitulo + 2 * porValor : 0;
  });
  mapeo.liceo = elegir(({ t }) => (tiene(t, 'liceo', 'colegio', 'establecimiento', 'escuela', 'institucion') ? 3 : 0));

  // Nombre: una columna "nombre completo", o nombres + apellidos por separado.
  const apP = columnas.find((c) => /apellido.*(paterno|1)|primer apellido/.test(normalizar(c.titulo)));
  const apM = columnas.find((c) => /apellido.*(materno|2)|segundo apellido/.test(normalizar(c.titulo)));
  if (apP) { mapeo.apellido1 = apP.indice; usadas.add(apP.indice); }
  if (apM) { mapeo.apellido2 = apM.indice; usadas.add(apM.indice); }
  const conDosPalabras = (v: string) => v.trim().split(/\s+/).length >= (apP ? 1 : 2) && !/anonymous|anonimo/i.test(v);
  mapeo.nombre = elegir(({ indice, t }) => {
    if (!tiene(t, 'nombre')) return 0;
    return 1 + (tiene(t, 'completo', 'estudiante', 'alumno') ? 2 : 0) + 2 * proporcion(indice, conDosPalabras);
  });
  for (const c of CAMPOS) if (mapeo[c] === undefined) mapeo[c] = null;
  return mapeo;
}

// ---------------------------------------------------------------------------
// Limpieza de los datos de contacto
// ---------------------------------------------------------------------------

/** Errores de tipeo frecuentes en el dominio del correo. */
const DOMINIOS_MAL_ESCRITOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.cl': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.comm': 'gmail.com', 'gmaill.com': 'gmail.com',
  'gmai.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gimail.com': 'gmail.com', 'g.mail.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'hotmai.com': 'hotmail.com', 'homail.com': 'hotmail.com', 'hotmil.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outllok.com': 'outlook.com', 'outlook.con': 'outlook.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'icloud.co': 'icloud.com', 'iclould.com': 'icloud.com',
};

export function limpiarEmail(entrada: string | null): { email: string | null; error?: string; sugerencia?: string } {
  if (!entrada) return { email: null };
  const e = entrada.replace(/\s+/g, '').replace(/^mailto:/i, '').toLowerCase();
  if (!pareceEmail(e)) return { email: null, error: `"${entrada}" no parece un email` };
  const dominio = e.split('@')[1];
  const correcto = DOMINIOS_MAL_ESCRITOS[dominio];
  return correcto ? { email: e, sugerencia: `${e.split('@')[0]}@${correcto}` } : { email: e };
}

/** Celulares chilenos a "+569XXXXXXXX"; lo demás se deja como venía, con aviso. */
export function limpiarTelefono(entrada: string | null): { telefono: string | null; aviso?: string } {
  if (!entrada) return { telefono: null };
  const d = digitos(entrada);
  if (d.length === 11 && d.startsWith('569')) return { telefono: `+${d}` };
  if (d.length === 9 && d.startsWith('9')) return { telefono: `+56${d}` };
  if (d.length === 8) return { telefono: `+569${d}` };
  if (d.length === 11 && d.startsWith('56')) return { telefono: `+${d}` }; // fijo con código de país
  return { telefono: entrada.trim().slice(0, 60), aviso: `el teléfono "${entrada}" no tiene el formato de un celular chileno` };
}

// ---------------------------------------------------------------------------
// Comparación de nombres
// ---------------------------------------------------------------------------

/** Palabras de un nombre: sin tildes, sin apodos entre paréntesis ni conectores. */
export function palabrasNombre(s: string | null | undefined): string[] {
  if (!s) return [];
  return normalizar(s.replace(/\(.*?\)/g, ' '))
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !['de', 'del', 'la', 'las', 'los', 'y'].includes(w));
}

/** ¿Dos palabras son la misma, admitiendo un error de tipeo en las largas? (González / Gonzales) */
export function mismaPalabra(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  // Distancia de edición ≤ 1
  let i = 0;
  let j = 0;
  let difs = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++difs > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return difs + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Puntaje de parecido entre lo que escribió el estudiante y un invitado.
 * 0 = no es. Se exige el apellido paterno y al menos un nombre.
 */
export function puntajeNombre(respuesta: string[], inv: { nombres: string; apellido_paterno: string; apellido_materno: string | null }): number {
  const esta = (w: string) => respuesta.some((r) => mismaPalabra(r, w));
  const apP = palabrasNombre(inv.apellido_paterno);
  const apM = palabrasNombre(inv.apellido_materno);
  const nombres = palabrasNombre(inv.nombres);
  if (!apP.length || !apP.every(esta)) return 0;
  const nombresQueEstan = nombres.filter(esta).length;
  if (!nombresQueEstan) return 0;
  let p = 3 + nombresQueEstan;
  if (apM.length && apM.every(esta)) p += 2;
  return p;
}