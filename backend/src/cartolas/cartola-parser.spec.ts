import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import * as path from 'path';
import { claveNombre, cuerpoRut, fechaIso, leerCartola, limpiarTexto, rutDelArchivo } from './cartola-parser';
import { buscarIntegrante, emparejar, Postulante, prepararPostulante, rutTapado } from './emparejar';
import { extraerTexto, PdfIlegibleError } from './lector-pdf';

// El PDF de ejemplo es INVENTADO (nombres y RUT ficticios) pero con el mismo diseño que una cartola real.
const PDF = path.join(__dirname, '../../../db/cartolas-demo/cartola-sintetica.pdf');
const hayPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

/**
 * Texto con las mismas manías que deja `pdftotext` en una cartola real descargada de la Clave Única:
 * espacios dentro de fechas y de miles ("22/ 10/ 2026", "$1. 025. 000"), "- 18 AÑOS", palabras partidas ("FUENZ ALIDA").
 * Datos inventados.
 */
const TEXTO_REAL = `
Cartola Hogar                                                          Número de Folio: #00000000
CARLOS EJEMPLO FUENZ ALIDA                                  Última actualización de información: 22/ 10/ 2026
PASAJE FICTICIO, # 622, Localidad: PRUEBA                                       Fecha de consulta: 15/ 11/ 2026
¿Cuál es el tramo de mi hogar?                                                          0 a 40%
                                                                   TRAMO         40        50       60
         Según los tramos de vulnerabilidad socioeconómica, tu hogar se ubica en el Tramo 40 (0% al 40%).
¿Qué información se considera para el                  2. Personas que                    TOTAL        - 18 AÑOS        + 60 AÑOS
tramo de mi hogar?                                     conforman el
                                                       hogar:                                   3             0                2
                                                       3. Ingresos de las personas que conforman el hogar:
                                                       Trabajo                              Entre $585. 000 y $805. 000
1. Total de personas en tu hogar con:                  Capital (ej. inversiones)            No tiene
    DISCAPACIDAD        DEPENDENCIA           INVALIDEZ    NECESIDADES
                                                           EDUCATIVAS           TOTAL INGRESOS HOGAR                 Entre $1. 025. 000 y $1. 275. 000
                                                           ESPECIALES          Ingresos observados en los últimos 12 meses disponibles.
            1                  0                 0             0
 ¿Quiénes conforman mi hogar?                                                      Total de integrantes: 3 personas
RUT                    Integrantes                                                  Parentesco                       -18 años         +60 años
4.553.XXX-X            Rolando Augusto Ejemplo Cornejo                              Jefe(a) de hogar
5.622.XXX-X            Amadora del Carmen Modelo Maldonado                          Cónyuge o pareja
21.764.XXX-X           Carlos Alonso Ejemplo Fuenzalida                                  Nieto(a)
Esta cartola fue impresa el 15 de noviembre a las 04: 00 hrs. Clave Unica Código 000- 000- 000
\fGuía para entender la Cartola Hogar del Registro Social de Hogares
hogar:   9   9   9
`;

describe('utilidades', () => {
  it('claveNombre ignora tildes, espacios y símbolos', () => expect(claveNombre('Joaquín  Ñuñoa-Díaz')).toBe('JOAQUINNUNOADIAZ'));
  it('cuerpoRut quita puntos, guion y dígito verificador', () => expect(cuerpoRut('21.764.393-5')).toBe('21764393'));
  it('rutDelArchivo lee el RUT del nombre «cartola_rsh_<RUT>_<fecha>.pdf»', () => {
    expect(rutDelArchivo('cartola_rsh_21764393_20261115040015.pdf')).toBe('21764393');
    expect(rutDelArchivo('mi cartola.pdf')).toBeNull();
  });
  it.each([
    ['03/11/2026', '2026-11-03'], ['3-1-2026', '2026-01-03'], ['3 de junio de 2026', '2026-06-03'], ['31/02/2026', null], ['sin fecha', null],
  ])('fechaIso %s → %s', (texto, esperado) => expect(fechaIso(texto)).toBe(esperado));
  it('limpiarTexto arregla fechas y miles partidos y corta la guía', () => {
    const t = limpiarTexto('22/ 10/ 2026 $1. 025. 000 - 18 AÑOS\nGuía para entender la Cartola Hogar\nruido');
    expect(t).toContain('22/10/2026 $1.025.000 -18 AÑOS');
    expect(t).not.toContain('ruido');
  });
});

describe('leerCartola (texto con las manías de una cartola real)', () => {
  const c = leerCartola(TEXTO_REAL);

  it('reconoce que es una cartola y lee las fechas', () => {
    expect(c.esCartola).toBe(true);
    expect(c.emitidaEn).toBe('2026-11-15'); // «Fecha de consulta»
    expect(c.ficha.rshActualizada).toBe('2026-10-22');
  });
  it('lee tramo, personas, menores y mayores desde los totales de la cartola', () => {
    expect(c.ficha.tramoRsh).toBe(40);
    expect(c.ficha.personasHogar).toBe(3);
    expect(c.ficha.menores18).toBe(0);
    expect(c.ficha.mayores60).toBe(2);
  });
  it('lee los 4 números de necesidades especiales en su orden', () => {
    expect([c.ficha.conDiscapacidad, c.ficha.conDependencia, c.ficha.conInvalidez, c.ficha.conNee]).toEqual([1, 0, 0, 0]);
  });
  it('toma el TOTAL de ingresos, no la fila de Trabajo', () => expect(c.ficha.ingresosHogar).toBe('Entre $1.025.000 y $1.275.000'));
  it('lee a los integrantes (solo para emparejar) y no avisa nada si todo calza', () => {
    expect(c.integrantes.map((i) => i.rutParcial)).toEqual(['4553', '5622', '21764']);
    expect(c.integrantes[2].clave).toBe('CARLOSALONSOEJEMPLOFUENZALIDA');
    expect(c.avisos).toEqual([]);
  });
  it('ignora los datos de ejemplo de la guía (hogar: 9 9 9)', () => expect(c.ficha.menores18).not.toBe(9));

  it('avisa si la lista de integrantes no calza con el total', () => {
    const x = leerCartola(TEXTO_REAL.replace('Total de integrantes: 3 personas', 'Total de integrantes: 5 personas').replace('hogar:                                   3 ', 'hogar:                                   5 '));
    expect(x.avisos.join(' ')).toContain('integrantes');
  });
  it('lo que no encuentra queda vacío y se avisa (no inventa)', () => {
    const x = leerCartola('Cartola Hogar\ntramo\n');
    expect(x.esCartola).toBe(true);
    expect(x.ficha.tramoRsh).toBeNull();
    expect(x.ficha.ingresosHogar).toBeNull();
    expect(x.avisos.length).toBeGreaterThan(0);
  });
  it('un texto cualquiera no es una cartola', () => expect(leerCartola('Factura de luz').esCartola).toBe(false));
});

describe('emparejar (cartola con RUT tapado)', () => {
  const persona = (id: string, nombres: string, pat: string, mat: string | null, rut: string | null = null): Postulante =>
    prepararPostulante({ id, nombres, apellido_paterno: pat, apellido_materno: mat, rut });
  const integrantes = [
    { clave: claveNombre('Carlos Ernesto Prueba Ejemplo'), rutParcial: '21111' },
    { clave: claveNombre('Estudiante Demo Prueba Ejemplo'), rutParcial: '23333' },
  ];

  it('reconoce por nombre completo, sin importar tildes ni mayúsculas', () => {
    expect(emparejar(integrantes, null, [persona('a', 'ESTUDIANTE DEMO', 'prueba', 'Ejemplo')])).toEqual([{ id: 'a', por: 'NOMBRE' }]);
  });
  it('un nombre de pila que falta en el sistema queda como aproximado (a confirmar)', () => {
    expect(emparejar(integrantes, null, [persona('a', 'Estudiante', 'Prueba', 'Ejemplo')])).toEqual([{ id: 'a', por: 'NOMBRE_APROXIMADO' }]);
  });
  it('reconoce por el RUT del nombre del archivo si el postulante tiene RUT cargado', () => {
    expect(emparejar([], '23333444', [persona('a', 'Otro', 'Nombre', 'Distinto', '23.333.444-5')])).toEqual([{ id: 'a', por: 'RUT' }]);
  });
  it('no empareja a un homónimo cuyo RUT no calza con el comienzo del RUT de la cartola', () => {
    expect(emparejar(integrantes, null, [persona('a', 'Estudiante Demo', 'Prueba', 'Ejemplo', '9.999.999-9')])).toEqual([]);
  });
  it('con RUT cargado que sí calza, reconoce por nombre', () => {
    expect(emparejar(integrantes, null, [persona('a', 'Estudiante Demo', 'Prueba', 'Ejemplo', '23.333.444-5')])).toEqual([{ id: 'a', por: 'NOMBRE' }]);
  });
  it('no confunde a alguien que no está', () => {
    expect(emparejar(integrantes, null, [persona('a', 'Pedro', 'Pérez', 'Soto')])).toEqual([]);
  });
  it('si hay hermanos postulando en el mismo hogar, devuelve a los dos', () => {
    const hermano = [...integrantes, { clave: claveNombre('Hermano Demo Prueba Ejemplo'), rutParcial: '24444' }];
    const r = emparejar(hermano, null, [persona('a', 'Estudiante Demo', 'Prueba', 'Ejemplo'), persona('b', 'Hermano Demo', 'Prueba', 'Ejemplo')]);
    expect(r.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

(hayPdftotext ? describe : describe.skip)('extraerTexto + leerCartola con el PDF de ejemplo', () => {
  it('lee el PDF sintético completo', async () => {
    const c = leerCartola(await extraerTexto(readFileSync(PDF)));
    expect(c.esCartola).toBe(true);
    expect(c.emitidaEn).toBe('2026-11-15');
    expect(c.ficha).toEqual({
      tramoRsh: 50, rshActualizada: '2026-10-22', personasHogar: 4, menores18: 1, mayores60: 1,
      conDiscapacidad: 2, conDependencia: 1, conInvalidez: 0, conNee: 1, ingresosHogar: 'Entre $400.000 y $600.000',
    });
    expect(c.integrantes).toHaveLength(4);
    expect(c.avisos).toEqual([]);
  });

  it('un archivo que no es PDF da un error legible', async () => {
    await expect(extraerTexto(Buffer.from('esto no es un pdf'))).rejects.toBeInstanceOf(PdfIlegibleError);
  });
});

describe('buscarIntegrante y rutTapado (comparar la cartola con un estudiante)', () => {
  const integrantes = [
    { clave: claveNombre('Carlos Ernesto Prueba Ejemplo'), rutParcial: '21111', nombre: 'Carlos Ernesto Prueba Ejemplo' },
    { clave: claveNombre('Estudiante Demo Prueba Ejemplo'), rutParcial: '23333', nombre: 'Estudiante Demo Prueba Ejemplo' },
  ];
  const estudiante = (rut: string | null) => prepararPostulante({ id: 'a', nombres: 'Estudiante Demo', apellido_paterno: 'Prueba', apellido_materno: 'Ejemplo', rut });

  it('devuelve el nombre tal como está en la cartola y cómo se reconoció', () => {
    const m = buscarIntegrante(estudiante(null), integrantes);
    expect(m?.por).toBe('NOMBRE');
    expect(m?.integrante.nombre).toBe('Estudiante Demo Prueba Ejemplo');
    expect(rutTapado(m?.integrante.rutParcial)).toBe('23.333.XXX-X');
  });
  it('si el RUT cargado no calza con el de la cartola, no lo reconoce (homónimo)', () => {
    expect(buscarIntegrante(estudiante('9.999.999-9'), integrantes)).toBeNull();
    expect(buscarIntegrante({ ...estudiante('9.999.999-9'), rut: null }, integrantes)?.integrante.rutParcial).toBe('23333');
  });
  it('con RUT cargado que calza, lo reconoce', () => {
    expect(buscarIntegrante(estudiante('23.333.444-5'), integrantes)?.por).toBe('NOMBRE');
  });
  it('rutTapado arma el formato de la cartola y devuelve null si no hay RUT', () => {
    expect(rutTapado('4553')).toBe('4.553.XXX-X');
    expect(rutTapado(null)).toBeNull();
  });
  it('el lector guarda el nombre de cada integrante', () => {
    const c = leerCartola(TEXTO_REAL);
    expect(c.integrantes.every((i) => !!i.nombre)).toBe(true);
  });
});
