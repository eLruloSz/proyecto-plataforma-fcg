// Prueba de punta a punta de la etapa 1 contra una API levantada con los datos demo.
// Uso:  node test/flujo-etapa1.mjs   (API en http://localhost:3000, base recién cargada)
import { readFileSync } from 'fs';
import { strict as assert } from 'assert';

const API = process.env.API ?? 'http://localhost:3000/api';
const DEMO = new URL('../../db/nominas-demo/', import.meta.url);
let token = '';

async function api(metodo, ruta, cuerpo, { esperado = [200, 201], form } = {}) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(cuerpo && { 'Content-Type': 'application/json' }) },
    body: form ?? (cuerpo ? JSON.stringify(cuerpo) : undefined),
  });
  const texto = await r.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!esperado.includes(r.status)) throw new Error(`${metodo} ${ruta} → ${r.status}: ${texto}`);
  return datos;
}
const archivo = (nombre) => {
  const f = new FormData();
  f.append('archivo', new Blob([readFileSync(new URL(nombre, DEMO))]), nombre);
  return f;
};
const paso = (t) => console.log(`\n▸ ${t}`);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
/** El envío ocurre en segundo plano: espera hasta que no quede nada en cola. */
async function esperarEnvio(id) {
  for (let i = 0; i < 120; i++) {
    const e = await api('GET', `/comunicacion/envios/${id}`);
    if (!e.destinatarios.some((d) => d.entrega === 'PENDIENTE')) return e;
    await espera(500);
  }
  throw new Error('El envío no terminó a tiempo');
}

// 1. Sesión
paso('Login');
await api('POST', '/auth/login', { email: 'coordinacion@fcg.cl', password: 'mala' }, { esperado: [401] });
token = (await api('POST', '/auth/login', { email: 'coordinacion@fcg.cl', password: 'Demo1234!' })).token;
await fetch(`${API}/liceos`).then((r) => assert.equal(r.status, 401, 'sin token debe dar 401'));
console.log('  ok: credenciales malas → 401, sin token → 401');

// 2. Proceso
paso('Proceso y etapas');
const proceso = await api('GET', '/proceso');
console.log(`  ${proceso.nombre}: ${proceso.etapas.map((e) => `${e.orden}.${e.estado}`).join(' ')}`);
assert.equal(proceso.etapas.filter((e) => e.estado === 'ACTIVA').length, 1);

const liceos = await api('GET', '/liceos');
const L = Object.fromEntries(liceos.map((l) => [l.codigo, l]));
console.log(`  ${liceos.length} liceos`);

// 3. Correo de presentación a todas las contrapartes
paso('Correo de presentación: previsualizar destinatarios');
const plantillas = await api('GET', '/comunicacion/plantillas');
const pres = plantillas.find((p) => p.proposito === 'PRESENTACION');
const previa = await api('POST', '/comunicacion/envios/previsualizar', {
  grupo: 'CONTRAPARTES', asunto: pres.asunto, cuerpo: pres.cuerpo, plantillaId: pres.id,
});
console.log(`  ${previa.destinatarios.length} destinatarios, ${previa.excluidos.length} excluidos:`);
previa.excluidos.forEach((x) => console.log(`    - ${x.liceo}: ${x.motivo}`));
assert.equal(previa.destinatarios.length, 26);
assert.match(previa.destinatarios[0].cuerpo, /Liceo/);
assert.doesNotMatch(previa.destinatarios[0].cuerpo, /\{\{/, 'no deben quedar variables sin reemplazar');
console.log(`  ejemplo → ${previa.destinatarios[0].email}: "${previa.destinatarios[0].asunto}"`);

paso('Enviar (quitando un liceo de la lista)');
let envio = await api('POST', '/comunicacion/envios', {
  grupo: 'CONTRAPARTES', asunto: pres.asunto, cuerpo: pres.cuerpo, plantillaId: pres.id, excluir: [L['28'].id],
});
assert.equal(envio.total, 25);
envio = await esperarEnvio(envio.id);
const estados = envio.destinatarios.reduce((a, d) => ({ ...a, [d.entrega]: (a[d.entrega] ?? 0) + 1 }), {});
console.log(`  entrega: ${JSON.stringify(estados)}`);

paso('Marcar respuestas: 01, 02, 04 participan; 06 no participa');
const dest = (cod) => envio.destinatarios.find((d) => d.liceo_id === L[cod].id);
for (const cod of ['01', '02', '04']) {
  await api('PATCH', `/comunicacion/envios/${envio.id}/destinatarios/${dest(cod).id}`, { respondido: true, participa: true });
}
await api('PATCH', `/comunicacion/envios/${envio.id}/destinatarios/${dest('06').id}`,
  { respondido: true, participa: false, nota: 'No tienen 3° medio este año' });
const lista = await api('GET', '/comunicacion/envios');
console.log(`  respondidos ${lista[0].respondidos} / sin respuesta ${lista[0].sin_respuesta}`);
assert.equal(lista[0].respondidos, 4);

paso('Reenviar a los que faltan (debe excluir al que no participa)');
const reenvio = await api('POST', '/comunicacion/envios/previsualizar', {
  grupo: 'CONTRAPARTES', asunto: `Recordatorio: ${pres.asunto}`, cuerpo: pres.cuerpo, envioOrigenId: envio.id,
});
console.log(`  ${reenvio.destinatarios.length} pendientes a recordar`);
assert.equal(reenvio.destinatarios.length, 21);
assert.ok(!reenvio.destinatarios.some((d) => d.liceoId === L['06'].id));

// 4. Solicitud de notas con la planilla adjunta
paso('Solicitud de notas con adjunto en la plantilla');
const solicitud = plantillas.find((p) => p.proposito === 'SOLICITUD_NOTAS');
const conAdjunto = await api('POST', `/comunicacion/plantillas/${solicitud.id}/adjuntos`, null, { form: archivo('nomina_liceo_01.xlsx') });
assert.equal(conAdjunto.adjuntos.length, 1);
const envio2 = await api('POST', '/comunicacion/envios', {
  grupo: 'CONTRAPARTES', asunto: solicitud.asunto, cuerpo: solicitud.cuerpo, plantillaId: solicitud.id,
  adjuntoIds: conAdjunto.adjuntos.map((a) => a.id),
});
console.log(`  enviado a ${envio2.total} contrapartes (excluye al que no participa), ${envio2.adjuntos.length} adjunto`);
await esperarEnvio(envio2.id);
assert.equal(envio2.total, 25);

// 5. Nóminas
paso('Previsualizar nómina con errores (liceo 05)');
const prev05 = await api('POST', `/liceos/${L['05'].id}/nomina/previsualizar`, null, { form: archivo('nomina_liceo_05.xlsx') });
console.log(`  ${prev05.totalAlumnos} alumnos en ${prev05.cursos.length} cursos · ${prev05.errores.length} errores · ${prev05.advertencias.length} advertencias`);
prev05.errores.forEach((e) => console.log(`    ✗ ${e.hoja} fila ${e.fila}: ${e.mensaje}`));
prev05.advertencias.slice(0, 4).forEach((e) => console.log(`    ! ${e.hoja ?? ''} ${e.fila ? 'fila ' + e.fila : ''} ${e.mensaje}`));
assert.equal(prev05.errores.length, 2);
const sinGuardar = await api('GET', `/liceos/${L['05'].id}/nomina`);
assert.equal(sinGuardar.carga, null, 'previsualizar no debe guardar');

paso('Nómina en el liceo equivocado → advertencia');
const equivocado = await api('POST', `/liceos/${L['10'].id}/nomina/previsualizar`, null, { form: archivo('nomina_liceo_02.xlsx') });
assert.ok(equivocado.advertencias.some((a) => /liceo equivocado|Revisa que sea el archivo correcto/.test(a.mensaje)));
console.log(`  ${equivocado.advertencias[0].mensaje}`);

paso('Confirmar nóminas de 01, 02, 04, 05');
for (const cod of ['01', '02', '04', '05']) {
  const r = await api('POST', `/liceos/${L[cod].id}/nomina`, null, { form: archivo(`nomina_liceo_${cod}.xlsx`) });
  console.log(`  ${cod}: ${r.totalAlumnos} alumnos, cursos ${r.cursos.map((c) => c.curso).join(' ')}`);
}
const e2 = await api('GET', `/comunicacion/envios/${envio2.id}`);
const auto = e2.destinatarios.filter((d) => d.respuesta_auto);
console.log(`  la solicitud de notas quedó respondida automáticamente para ${auto.length} liceos`);
assert.equal(auto.length, 4);

paso('Sugerencia de invitados (3 primeros por curso)');
const nomina02 = await api('GET', `/liceos/${L['02'].id}/nomina?porCurso=3`);
for (const c of nomina02.cursos) {
  const sug = c.alumnos.filter((a) => a.sugerido);
  console.log(`  ${c.curso}: ${c.alumnos.length} alumnos, sugeridos ${sug.length} → ${sug.map((a) => `${a.posicion_curso}° ${a.nombres.split(' ')[0]} (${a.promedio})`).join(', ')}`);
  assert.ok(sug.length >= 3);
}

// 6. Invitar y generar Id
paso('Invitar: liceo 01 primero, luego 02 (el correlativo sigue entre liceos)');
const nomina01 = await api('GET', `/liceos/${L['01'].id}/nomina?porCurso=2`);
const ids01 = nomina01.cursos.flatMap((c) => c.alumnos.filter((a) => a.sugerido).map((a) => a.id));
const inv01 = await api('POST', '/invitados', { alumnoIds: ids01 });
const ids02 = nomina02.cursos.flatMap((c) => c.alumnos.filter((a) => a.sugerido).map((a) => a.id));
const inv02 = await api('POST', '/invitados', { alumnoIds: ids02 });
console.log(`  01 → ${inv01.invitados.map((i) => i.codigo).join(' ')}`);
console.log(`  02 → ${inv02.invitados.map((i) => i.codigo).join(' ')}`);
assert.equal(inv01.invitados[0].codigo, '01.001a');
assert.equal(inv02.invitados[0].codigo, `02.${String(inv01.invitados.length + 1).padStart(3, '0')}a`);
await api('POST', '/invitados', { alumnoIds: [ids01[0]] }, { esperado: [409] });
console.log('  ok: invitar dos veces al mismo alumno → 409');

paso('Quitar un invitado no libera su Id');
await api('DELETE', `/invitados/${inv02.invitados.at(-1).id}`);
const nuevo = await api('POST', '/invitados', { alumnoIds: [nomina02.cursos[0].alumnos.find((a) => !a.sugerido).id] });
console.log(`  quitado ${inv02.invitados.at(-1).codigo}, el siguiente invitado recibe ${nuevo.invitados[0].codigo}`);
assert.notEqual(nuevo.invitados[0].codigo, inv02.invitados.at(-1).codigo);

paso('Reemplazar la nómina de 01 mantiene a sus invitados enlazados');
await api('POST', `/liceos/${L['01'].id}/nomina`, null, { form: archivo('nomina_liceo_01.xlsx') });
const n01b = await api('GET', `/liceos/${L['01'].id}/nomina?porCurso=2`);
const enlazados = n01b.cursos.flatMap((c) => c.alumnos).filter((a) => a.codigo).length;
console.log(`  ${enlazados} de ${inv01.invitados.length} invitados siguen enlazados a la nómina nueva`);
assert.equal(enlazados, inv01.invitados.length);

// 7. Contactos y confirmación de los invitados
paso('Datos de contacto, RUT y confirmación (formulario 1)');
let invitados = await api('GET', '/invitados');
await api('PATCH', `/invitados/${invitados[0].id}`, { rut: '12.345.678-9' }, { esperado: [400] });
await api('PATCH', `/invitados/${invitados[0].id}`, { email: 'no-es-email' }, { esperado: [400] });
const encuentros = await api('GET', '/encuentros');
for (const [i, inv] of invitados.entries()) {
  const datos = { email: `estudiante${i + 1}@correo-demo.cl`, telefono: `+5691234${String(i).padStart(4, '0')}` };
  if (i % 4 !== 3) Object.assign(datos, { confirmacion: 'CONFIRMADO', encuentroEventoId: encuentros[i % 3].id });
  if (i === 3) datos.confirmacion = 'RECHAZADO';
  if (i === 7) delete datos.email; // uno queda sin email
  await api('PATCH', `/invitados/${inv.id}`, datos);
}
await api('PATCH', `/invitados/${invitados[0].id}`, { rut: '11.111.111-1', asistioEncuentro: true });
await api('POST', `/invitados/${invitados[0].id}/comentarios`, { texto: 'RSH no actualizado, el padre cambió de trabajo' });
invitados = await api('GET', '/invitados');
console.log(`  ${invitados.filter((i) => i.confirmacion === 'CONFIRMADO').length} confirmados, ${invitados.filter((i) => i.confirmacion === 'RECHAZADO').length} rechazó; RUT guardado como ${invitados[0].rut}`);

paso('Invitación a estudiantes: excluye a quien rechazó y a quien no tiene email');
const invEst = plantillas.find((p) => p.proposito === 'INVITACION_ESTUDIANTES');
const pe = await api('POST', '/comunicacion/envios/previsualizar', { grupo: 'POSTULANTES', asunto: invEst.asunto, cuerpo: invEst.cuerpo });
console.log(`  ${pe.destinatarios.length} destinatarios; excluidos: ${pe.excluidos.map((x) => `${x.nombre} (${x.motivo})`).join('; ')}`);
assert.equal(pe.excluidos.length, 2);

// 8. Webhook del proveedor
paso('Webhook del proveedor: rebote de un correo');
await fetch(`${API}/webhooks/correo?token=malo`, { method: 'POST' }).then((r) => assert.equal(r.status, 403));
console.log('  ok: token inválido → 403');
const idExterno = await import('child_process').then(({ execSync }) => execSync(
  `PGPASSWORD=becas_dev_password psql -h localhost -U becas -d becas -tAc "SELECT d.id_externo FROM envio_destinatarios d WHERE d.envio_id = '${envio2.id}' AND d.liceo_id = '${L['10'].id}'"`,
).toString().trim());
const wh = await fetch(`${API}/webhooks/correo?token=${process.env.MAIL_WEBHOOK_TOKEN ?? 'token-de-prueba-123'}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify([{ event: 'hard_bounce', 'message-id': `<${idExterno}>`, reason: 'Mailbox does not exist' }]),
}).then((r) => r.json());
assert.equal(wh.actualizados, 1);
const rebotado = (await api('GET', `/comunicacion/envios/${envio2.id}`)).destinatarios.find((d) => d.liceo_id === L['10'].id);
console.log(`  liceo 10 → entrega ${rebotado.entrega}: ${rebotado.error}`);
assert.equal(rebotado.entrega, 'REBOTADO');

// 9. Dashboard y seguimiento
paso('Dashboard');
const dash = await api('GET', '/dashboard');
console.log(`  embudo: ${JSON.stringify(dash.embudo)}`);
console.log(`  liceos: ${JSON.stringify(dash.liceos)}`);
console.log(`  correos esperando respuesta: ${dash.correosPendientes.map((c) => `"${c.asunto.slice(0, 40)}…" ${c.sin_respuesta}/${c.total}`).join(' | ')}`);
assert.equal(dash.embudo.invitados, invitados.length);

paso('Seguimiento por liceo (hitos marcados solos)');
const grilla = await api('GET', '/hitos');
for (const cod of ['01', '06', '10']) {
  const f = grilla.filas.find((x) => x.codigo === cod);
  const hechos = grilla.catalogo.filter((h) => f.hitos[h.codigo]?.completado).map((h) => h.nombre);
  console.log(`  ${cod} [${f.participacion}]: ${hechos.join(' · ') || '(nada)'}`);
}
await api('PUT', `/hitos/${L['01'].id}/VISITA`, { completado: true, observaciones: 'Visita el 12 de agosto' });

paso('Activar etapa 2 (la 1 queda cerrada)');
const p2 = await api('POST', `/proceso/etapas/${proceso.etapas[1].id}/activar`);
console.log(`  ${p2.etapas.map((e) => `${e.orden}.${e.estado}`).join(' ')}`);
assert.deepEqual(p2.etapas.map((e) => e.estado), ['CERRADA', 'ACTIVA', 'PENDIENTE', 'PENDIENTE', 'PENDIENTE']);
await api('POST', `/proceso/etapas/${proceso.etapas[0].id}/activar`);

console.log('\n✔ Flujo de la etapa 1 completo');
