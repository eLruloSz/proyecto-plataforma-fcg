import {
  ENCABEZADO_NECESIDADES, ETIQUETA_ACTUALIZACION, ETIQUETA_EMISION, FILA_INTEGRANTE, INICIO_GUIA, LINEA_NECESIDADES, LINEA_TRAMO,
  ESTA_DISTANCIA, ETIQUETA_TOTAL_INGRESOS, MARCADORES, NOMBRE_ARCHIVO, ORDEN_NECESIDADES, RANGO_INGRESOS, RESTO_DE_LINEA_TOTAL, RESUMEN_PERSONAS, TOTAL_INTEGRANTES, TRAMO_PRINCIPAL, TRAMOS_VALIDOS,
} from './cartola-formato';

/**
 * Convierte el TEXTO de una Cartola Hogar en los datos de la ficha. Es una función pura (texto → datos):
 * no toca disco, base de datos ni red, así que se prueba con texto suelto.
 *
 * Privacidad: la cartola trae nombres de todo el hogar. Aquí solo se usan para reconocer al estudiante
 * (`integrantes`, que NO debe salir de este servidor) y para contrastar el total. Nada de eso se guarda.
 */

export interface DatosFicha {
  tramoRsh: number | null;
  rshActualizada: string | null;
  personasHogar: number | null;
  menores18: number | null;
  mayores60: number | null;
  conDiscapacidad: number | null;
  conDependencia: number | null;
  conInvalidez: number | null;
  conNee: number | null;
  ingresosHogar: string | null;
}

/** Un integrante de la cartola, solo para emparejar al estudiante. `clave` = nombre sin tildes, espacios ni símbolos. */
export interface Integrante { clave: string; rutParcial: string | null }

export interface CartolaLeida {
  esCartola: boolean;
  emitidaEn: string | null; // AAAA-MM-DD (fecha de consulta)
  ficha: DatosFicha;
  integrantes: Integrante[]; // interno: nunca se devuelve
  avisos: string[];
}

// ---------------------------------------------------------------------------
// Nombres y RUT (solo para emparejar)
// ---------------------------------------------------------------------------

/** "Joaquín Alonso" → "JOAQUINALONSO". Sin espacios a propósito: el PDF a veces parte una palabra ("FUENZ ALIDA"). */
export function claveNombre(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
}

/** RUT sin puntos, guion ni dígito verificador: "21.764.393-5" → "21764393". */
export function cuerpoRut(rut: string): string {
  return rut.replace(/[.\-\s]/g, '').toUpperCase().slice(0, -1);
}

/** El RUT (sin dígito) que trae el nombre del archivo «cartola_rsh_21764393_…pdf», o null. */
export function rutDelArchivo(nombreArchivo: string): string | null {
  return NOMBRE_ARCHIVO.exec(nombreArchivo)?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function iso(d: number, m: number, a: number): string | null {
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
}

/** Primera fecha del texto: "03/11/2026", "03-11-2026" o "3 de noviembre de 2026" → "2026-11-03". */
export function fechaIso(texto: string): string | null {
  const num = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/.exec(texto);
  if (num) return iso(Number(num[1]), Number(num[2]), Number(num[3]));
  const largo = /(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i.exec(texto);
  if (largo) {
    const mes = MESES.indexOf(largo[2].toLowerCase());
    return mes >= 0 ? iso(Number(largo[1]), mes + 1, Number(largo[3])) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * Limpia lo que deja `pdftotext`: espacios dentro de fechas y de miles ("22/ 10/ 2026", "$1. 025. 000", "- 18 AÑOS"),
 * y corta la guía de ejemplo del final.
 */
export function limpiarTexto(texto: string): string {
  const guia = texto.search(INICIO_GUIA);
  const util = guia >= 0 ? texto.slice(0, guia) : texto;
  return util
    .replace(/(\d)[ \t]*\/[ \t]*(?=\d)/g, '$1/')
    .replace(/(\d)\.[ \t]+(?=\d)/g, '$1.')
    .replace(/([+\-])[ \t]+(?=\d)/g, '$1');
}

function ultimoTramoValido(texto: string): number | null {
  for (const linea of texto.match(LINEA_TRAMO) ?? []) {
    const validos = [...linea.matchAll(/(\d{2,3})\s*%/g)].map((m) => Number(m[1])).filter((n) => TRAMOS_VALIDOS.includes(n));
    if (validos.length) return validos[validos.length - 1];
  }
  return null;
}

export function leerCartola(textoCrudo: string): CartolaLeida {
  const texto = limpiarTexto(textoCrudo);
  const avisos: string[] = [];
  const esCartola = MARCADORES.every((m) => m.test(texto));

  const emitidaEn = fechaIso(ETIQUETA_EMISION.exec(texto)?.[1] ?? '');
  const actualizada = fechaIso(ETIQUETA_ACTUALIZACION.exec(texto)?.[1] ?? '');

  // Tramo: «se ubica en el Tramo 40». Si esa frase no está, el último porcentaje válido de una línea con «tramo».
  const tramoFrase = Number(TRAMO_PRINCIPAL.exec(texto)?.[1]);
  const tramoRsh = TRAMOS_VALIDOS.includes(tramoFrase) ? tramoFrase : ultimoTramoValido(texto);

  // Resumen del hogar: total, menores de 18 y mayores de 60 (la cartola ya los trae calculados).
  const resumen = RESUMEN_PERSONAS.exec(texto);
  const totalDeclarado = Number(TOTAL_INTEGRANTES.exec(texto)?.[1] ?? NaN);

  // «Total de personas en tu hogar con…»: 4 números debajo del encabezado, siempre en el mismo orden.
  const necesidades: Record<string, number | null> = { conDiscapacidad: null, conDependencia: null, conInvalidez: null, conNee: null };
  const desde = texto.search(ENCABEZADO_NECESIDADES);
  const fila = desde >= 0 ? LINEA_NECESIDADES.exec(texto.slice(desde)) : null;
  if (fila) ORDEN_NECESIDADES.forEach((k, i) => { necesidades[k] = Number(fila[i + 1]); });

  // Ingreso: el TOTAL del hogar, tal como lo escribe la cartola.
  let ingresosHogar: string | null = null;
  const posTotal = texto.search(ETIQUETA_TOTAL_INGRESOS);
  if (posTotal >= 0) {
    const rango = RANGO_INGRESOS.exec(texto.slice(posTotal, posTotal + ESTA_DISTANCIA));
    const resto = RESTO_DE_LINEA_TOTAL.exec(texto)?.[1].trim().split(/[ \t]{2,}/)[0];
    ingresosHogar = (rango ? rango[0] : resto ?? null)?.replace(/\s+/g, ' ').slice(0, 120) ?? null;
  }

  // Integrantes (solo para emparejar y para contrastar el total).
  const integrantes: Integrante[] = [...texto.matchAll(FILA_INTEGRANTE)].map((m) => ({
    clave: claveNombre(m[2]), rutParcial: m[1].replace('.', ''),
  })).filter((i) => i.clave.length > 0);

  const personasHogar = resumen ? Number(resumen[1]) : Number.isFinite(totalDeclarado) ? totalDeclarado : integrantes.length || null;
  if (integrantes.length && personasHogar !== null && integrantes.length !== personasHogar) {
    avisos.push(`La lista de integrantes trae ${integrantes.length} personas y el total dice ${personasHogar}: revisa el PDF.`);
  }

  const ficha: DatosFicha = {
    tramoRsh,
    rshActualizada: actualizada,
    personasHogar,
    menores18: resumen ? Number(resumen[2]) : null,
    mayores60: resumen ? Number(resumen[3]) : null,
    conDiscapacidad: necesidades.conDiscapacidad,
    conDependencia: necesidades.conDependencia,
    conInvalidez: necesidades.conInvalidez,
    conNee: necesidades.conNee,
    ingresosHogar,
  };

  const obligatorios: [keyof DatosFicha, string][] = [
    ['tramoRsh', 'tramo'], ['rshActualizada', 'última actualización'], ['personasHogar', 'personas del hogar'],
    ['menores18', 'menores de 18'], ['mayores60', 'mayores de 60'], ['conDiscapacidad', 'personas con discapacidad, dependencia, invalidez y NEE'],
    ['ingresosHogar', 'ingreso del hogar'],
  ];
  for (const [k, nombre] of obligatorios) if (ficha[k] === null) avisos.push(`No se encontró el dato «${nombre}»: queda vacío.`);

  return { esCartola, emitidaEn, ficha, integrantes, avisos };
}
