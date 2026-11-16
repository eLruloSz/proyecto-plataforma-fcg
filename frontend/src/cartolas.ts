/** Tipos y utilidades compartidas por las pantallas de cartolas RSH. */

export interface DatosFicha {
  tramoRsh: number | null; rshActualizada: string | null; personasHogar: number | null; menores18: number | null; mayores60: number | null;
  conDiscapacidad: number | null; conDependencia: number | null; conInvalidez: number | null; conNee: number | null; ingresosHogar: string | null;
}

export type MotivoCoincidencia = 'RUT' | 'NOMBRE' | 'NOMBRE_APROXIMADO';

export interface Estudiante {
  id: string; codigo: string; nombre: string; liceo: string; por?: MotivoCoincidencia;
  fichaActual: Record<string, unknown> | null; yaCargada: string | null;
  nombreCartola?: string | null; rutCartola?: string | null; rutCoincide?: boolean | null;
}

export interface Verificacion {
  estado: 'COINCIDE' | 'APROXIMADO' | 'NO_COINCIDE';
  nombreSistema: string; nombreCartola: string | null; rutCartola: string | null; rutCoincide: boolean | null;
  motivo: 'NOMBRE_NO_APARECE' | 'RUT_DISTINTO' | null;
}

export interface ResultadoCartola {
  archivo: string; estado: 'OK' | 'REVISAR' | 'ERROR'; error?: string; hash?: string; emitidaEn?: string | null;
  ficha?: DatosFicha; integrantes?: number; avisos: string[]; coincidencias: Estudiante[]; verificacion?: Verificacion;
}

/** Campos de la ficha que lee o digita la cartola: clave del lector, columna de la ficha y cómo se muestra. */
export const CAMPOS_FICHA: { k: keyof DatosFicha; t: string; col: string }[] = [
  { k: 'tramoRsh', t: 'Tramo RSH', col: 'tramo_rsh' },
  { k: 'rshActualizada', t: 'Última actualización', col: 'rsh_actualizada' },
  { k: 'personasHogar', t: 'Personas del hogar', col: 'personas_hogar' },
  { k: 'menores18', t: 'Menores de 18', col: 'menores_18' },
  { k: 'mayores60', t: 'Mayores de 60', col: 'mayores_60' },
  { k: 'conDiscapacidad', t: 'Con discapacidad', col: 'con_discapacidad' },
  { k: 'conDependencia', t: 'Con dependencia', col: 'con_dependencia' },
  { k: 'conInvalidez', t: 'Con invalidez', col: 'con_invalidez' },
  { k: 'conNee', t: 'Con NEE', col: 'con_nee' },
  { k: 'ingresosHogar', t: 'Ingresos del hogar', col: 'ingresos_hogar' },
];

/** Los datos que debe traer una ficha completa (sin el tramo, que también viene del Excel del ranking). */
export const DATOS_DE_CARTOLA = CAMPOS_FICHA.filter((c) => c.k !== 'tramoRsh');

export const valorTexto = (k: keyof DatosFicha, v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'rshActualizada') return String(v).slice(0, 10).split('-').reverse().join('-');
  if (k === 'tramoRsh') return `${v}%`;
  return String(v);
};

/** Cuántos datos de la cartola faltan en la ficha (null = no hay ficha). */
export function datosFaltantes(ficha: Record<string, unknown> | null): number | null {
  if (!ficha) return null;
  return DATOS_DE_CARTOLA.filter((c) => ficha[c.col] === null || ficha[c.col] === undefined).length;
}

const clave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

/**
 * Compara el nombre que se tiene del estudiante con el que alguien escribe de la cartola (modo manual).
 * Misma idea que el servidor: mismas palabras (sin importar orden ni tildes) = coincide; falta algún nombre de pila = parecido.
 */
export function compararNombre(sistema: { nombres: string; paterno: string; materno: string | null }, escrito: string): 'COINCIDE' | 'APROXIMADO' | 'NO_COINCIDE' {
  const k = clave(escrito);
  if (!k) return 'NO_COINCIDE';
  const palabras = `${sistema.nombres} ${sistema.paterno} ${sistema.materno ?? ''}`.split(/\s+/).map(clave).filter(Boolean);
  const largas = palabras.filter((w) => w.length >= 3);
  if (largas.length >= 2 && largas.every((w) => k.includes(w)) && palabras.reduce((n, w) => n + w.length, 0) === k.length) return 'COINCIDE';
  const paterno = clave(sistema.paterno), primero = clave(sistema.nombres.split(/\s+/)[0] ?? ''), materno = clave(sistema.materno ?? '');
  if (paterno.length >= 3 && primero.length >= 3 && k.includes(paterno) && k.includes(primero) && (materno.length < 3 || k.includes(materno))) return 'APROXIMADO';
  return 'NO_COINCIDE';
}

/**
 * Comparación que pidió la fundación: personas del hogar según el formulario del estudiante vs. según la cartola.
 * null = falta uno de los dos datos (no se puede comparar).
 */
export function compararPersonas(formulario: unknown, cartola: unknown): { formulario: number; cartola: number; coincide: boolean } | null {
  const a = formulario === null || formulario === undefined || formulario === '' ? NaN : Number(formulario);
  const b = cartola === null || cartola === undefined || cartola === '' ? NaN : Number(cartola);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { formulario: a, cartola: b, coincide: a === b };
}

/**
 * Lo que se manda a PUT /postulaciones/:id/ficha al guardar una cartola: solo lo que trae (lo vacío no borra nada).
 * Si trae tramo, el RSH deja de estar "Pendiente" (la "P" del ranking).
 */
export function cuerpoFicha(datos: Partial<DatosFicha>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== null && v !== undefined));
  if (cuerpo.tramoRsh !== undefined) cuerpo.rshPendiente = false;
  return { ...cuerpo, ...extra };
}
