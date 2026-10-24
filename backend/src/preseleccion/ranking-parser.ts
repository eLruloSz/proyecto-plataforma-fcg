import * as ExcelJS from 'exceljs';
import { normalizar, valorCelda } from '../nominas/parser';

/**
 * Lectura del Excel de ranking que calcula la fundación (Preselección N°1).
 * Formato documentado en el proyecto (claude/ranking-excel-formato.md):
 *
 *   n° | Estab. | Id. | Apellido Paterno | Apellido Materno | Nombre | Notas |
 *   Ranking Notas | Puntaje Académico | RSH | I.P.C. | Puntaje I.P.C. |
 *   Puntaje Nivel Ed. Padres | Vul + (0/1) | Pje. Vul. | Pje. Socio econ. |
 *   Comp. y Part. | Puntaje Total | Finalistas | Ranking | Finalistas (repetida)
 *
 * El archivo puede traer varias pestañas (distintas ponderaciones); se elige
 * cuál cargar. Las columnas se buscan por su título, no por su posición.
 */

export interface FilaRanking {
  fila: number;
  id: string | null;
  establecimiento: string | null;
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
  nombre: string | null;
  notas: number | null;
  rankingNotas: number | null;
  puntajeAcademico: number | null;
  rsh: string | null;
  ipc: number | null;
  puntajeIpc: number | null;
  puntajeNivelPadres: number | null;
  vulnerabilidad: number | null;
  puntajeVulnerabilidad: number | null;
  puntajeSocioeconomico: number | null;
  puntajeCompromiso: number | null;
  puntajeTotal: number | null;
  finalista: boolean;
  posicion: number | null;
}

export interface LecturaRanking {
  hojas: { nombre: string; filas: number }[];
  hoja: string | null;
  filas: FilaRanking[];
  advertencias: string[];
}

type Clave = keyof Omit<FilaRanking, 'fila'>;

/** Qué columna es cada dato, según su título (ya normalizado: minúsculas, sin tildes). */
function claveDeTitulo(t: string): Clave | null {
  if (/^id\b|^id\.?$/.test(t)) return 'id';
  if (t.startsWith('estab')) return 'establecimiento';
  if (t.includes('apellido') && t.includes('paterno')) return 'apellidoPaterno';
  if (t.includes('apellido') && t.includes('materno')) return 'apellidoMaterno';
  if (t.startsWith('nombre')) return 'nombre';
  if (t.includes('ranking') && t.includes('nota')) return 'rankingNotas';
  if (t.startsWith('nota')) return 'notas';
  if (t.includes('academico')) return 'puntajeAcademico';
  const ipc = t.includes('i.p.c') || /\bipc\b/.test(t);
  if (ipc && /puntaje|pje/.test(t)) return 'puntajeIpc';
  if (ipc) return 'ipc';
  if (t.startsWith('rsh')) return 'rsh';
  if (t.includes('nivel')) return 'puntajeNivelPadres';
  if (t.includes('vul') && /puntaje|pje/.test(t)) return 'puntajeVulnerabilidad';
  if (t.includes('vul')) return 'vulnerabilidad';
  if (t.includes('socio')) return 'puntajeSocioeconomico';
  if (t.startsWith('comp')) return 'puntajeCompromiso';
  if (t.includes('total')) return 'puntajeTotal';
  if (t.startsWith('finalista')) return 'finalista';
  if (t.startsWith('ranking')) return 'posicion';
  return null;
}

/** "6,85" → 6.85 · "184.518" → 184518 · "40%" → 40 · "-" / "P" → null */
export function leerNumero(v: string | number | null): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = v.replace(/[%$\s]/g, '');
  if (!/\d/.test(s)) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // separador de miles
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Busca en las primeras filas la de los títulos (la que tiene "Id." y algún apellido). */
function filaDeTitulos(ws: ExcelJS.Worksheet): { fila: number; columnas: Map<number, Clave> } | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const columnas = new Map<number, Clave>();
    const usadas = new Set<Clave>();
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const v = valorCelda(cell);
      if (v === null) return;
      const clave = claveDeTitulo(normalizar(String(v)));
      // Si una columna se repite (ej. "Finalistas" dos veces), vale la primera.
      if (clave && !usadas.has(clave)) { columnas.set(col, clave); usadas.add(clave); }
    });
    if (usadas.has('id') && (usadas.has('apellidoPaterno') || usadas.has('nombre'))) return { fila: r, columnas };
  }
  return null;
}

export async function leerRanking(buffer: Buffer, hojaElegida?: string): Promise<LecturaRanking> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const advertencias: string[] = [];

  const validas = wb.worksheets
    .map((ws) => ({ ws, titulos: filaDeTitulos(ws) }))
    .filter((x): x is { ws: ExcelJS.Worksheet; titulos: NonNullable<ReturnType<typeof filaDeTitulos>> } => !!x.titulos);
  if (!validas.length) {
    return { hojas: [], hoja: null, filas: [], advertencias: ['No se encontró una hoja con las columnas del ranking ("Id.", "Apellido Paterno", "Puntaje Total"…).'] };
  }

  const leerHoja = (ws: ExcelJS.Worksheet, titulos: { fila: number; columnas: Map<number, Clave> }) => {
    const filas: FilaRanking[] = [];
    let vacias = 0;
    for (let r = titulos.fila + 1; r <= ws.rowCount && vacias < 30; r++) {
      const row = ws.getRow(r);
      const crudo: Partial<Record<Clave, string | number | null>> = {};
      for (const [col, clave] of titulos.columnas) crudo[clave] = valorCelda(row.getCell(col));
      const texto = (k: Clave) => (crudo[k] === null || crudo[k] === undefined ? null : String(crudo[k]).replace(/\s+/g, ' ').trim() || null);
      if (!texto('id') && !texto('apellidoPaterno') && !texto('nombre')) { vacias++; continue; }
      vacias = 0;
      const num = (k: Clave) => leerNumero(crudo[k] ?? null);
      filas.push({
        fila: r,
        id: texto('id'),
        establecimiento: texto('establecimiento'),
        apellidoPaterno: texto('apellidoPaterno'),
        apellidoMaterno: texto('apellidoMaterno'),
        nombre: texto('nombre'),
        notas: num('notas'),
        rankingNotas: num('rankingNotas'),
        puntajeAcademico: num('puntajeAcademico'),
        rsh: texto('rsh'),
        ipc: num('ipc'),
        puntajeIpc: num('puntajeIpc'),
        puntajeNivelPadres: num('puntajeNivelPadres'),
        vulnerabilidad: num('vulnerabilidad'),
        puntajeVulnerabilidad: num('puntajeVulnerabilidad'),
        puntajeSocioeconomico: num('puntajeSocioeconomico'),
        puntajeCompromiso: num('puntajeCompromiso'),
        puntajeTotal: num('puntajeTotal'),
        finalista: num('finalista') === 1,
        posicion: num('posicion'),
      });
    }
    return filas;
  };

  const hojas = validas.map((x) => ({ nombre: x.ws.name, filas: leerHoja(x.ws, x.titulos).length }));
  const elegida = validas.find((x) => x.ws.name === hojaElegida) ?? validas[0];
  if (hojaElegida && elegida.ws.name !== hojaElegida) advertencias.push(`No existe la pestaña "${hojaElegida}"; se usó "${elegida.ws.name}".`);
  const filas = leerHoja(elegida.ws, elegida.titulos);

  for (const f of filas) {
    if (!f.id) advertencias.push(`Fila ${f.fila}: ${f.nombre ?? ''} ${f.apellidoPaterno ?? ''} no tiene Id; no se puede cruzar.`);
    if (f.puntajeTotal === null && f.id) advertencias.push(`Fila ${f.fila} (${f.id}): no tiene Puntaje Total.`);
  }
  if (filas.length && filas.every((f) => f.posicion === null)) {
    advertencias.push('El archivo no trae la columna "Ranking": se ordenará por Puntaje Total.');
  }
  return { hojas, hoja: elegida.ws.name, filas, advertencias };
}