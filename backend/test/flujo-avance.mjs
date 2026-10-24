// Prueba del avance entre etapas. Se corre DESPUÉS de flujo-etapa1.mjs (usa sus datos).
// Uso:  node test/flujo-etapa1.mjs && node test/flujo-avance.mjs
import { strict as assert } from 'assert';

const API = process.env.API ?? 'http://localhost:3000/api';
let token = '';
async function api(metodo, ruta, cuerpo, { esperado = [200, 201] } = {}) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(cuerpo && { 'Content-Type': 'application/json' }) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const t = await r.text();
  const d = t ? JSON.parse(t) : null;
  if (!esperado.includes(r.status)) throw new Error(`${metodo} ${ruta} → ${r.status}: ${t}`);
  return d;
}
const paso = (t) => console.log(`\n▸ ${t}`);

token = (await api('POST', '/auth/login', { email: 'coordinacion@fcg.cl', password: 'Demo1234!' })).token;
let proceso = await api('GET', '/proceso');
const [E1, E2, E3] = proceso.etapas;
console.log(`etapas: ${proceso.etapas.map((e) => `${e.orden}.${e.nombre} (${e.estudiantes} est., cupo ${e.cupo ?? '—'}, ${e.requisitos} req.)`).join(' | ')}`);

paso('Etapa 1: marcar según la respuesta a la invitación');
let v1 = await api('GET', `/avance/${E1.id}`);
console.log(`  ${v1.estudiantes.length} estudiantes en la etapa · ${JSON.stringify(v1.resumen)}`);
await api('POST', `/avance/${E1.id}/confirmar`, {}, { esperado: [400] });
console.log('  ok: confirmar sin marcas → 400');
const sug = await api('POST', `/avance/${E1.id}/sugerir-desde-confirmacion`);
v1 = await api('GET', `/avance/${E1.id}`);
console.log(`  sugeridos ${sug.marcados}: pasan ${v1.resumen.marcados_pasa}, no pasan ${v1.resumen.marcados_no_pasa}, sin decidir ${v1.resumen.pendientes_de_decidir}`);
assert.equal(v1.resumen.marcados_pasa, 10);
assert.equal(v1.resumen.marcados_no_pasa, 1);

paso('Marcar a mano a los que faltan y cambiar una marca');
const sinMarca = v1.estudiantes.filter((x) => !x.resultado);
await api('PUT', `/avance/${E1.id}/estudiantes/${sinMarca[0].id}/resultado`, { resultado: 'NO_PASA' });
await api('PUT', `/avance/${E1.id}/estudiantes/${sinMarca[1].id}/resultado`, { resultado: 'PASA' });
await api('PUT', `/avance/${E1.id}/estudiantes/${sinMarca[1].id}/resultado`, { resultado: null });
v1 = await api('GET', `/avance/${E1.id}`);
console.log(`  pasan ${v1.resumen.marcados_pasa}, no pasan ${v1.resumen.marcados_no_pasa}, sin decidir ${v1.resumen.pendientes_de_decidir}`);
assert.equal(v1.resumen.pendientes_de_decidir, 1);

paso('Antes de confirmar nada cambió');
let p0 = await api('GET', '/proceso');
assert.equal(p0.etapas[1].estudiantes, 0);
console.log(`  etapa 2 sigue con ${p0.etapas[1].estudiantes} estudiantes`);

paso('Confirmar avance de la etapa 1');
const conf = await api('POST', `/avance/${E1.id}/confirmar`, {});
console.log(`  pasan ${conf.pasan}, no pasan ${conf.noPasan} → siguiente: ${conf.siguiente.nombre}`);
assert.deepEqual([conf.pasan, conf.noPasan], [10, 2]);
proceso = await api('GET', '/proceso');
console.log(`  etapa 1: ${proceso.etapas[0].estudiantes} activos · etapa 2: ${proceso.etapas[1].estudiantes}`);
assert.equal(proceso.etapas[1].estudiantes, 10);
const confirmado = (await api('GET', `/avance/${E1.id}`)).estudiantes.find((x) => x.confirmado && x.resultado === 'PASA');
await api('PUT', `/avance/${E1.id}/estudiantes/${confirmado.id}/resultado`, { resultado: 'NO_PASA' }, { esperado: [409] });
console.log('  ok: no se puede cambiar un resultado confirmado sin deshacerlo (409)');

paso('Deshacer una confirmación y volver a confirmar');
await api('POST', `/avance/${E1.id}/estudiantes/${confirmado.id}/deshacer`);
proceso = await api('GET', '/proceso');
assert.equal(proceso.etapas[1].estudiantes, 9);
console.log(`  deshecho: etapa 2 tiene ${proceso.etapas[1].estudiantes}`);
await api('POST', `/avance/${E1.id}/confirmar`, { postulacionIds: [confirmado.id] });
proceso = await api('GET', '/proceso');
assert.equal(proceso.etapas[1].estudiantes, 10);

paso('Avisar resultados: solo a quienes no se les ha avisado');
const plantillas = await api('GET', '/comunicacion/plantillas');
const pasa = plantillas.find((p) => p.nombre.startsWith('Aviso: avanzas'));
const noPasa = plantillas.find((p) => p.nombre.startsWith('Aviso: no contin'));
const filtroPasa = { etapaId: E1.id, tipo: 'PASA', soloSinAviso: true };
let prev = await api('POST', '/comunicacion/envios/previsualizar', { grupo: 'POSTULANTES', asunto: pasa.asunto, cuerpo: pasa.cuerpo, filtroEtapa: filtroPasa });
console.log(`  pasan: ${prev.destinatarios.length} con email, excluidos: ${prev.excluidos.map((x) => x.motivo).join(', ') || 'ninguno'}`);
await api('POST', '/comunicacion/envios', { grupo: 'POSTULANTES', asunto: pasa.asunto, cuerpo: pasa.cuerpo, plantillaId: pasa.id, filtroEtapa: filtroPasa });
prev = await api('POST', '/comunicacion/envios/previsualizar', { grupo: 'POSTULANTES', asunto: pasa.asunto, cuerpo: pasa.cuerpo, filtroEtapa: filtroPasa });
console.log(`  después del aviso, quedan ${prev.destinatarios.length + prev.excluidos.length} sin avisar`);
assert.equal(prev.destinatarios.length, 0);
const np = await api('POST', '/comunicacion/envios/previsualizar', { grupo: 'POSTULANTES', asunto: noPasa.asunto, cuerpo: noPasa.cuerpo, filtroEtapa: { etapaId: E1.id, tipo: 'NO_PASA' } });
console.log(`  no pasan: ${np.destinatarios.map((d) => d.nombre).join(', ')} (incluye a quien rechazó la invitación); sin email: ${np.excluidos.map((x) => x.nombre).join(', ')}`);
assert.equal(np.destinatarios.length + np.excluidos.length, 2);
assert.ok(np.excluidos.every((x) => x.motivo === 'Sin email registrado'));
const todos = await api('POST', '/comunicacion/envios/previsualizar', { grupo: 'POSTULANTES', asunto: 'x', cuerpo: 'y' });
console.log(`  envío a "todos los invitados": ${todos.destinatarios.length} destinatarios; ${todos.excluidos.filter((x) => /no continúa|Rechazó/.test(x.motivo)).length} fuera del proceso excluidos`);

paso('Etapa 2 → 3 y requisitos de la etapa 3');
const v2 = await api('GET', `/avance/${E2.id}`);
for (const x of v2.estudiantes) await api('PUT', `/avance/${E2.id}/estudiantes/${x.id}/resultado`, { resultado: 'PASA' });
await api('POST', `/avance/${E2.id}/confirmar`, {});
let v3 = await api('GET', `/avance/${E3.id}`);
console.log(`  etapa 3: ${v3.estudiantes.length} estudiantes · requisitos: ${v3.requisitos.map((r) => r.nombre).join(', ')}`);
for (const [i, x] of v3.estudiantes.entries()) {
  for (const [j, r] of v3.requisitos.entries()) {
    if (i < 4 || j < 2) await api('PUT', `/avance/${E3.id}/estudiantes/${x.id}/requisitos/${r.id}`, { cumplido: true });
  }
}
await api('PUT', `/avance/${E3.id}/estudiantes/${v3.estudiantes[0].id}/requisitos/${v3.requisitos[3].id}`, { cumplido: false });
v3 = await api('GET', `/avance/${E3.id}`);
console.log(`  con requisitos pendientes: ${v3.resumen.con_requisitos_pendientes} de ${v3.estudiantes.length}`);
assert.equal(v3.resumen.con_requisitos_pendientes, 7);
const faltan = await api('POST', '/comunicacion/envios/previsualizar', { grupo: 'POSTULANTES', asunto: 'Recordatorio', cuerpo: 'Te falta enviar documentos', filtroEtapa: { etapaId: E3.id, tipo: 'FALTAN_REQUISITOS' } });
console.log(`  recordatorio "faltan documentos": ${faltan.destinatarios.length} con email + ${faltan.excluidos.length} sin email`);
assert.equal(faltan.destinatarios.length + faltan.excluidos.length, 7);
const conLista = await api('POST', '/comunicacion/envios/previsualizar', { grupo: 'POSTULANTES', asunto: 'Recordatorio', cuerpo: 'Falta:\n{{documentos_pendientes}}', filtroEtapa: { etapaId: E3.id, tipo: 'FALTAN_REQUISITOS' } });
const d0 = conLista.destinatarios[0];
assert.ok(d0 && /• /.test(d0.cuerpo) && !d0.cuerpo.includes('{{'), 'documentos_pendientes se reemplaza');
console.log(`  {{documentos_pendientes}} → ${JSON.stringify(d0.cuerpo.split('\n').slice(1).join(' '))}`);
const req = await api('POST', `/avance/${E3.id}/requisitos`, { nombre: 'Cédula de identidad' });
await api('DELETE', `/avance/${E3.id}/requisitos/${req.id}`);

paso('Alerta del dashboard');
const dash = await api('GET', '/dashboard');
console.log(`  ${JSON.stringify(dash.pendientes)}`);
console.log(`  por etapa: ${dash.porEtapa.map((e) => `${e.orden}:${e.llegaron}/${e.en_etapa}`).join(' ')}`);
assert.equal(dash.pendientes.con_requisitos_pendientes, 7);

paso('Informe por liceo con {{estudiantes}}');
const informe = plantillas.find((p) => p.proposito === 'INFORME_LICEO');
const liceos = await api('GET', '/liceos');
const conInvitados = liceos.filter((l) => l.invitados > 0).map((l) => l.id);
const inf = await api('POST', '/comunicacion/envios/previsualizar', { grupo: 'LICEO', liceoIds: conInvitados, asunto: informe.asunto, cuerpo: informe.cuerpo });
console.log(`  ${inf.destinatarios.length} liceos; ejemplo para ${inf.destinatarios[0].liceo}:\n` +
  inf.destinatarios[0].cuerpo.split('\n').filter((l) => l.startsWith('•')).map((l) => `    ${l}`).join('\n'));
assert.match(inf.destinatarios[0].cuerpo, /• \d\d\.\d{3}a/);
assert.doesNotMatch(inf.destinatarios[0].cuerpo, /\{\{/);

paso('Invitados muestran su etapa y lo que les falta');
const inv = await api('GET', '/invitados');
const ej = inv.find((i) => i.faltan.length);
console.log(`  ${ej.codigo}: ${ej.etapa} · falta ${ej.faltan.join(', ')}`);

paso('Agregar una etapa entre la 2 y la 3, editarla y eliminarla');
proceso = await api('POST', '/proceso/etapas', { nombre: 'Revisión de antecedentes', despuesDe: E2.id, cupo: 40 });
console.log(`  ${proceso.etapas.map((e) => `${e.orden}.${e.nombre}[${e.estado}]`).join(' ')}`);
assert.equal(proceso.etapas.length, 6);
assert.equal(proceso.etapas[2].nombre, 'Revisión de antecedentes');
assert.equal(proceso.etapas[3].estudiantes, 10, 'los estudiantes de la etapa 3 no se mueven');
const nueva = proceso.etapas[2];
proceso = await api('PATCH', `/proceso/etapas/${nueva.id}`, { cupo: null, nombre: 'Revisión de RSH' });
assert.equal(proceso.etapas[2].cupo, null);
await api('DELETE', `/proceso/etapas/${E3.id}`, null, { esperado: [409] });
console.log('  ok: no se puede eliminar una etapa con estudiantes (409)');
proceso = await api('DELETE', `/proceso/etapas/${nueva.id}`);
assert.equal(proceso.etapas.length, 5);
assert.deepEqual(proceso.etapas.map((e) => e.orden), [1, 2, 3, 4, 5]);

paso('No se puede deshacer la etapa 1 de quien ya avanzó en la 2');
const avanzo = (await api('GET', `/avance/${E1.id}`)).estudiantes.find((x) => x.resultado === 'PASA');
await api('POST', `/avance/${E1.id}/estudiantes/${avanzo.id}/deshacer`, null, { esperado: [409] });
console.log('  ok: 409');

console.log('\n✔ Avance entre etapas completo');
