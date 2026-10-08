import * as ExcelJS from 'exceljs';

/**
 * Lector de la plantilla "Formato envío notas Liceos".
 *
 * Estructura esperada (una hoja por curso):
 *   - Encabezado con "Nombre Liceo:", "Curso:" y "Especialidad:" (etiqueta y valor
 *     en celdas separadas).
 *   - Una fila de títulos con: N°, Apellido Paterno, Apellido Materno, Nombres,
 *     Promedio Final 1°medio, Promedio Final 2°Medio.
 *   - Debajo, un alumno por fila. Las filas que solo traen el N° (la plantilla
 *     viene prenumerada) se ignoran.
 *
 * Los liceos modifican la plantilla (cambian títulos, agregan hojas, escriben
 * las notas como "6,5" o "65"), así que la lectura busca las columnas por su
 * título en vez de por posición fija, y distingue:
 *   - errores: filas que no se pueden usar (quedan fuera de la carga)
 *   - advertencias: filas que se cargan, pero conviene revisar
 */

export interface AlumnoLeido {
  hoja: string;
  fila: number;
  curso: string;
  cursoOriginal: string;
  especialidad: string | null;
  nLista: number | null;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  nombres: string;
  promedio1m: number | null;
  promedio2m: number | null;
  promedio: number;
  posicionCurso: number;
}

export interface Observacion {
  hoja?: string;
  fila?: number;
  mensaje: string;
}

export interface CursoLeido {
  curso: string;
  cursoOriginal: string;
  especialidad: string | null;
  hoja: string;
  alumnos: number;
}

export interface ResultadoLectura {
  liceoEnArchivo: string | null;
  cursos: CursoLeido[];
  alumnos: AlumnoLeido[];
  errores: Observacion[];
  advertencias: Observacion[];
}

const MAX_FILAS = 5000;
const FILAS_VACIAS_PARA_CORTAR = 30;

/** Minúsculas, sin tildes, espacios simples. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/º/g, '°')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Valor "plano" de una celda de ExcelJS (texto enriquecido, fórmulas, hipervínculos...). */
export function valorCelda(cell: ExcelJS.Cell | undefined): string | number | null {
  if (!cell) return null;
  const v: any = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'boolean') return null;
  if (v instanceof Date) return null;
  if (typeof v === 'object') {
    if ('result' in v) return v.result === undefined || v.result === null || typeof v.result === 'object' ? null : v.result;
    if ('richText' in v) {
      const t = v.richText.map((r: { text: string }) => r.text).join('').trim();
      return t === '' ? null : t;
    }
    if ('text' in v) return String(v.text).trim() || null;
    if ('error' in v) return null;
  }
  return null;
}

function texto(cell: ExcelJS.Cell | undefined): string | null {
  const v = valorCelda(cell);
  if (v === null) return null;
  const t = String(v).replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

/** "3° año A" → "3°A";  "3° C" → "3°C";  "Curso 3°B" → "3°B". */
export function normalizarCurso(original: string): string | null {
  const t = normalizar(original).toUpperCase();
  const m = t.match(/(\d)\s*°?\s*(?:ANO|MEDIO)?\s*°?\s*([A-Z])\b/);
  return m ? `${m[1]}°${m[2]}` : null;
}

/**
 * Convierte una nota a número entre 1.0 y 7.0.
 * Acepta 6.5, "6,5", "6.5" y también 65 (sin coma), avisando la conversión.
 */
export function leerNota(v: string | number | null): { nota: number | null; aviso?: string; error?: string } {
  if (v === null) return { nota: null };
  let n: number;
  if (typeof v === 'number') n = v;
  else {
    const limpio = v.replace(',', '.').replace(/[^\d.]/g, '');
    if (limpio === '' || isNaN(Number(limpio))) return { nota: null, error: `"${v}" no es una nota válida` };
    n = Number(limpio);
  }
  if (n >= 1 && n <= 7) return { nota: Math.round(n * 100) / 100 };
  if (n >= 10 && n <= 70) {
    const conv = Math.round(n) / 10;
    return { nota: conv, aviso: `nota ${v} interpretada como ${conv.toFixed(1)}` };
  }
  return { nota: null, error: `la nota ${v} está fuera del rango 1,0 – 7,0` };
}

interface Columnas {
  n?: number;
  apP?: number;
  apM?: number;
  nombres?: number;
  p1?: number;
  p2?: number;
}

function detectarColumnas(row: ExcelJS.Row): Columnas | null {
  const c: Columnas = {};
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const raw = texto(cell);
    if (!raw) return;
    const t = normalizar(raw);
    if (t.includes('apellido') && t.includes('paterno')) c.apP = col;
    else if (t.includes('apellido') && t.includes('materno')) c.apM = col;
    else if (t.startsWith('nombre') && !t.includes('apellido') && !t.includes('liceo')) c.nombres = col;
    else if (t.includes('promedio') || t.includes('nota')) {
      if (/2|segund/.test(t) && !/\b1\b|1°|primer/.test(t)) c.p2 = col;
      else if (/1|primer/.test(t)) c.p1 = col;
    } else if (/^(n°|n|no|nro|numero|n° lista)$/.test(t)) c.n = col;
  });
  return c.apP && c.nombres && (c.p1 || c.p2) ? c : null;
}

/** Busca una etiqueta ("Curso:") en las primeras filas y devuelve el valor a su derecha. */
function buscarEtiqueta(ws: ExcelJS.Worksheet, hastaFila: number, etiqueta: string): string | null {
  for (let r = 1; r < hastaFila; r++) {
    const row = ws.getRow(r);
    for (let col = 1; col <= Math.min(ws.columnCount || 10, 20); col++) {
      const raw = texto(row.getCell(col));
      if (!raw) continue;
      const t = normalizar(raw);
      if (!t.startsWith(etiqueta)) continue;
      // "Curso: 3°A" en la misma celda
      const resto = raw.split(':').slice(1).join(':').trim();
      if (resto) return resto;
      // Valor en las celdas siguientes (saltando las combinadas con la etiqueta)
      for (let c2 = col + 1; c2 <= col + 10; c2++) {
        const cell = row.getCell(c2);
        if (cell.isMerged && cell.master.address === row.getCell(col).master.address) continue;
        const v = texto(cell);
        if (v) return v;
      }
      return null;
    }
  }
  return null;
}

export async function leerNomina(buffer: Buffer): Promise<ResultadoLectura> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as any);
  } catch {
    return {
      liceoEnArchivo: null,
      cursos: [],
      alumnos: [],
      errores: [{ mensaje: 'No se pudo leer el archivo. Debe ser un Excel .xlsx (si es .xls antiguo, ábrelo y guárdalo como .xlsx).' }],
      advertencias: [],
    };
  }

  const errores: Observacion[] = [];
  const advertencias: Observacion[] = [];
  const alumnos: Omit<AlumnoLeido, 'promedio' | 'posicionCurso'>[] = [];
  const cursos = new Map<string, CursoLeido>();
  let liceoEnArchivo: string | null = null;

  for (const ws of wb.worksheets) {
    if (ws.state !== 'visible') continue;
    const hoja = ws.name;

    // 1. Fila de títulos
    let filaTitulos = 0;
    let cols: Columnas | null = null;
    for (let r = 1; r <= Math.min(ws.rowCount, 30); r++) {
      cols = detectarColumnas(ws.getRow(r));
      if (cols) { filaTitulos = r; break; }
    }
    if (!cols) {
      if (ws.actualRowCount > 0) {
        advertencias.push({ hoja, mensaje: 'No tiene la tabla de alumnos (no se encontró la fila con "Apellido Paterno", "Nombres" y los promedios). Se omitió.' });
      }
      continue;
    }

    // 2. Encabezado de la hoja
    liceoEnArchivo ??= buscarEtiqueta(ws, filaTitulos, 'nombre liceo');
    const cursoEtiqueta = buscarEtiqueta(ws, filaTitulos, 'curso');
    const cursoOriginal = cursoEtiqueta ?? hoja;
    let curso = normalizarCurso(cursoOriginal) ?? normalizarCurso(hoja);
    if (!curso) {
      curso = cursoOriginal.slice(0, 10);
      advertencias.push({ hoja, mensaje: `No se reconoció el curso "${cursoOriginal}". Se usará "${curso}".` });
    }
    const especialidad = buscarEtiqueta(ws, filaTitulos, 'especialidad');

    // 3. Alumnos
    let vacias = 0;
    let enHoja = 0;
    for (let r = filaTitulos + 1; r <= ws.rowCount && alumnos.length < MAX_FILAS; r++) {
      const row = ws.getRow(r);
      const apP = cols.apP ? texto(row.getCell(cols.apP)) : null;
      const apM = cols.apM ? texto(row.getCell(cols.apM)) : null;
      const nom = cols.nombres ? texto(row.getCell(cols.nombres)) : null;
      const v1 = cols.p1 ? valorCelda(row.getCell(cols.p1)) : null;
      const v2 = cols.p2 ? valorCelda(row.getCell(cols.p2)) : null;

      if (!apP && !apM && !nom) {
        if (v1 !== null || v2 !== null) errores.push({ hoja, fila: r, mensaje: 'Tiene notas pero no tiene nombre.' });
        if (++vacias >= FILAS_VACIAS_PARA_CORTAR) break;
        continue;
      }
      vacias = 0;
      const quien = [nom, apP, apM].filter(Boolean).join(' ');

      if (!apP || !nom) {
        errores.push({ hoja, fila: r, mensaje: `${quien}: falta ${!apP ? 'el apellido paterno' : 'el nombre'}.` });
        continue;
      }
      const n1 = leerNota(v1);
      const n2 = leerNota(v2);
      if (n1.error || n2.error) {
        errores.push({ hoja, fila: r, mensaje: `${quien}: ${[n1.error, n2.error].filter(Boolean).join('; ')}.` });
        continue;
      }
      if (n1.nota === null && n2.nota === null) {
        errores.push({ hoja, fila: r, mensaje: `${quien}: no tiene promedios.` });
        continue;
      }
      for (const aviso of [n1.aviso, n2.aviso].filter(Boolean)) {
        advertencias.push({ hoja, fila: r, mensaje: `${quien}: ${aviso}.` });
      }
      if (n1.nota === null || n2.nota === null) {
        advertencias.push({
          hoja, fila: r,
          mensaje: `${quien}: falta el promedio de ${n1.nota === null ? '1°' : '2°'} medio; se usa solo el otro.`,
        });
      }
      const nRaw = cols.n ? valorCelda(row.getCell(cols.n)) : null;
      alumnos.push({
        hoja, fila: r, curso, cursoOriginal, especialidad,
        nLista: typeof nRaw === 'number' ? nRaw : null,
        apellidoPaterno: apP, apellidoMaterno: apM, nombres: nom,
        promedio1m: n1.nota, promedio2m: n2.nota,
      });
      enHoja++;
    }

    if (enHoja === 0) {
      advertencias.push({ hoja, mensaje: `La hoja del curso ${curso} no tiene alumnos.` });
      continue;
    }
    const previo = cursos.get(curso);
    if (previo) {
      advertencias.push({ hoja, mensaje: `El curso ${curso} aparece también en la hoja "${previo.hoja}". Se juntaron ambas.` });
      previo.alumnos += enHoja;
    } else {
      cursos.set(curso, { curso, cursoOriginal, especialidad, hoja, alumnos: enHoja });
    }
  }

  // 4. Duplicados dentro de un curso
  const vistos = new Map<string, number>();
  for (const a of alumnos) {
    const k = `${a.curso}|${normalizar(`${a.nombres} ${a.apellidoPaterno} ${a.apellidoMaterno ?? ''}`)}`;
    const fila = vistos.get(k);
    if (fila !== undefined) {
      advertencias.push({ hoja: a.hoja, fila: a.fila, mensaje: `${a.nombres} ${a.apellidoPaterno} aparece dos veces en ${a.curso} (filas ${fila} y ${a.fila}).` });
    } else vistos.set(k, a.fila);
  }

  // 5. Promedio y posición dentro del curso (empates comparten posición: 1, 2, 2, 4)
  const conPromedio = alumnos.map((a) => {
    const notas = [a.promedio1m, a.promedio2m].filter((x): x is number => x !== null);
    return { ...a, promedio: Math.round((notas.reduce((s, x) => s + x, 0) / notas.length) * 1000) / 1000, posicionCurso: 0 };
  });
  const porCurso = new Map<string, typeof conPromedio>();
  for (const a of conPromedio) {
    if (!porCurso.has(a.curso)) porCurso.set(a.curso, []);
    porCurso.get(a.curso)!.push(a);
  }
  for (const lista of porCurso.values()) {
    lista.sort((x, y) => y.promedio - x.promedio);
    lista.forEach((a, i) => {
      a.posicionCurso = i > 0 && lista[i - 1].promedio === a.promedio ? lista[i - 1].posicionCurso : i + 1;
    });
  }

  if (alumnos.length >= MAX_FILAS) {
    advertencias.push({ mensaje: `Se leyeron solo los primeros ${MAX_FILAS} alumnos.` });
  }
  if (!alumnos.length && !errores.length) {
    errores.push({ mensaje: 'El archivo no tiene alumnos. Revisa que sea la plantilla de notas completada.' });
  }

  return {
    liceoEnArchivo,
    cursos: [...cursos.values()].sort((a, b) => a.curso.localeCompare(b.curso)),
    alumnos: conPromedio.sort((a, b) => a.curso.localeCompare(b.curso) || a.posicionCurso - b.posicionCurso),
    errores,
    advertencias,
  };
}
