// ============================================================================
// TEST 2 · E2E BACKEND · Etapa 1: nóminas, invitación por promedio y Forms
//
// Qué hace: golpea la API real (igual que lo haría el frontend) y comprueba los
// casos definidos por el equipo en el informe E2E, incluidos los casos de falla.
//
// Cómo correrlo (con el sistema levantado y la base RECIÉN cargada):
//   1) cd backend && npm ci                      (instala exceljs, una sola vez)
//   2) node --test test/e2e-test2-etapa1-backend.mjs
//
// Variables opcionales:
//   API      (por defecto http://localhost:8080/api)
//   MAILPIT  (por defecto http://localhost:8025)
//
// Copia este archivo dentro de  backend/test/  (usa ../../db/nominas-demo/).
// Cada `test(...)` de abajo es un caso del informe: el nombre dice cuál.
// ============================================================================
import { test, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';

const API = process.env.API ?? 'http://localhost:8080/api';
const MAILPIT = process.env.MAILPIT ?? 'http://localhost:8025';
const DEMO = new URL('../../db/nominas-demo/', import.meta.url);

let token = '';
const L = {};              // liceos por código: L['01'].id
const estado = {};         // datos compartidos entre casos (ids, conteos)

// ---------------------------------------------------------------- utilidades
/** Llama a la API y devuelve {status, data, texto}; nunca lanza por el código HTTP. */
async function api(metodo, ruta, { json, form, auth = true } = {}) {
  const headers = {};
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + ruta, { method: metodo, headers, body: form ?? (json !== undefined ? JSON.stringify(json) : undefined) });
  const texto = await r.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON (p. ej. HTML de nginx) */ }
  return { status: r.status, data, texto };
}

function formArchivo(buffer, nombre, campo = 'archivo', extra = {}) {
  const f = new FormData();
  f.append(campo, new Blob([buffer]), nombre);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
}
const demo = (nombre) => readFileSync(new URL(nombre, DEMO));

/** Un 5xx nunca es una respuesta aceptable a un dato malo. */
const sinError500 = (r, contexto) =>
  assert.ok(r.status < 500, `${contexto}: el servidor respondió ${r.status} (${r.texto.slice(0, 200)})`);

/** Dígito verificador de un RUT chileno (para armar RUT válidos e inválidos). */
function dv(cuerpo) {
  let suma = 0, mult = 2;
  for (const d of String(cuerpo).split('').reverse()) { suma += Number(d) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const r = 11 - (suma % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}
const rutValido = (cuerpo) => `${cuerpo}-${dv(cuerpo)}`;
const rutInvalido = (cuerpo) => `${cuerpo}-${dv(cuerpo) === '1' ? '2' : '1'}`; // mismo cuerpo, dígito verificador incorrecto

async function cantidadCorreosMailpit() {
  try {
    const r = await fetch(`${MAILPIT}/api/v1/messages?limit=1`);
    return (await r.json()).total;
  } catch { return null; }
}

/** Excel de respuestas estilo Forms, con las columnas que usa el sistema. */
async function excelForms(filas) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  ws.addRow(['Id', 'Nombre completo del estudiante', 'RUT', 'Liceo', 'Correo de contacto', 'Teléfono de contacto', '¿Aceptas postular?']);
  filas.forEach((f, i) => ws.addRow([i + 1, f.nombre, f.rut, f.liceo, f.email, f.telefono, f.acepta ?? 'Sí']));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const MAPEO_FORMS = { nombre: 2, rut: 3, liceo: 4, email: 5, telefono: 6, acepta: 7 };

// ------------------------------------------------------------------ preparar
before(async () => {
  // Sesión
  const login = await api('POST', '/auth/login', { json: { email: 'coordinacion@fcg.cl', password: 'Demo1234!' }, auth: false });
  assert.ok([200, 201].includes(login.status), `login: ${login.status} ${login.texto}`);
  token = login.data.token;

  // Proceso activo (la base demo parte sin proceso: se inicia igual que en la pantalla "Iniciar proceso")
  let inicio = (await api('GET', '/proceso/inicio')).data;
  if (!inicio.activo) {
    if (!inicio.borrador) inicio = (await api('POST', '/proceso/borrador', { json: { anio: inicio.anioSugerido } })).data;
    const confirmado = await api('POST', '/proceso/borrador/confirmar');
    assert.ok(confirmado.status < 300, `confirmar proceso: ${confirmado.texto}`);
  }
  const liceos = (await api('GET', '/liceos')).data;
  for (const l of liceos) L[l.codigo] = l;
  for (const cod of ['01', '04', '05']) assert.ok(L[cod], `falta el liceo ${cod} en la base demo`);
  estado.correosAntes = await cantidadCorreosMailpit();
});

// ============================================================================
// PASO 0 · seguridad básica de los endpoints de la etapa
// ============================================================================
test('T2-00 · sin sesión no se puede subir una nómina (401)', async () => {
  const r = await api('POST', `/liceos/${L['01'].id}/nomina/previsualizar`, { form: formArchivo(demo('nomina_liceo_01.xlsx'), 'nomina_liceo_01.xlsx'), auth: false });
  assert.equal(r.status, 401);
});

// ============================================================================
// PASO 1 · nómina válida
// ============================================================================
test('T2-01 · nómina válida: previsualizar lee los alumnos y NO guarda nada', async () => {
  const r = await api('POST', `/liceos/${L['01'].id}/nomina/previsualizar`, { form: formArchivo(demo('nomina_liceo_01.xlsx'), 'nomina_liceo_01.xlsx') });
  assert.equal(r.status, 200, r.texto);
  assert.ok(r.data.totalAlumnos > 0, 'debe leer al menos un alumno');
  assert.equal(r.data.errores.length, 0, 'la nómina válida no debe traer errores');
  assert.equal(r.data.alumnos.length, r.data.totalAlumnos);
  estado.total01 = r.data.totalAlumnos;

  const antes = await api('GET', `/liceos/${L['01'].id}/nomina`);
  assert.equal(antes.data.carga, null, 'previsualizar no debe dejar nada guardado');
});

test('T2-01b · confirmar guarda la nómina y la lista queda ordenada por promedio', async () => {
  const r = await api('POST', `/liceos/${L['01'].id}/nomina`, { form: formArchivo(demo('nomina_liceo_01.xlsx'), 'nomina_liceo_01.xlsx') });
  assert.equal(r.status, 201, r.texto);
  assert.equal(r.data.totalAlumnos, estado.total01);

  const n = (await api('GET', `/liceos/${L['01'].id}/nomina?n=10`)).data;
  assert.equal(n.alumnos.length, estado.total01, 'cantidad guardada = cantidad leída');
  const promedios = n.alumnos.map((a) => a.promedio);
  const ordenados = [...promedios].sort((a, b) => b - a);
  assert.deepEqual(promedios, ordenados, 'los alumnos deben venir de mayor a menor promedio');
  assert.ok(promedios.every((p) => p >= 1 && p <= 7), 'todos los promedios entre 1,0 y 7,0');
  estado.nomina01 = n.alumnos;
});

// ============================================================================
// PASO 2 · subir la misma nómina otra vez (no debe duplicar)
// ============================================================================
test('T2-02 · reenviar la misma nómina avisa y no duplica estudiantes', async () => {
  const prev = await api('POST', `/liceos/${L['01'].id}/nomina/previsualizar`, { form: formArchivo(demo('nomina_liceo_01.xlsx'), 'nomina_liceo_01.xlsx') });
  assert.ok(prev.data.advertencias.some((a) => /ya tiene una nómina/i.test(a.mensaje)), 'debe avisar que reemplaza la anterior');

  const conf = await api('POST', `/liceos/${L['01'].id}/nomina`, { form: formArchivo(demo('nomina_liceo_01.xlsx'), 'nomina_liceo_01.xlsx') });
  assert.equal(conf.status, 201, conf.texto);
  const despues = (await api('GET', `/liceos/${L['01'].id}/nomina`)).data;
  assert.equal(despues.alumnos.length, estado.total01, 'misma cantidad de alumnos tras reenviar (sin duplicados)');
});

// ============================================================================
// PASO 3 · nómina con errores (liceo 05)
// ============================================================================
test('T2-03 · nómina del liceo 05: reporta los errores por fila y carga todo-o-nada de forma consistente', async () => {
  const f = () => formArchivo(demo('nomina_liceo_05.xlsx'), 'nomina_liceo_05.xlsx');
  const prev = await api('POST', `/liceos/${L['05'].id}/nomina/previsualizar`, { form: f() });
  assert.equal(prev.status, 200, prev.texto);
  assert.ok(prev.data.errores.length > 0, 'debe reportar errores');
  assert.ok(prev.data.errores.every((e) => e.mensaje), 'cada error trae un mensaje legible');
  assert.equal((await api('GET', `/liceos/${L['05'].id}/nomina`)).data.carga, null, 'previsualizar no guarda');

  const conf = await api('POST', `/liceos/${L['05'].id}/nomina`, { form: f() });
  sinError500(conf, 'confirmar liceo 05');
  assert.equal(conf.status, 201, conf.texto);
  // Estado final coherente: lo que se cargó = lo que la previsualización dijo que se cargaría.
  const guardada = (await api('GET', `/liceos/${L['05'].id}/nomina`)).data;
  assert.equal(guardada.alumnos.length, prev.data.totalAlumnos, 'ni más ni menos que lo anunciado (sin carga a medias)');
  assert.equal(conf.data.errores.length, prev.data.errores.length, 'los errores quedan registrados en la carga');
});

// ============================================================================
// PASO 4 · archivos inválidos (en el liceo 04, que debe quedar SIN nómina)
// ============================================================================
async function excelVacio() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Hoja1');
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const archivosInvalidos = [
  { caso: 'vacio.xlsx (Excel sin contenido)', nombre: 'vacio.xlsx', buffer: excelVacio },
  { caso: 'falso.xlsx (un PDF renombrado)', nombre: 'falso.xlsx', buffer: () => Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n') },
  { caso: 'texto.txt (extensión no permitida)', nombre: 'texto.txt', buffer: () => Buffer.from('hola, esto no es un Excel') },
  { caso: 'grande.xlsx (más de 10 MB)', nombre: 'grande.xlsx', buffer: () => Buffer.alloc(11 * 1024 * 1024, 1) },
];
for (const a of archivosInvalidos) {
  test(`T2-04 · archivo inválido: ${a.caso} se rechaza con un mensaje claro y sin error 500`, async () => {
    const buf = await a.buffer();
    const prev = await api('POST', `/liceos/${L['04'].id}/nomina/previsualizar`, { form: formArchivo(buf, a.nombre) });
    sinError500(prev, `previsualizar ${a.nombre}`);
    const conf = await api('POST', `/liceos/${L['04'].id}/nomina`, { form: formArchivo(buf, a.nombre) });
    sinError500(conf, `confirmar ${a.nombre}`);

    // Confirmar NUNCA debe aceptar el archivo.
    assert.ok([400, 413].includes(conf.status), `confirmar debe rechazar (400/413), respondió ${conf.status}`);
    // Previsualizar: o rechaza (400/413) o responde 200 con 0 alumnos y el motivo en errores/advertencias.
    if (prev.status === 200) {
      assert.equal(prev.data.totalAlumnos, 0, 'no debe "leer" alumnos de un archivo inválido');
      assert.ok(prev.data.errores.length + prev.data.advertencias.length > 0, 'debe explicar el problema');
    } else {
      assert.ok([400, 413].includes(prev.status), `status inesperado ${prev.status}`);
    }
    // Y la base no cambia.
    assert.equal((await api('GET', `/liceos/${L['04'].id}/nomina`)).data.carga, null, 'no debe quedar nada guardado en el liceo 04');
  });
}

test('T2-04e · subir sin adjuntar archivo → 400 (no 500)', async () => {
  const r = await api('POST', `/liceos/${L['04'].id}/nomina/previsualizar`, { form: new FormData() });
  assert.equal(r.status, 400, r.texto);
});

test('T2-04f · liceo inexistente / id mal formado → 404 / 400', async () => {
  const f = formArchivo(demo('nomina_liceo_01.xlsx'), 'nomina_liceo_01.xlsx');
  const noExiste = await api('POST', '/liceos/00000000-0000-4000-8000-000000000000/nomina/previsualizar', { form: f });
  assert.equal(noExiste.status, 404, noExiste.texto);
  const malId = await api('GET', '/liceos/abc/nomina');
  assert.equal(malId.status, 400, malId.texto);
});

// ============================================================================
// PASO 5 · invitar a los N mejores (valores límite)
// Oráculo independiente: se calcula a mano desde los promedios de la nómina.
// ============================================================================
const esperadosTop = (alumnos, n) => {
  if (n <= 0) return 0;
  const orden = alumnos.map((a) => a.promedio).sort((a, b) => b - a);
  if (n >= orden.length) return orden.length;
  const corte = orden[n - 1];                    // el N-ésimo mejor promedio
  return orden.filter((p) => p >= corte).length; // los empates en el límite entran todos
};
const sugeridos = (nomina) => nomina.alumnos.filter((a) => a.sugerido).length;

test('T2-05a · N = 3 sugiere exactamente a los 3 mejores (más empates en el límite)', async () => {
  const n = (await api('GET', `/liceos/${L['01'].id}/nomina?modo=liceo&n=3`)).data;
  assert.equal(sugeridos(n), esperadosTop(estado.nomina01, 3));
  assert.ok(sugeridos(n) >= 3);
  // los sugeridos son realmente los de mayor promedio
  const minSug = Math.min(...n.alumnos.filter((a) => a.sugerido).map((a) => a.promedio));
  const maxNoSug = Math.max(0, ...n.alumnos.filter((a) => !a.sugerido).map((a) => a.promedio));
  assert.ok(minSug >= maxNoSug, 'ningún no-sugerido supera a un sugerido');
});

test('T2-05b · N = 0 no sugiere a nadie', async () => {
  const r = await api('GET', `/liceos/${L['01'].id}/nomina?modo=liceo&n=0`);
  assert.equal(r.status, 200);
  assert.equal(sugeridos(r.data), 0);
});

test('T2-05c · N = -1: no da error 500 y no sugiere a nadie (la API lo trata como 0)', async () => {
  const r = await api('GET', `/liceos/${L['01'].id}/nomina?modo=liceo&n=-1`);
  sinError500(r, 'n=-1');
  assert.equal(r.status, 200);
  assert.equal(sugeridos(r.data), 0, 'un N negativo nunca debe sugerir estudiantes');
  // OBSERVACIÓN para el informe: el informe esperaba "se bloquea con validación"; la API no responde 400,
  // sino que corrige el valor a 0 en silencio. Anótalo como hallazgo de gravedad baja.
});

test('T2-05d · N = "abc" y N vacío: no dan error 500 y usan el valor por defecto (10)', async () => {
  for (const q of ['n=abc', 'n=']) {
    const r = await api('GET', `/liceos/${L['01'].id}/nomina?modo=liceo&${q}`);
    sinError500(r, q);
    assert.equal(r.status, 200, q);
    assert.equal(r.data.n, 10, `${q} debe caer al valor por defecto`);
    assert.equal(sugeridos(r.data), esperadosTop(estado.nomina01, 10), q);
  }
  // OBSERVACIÓN: tampoco se rechaza con 400; se reemplaza por 10 sin avisar.
});

test('T2-05e · N mayor al total (9999) sugiere a todos, sin error', async () => {
  const r = await api('GET', `/liceos/${L['01'].id}/nomina?modo=liceo&n=9999`);
  assert.equal(r.status, 200);
  assert.equal(sugeridos(r.data), estado.total01);
});

test('T2-05f · modo "por curso": N = 3 sugiere a los 3 mejores de CADA curso', async () => {
  const r = (await api('GET', `/liceos/${L['01'].id}/nomina?modo=curso&n=3`)).data;
  assert.ok(r.cursos.length > 0);
  for (const c of r.cursos) {
    const promedios = c.alumnos.map((a) => a.promedio).sort((a, b) => b - a);
    const esperado = promedios.length <= 3 ? promedios.length : promedios.filter((p) => p >= promedios[2]).length;
    assert.equal(c.alumnos.filter((a) => a.sugerido).length, esperado, `curso ${c.curso}`);
  }
});

test('T2-05g · invitar: se crean exactamente los invitados elegidos, con Id único y formato correcto', async () => {
  const n = (await api('GET', `/liceos/${L['01'].id}/nomina?modo=liceo&n=3`)).data;
  const ids = n.alumnos.filter((a) => a.sugerido).map((a) => a.id);
  const r = await api('POST', '/invitados', { json: { alumnoIds: ids } });
  assert.equal(r.status, 201, r.texto);
  assert.equal(r.data.invitados.length, ids.length);
  const codigos = r.data.invitados.map((i) => i.codigo);
  assert.equal(new Set(codigos).size, codigos.length, 'los Id no se repiten');
  assert.ok(codigos.every((c) => /^01\.\d{3}[a-z]$/.test(c)), `formato de Id inesperado: ${codigos}`);
  estado.invitados = r.data.invitados;
  estado.idsInvitados = ids;
});

test('T2-05h · invitar de nuevo a los mismos → 409 y no se crean duplicados', async () => {
  const antes = (await api('GET', '/invitados')).data.length;
  const r = await api('POST', '/invitados', { json: { alumnoIds: estado.idsInvitados } });
  assert.equal(r.status, 409, r.texto);
  assert.equal((await api('GET', '/invitados')).data.length, antes);
});

test('T2-05i · invitar con datos inválidos: lista vacía, id mal formado, id inexistente y más de 500 → 400/404, nunca 500', async () => {
  const vacio = await api('POST', '/invitados', { json: { alumnoIds: [] } });
  assert.equal(vacio.status, 400, 'lista vacía');
  const malId = await api('POST', '/invitados', { json: { alumnoIds: ['abc'] } });
  assert.equal(malId.status, 400, 'id mal formado');
  const noExiste = await api('POST', '/invitados', { json: { alumnoIds: ['00000000-0000-4000-8000-000000000000'] } });
  assert.equal(noExiste.status, 404, noExiste.texto);
  const muchos = await api('POST', '/invitados', { json: { alumnoIds: Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) } });
  assert.equal(muchos.status, 400, 'más de 500');
  const sinCampo = await api('POST', '/invitados', { json: {} });
  assert.equal(sinCampo.status, 400, 'sin alumnoIds');
});

// ============================================================================
// PASO 6 · datos de Forms: RUT, email y estudiante no invitado
// ============================================================================
test('T2-06a · Forms (4 filas): fila válida calza; RUT malo, email malo y no invitado se reportan con su motivo', async () => {
  const inv = (await api('GET', '/invitados')).data;
  assert.ok(inv.length >= 3, 'se necesitan 3 invitados del test anterior');
  const [A, B, C] = estado.invitados.map((i) => inv.find((x) => x.id === i.id));
  const nombre = (x) => `${x.nombres} ${x.apellido_paterno} ${x.apellido_materno ?? ''}`.trim();
  const liceoTxt = '01';
  // alumno de la nómina que NO fue invitado (y cuyo apellido no se parece al de ningún invitado,
  // para que el sistema no pueda confundirlo con uno de ellos)
  const norm = (t) => (t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const apellidosInv = new Set(inv.map((x) => norm(x.apellido_paterno)));
  const noInvitado = estado.nomina01.find((a) => !estado.idsInvitados.includes(a.id) && !apellidosInv.has(norm(a.apellido_paterno)));
  assert.ok(noInvitado, 'no se encontró un alumno no invitado para la fila 4');

  const filas = [
    { nombre: nombre(A), rut: rutValido('20123456'), liceo: liceoTxt, email: 'a.valido@gmail.com', telefono: '912345678' },
    { nombre: nombre(B), rut: rutInvalido('20123457'), liceo: liceoTxt, email: 'b.rutmalo@gmail.com', telefono: '987654321' },
    { nombre: nombre(C), rut: rutValido('20123458'), liceo: liceoTxt, email: 'c@@gmail', telefono: '923456789' },
    { nombre: `${noInvitado.nombres} ${noInvitado.apellido_paterno} ${noInvitado.apellido_materno ?? ''}`.trim(), rut: rutValido('20123459'), liceo: liceoTxt, email: 'noinvitado@gmail.com', telefono: '934567890' },
  ];
  estado.formsFilas = filas;
  estado.formsInv = { A, B, C };
  const buf = await excelForms(filas);

  const prev = await api('POST', '/invitados/importar-contactos/previsualizar', { form: formArchivo(buf, 'respuestas_forms_qa.xlsx', 'archivo', { mapeo: JSON.stringify(MAPEO_FORMS) }) });
  assert.equal(prev.status, 200, prev.texto);
  const f = prev.data.filas;
  assert.equal(f.length, 4);

  // fila 1: válida
  assert.equal(f[0].calce, 'CALZA');
  assert.equal(f[0].invitado.id, A.id);
  assert.equal(f[0].limpio.rut, filas[0].rut);
  assert.equal(f[0].limpio.email, 'a.valido@gmail.com');
  assert.equal(f[0].limpio.telefono, '+56912345678');
  assert.equal(f[0].avisos.length, 0);
  // fila 2: RUT con dígito verificador incorrecto → no se carga el RUT y se explica
  assert.equal(f[1].limpio.rut, null);
  assert.ok(f[1].avisos.some((a) => /RUT/i.test(a) && /no es válido/i.test(a)), JSON.stringify(f[1].avisos));
  // fila 3: email malformado → no se carga el email y se explica
  assert.equal(f[2].limpio.email, null);
  assert.ok(f[2].avisos.some((a) => /email/i.test(a)), JSON.stringify(f[2].avisos));
  // fila 4: estudiante que no fue invitado → sin calce, sin invitado asociado
  assert.equal(f[3].calce, 'SIN_CALCE');
  assert.equal(f[3].invitado, null);
});

test('T2-06b · previsualizar el Forms no guarda nada', async () => {
  const { A } = estado.formsInv;
  const ahora = (await api('GET', '/invitados')).data.find((x) => x.id === A.id);
  assert.equal(ahora.email, A.email);
  assert.equal(ahora.rut, A.rut);
});

test('T2-06c · confirmar solo lo que calza: la fila válida se guarda; RUT malo y email malo NO se guardan; el no invitado no genera cambios', async () => {
  const prev = await api('POST', '/invitados/importar-contactos/previsualizar', {
    form: formArchivo(await excelForms(estado.formsFilas), 'respuestas_forms_qa.xlsx', 'archivo', { mapeo: JSON.stringify(MAPEO_FORMS) }),
  });
  // Lo mismo que hace la pantalla: solo las filas con invitado, con los datos ya limpios.
  const cambios = prev.data.filas.filter((x) => x.invitado).map((x) => ({
    invitadoId: x.invitado.id, email: x.limpio.email, telefono: x.limpio.telefono, rut: x.limpio.rut, confirmacion: x.limpio.confirmacion ?? undefined,
  }));
  assert.equal(cambios.length, 3, 'la fila del no invitado no entra en los cambios');
  const r = await api('POST', '/invitados/importar-contactos', { json: { cambios } });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.data.actualizados, 3);

  const lista = (await api('GET', '/invitados')).data;
  const { A, B, C } = estado.formsInv;
  const a = lista.find((x) => x.id === A.id), b = lista.find((x) => x.id === B.id), c = lista.find((x) => x.id === C.id);
  assert.equal(a.rut, estado.formsFilas[0].rut);
  assert.equal(a.email, 'a.valido@gmail.com');
  assert.equal(a.telefono, '+56912345678');
  assert.equal(b.rut, null, 'el RUT inválido NO debe haberse guardado');
  assert.equal(c.email, null, 'el email malformado NO debe haberse guardado');
});

test('T2-06d · confirmar con datos inválidos directo a la API: 400 y NADA se guarda (todo o nada)', async () => {
  const { C } = estado.formsInv;
  const antes = (await api('GET', '/invitados')).data;
  const rutMalo = await api('POST', '/invitados/importar-contactos', { json: { cambios: [
    { invitadoId: estado.formsInv.A.id, telefono: '+56911111111' },
    { invitadoId: C.id, rut: '12.345.678-9' },
  ] } });
  assert.equal(rutMalo.status, 400, rutMalo.texto);
  const emailMalo = await api('POST', '/invitados/importar-contactos', { json: { cambios: [{ invitadoId: C.id, email: 'no-es-email' }] } });
  assert.equal(emailMalo.status, 400, emailMalo.texto);
  const despues = (await api('GET', '/invitados')).data;
  assert.deepEqual(despues.map((x) => [x.id, x.email, x.rut, x.telefono]), antes.map((x) => [x.id, x.email, x.rut, x.telefono]), 'nada debe haber cambiado');
});

test('T2-06e · el mismo RUT en dos personas distintas → 409', async () => {
  const { A, C } = estado.formsInv;
  const r = await api('POST', '/invitados/importar-contactos', { json: { cambios: [{ invitadoId: C.id, rut: estado.formsFilas[0].rut }] } });
  assert.equal(r.status, 409, `el RUT de ${A.codigo} no puede asignarse a ${C.codigo}: ${r.texto}`);
});

test('T2-06f · Forms: archivos inválidos (.txt, falso.xlsx) → 400, nunca 500', async () => {
  const txt = await api('POST', '/invitados/importar-contactos/previsualizar', { form: formArchivo(Buffer.from('hola'), 'respuestas.txt') });
  assert.equal(txt.status, 400, txt.texto);
  const falso = await api('POST', '/invitados/importar-contactos/previsualizar', { form: formArchivo(Buffer.from('%PDF-1.4'), 'falso.xlsx') });
  assert.equal(falso.status, 400, falso.texto);
  const mapeoMalo = await api('POST', '/invitados/importar-contactos/previsualizar', { form: formArchivo(await excelForms(estado.formsFilas), 'r.xlsx', 'archivo', { mapeo: '{no es json' }) });
  assert.equal(mapeoMalo.status, 400, mapeoMalo.texto);
});

test('T2-06g · Forms sin indicar columnas: el sistema las detecta solo (email, RUT, teléfono, nombre)', async () => {
  const prev = await api('POST', '/invitados/importar-contactos/previsualizar', { form: formArchivo(await excelForms(estado.formsFilas), 'respuestas_forms_qa.xlsx') });
  assert.equal(prev.status, 200, prev.texto);
  const m = prev.data.mapeo;
  for (const campo of ['nombre', 'rut', 'email', 'telefono']) assert.ok(m[campo], `no detectó la columna "${campo}"`);
  assert.equal(m.rut, 3);
  assert.equal(m.email, 5);
});

// ============================================================================
// PASO 7 · seguimiento por liceo   |   PASO 8 · correos
// ============================================================================
test('T2-07 · seguimiento: se marcan solos "Nómina recibida" y "Definición de invitados" en el liceo 01 (y no en uno sin nómina)', async () => {
  const g = (await api('GET', '/hitos')).data;
  const f01 = g.filas.find((x) => x.codigo === '01');
  assert.equal(f01.hitos.RECEPCION_NOMINA?.completado, true, 'RECEPCION_NOMINA en liceo 01');
  assert.equal(f01.hitos.DEFINICION_INVITADOS?.completado, true, 'DEFINICION_INVITADOS en liceo 01');
  const f04 = g.filas.find((x) => x.codigo === '04');
  assert.ok(!f04.hitos.RECEPCION_NOMINA?.completado, 'el liceo 04 no tiene nómina: su hito no debe estar marcado');
  assert.ok(!f04.hitos.DEFINICION_INVITADOS?.completado);
});

test('T2-08 · cargar nóminas, invitar e importar contactos NO envía correos', async () => {
  const despues = await cantidadCorreosMailpit();
  if (estado.correosAntes === null || despues === null) return console.log('  (Mailpit no disponible: caso omitido)');
  assert.equal(despues, estado.correosAntes, 'estas acciones no deben generar correos (los envíos son una acción aparte en Comunicación)');
});
