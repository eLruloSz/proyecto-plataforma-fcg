import * as ExcelJS from 'exceljs';

/**
 * Utilidades para armar los Excel del sistema.
 *
 * Regla de la fundación: si un estudiante no entregó un dato, su celda queda vacía; y si
 * NADIE entregó un dato, esa columna no se incluye. `agregarHoja` aplica las dos cosas:
 * cada columna dice cómo sacar su valor y se descarta sola cuando todos sus valores están vacíos.
 */

const ZONA = 'America/Santiago';

export type Valor = string | number | Date | null | undefined;

export interface Columna<T> {
  titulo: string;
  valor: (fila: T) => Valor;
  /** Formato de Excel (por ejemplo '0.000' o 'dd-mm-yyyy hh:mm'). */
  formato?: string;
  /** Ancho mínimo en caracteres; si falta se calcula según el contenido. */
  ancho?: number;
}

export const FORMATO_FECHA = 'dd-mm-yyyy';
export const FORMATO_FECHA_HORA = 'dd-mm-yyyy hh:mm';

const esVacio = (v: Valor) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Excel guarda las fechas sin zona horaria. Para que se vea la hora de Chile (y no la UTC del
 * servidor), se arma una fecha cuyos componentes UTC son la hora de reloj de Chile.
 */
export function relojChile(f: Date | string | null | undefined): Date | null {
  if (!f) return null;
  const d = new Date(f);
  if (isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const n = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  return new Date(Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')));
}

/** Columna de fecha (con o sin hora) ya convertida a hora de Chile. */
export function colFecha<T>(titulo: string, get: (f: T) => Date | string | null | undefined, conHora = false): Columna<T> {
  return { titulo, valor: (f) => relojChile(get(f)), formato: conHora ? FORMATO_FECHA_HORA : FORMATO_FECHA, ancho: conHora ? 17 : 12 };
}

/**
 * Columna de fecha SIN hora (tipo `date` de la base). Se lee como texto "AAAA-MM-DD" (en la consulta:
 * `to_char(col, 'YYYY-MM-DD')`) para que ninguna zona horaria del servidor corra el día.
 */
export function colDia<T>(titulo: string, get: (f: T) => string | null | undefined): Columna<T> {
  return {
    titulo,
    valor: (f) => {
      const t = get(f);
      return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(`${t}T00:00:00Z`) : null;
    },
    formato: FORMATO_FECHA,
    ancho: 12,
  };
}

/** Nombre de hoja válido para Excel: sin \ / ? * [ ] :, máximo 31 caracteres y sin repetirse. */
export function nombreHoja(nombre: string, usados: Set<string>): string {
  const base = nombre.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Hoja';
  let final = base;
  for (let i = 2; usados.has(final.toLowerCase()); i++) {
    const sufijo = ` (${i})`;
    final = base.slice(0, 31 - sufijo.length) + sufijo;
  }
  usados.add(final.toLowerCase());
  return final;
}

/** Nombre de archivo sin caracteres que Windows no acepta. */
export const nombreArchivo = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();

/** Agrega una hoja con las columnas que tengan al menos un dato. Devuelve los títulos incluidos. */
export function agregarHoja<T>(wb: ExcelJS.Workbook, nombre: string, columnas: Columna<T>[], filas: T[]): string[] {
  const matriz = filas.map((f) => columnas.map((c) => c.valor(f)));
  const usadas = columnas
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => matriz.some((fila) => !esVacio(fila[i])));
  // Si la hoja no tiene ningún dato se deja al menos la primera columna, para que no quede en blanco.
  const incluidas = usadas.length ? usadas : columnas.slice(0, 1).map((c, i) => ({ c, i }));

  const ws = wb.addWorksheet(nombre);
  ws.addRow(incluidas.map(({ c }) => c.titulo));
  for (const fila of matriz) ws.addRow(incluidas.map(({ i }) => (esVacio(fila[i]) ? null : fila[i])));

  incluidas.forEach(({ c, i }, k) => {
    const col = ws.getColumn(k + 1);
    if (c.formato) col.numFmt = c.formato;
    const largoDatos = matriz.reduce((m, fila) => {
      const v = fila[i];
      return Math.max(m, esVacio(v) ? 0 : v instanceof Date ? 17 : String(v).length);
    }, 0);
    // El encabezado se parte en dos líneas, así que no hace falta ancho para el título entero.
    col.width = Math.min(50, Math.max(c.ancho ?? 8, Math.min(c.titulo.length + 2, 16), largoDatos + 2));
  });

  const encabezado = ws.getRow(1);
  encabezado.font = { bold: true };
  encabezado.alignment = { vertical: 'middle', wrapText: true };
  encabezado.height = 30;
  encabezado.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5ECF3' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF8FA3B8' } } };
  });
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];
  if (filas.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: incluidas.length } };

  return incluidas.map(({ c }) => c.titulo);
}

export const crearLibro = () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema de gestión — Beca Carmen Goudie';
  wb.created = new Date();
  return wb;
};
