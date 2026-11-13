// ============================================================================
// TEST 2 · E2E FRONTEND · Etapa 1: nóminas, invitación por promedio y Forms
//
// Maneja un navegador real (Chromium) contra http://localhost:8080 y repite, por
// pantalla, los casos del informe. Se corre DESPUÉS del test de backend y con la
// base recién cargada (docker compose --profile app down -v && ... up -d --build).
//
//   npm i -D @playwright/test exceljs
//   npx playwright install chromium
//   npx playwright test
//   npx playwright show-report        (abre el informe con las capturas)
//
// Ubicación: copia la carpeta test2/ en la raíz del repo (queda repo/test2/frontend).
// REPO (por defecto ../..) es la raíz del repo; de ahí se leen las nóminas db/nominas-demo.
// ============================================================================
import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const MAILPIT = process.env.MAILPIT ?? 'http://localhost:8025';
const REPO = process.env.REPO ?? path.resolve(__dirname, '../..');
const NOMINAS = path.join(REPO, 'db', 'nominas-demo');
const EVID = path.resolve(__dirname, 'evidencias', 'T2');
mkdirSync(EVID, { recursive: true });

const CORREO = 'coordinacion@fcg.cl';
const CLAVE = 'Demo1234!';

let api: APIRequestContext;
let token = '';
const L: Record<string, { id: string; nombre: string }> = {};
const estado: { correosAntes: number | null; total04?: number; invitadosCodigos?: string[] } = { correosAntes: null };

// ---------------------------------------------------------------- utilidades
async function get(ruta: string) {
  const r = await api.get(`/api${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  return r.json();
}
async function post(ruta: string, data?: unknown) {
  return api.post(`/api${ruta}`, { headers: { Authorization: `Bearer ${token}` }, data });
}
async function correosMailpit(): Promise<number | null> {
  try { return (await (await fetch(`${MAILPIT}/api/v1/messages?limit=1`)).json()).total; } catch { return null; }
}
async function evidencia(page: Page, nombre: string) {
  await page.screenshot({ path: path.join(EVID, `${nombre}.png`), fullPage: false });
}
async function iniciarSesionUI(page: Page) {
  await page.goto('/');
  await page.locator('#email').fill(CORREO);
  await page.locator('#pass').fill(CLAVE);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('#email')).toHaveCount(0);            // ya no está el login
}
const excel = (nombre: string) => ({ name: nombre, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: readFileSync(path.join(NOMINAS, nombre)) });

function dv(cuerpo: string) {
  let suma = 0, mult = 2;
  for (const d of cuerpo.split('').reverse()) { suma += Number(d) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const r = 11 - (suma % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}

// ------------------------------------------------------------------ preparar
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  api = await pwRequest.newContext({ baseURL: BASE });
  const login = await api.post('/api/auth/login', { data: { email: CORREO, password: CLAVE } });
  token = (await login.json()).token;
  expect(token, 'no se pudo iniciar sesión por API').toBeTruthy();

  // La base demo parte sin proceso activo. Se inicia por API solo como PREPARACIÓN
  // (lo que se prueba por pantalla es la Etapa 1, no el asistente "Iniciar proceso").
  let inicio = await get('/proceso/inicio');
  if (!inicio.activo) {
    if (!inicio.borrador) await post('/proceso/borrador', { anio: inicio.anioSugerido });
    await post('/proceso/borrador/confirmar');
  }
  for (const l of await get('/liceos')) L[l.codigo] = l;
  estado.correosAntes = await correosMailpit();
});
test.afterAll(async () => { await api.dispose(); });

test.beforeEach(async ({ page }) => { await iniciarSesionUI(page); });

// ============================================================================
// PASO 1 · nómina válida
// ============================================================================
test('T2-01 · subir una nómina válida (liceo 04): se revisa y se carga', async ({ page }) => {
  await page.goto(`/liceos/${L['04'].id}`);
  await expect(page.getByText(/aún no tiene nómina/i)).toBeVisible();

  await page.locator('input[type=file]').first().setInputFiles(excel('nomina_liceo_04.xlsx'));
  const modal = page.getByText(/Revisar nómina — nomina_liceo_04\.xlsx/);
  await expect(modal).toBeVisible();
  await expect(page.getByText(/filas con error/)).toBeVisible();
  await evidencia(page, 'T2-01_nomina-valida');

  const boton = page.getByRole('button', { name: /Cargar \d+ alumnos/ });
  estado.total04 = Number((await boton.textContent())!.match(/\d+/)![0]);
  expect(estado.total04).toBeGreaterThan(0);
  await boton.click();

  await expect(page.getByText(`Nómina cargada: ${estado.total04} alumnos`)).toBeVisible();
  await expect(page.getByText(new RegExp(`${estado.total04}\\s*alumnos en \\d+ cursos`))).toBeVisible();
});

// ============================================================================
// PASO 2 · reenviar la misma nómina
// ============================================================================
test('T2-02 · reemplazar con la misma nómina: avisa y la cantidad no cambia', async ({ page }) => {
  await page.goto(`/liceos/${L['04'].id}`);
  await page.locator('input[type=file]').first().setInputFiles(excel('nomina_liceo_04.xlsx'));
  await expect(page.getByText(/ya tiene una nómina cargada/i)).toBeVisible();   // advertencia del sistema
  await evidencia(page, 'T2-02_reenvio');
  await page.getByRole('button', { name: /Cargar \d+ alumnos/ }).click();
  await expect(page.getByText(new RegExp(`${estado.total04}\\s*alumnos en \\d+ cursos`))).toBeVisible();
});

// ============================================================================
// PASO 3 · nómina con errores (liceo 05)
// ============================================================================
test('T2-03 · nómina del liceo 05: la pantalla muestra cuántas filas tienen error', async ({ page }) => {
  await page.goto(`/liceos/${L['05'].id}`);
  await page.locator('input[type=file]').first().setInputFiles(excel('nomina_liceo_05.xlsx'));
  await expect(page.getByText(/Revisar nómina — nomina_liceo_05\.xlsx/)).toBeVisible();
  // El número de filas con error debe ser mayor que 0 y estar resaltado en rojo.
  const tarjeta = page.locator('.tarjeta', { hasText: 'filas con error' }).first();
  const n = Number((await tarjeta.textContent())!.match(/(\d+)\s*filas con error/)![1]);
  expect(n).toBeGreaterThan(0);
  await evidencia(page, 'T2-03_liceo05');
  await page.getByRole('button', { name: 'Cancelar' }).click();              // no se carga: solo se revisa
  await expect(page.getByText(/aún no tiene nómina/i)).toBeVisible();
});

// ============================================================================
// PASO 4 · archivos inválidos (en el liceo 02, que debe seguir SIN nómina)
// ============================================================================
const invalidos = [
  { caso: 'vacio.xlsx', archivo: async () => { const wb = new ExcelJS.Workbook(); wb.addWorksheet('Hoja1'); return { name: 'vacio.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(await wb.xlsx.writeBuffer()) }; }, esperado: 'sin-alumnos' },
  { caso: 'falso.xlsx', archivo: async () => ({ name: 'falso.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') }), esperado: 'sin-alumnos' },
  { caso: 'texto.txt', archivo: async () => ({ name: 'texto.txt', mimeType: 'text/plain', buffer: Buffer.from('hola, no soy un Excel') }), esperado: 'error' },
  { caso: 'grande.xlsx', archivo: async () => ({ name: 'grande.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.alloc(11 * 1024 * 1024, 1) }), esperado: 'error' },
];
for (const [i, c] of invalidos.entries()) {
  test(`T2-04${'abcd'[i]} · archivo inválido ${c.caso}: no se puede cargar y no hay "Internal server error"`, async ({ page }) => {
    await page.goto(`/liceos/${L['02'].id}`);
    await page.locator('input[type=file]').first().setInputFiles(await c.archivo());

    if (c.esperado === 'sin-alumnos') {
      // Se abre la revisión, pero sin alumnos: el botón de cargar queda deshabilitado.
      await expect(page.getByRole('button', { name: /Cargar 0 alumnos/ })).toBeDisabled();
    } else {
      // Se rechaza con un aviso rojo y no se abre la revisión.
      await expect(page.locator('.bg-red-700').first()).toBeVisible();
      await expect(page.getByText(/Revisar nómina/)).toHaveCount(0);
    }
    await expect(page.getByText(/internal server error/i)).toHaveCount(0);
    await evidencia(page, `T2-04${'abcd'[i]}_archivo-invalido`);
  });
}
test('T2-04e · tras los archivos inválidos el liceo 02 sigue sin nómina', async ({ page }) => {
  await page.goto(`/liceos/${L['02'].id}`);
  await expect(page.getByText(/aún no tiene nómina/i)).toBeVisible();
});

// ============================================================================
// PASO 5 · invitar a los N mejores (valores límite en el campo "Sugerir los N")
// ============================================================================
async function sugeridosEsperados(n: number, modo = 'liceo') {
  const r = await get(`/liceos/${L['04'].id}/nomina?modo=${modo}&n=${n}`);
  return r.alumnos.filter((a: any) => a.sugerido && !a.codigo).length as number;
}
test('T2-05 · campo "Sugerir los N": 3, 0, -1, vacío, texto y mayor al total', async ({ page }) => {
  await page.goto(`/liceos/${L['04'].id}`);
  const campo = page.locator('#sugerirN');
  const seleccionados = page.getByText(/\d+ seleccionados/);
  const crear = page.getByRole('button', { name: 'Crear Invitados' });

  // N = 3
  await campo.fill('3');
  await expect(seleccionados).toHaveText(`${await sugeridosEsperados(3)} seleccionados`);
  await evidencia(page, 'T2-05_valor-N-3');

  // N = 0, -1 y vacío: nadie seleccionado y no se puede crear invitados
  for (const v of ['0', '-1', '']) {
    await campo.fill(v);
    await expect(seleccionados).toHaveText('0 seleccionados');
    await expect(crear).toBeDisabled();
    await evidencia(page, `T2-05_valor-N-${v === '' ? 'vacio' : v}`);
  }

  // Texto: un campo numérico no deja escribir letras
  await campo.fill('0');
  await campo.click();
  await page.keyboard.type('abc');
  await expect(campo).not.toHaveValue(/[a-z]/i);
  await evidencia(page, 'T2-05_valor-N-abc');

  // Mayor al total: se limita a 200 y se sugiere a todos
  await campo.fill('9999');
  await expect(campo).toHaveValue('200');
  await expect(seleccionados).toHaveText(`${estado.total04} seleccionados`);
  await evidencia(page, 'T2-05_valor-N-9999');

  // Modo "de cada curso"
  await page.getByLabel('Cómo sugerir').selectOption('curso');
  await expect(campo).toHaveValue('3');
  await expect(seleccionados).toHaveText(`${await sugeridosEsperados(3, 'curso')} seleccionados`);
  await evidencia(page, 'T2-05_por-curso');
});

test('T2-05f · crear 3 invitados desde la pantalla y no se puede invitar dos veces a los mismos', async ({ page }) => {
  await page.goto(`/liceos/${L['04'].id}`);
  await page.locator('#sugerirN').fill('3');
  const esperados = await sugeridosEsperados(3);
  await page.getByRole('button', { name: 'Crear Invitados' }).click();
  await expect(page.getByText(`Invitar a ${esperados} estudiantes`)).toBeVisible();
  await evidencia(page, 'T2-05f_confirmar-invitados');
  await page.getByRole('button', { name: 'Confirmar' }).click();

  await expect(page.getByText(new RegExp(`${esperados} invitados: 04\\.\\d{3}[a-z]`))).toBeVisible();
  await evidencia(page, 'T2-05f_invitados-creados');

  // Con los mismos N, ya no queda nadie por invitar (los ya invitados no se vuelven a marcar)
  await page.reload();
  await page.locator('#sugerirN').fill('3');
  await expect(page.getByText('0 seleccionados')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear Invitados' })).toBeDisabled();

  estado.invitadosCodigos = (await get('/invitados')).map((i: any) => i.codigo);
  expect(estado.invitadosCodigos!.length).toBe(esperados);
});

// ============================================================================
// PASO 6 · respuestas de Forms (RUT, email y estudiante no invitado)
// ============================================================================
test('T2-06 · importar Forms: la fila válida se guarda; RUT malo, email malo y no invitado se reportan', async ({ page }) => {
  const inv: any[] = await get('/invitados');
  expect(inv.length).toBeGreaterThanOrEqual(3);
  const [A, B, C] = inv;
  const nombre = (x: any) => `${x.nombres} ${x.apellido_paterno} ${x.apellido_materno ?? ''}`.trim();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  ws.addRow(['Id', 'Nombre completo del estudiante', 'RUT', 'Liceo', 'Correo de contacto', 'Teléfono de contacto', '¿Aceptas postular?']);
  ws.addRow([1, nombre(A), `20123456-${dv('20123456')}`, '04', 'a.valido@gmail.com', '912345678', 'Sí']);
  ws.addRow([2, nombre(B), `20123457-${dv('20123457') === '1' ? '2' : '1'}`, '04', 'b.rutmalo@gmail.com', '987654321', 'Sí']);
  ws.addRow([3, nombre(C), `20123458-${dv('20123458')}`, '04', 'c@@gmail', '923456789', 'Sí']);
  ws.addRow([4, 'Zacarías Quintrilaf Wenuleo', `20123459-${dv('20123459')}`, '04', 'noinvitado@gmail.com', '934567890', 'Sí']);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  await page.goto('/invitados');
  await page.getByRole('button', { name: 'Importar respuestas del formulario' }).click();
  await evidencia(page, 'T2-06_paso1');
  await page.locator('input[type=file]').last().setInputFiles({ name: 'respuestas_forms_qa.xlsx', mimeType: 'application/octet-stream', buffer });

  await expect(page.getByText(/Importar respuestas — respuestas_forms_qa\.xlsx/)).toBeVisible();
  await expect(page.getByText('4 respuestas')).toBeVisible();
  await expect(page.getByText(/no es válido: no se carga/)).toBeVisible();        // RUT con dígito verificador malo
  await expect(page.getByText(/no parece un email/)).toBeVisible();               // email malformado
  await expect(page.getByText(/1 sin calce/)).toBeVisible();                      // estudiante no invitado
  await evidencia(page, 'T2-06_forms');

  await page.getByRole('button', { name: /Guardar datos de \d+ invitados/ }).click();
  await expect(page.getByText(/Datos actualizados en \d+ invitados/)).toBeVisible();

  // Verificación del resultado (lo que quedó guardado), por API
  const despues: any[] = await get('/invitados');
  const a = despues.find((x) => x.id === A.id), b = despues.find((x) => x.id === B.id), c = despues.find((x) => x.id === C.id);
  expect(a.email).toBe('a.valido@gmail.com');
  expect(a.rut).toBe(`20123456-${dv('20123456')}`);
  expect(b.rut, 'el RUT inválido no debe guardarse').toBeNull();
  expect(c.email, 'el email malformado no debe guardarse').toBeNull();
  expect(despues.length).toBe(inv.length);                                         // el no invitado no se creó
});

// ============================================================================
// PASO 7 y 8 · seguimiento por liceo y correos
// ============================================================================
test('T2-07 · seguimiento por liceo: hitos automáticos marcados para el liceo 04 (y no para el 02)', async ({ page }) => {
  await page.goto('/seguimiento');
  await expect(page.getByText(/Seguimiento/i).first()).toBeVisible();
  await evidencia(page, 'T2-07_seguimiento');
  const g = await get('/hitos');
  const f04 = g.filas.find((x: any) => x.codigo === '04');
  const f02 = g.filas.find((x: any) => x.codigo === '02');
  expect(f04.hitos.RECEPCION_NOMINA?.completado).toBe(true);
  expect(f04.hitos.DEFINICION_INVITADOS?.completado).toBe(true);
  expect(f02.hitos.RECEPCION_NOMINA?.completado ?? false).toBe(false);
});

test('T2-08 · estas acciones no mandan correos (Mailpit queda igual)', async () => {
  const despues = await correosMailpit();
  test.skip(despues === null || estado.correosAntes === null, 'Mailpit no disponible');
  expect(despues).toBe(estado.correosAntes);
});