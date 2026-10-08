import { readFileSync } from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { leerNomina, leerNota, normalizarCurso } from './parser';

const demo = (f: string) => readFileSync(path.join(__dirname, '../../../db/nominas-demo', f));

describe('normalizarCurso', () => {
  it.each([
    ['3° año A', '3°A'],
    ['3° C', '3°C'],
    ['3°B', '3°B'],
    ['Curso 3°D', '3°D'],
    ['3 medio E', '3°E'],
    ['3º año b', '3°B'],
  ])('%s → %s', (entrada, esperado) => expect(normalizarCurso(entrada)).toBe(esperado));

  it('no inventa una letra cuando no la hay', () => {
    expect(normalizarCurso('3° medio')).toBeNull();
  });
});

describe('leerNota', () => {
  it('acepta número, texto con coma y nota sin coma', () => {
    expect(leerNota(6.85).nota).toBe(6.85);
    expect(leerNota('6,8').nota).toBe(6.8);
    const r = leerNota(65);
    expect(r.nota).toBe(6.5);
    expect(r.aviso).toBeDefined();
  });
  it('rechaza notas fuera de rango', () => {
    expect(leerNota(8.2).error).toBeDefined();
    expect(leerNota('seis').error).toBeDefined();
  });
});

describe('leerNomina con la plantilla real', () => {
  it('lee todas las hojas de cursos y calcula posiciones', async () => {
    const r = await leerNomina(demo('nomina_liceo_02.xlsx'));
    expect(r.errores).toEqual([]);
    expect(r.liceoEnArchivo).toBe('Liceo Pedro Regalado Videla');
    expect(r.cursos.map((c) => c.curso)).toEqual(['3°A', '3°B', '3°C']);
    expect(r.cursos[0].especialidad).toBe('Científico Humanista');
    for (const c of r.cursos) {
      const delCurso = r.alumnos.filter((a) => a.curso === c.curso);
      expect(delCurso.length).toBe(c.alumnos);
      expect(delCurso[0].posicionCurso).toBe(1);
      // ordenados de mayor a menor promedio
      for (let i = 1; i < delCurso.length; i++) {
        expect(delCurso[i].promedio).toBeLessThanOrEqual(delCurso[i - 1].promedio);
      }
    }
  });

  it('separa errores (fuera de la carga) de advertencias (se cargan)', async () => {
    const r = await leerNomina(demo('nomina_liceo_05.xlsx'));
    const errores = r.errores.map((e) => e.mensaje).join(' | ');
    const avisos = r.advertencias.map((e) => e.mensaje).join(' | ');
    expect(errores).toMatch(/no tiene promedios/);
    expect(errores).toMatch(/fuera del rango/);
    expect(avisos).toMatch(/interpretada como 6\.5/);
    expect(avisos).toMatch(/falta el promedio de 2° medio/);
    expect(avisos).toMatch(/aparece dos veces/);
    expect(r.errores.every((e) => e.fila && e.hoja)).toBe(true);
  });

  it('los empates comparten posición', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Curso 3°A');
    ws.addRow(['Curso:', '3°A']);
    ws.addRow(['N°', 'Apellido Paterno', 'Apellido Materno', 'Nombres', 'Promedio Final 1°medio', 'Promedio Final 2°Medio']);
    ws.addRow([1, 'Rojas', 'Díaz', 'Ana', 6.5, 6.5]);
    ws.addRow([2, 'Soto', 'Pérez', 'Luis', 6.9, 6.9]);
    ws.addRow([3, 'Silva', 'Mora', 'Eva', 6.5, 6.5]);
    ws.addRow([4, 'Tapia', 'Leal', 'Raúl', 6.0, 6.2]);
    const r = await leerNomina(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(r.alumnos.map((a) => [a.nombres, a.posicionCurso])).toEqual([
      ['Luis', 1], ['Ana', 2], ['Eva', 2], ['Raúl', 4],
    ]);
  });

  it('avisa con un mensaje claro si no es un Excel', async () => {
    const r = await leerNomina(Buffer.from('esto no es un excel'));
    expect(r.alumnos).toEqual([]);
    expect(r.errores[0].mensaje).toMatch(/\.xlsx/);
  });
});
