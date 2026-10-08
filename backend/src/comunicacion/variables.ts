/** Variables que se pueden usar en asunto y cuerpo de los correos. */
export const VARIABLES = {
  nombre: 'Nombre del destinatario (contraparte, director/a o estudiante)',
  cargo: 'Cargo del destinatario (solo liceos)',
  liceo: 'Nombre del liceo',
  anio: 'Año del proceso',
  firma: 'Tu firma (se configura en tu perfil)',
  codigo: 'Id del estudiante, ej. 01.006a (solo estudiantes)',
  curso: 'Curso del estudiante (solo estudiantes)',
} as const;

const PATRON = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

/** Reemplaza {{variable}}. Las variables sin valor quedan vacías; las desconocidas, tal cual. */
export function reemplazarVariables(texto: string, valores: Record<string, string | null | undefined>): string {
  return texto.replace(PATRON, (completo, nombre: string) => {
    const k = nombre.toLowerCase();
    if (!(k in VARIABLES)) return completo;
    return valores[k] ?? '';
  });
}

/**
 * Asunto para mostrar en listas (un envío tiene un asunto por destinatario):
 * reemplaza el año y deja las variables por destinatario como «liceo».
 */
export function asuntoVisible(asunto: string, anio: number | string): string {
  return asunto.replace(PATRON, (completo, nombre: string) => {
    const k = nombre.toLowerCase();
    if (k === 'anio') return String(anio);
    return k in VARIABLES ? `«${k}»` : completo;
  });
}

export function variablesDesconocidas(texto: string): string[] {
  const out = new Set<string>();
  for (const m of texto.matchAll(PATRON)) {
    if (!(m[1].toLowerCase() in VARIABLES)) out.add(m[1]);
  }
  return [...out];
}
