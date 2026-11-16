/**
 * FORMATO DE LA CARTOLA HOGAR — es el ÚNICO archivo que hay que tocar si el Estado cambia el diseño.
 *
 * Ajustado a una cartola real descargada de la Clave Única (PDF de 2 páginas generado con wkhtmltopdf).
 * Lo que se sabe de ese formato:
 *   - El RUT de los integrantes viene TAPADO ("4.553.XXX-X"): no sirve para reconocer al estudiante.
 *     Por eso se reconoce por nombre (y por el RUT del nombre del archivo, si está cargado).
 *   - Los totales ya vienen resumidos ("TOTAL / -18 AÑOS / +60 AÑOS"): no hace falta calcular edades.
 *   - La fecha de la cartola se llama «Fecha de consulta».
 *   - `pdftotext` deja espacios de más dentro de números y fechas ("22/ 10/ 2026", "$1. 025. 000"): el parser
 *     los limpia antes de buscar nada.
 *   - La 2.ª página es una guía con datos de EJEMPLO: se corta el texto donde empieza.
 *
 * Si una etiqueta no calza, el dato queda vacío y el lector lo avisa: nunca inventa un valor.
 */

/** Todos estos deben aparecer para considerar que el PDF es una Cartola Hogar. */
export const MARCADORES = [/cartola\s+hogar/i, /tramo/i];

/** Desde aquí el PDF trae una guía con datos de ejemplo (no son del hogar): se ignora. */
export const INICIO_GUIA = /gu[ií]a\s+para\s+entender\s+la\s+cartola/i;

/** Tramos válidos de la ficha (los mismos que acepta la tabla fichas_postulacion). */
export const TRAMOS_VALIDOS = [40, 50, 60, 70, 80, 90, 100];

/** «Fecha de consulta: 15/11/2026» — el día en que se descargó la cartola. */
export const ETIQUETA_EMISION = /fecha\s+de\s+(?:consulta|emisi[oó]n)\s*:?\s*([^\n]{0,40})/i;

/** «Última actualización de información: 22/10/2026». */
export const ETIQUETA_ACTUALIZACION = /[uú]ltima\s+actualizaci[oó]n(?:\s+de\s+informaci[oó]n)?\s*:?\s*([^\n]{0,40})/i;

/** «…tu hogar se ubica en el Tramo 40 (0% al 40%)». */
export const TRAMO_PRINCIPAL = /se\s+ubica\s+en\s+el\s+tramo\s+(\d{2,3})\b/i;
/** Respaldo: cualquier línea con «tramo» y un porcentaje ("0 a 40%"); se toma el último válido. */
export const LINEA_TRAMO = /(?:tramo|calificaci[oó]n\s+socioecon[oó]mica)[^\n]*/gi;

/** «2. Personas que conforman el hogar:  TOTAL  -18 AÑOS  +60 AÑOS» → la línea «hogar:  3  0  2». */
export const RESUMEN_PERSONAS = /hogar:\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\b/i;
export const TOTAL_INTEGRANTES = /total\s+de\s+integrantes:\s*(\d{1,2})/i;

/** Encabezado de «Total de personas en tu hogar con:». Debajo vienen, en este orden, los 4 números. */
export const ENCABEZADO_NECESIDADES = /DISCAPACIDAD/;
export const LINEA_NECESIDADES = /^[ \t]*(\d{1,2})[ \t]+(\d{1,2})[ \t]+(\d{1,2})[ \t]+(\d{1,2})(?:[ \t]{2,}\S.*)?[ \t]*$/m;
export const ORDEN_NECESIDADES = ['conDiscapacidad', 'conDependencia', 'conInvalidez', 'conNee'] as const;

/**
 * «TOTAL INGRESOS HOGAR  Entre $1.025.000 y $1.275.000» (no confundir con las filas de Trabajo, Pensión…).
 * El valor suele ir en la misma línea que la etiqueta, pero a veces el PDF lo baja una línea: se busca el
 * primer «Entre $X y $Y» que sigue a la etiqueta (dentro de ESTA_DISTANCIA caracteres).
 */
export const ETIQUETA_TOTAL_INGRESOS = /total\s+ingresos\s+hogar/i;
export const RANGO_INGRESOS = /entre\s+\$\s*[\d.]+\s+y\s+\$\s*[\d.]+/i;
export const ESTA_DISTANCIA = 400;
/** Si el total no es un rango (por ejemplo «No tiene»), se toma el resto de la línea con la etiqueta. */
export const RESTO_DE_LINEA_TOTAL = /total\s+ingresos\s+hogar[ \t]+([^\n]+)/i;

/**
 * Fila de «¿Quiénes conforman mi hogar?»: RUT tapado, nombre y (después de 2+ espacios) el parentesco.
 * Grupo 1 = primeros dígitos del RUT ("21.764"), grupo 2 = nombre.
 */
export const FILA_INTEGRANTE = /^[ \t]*(\d{1,2}\.\d{3})\.(?:XXX|\d{3})-[\dkKxX][ \t]+(.+?)(?=[ \t]{2,}\S|[ \t]*$)/gm;

/** El PDF se descarga como «cartola_rsh_<RUT sin dígito>_<fecha>.pdf»: el RUT de quien la pidió. */
export const NOMBRE_ARCHIVO = /^cartola_rsh_(\d{7,8})_/i;

/** Una cartola de hace más de estos días se marca para revisar (el RSH se actualiza todos los meses). */
export const DIAS_MAXIMOS_ANTIGUEDAD = 60;

/** Menos texto que esto = PDF escaneado o foto: no se puede leer sin OCR (y no se usa OCR externo). */
export const MIN_CARACTERES = 80;
