// Prueba del histórico de generaciones contra la API.
// Uso:  node test/flujo-generaciones.mjs   (correr después de flujo-etapa1 y flujo-avance)
// Escribe directo en la base con psql para simular el final del proceso
// (becarios), igual que flujo-etapa1 lo hace para el webhook.
import { execSync } from 'child_process';
import { strict as assert } from 'assert';

const API = process.env.API ?? 'http://localhost:3000/api';
let token = '';

async function api(metodo, ruta, cuerpo, { esperado = [200, 201, 204] } = {}) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(cuerpo && { 'Content-Type': 'application/json' }) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!esperado.includes(r.status)) throw new Error(`${metodo} ${ruta} → ${r.status}: ${texto}`);
  return datos;
}
const sql = (q) => execSync(`PGPASSWORD=becas_dev_password psql -h localhost -U becas -d becas -tAc "${q}"`).toString().trim();
const paso = (t) => console.log(`\n▸ ${t}`);

paso('Login');
token = (await api('POST', '/auth/login', { email: 'coordinacion@fcg.cl', password: 'Demo1234!' })).token;

paso('Generaciones con el proceso 2026 en curso');
let lista = await api('GET', '/generaciones');
console.log('  ' + lista.map((g) => `${g.anio} ${g.estado}${g.historico ? ' (histórica)' : ''}`).join(' · '));
assert.deepEqual(lista.map((g) => g.anio), [2026, 2025]);
assert.equal(lista[0].estado, 'ACTIVO');
assert.ok(lista[0].resumen.invitados > 0, 'el proceso en curso muestra sus números del momento');
assert.equal(lista[0].resumen.etapas[0].llegaron, lista[0].resumen.invitados, 'a la etapa 1 llegan todos los invitados');
// 2025 se cerró antes de existir el histórico: el resumen se calcula y se guarda la primera vez
assert.equal(sql(`SELECT resumen IS NOT NULL FROM procesos WHERE anio = 2025`), 't');
console.log(`  2026 en curso: ${lista[0].resumen.invitados} invitados · 2025: resumen guardado`);

paso('Generación histórica ingresada a mano');
const historica = {
  anio: 2024, liceos: 24, invitados: 300, aceptaron: null, becarios: null,
  etapas: [{ nombre: 'Preselección N°1', llegaron: 53 }, { nombre: 'Preselección N°2', llegaron: 21 }, { nombre: 'Selección de becarios', llegaron: null }],
  listaBecarios: [{ nombre: 'Ana Pérez', liceo: 'Liceo A' }, { nombre: 'Luis Soto' }],
  observaciones: 'Cargada desde la planilla 2024',
};
let g = await api('POST', '/generaciones/historicas', historica);
assert.equal(g.historico, true);
assert.equal(g.estado, 'CERRADO');
assert.equal(g.resumen.becarios, 2, 'sin número de becarios se usa el largo de la lista');
assert.deepEqual(g.resumen.etapas.map((e) => e.orden), [2, 3, 4]);
await api('POST', '/generaciones/historicas', historica, { esperado: [409] });
await api('POST', '/generaciones/historicas', { ...historica, anio: 2026 }, { esperado: [409] });
await api('POST', '/generaciones/historicas', { ...historica, anio: 2023, invitados: -1 }, { esperado: [400] });
g = await api('PUT', '/generaciones/historicas/2024', { ...historica, anio: 2023, becarios: 11 });
assert.equal(g.anio, 2023);
assert.equal(g.resumen.becarios, 11);
await api('PUT', '/generaciones/historicas/2025', historica, { esperado: [409] });
await api('DELETE', '/generaciones/historicas/2025', undefined, { esperado: [409] });
console.log('  ok: crear, año repetido (409), corregir y año del sistema no editable (409)');

paso('El año sugerido para el próximo proceso salta los años ocupados');
assert.equal((await api('GET', '/proceso/inicio')).anioSugerido, 2027);

paso('Cerrar 2026 guarda la foto del año');
const [ultima] = sql(`SELECT id FROM etapas WHERE proceso_id = (SELECT id FROM procesos WHERE anio = 2026) ORDER BY orden DESC LIMIT 1`).split('\n');
sql(`UPDATE postulaciones SET estado = 'BECARIO', etapa_id = '${ultima}'
      WHERE id IN (SELECT id FROM postulaciones WHERE proceso_id = (SELECT id FROM procesos WHERE anio = 2026)
                    AND confirmacion = 'CONFIRMADO' ORDER BY codigo LIMIT 2)`);
// Un liceo que no participó en 2026, para ver que "usar como base" lo deja fuera en 2027
const fuera = sql(`SELECT l.id FROM liceos l WHERE l.activo AND NOT EXISTS (SELECT 1 FROM postulaciones p WHERE p.liceo_id = l.id) ORDER BY l.codigo LIMIT 1`);
sql(`UPDATE participaciones_liceo SET incluido = FALSE WHERE liceo_id = '${fuera}' AND proceso_id = (SELECT id FROM procesos WHERE anio = 2026)`);
await api('POST', '/proceso/cerrar', { anio: 2026 });
assert.equal(sql(`SELECT estado || ' ' || (cerrado_en IS NOT NULL) || ' ' || (resumen IS NOT NULL) FROM procesos WHERE anio = 2026`), 'CERRADO true true');
const d = await api('GET', '/generaciones/2026');
assert.equal(d.resumen.becarios, 2);
assert.equal(d.resumen.lista_becarios.length, 2);
assert.equal(d.resumen.etapas.at(-1).llegaron, 2);
assert.ok(d.resumen.por_liceo.length > 0);
assert.equal(d.resumen.por_liceo[0].becarios > 0, true, 'los liceos con becarios van primero');
assert.equal(d.resumen.por_liceo[0].llegaron.length, d.resumen.etapas.length);
assert.ok(d.resumen.material.envios.length > 0);
console.log(`  2026: ${d.resumen.invitados} invitados → ${d.resumen.etapas.map((e) => e.llegaron).join(' → ')} · ${d.resumen.becarios} becarios`);
await api('PUT', '/generaciones/historicas/2026', historica, { esperado: [409] });
console.log('  ok: no se puede editar una generación del sistema');

paso('El histórico no cambia si después se edita un liceo');
const primero = d.resumen.por_liceo[0];
sql(`UPDATE liceos SET nombre = 'Nombre cambiado' WHERE codigo = '${primero.codigo}'`);
assert.equal((await api('GET', '/generaciones/2026')).resumen.por_liceo[0].nombre, primero.nombre);
console.log(`  ok: sigue diciendo "${primero.nombre}"`);

paso('Iniciar 2027 usando 2026 como base');
const inicio = await api('POST', '/proceso/borrador', { anio: 2027, usarBase: true });
const etapas2026 = Number(sql(`SELECT COUNT(*) FROM etapas WHERE proceso_id = (SELECT id FROM procesos WHERE anio = 2026)`));
assert.equal(inicio.borrador.etapas.length, etapas2026);
assert.equal(inicio.ultimo.anio, 2026, 'la generación ingresada a mano no cuenta como proceso anterior');
assert.equal(sql(`SELECT incluido FROM participaciones_liceo WHERE liceo_id = '${fuera}' AND proceso_id = (SELECT id FROM procesos WHERE anio = 2027)`), 'f');
console.log('  ok: copia las etapas y deja fuera al liceo que no participó en 2026');
lista = await api('GET', '/generaciones');
assert.deepEqual(lista.map((x) => x.anio), [2026, 2025, 2023], 'el proceso en preparación no aparece');

paso('Volver al inicio desde la revisión de liceos');
const liceo = (await api('GET', '/liceos?todos=1'))[0];
await api('PATCH', `/liceos/${liceo.id}`, { comuna: 'Comuna corregida' });
const vuelta = await api('DELETE', '/proceso/borrador');
assert.equal(vuelta.borrador, null);
assert.equal(vuelta.anioSugerido, 2027);
assert.equal(sql(`SELECT COUNT(*) FROM procesos WHERE anio = 2027`), '0');
assert.equal(sql(`SELECT comuna FROM liceos WHERE id = '${liceo.id}'`), 'Comuna corregida', 'los cambios a los liceos se mantienen');
await api('DELETE', '/proceso/borrador', undefined, { esperado: [404] });
console.log('  ok: se descarta el proceso en preparación y se mantienen los datos de los liceos');

paso('Eliminar la generación ingresada a mano');
await api('DELETE', '/generaciones/historicas/2023');
await api('GET', '/generaciones/2023', undefined, { esperado: [404] });

console.log('\n✔ Histórico de generaciones completo');
