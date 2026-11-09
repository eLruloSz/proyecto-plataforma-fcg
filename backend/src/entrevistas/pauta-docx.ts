import JSZip from 'jszip';
import { PLANTILLA_PAUTA_B64 } from './plantilla-pauta';

/**
 * Pauta de entrevista en Word, a partir de la plantilla de la fundación.
 *
 * Solo se rellena lo que el sistema ya sabe. Lo que depende del cuestionario del estudiante
 * (ocupaciones, nivel educacional de los padres, actividades, sueños…) queda en blanco para
 * escribirlo en la entrevista. Un dato que falta deja su celda vacía: nunca se inventa.
 */
export interface DatosPauta {
  codigo: string;
  nombreCompleto: string;
  establecimiento: string;
  comuna: string | null;
  /** Posición en el curso según la nómina (1 = mejor promedio). */
  posicionNotas: number | null;
  /** Lugar en el ranking de la preselección N°1. */
  rankingPreseleccion: number | null;
  fechaHora: Date | string | null;
  personasHogar: number | null;
  /** Tramo del RSH, por ejemplo "40%" o "Pendiente". */
  tramoRsh: string | null;
  ingresoMensual: string | null;
}

const ZONA = 'America/Santiago';
const plantilla = () => Buffer.from(PLANTILLA_PAUTA_B64, 'base64');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const txt = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v).trim());

/** "martes, 18 de agosto de 2026, 10:00 hrs", en hora de Chile. Vacío si no hay fecha. */
export function textoFechaEntrevista(f: Date | string | null): string {
  if (!f) return '';
  const d = new Date(f);
  if (isNaN(d.getTime())) return '';
  const dia = new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  const hora = new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)}, ${hora} hrs`;
}

/** Escribe `texto` en el primer párrafo de la celda, con el formato (fuente) que ya trae el párrafo. */
function escribirEnCelda(celda: string, texto: string): string {
  if (!texto) return celda;
  let hecho = false;
  return celda.replace(/<w:p(\s[^>]*?)?(\/>|>[\s\S]*?<\/w:p>)/, (p, attrs: string | undefined, resto: string) => {
    if (hecho) return p;
    hecho = true;
    const pPr = p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
    const rPr = pPr.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';
    const run = `<w:r>${rPr}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r>`;
    const abre = `<w:p${attrs ?? ''}>`;
    if (resto === '/>') return `${abre}${run}</w:p>`;
    return p.replace(/<\/w:p>$/, `${run}</w:p>`);
  });
}

/** Rellena celdas de la segunda fila (la de datos) de una tabla. `valores[n]` va en la celda n. */
function rellenarFilaDeDatos(tabla: string, valores: Record<number, string>): string {
  let fila = 0;
  return tabla.replace(/<w:tr[ >][\s\S]*?<\/w:tr>/g, (tr) => {
    if (fila++ !== 1) return tr;
    let celda = 0;
    return tr.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (tc) => {
      const v = valores[celda++];
      return v ? escribirEnCelda(tc, v) : tc;
    });
  });
}

export async function generarPauta(d: DatosPauta): Promise<Buffer> {
  const zip = await JSZip.loadAsync(plantilla());
  const archivo = zip.file('word/document.xml');
  if (!archivo) throw new Error('La plantilla de la pauta no tiene word/document.xml.');
  let xml = await archivo.async('string');

  // Tablas de la plantilla, en orden: 0 identificación · 1 hogar · 3 RSH e ingresos.
  const porTabla: Record<number, Record<number, string>> = {
    0: {
      0: txt(d.codigo), 1: txt(d.nombreCompleto), 2: txt(d.establecimiento), 3: txt(d.comuna),
      4: txt(d.posicionNotas), 5: txt(d.rankingPreseleccion),
    },
    1: { 0: txt(d.personasHogar) },
    3: { 0: txt(d.tramoRsh), 3: txt(d.ingresoMensual) },
  };
  let t = 0;
  xml = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tabla) => {
    const valores = porTabla[t++];
    return valores ? rellenarFilaDeDatos(tabla, valores) : tabla;
  });

  // "Fecha y hora entrevista: " → se agrega el valor a continuación (sin negrita).
  const fecha = textoFechaEntrevista(d.fechaHora);
  if (fecha) {
    xml = xml.replace(
      /(<w:t xml:space="preserve">Fecha y hora entrevista: <\/w:t><\/w:r>)/,
      `$1<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/></w:rPr><w:t xml:space="preserve">${esc(fecha)}</w:t></w:r>`);
  }

  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Une varias pautas en un solo .zip. `nombre` es el nombre de cada archivo dentro del zip. */
export async function empaquetarPautas(pautas: { nombre: string; contenido: Buffer }[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const p of pautas) zip.file(p.nombre, p.contenido);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
