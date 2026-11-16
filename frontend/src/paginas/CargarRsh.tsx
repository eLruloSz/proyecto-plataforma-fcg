import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import {
  CAMPOS_FICHA, compararNombre, DatosFicha, ResultadoCartola, valorTexto,
} from '../cartolas';
import { Caja, Etiqueta, Modal, useAviso } from '../ui';

/**
 * Cargar el RSH de UN estudiante ya elegido: desde la cartola (PDF) o digitando los datos a mano.
 * En los dos casos se muestra primero una vista previa (con quién es el estudiante y qué cambia en su ficha)
 * y solo se guarda cuando la persona confirma. El PDF se lee en el servidor y se descarta.
 */

export interface EstudianteRsh {
  id: string; codigo: string; nombres: string; apellido_paterno: string; apellido_materno: string | null; liceo: string;
  ficha: Record<string, unknown> | null;
}

type Identidad = {
  estado: 'COINCIDE' | 'APROXIMADO' | 'NO_COINCIDE' | 'SIN_VERIFICAR';
  nombreCartola: string | null; rutCartola: string | null; rutCoincide: boolean | null; detalle?: string;
};
interface Previa {
  origen: 'pdf' | 'manual'; datos: Partial<DatosFicha>; identidad: Identidad; avisos: string[]; archivo?: string;
  hash?: string; emitidaEn?: string | null;
}

type Form = Record<'tramo' | 'actualizada' | 'personas' | 'menores' | 'mayores' | 'discapacidad' | 'dependencia' | 'invalidez' | 'nee' | 'ingresos' | 'nombre', string>;
const VACIO: Form = { tramo: '', actualizada: '', personas: '', menores: '', mayores: '', discapacidad: '', dependencia: '', invalidez: '', nee: '', ingresos: '', nombre: '' };
const aNumero = (s: string) => (s.trim() === '' ? null : Number(s));
const TRAMOS = [40, 50, 60, 70, 80, 90, 100];

const NOMBRE_ESTADO: Record<Identidad['estado'], { tono: 'verde' | 'amarillo' | 'rojo' | 'gris'; texto: string }> = {
  COINCIDE: { tono: 'verde', texto: 'Coincide' },
  APROXIMADO: { tono: 'amarillo', texto: 'Nombre parecido: confirma' },
  NO_COINCIDE: { tono: 'rojo', texto: 'No coincide' },
  SIN_VERIFICAR: { tono: 'gris', texto: 'Sin verificar' },
};

export function CargarRsh({ e, onCerrar }: { e: EstudianteRsh; onCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const entrada = useRef<HTMLInputElement>(null);
  const [modo, setModo] = useState<'pdf' | 'manual'>('pdf');
  const [leyendo, setLeyendo] = useState(false);
  const [errorPdf, setErrorPdf] = useState('');
  const [form, setForm] = useState<Form>(VACIO);
  const [errorForm, setErrorForm] = useState('');
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [confirmaIdentidad, setConfirmaIdentidad] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState('');

  const nombre = `${e.nombres} ${e.apellido_paterno}${e.apellido_materno ? ' ' + e.apellido_materno : ''}`;
  const set = (k: keyof Form, v: string) => { setForm((f) => ({ ...f, [k]: v })); setErrorForm(''); };

  // ---- Desde el PDF ------------------------------------------------------
  const leerPdf = async (archivo: File) => {
    setLeyendo(true); setErrorPdf('');
    try {
      const datos = new FormData();
      datos.append('archivos', archivo);
      const [r] = await api.enviarFormulario<ResultadoCartola[]>(`/cartolas/leer?postulacionId=${e.id}`, datos);
      if (!r || r.estado === 'ERROR' || !r.ficha) { setErrorPdf(r?.error ?? 'No se pudo leer el archivo.'); return; }
      const v = r.verificacion!;
      setConfirmaIdentidad(false);
      setPrevia({
        origen: 'pdf', datos: r.ficha, archivo: r.archivo, hash: r.hash, emitidaEn: r.emitidaEn,
        identidad: { estado: v.estado, nombreCartola: v.nombreCartola, rutCartola: v.rutCartola, rutCoincide: v.rutCoincide },
        avisos: r.avisos,
      });
    } catch (err) { setErrorPdf((err as Error).message); }
    finally { setLeyendo(false); }
  };

  // ---- Digitado a mano ---------------------------------------------------
  const revisarManual = () => {
    const personas = aNumero(form.personas);
    const partes = [form.menores, form.mayores].map(aNumero).reduce<number>((s, x) => s + (x ?? 0), 0);
    if (personas !== null && partes > personas) return setErrorForm('Menores de 18 y mayores de 60 suman más que el total de personas del hogar.');
    for (const k of ['discapacidad', 'dependencia', 'invalidez', 'nee'] as const) {
      const n = aNumero(form[k]);
      if (n !== null && personas !== null && n > personas) return setErrorForm('Hay más personas con apoyo que personas en el hogar.');
    }
    const datos: Partial<DatosFicha> = {
      tramoRsh: aNumero(form.tramo), rshActualizada: form.actualizada || null, personasHogar: personas, menores18: aNumero(form.menores),
      mayores60: aNumero(form.mayores), conDiscapacidad: aNumero(form.discapacidad), conDependencia: aNumero(form.dependencia),
      conInvalidez: aNumero(form.invalidez), conNee: aNumero(form.nee), ingresosHogar: form.ingresos.trim() || null,
    };
    if (Object.values(datos).every((v) => v === null)) return setErrorForm('Escribe al menos un dato de la cartola.');
    const escrito = form.nombre.trim();
    const identidad: Identidad = escrito
      ? { estado: compararNombre({ nombres: e.nombres, paterno: e.apellido_paterno, materno: e.apellido_materno }, escrito), nombreCartola: escrito, rutCartola: null, rutCoincide: null }
      : { estado: 'SIN_VERIFICAR', nombreCartola: null, rutCartola: null, rutCoincide: null, detalle: 'No escribiste el nombre que aparece en la cartola.' };
    setConfirmaIdentidad(false);
    setPrevia({ origen: 'manual', datos, identidad, avisos: [] });
  };

  // ---- Guardar -----------------------------------------------------------
  const exigeConfirmar = !!previa && (previa.identidad.estado === 'APROXIMADO' || previa.identidad.estado === 'NO_COINCIDE');
  const guardar = async () => {
    if (!previa) return;
    setGuardando(true); setErrorGuardar('');
    try {
      // Solo se envía lo que hay: un dato que falta no borra lo que ya tenía la ficha.
      const cuerpo = Object.fromEntries(Object.entries(previa.datos).filter(([, v]) => v !== null && v !== undefined));
      await api.put(`/postulaciones/${e.id}/ficha`, cuerpo);
      if (previa.origen === 'pdf' && previa.hash) await api.post('/cartolas/registro', { postulacionId: e.id, hash: previa.hash, emitidaEn: previa.emitidaEn ?? null });
      ['cartolas', 'avance', 'seleccion', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      avisar(`Ficha de ${e.nombres} ${e.apellido_paterno} actualizada`);
      onCerrar();
    } catch (err) { setErrorGuardar((err as Error).message); }
    finally { setGuardando(false); }
  };

  const numero = (k: keyof Form, label: string, min = 0) => (
    <label className="block">
      <span className="label">{label}</span>
      <input type="number" min={min} max={30} className="input py-1.5" value={form[k]} onChange={(ev) => set(k, ev.target.value)} />
    </label>
  );

  const pie = previa ? (
    <>
      <button className="btn-secundario" disabled={guardando} onClick={() => setPrevia(null)}>← Volver</button>
      <button className="btn-primario" disabled={guardando || (exigeConfirmar && !confirmaIdentidad)} onClick={guardar}>
        {guardando ? 'Guardando…' : 'Guardar en la ficha'}
      </button>
    </>
  ) : (
    <>
      <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
      {modo === 'manual' && <button className="btn-primario" onClick={revisarManual}>Revisar datos</button>}
    </>
  );

  return (
    <Modal titulo={`Cargar RSH — ${nombre}`} onCerrar={onCerrar} ancho="max-w-3xl" pie={pie}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <span className="font-mono text-xs">{e.codigo}</span>
          <span className="font-medium">{nombre}</span>
          <span className="text-xs text-gray-500">{e.liceo}</span>
        </div>

        {!previa && (
          <>
            <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
              {([['pdf', 'Subir la cartola (PDF)'], ['manual', 'Digitar a mano']] as const).map(([k, t]) => (
                <button key={k} onClick={() => setModo(k)} aria-pressed={modo === k}
                  className={`flex-1 rounded-md px-3 py-1.5 ${modo === k ? 'bg-white font-semibold shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>{t}</button>
              ))}
            </div>

            {modo === 'pdf' ? (
              <div className="space-y-3">
                <p className="text-gray-500">
                  Sube la Cartola Hogar tal como se descarga del RSH. El sistema la lee, la compara con este estudiante y te muestra lo que encontró antes de guardar.
                  El PDF no se guarda.
                </p>
                <input ref={entrada} type="file" hidden accept=".pdf,application/pdf"
                  onChange={(ev) => { const a = ev.target.files?.[0]; ev.target.value = ''; if (a) leerPdf(a); }} />
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-gray-300 px-4 py-6">
                  <button className="btn-primario" disabled={leyendo} onClick={() => entrada.current?.click()}>{leyendo ? 'Leyendo la cartola…' : 'Elegir cartola (PDF)'}</button>
                  <span className="text-xs text-gray-400">Un solo archivo. Si tienes varias cartolas, usa «Carga masiva».</span>
                </div>
                {errorPdf && <Caja tono="rojo">{errorPdf} <button className="underline" onClick={() => setModo('manual')}>Digitar a mano</button></Caja>}
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-gray-500">Copia los datos del hogar desde la cartola. Deja en blanco lo que no tengas: lo que falte no borra lo que ya está en la ficha.</p>
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Registro Social de Hogares</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="label">Tramo del hogar</span>
                      <select className="input py-1.5" value={form.tramo} onChange={(ev) => set('tramo', ev.target.value)}>
                        <option value="">Sin dato</option>
                        {TRAMOS.map((t) => <option key={t} value={t}>{t}%</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="label">Última actualización de información</span>
                      <input type="date" className="input py-1.5" value={form.actualizada} onChange={(ev) => set('actualizada', ev.target.value)} />
                    </label>
                  </div>
                </section>
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Personas que conforman el hogar</h3>
                  <div className="grid gap-3 sm:grid-cols-3">{numero('personas', 'Total', 1)}{numero('menores', 'Menores de 18 años')}{numero('mayores', 'Mayores de 60 años')}</div>
                </section>
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Personas del hogar con…</h3>
                  <div className="grid gap-3 sm:grid-cols-4">
                    {numero('discapacidad', 'Discapacidad')}{numero('dependencia', 'Dependencia')}{numero('invalidez', 'Invalidez')}{numero('nee', 'Necesidades educativas especiales')}
                  </div>
                </section>
                <label className="block">
                  <span className="label">Total ingresos del hogar (como lo dice la cartola)</span>
                  <input className="input py-1.5" placeholder="Ej: Entre $290.000 y $390.000" value={form.ingresos} onChange={(ev) => set('ingresos', ev.target.value)} />
                </label>
                <label className="block rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                  <span className="label">Nombre del estudiante como aparece en la cartola (recomendado)</span>
                  <input className="input py-1.5" placeholder={nombre} value={form.nombre} onChange={(ev) => set('nombre', ev.target.value)} />
                  <span className="mt-1 block text-xs text-gray-500">La cartola no trae el RUT completo. Con este nombre el sistema comprueba que estás cargando la cartola del estudiante correcto.</span>
                </label>
                {errorForm && <p className="text-red-700" role="alert">{errorForm}</p>}
              </div>
            )}
          </>
        )}

        {previa && (
          <VistaPrevia previa={previa} e={e} nombre={nombre} confirma={confirmaIdentidad} onConfirma={setConfirmaIdentidad} exigeConfirmar={exigeConfirmar} error={errorGuardar} />
        )}
      </div>
    </Modal>
  );
}

function VistaPrevia({ previa, e, nombre, confirma, onConfirma, exigeConfirmar, error }: {
  previa: Previa; e: EstudianteRsh; nombre: string; confirma: boolean; onConfirma: (v: boolean) => void; exigeConfirmar: boolean; error: string;
}) {
  const id = previa.identidad;
  const est = NOMBRE_ESTADO[id.estado];
  const filas = CAMPOS_FICHA.map(({ k, t, col }) => {
    const nuevo = previa.datos[k] ?? null;
    const antes = e.ficha?.[col] ?? null;
    const estado = nuevo === null ? 'sin-dato' : antes === null ? 'nuevo' : String(antes).slice(0, 10) === String(nuevo).slice(0, 10) ? 'igual' : 'cambia';
    return { k, t, nuevo, antes, estado };
  });
  const nuevos = filas.filter((f) => f.estado === 'nuevo').length;
  const cambian = filas.filter((f) => f.estado === 'cambia').length;

  return (
    <div className="space-y-4">
      {/* 1. ¿Es esta la cartola de este estudiante? */}
      <section className={`rounded-lg border p-3 ${id.estado === 'NO_COINCIDE' ? 'border-red-300 bg-red-50/50' : id.estado === 'APROXIMADO' ? 'border-yellow-300 bg-yellow-50/50' : id.estado === 'COINCIDE' ? 'border-green-300 bg-green-50/40' : 'border-gray-200'}`}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">¿Es la cartola de este estudiante?</h3>
          <Etiqueta tono={est.tono}>{est.texto}</Etiqueta>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[11px] uppercase text-gray-400">En el sistema</div>
            <div className="font-medium">{nombre}</div>
            <div className="text-xs text-gray-500"><span className="font-mono">{e.codigo}</span> · {e.liceo}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-gray-400">{previa.origen === 'pdf' ? 'En la cartola' : 'Nombre que escribiste'}</div>
            {id.nombreCartola ? <div className="font-medium">{id.nombreCartola}</div> : <div className="italic text-gray-400">{previa.origen === 'pdf' ? 'No aparece entre los integrantes' : 'No lo escribiste'}</div>}
            {id.rutCartola && (
              <div className="text-xs text-gray-500">
                RUT {id.rutCartola}
                {id.rutCoincide === true && <span className="ml-1 text-green-700">· calza con el RUT cargado</span>}
                {id.rutCoincide === false && <span className="ml-1 text-red-700">· NO calza con el RUT cargado</span>}
                {id.rutCoincide === null && <span className="ml-1 text-gray-400">· el estudiante no tiene RUT cargado</span>}
              </div>
            )}
          </div>
        </div>
        {previa.origen === 'pdf' && <p className="mt-2 text-xs text-gray-500">La cartola trae el RUT tapado, así que se reconoce por el nombre del estudiante entre los integrantes del hogar.</p>}
        {id.estado === 'SIN_VERIFICAR' && <p className="mt-2 text-xs text-gray-500">{id.detalle} Puedes guardar igual, pero no se comprobó que sea la cartola de este estudiante.</p>}
        {exigeConfirmar && (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={confirma} onChange={(ev) => onConfirma(ev.target.checked)} />
            <span>Confirmo que es la cartola de <strong>{nombre}</strong>, aunque el nombre no coincide del todo.</span>
          </label>
        )}
      </section>

      {previa.avisos.length > 0 && <Caja tono="amarillo"><ul className="list-disc space-y-0.5 pl-5">{previa.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul></Caja>}

      {/* 2. Qué cambia en la ficha */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Qué quedaría en la ficha</h3>
          <span className="text-xs text-gray-500">{nuevos} dato{nuevos === 1 ? '' : 's'} nuevo{nuevos === 1 ? '' : 's'} · {cambian} que cambia{cambian === 1 ? '' : 'n'}</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="tabla">
            <thead><tr><th>Dato</th><th>Ahora en la ficha</th><th>Con esta carga</th><th /></tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.k} className={f.estado === 'cambia' ? 'bg-yellow-50/60' : f.estado === 'nuevo' ? 'bg-green-50/40' : ''}>
                  <td className="text-gray-700">{f.t}</td>
                  <td className="text-gray-500">{valorTexto(f.k, f.antes)}</td>
                  <td className={f.estado === 'sin-dato' ? 'text-gray-300' : 'font-medium'}>{f.estado === 'sin-dato' ? 'sin cambio' : valorTexto(f.k, f.nuevo)}</td>
                  <td className="text-right text-xs">
                    {f.estado === 'cambia' && <span className="text-yellow-800">cambia</span>}
                    {f.estado === 'nuevo' && <span className="text-green-700">nuevo</span>}
                    {f.estado === 'igual' && <span className="text-gray-400">igual</span>}
                    {f.estado === 'sin-dato' && <span className="text-gray-300">{previa.origen === 'pdf' ? 'no se leyó' : 'en blanco'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          {previa.origen === 'pdf' && previa.archivo ? `Archivo: ${previa.archivo}${previa.emitidaEn ? ` · emitida ${valorTexto('rshActualizada', previa.emitidaEn)}` : ''}. ` : ''}
          Lo que no se leyó o quedó en blanco no borra lo que ya está en la ficha. Nada se guarda hasta que confirmes.
        </p>
      </section>
      {error && <p className="text-red-700" role="alert">{error}</p>}
    </div>
  );
}
