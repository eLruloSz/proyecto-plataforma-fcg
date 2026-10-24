import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, CargaRanking, FichaPostulacion, PreviaRanking, VistaAvance } from '../api';
import { Caja, Etiqueta, fecha, Modal, useAviso } from '../ui';

type Fila = VistaAvance['estudiantes'][number];

// ---------------------------------------------------------------------------
// Ficha de postulación (datos de la cartola RSH)
// ---------------------------------------------------------------------------

/** "0 a 40%", "41 a 50%"… como lo dice la cartola. */
export const textoTramo = (t: number) => (t === 40 ? '0 a 40%' : `${t - 9} a ${t}%`);

/** Alertas de la ficha: lo que la fundación revisa a mano hoy. */
export function alertasFicha(f: FichaPostulacion | null): { tono: 'amarillo' | 'rojo'; texto: string }[] {
  if (!f) return [];
  const a: { tono: 'amarillo' | 'rojo'; texto: string }[] = [];
  if (f.rsh_pendiente) a.push({ tono: 'amarillo', texto: 'RSH pendiente' });
  if (f.tramo_rsh && f.tramo_rsh > 50) a.push({ tono: 'rojo', texto: `Tramo ${textoTramo(f.tramo_rsh)}: sobre el máximo` });
  else if (f.tramo_rsh === 50) a.push({ tono: 'amarillo', texto: 'Tramo 41 a 50%: revisar caso a caso' });
  if (f.personas_formulario && f.personas_hogar && f.personas_formulario !== f.personas_hogar) {
    a.push({ tono: 'amarillo', texto: `Formulario dice ${f.personas_formulario} personas y la cartola ${f.personas_hogar}` });
  }
  if (f.rsh_actualizada) {
    const meses = (Date.now() - new Date(f.rsh_actualizada).getTime()) / (30.4 * 24 * 3600 * 1000);
    if (meses > 12) a.push({ tono: 'amarillo', texto: 'Cartola con más de un año sin actualizar' });
  }
  return a;
}

/** Celda de la tabla de la etapa: tramo y alertas, con botón para abrir la ficha. */
export function CeldaFicha({ f, onAbrir }: { f: Fila; onAbrir: () => void }) {
  const alertas = alertasFicha(f.ficha);
  const apoyo = f.ficha ? (f.ficha.con_discapacidad ?? 0) + (f.ficha.con_dependencia ?? 0) + (f.ficha.con_invalidez ?? 0) + (f.ficha.con_nee ?? 0) : 0;
  return (
    <button onClick={onAbrir} className="w-full min-w-[150px] rounded-md px-1 py-0.5 text-left hover:bg-gray-100" title="Ver o editar la ficha de postulación">
      {!f.ficha ? <span className="text-xs text-gray-400 underline">completar ficha</span> : (
        <div className="space-y-0.5 text-xs">
          <div className="text-gray-800">
            {f.ficha.rsh_pendiente ? 'RSH pendiente' : f.ficha.tramo_rsh ? `Tramo ${textoTramo(f.ficha.tramo_rsh)}` : 'Sin tramo'}
            {f.ficha.personas_hogar ? <span className="text-gray-400"> · {f.ficha.personas_hogar} pers.</span> : null}
            {apoyo > 0 && <span className="text-gray-400"> · {apoyo} con apoyo</span>}
          </div>
          {alertas.map((x) => <div key={x.texto} className={x.tono === 'rojo' ? 'text-red-700' : 'text-yellow-800'}>⚠ {x.texto}</div>)}
        </div>
      )}
    </button>
  );
}

type FormFicha = Record<
  'tramo' | 'actualizada' | 'personas' | 'menores' | 'mayores' | 'discapacidad' | 'dependencia' | 'invalidez' | 'nee' | 'ingresos' | 'formulario' | 'observaciones',
  string
> & { pendiente: boolean };

const aTexto = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const aNumero = (s: string) => (s.trim() === '' ? null : Number(s));

export function FichaModal({ estudiante, onCerrar }: { estudiante: Fila; onCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const f = estudiante.ficha;
  const [d, setD] = useState<FormFicha>({
    tramo: aTexto(f?.tramo_rsh), pendiente: f?.rsh_pendiente ?? false, actualizada: f?.rsh_actualizada?.slice(0, 10) ?? '',
    personas: aTexto(f?.personas_hogar), menores: aTexto(f?.menores_18), mayores: aTexto(f?.mayores_60),
    discapacidad: aTexto(f?.con_discapacidad), dependencia: aTexto(f?.con_dependencia), invalidez: aTexto(f?.con_invalidez), nee: aTexto(f?.con_nee),
    ingresos: f?.ingresos_hogar ?? '', formulario: aTexto(f?.personas_formulario), observaciones: f?.observaciones ?? '',
  });
  const [error, setError] = useState('');
  const set = (k: keyof FormFicha, v: string | boolean) => { setD((x) => ({ ...x, [k]: v })); setError(''); };

  const guardar = useMutation({
    mutationFn: () => api.put<FichaPostulacion>(`/postulaciones/${estudiante.id}/ficha`, {
      tramoRsh: d.pendiente ? null : aNumero(d.tramo), rshPendiente: d.pendiente, rshActualizada: d.actualizada || null,
      personasHogar: aNumero(d.personas), menores18: aNumero(d.menores), mayores60: aNumero(d.mayores),
      conDiscapacidad: aNumero(d.discapacidad), conDependencia: aNumero(d.dependencia), conInvalidez: aNumero(d.invalidez), conNee: aNumero(d.nee),
      ingresosHogar: d.ingresos || null, personasFormulario: aNumero(d.formulario), observaciones: d.observaciones || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['avance'] }); avisar('Ficha guardada'); onCerrar(); },
    onError: (e: Error) => setError(e.message),
  });

  const enviar = () => {
    const personas = aNumero(d.personas);
    const partes = [d.menores, d.mayores].map(aNumero).reduce<number>((s, x) => s + (x ?? 0), 0);
    if (personas !== null && partes > personas) return setError('Menores de 18 y mayores de 60 suman más que el total de personas del hogar.');
    for (const k of ['discapacidad', 'dependencia', 'invalidez', 'nee'] as const) {
      const n = aNumero(d[k]);
      if (n !== null && personas !== null && n > personas) return setError('Hay más personas con apoyo que personas en el hogar.');
    }
    guardar.mutate();
  };

  // Vista previa de las alertas con lo que se está escribiendo.
  const alertas = alertasFicha({
    tramo_rsh: d.pendiente ? null : aNumero(d.tramo), rsh_pendiente: d.pendiente, rsh_actualizada: d.actualizada || null,
    personas_hogar: aNumero(d.personas), personas_formulario: aNumero(d.formulario),
  } as FichaPostulacion);

  const numero = (k: keyof FormFicha, label: string, min = 0) => (
    <label className="block">
      <span className="label">{label}</span>
      <input type="number" min={min} max={30} className="input py-1.5" value={d[k] as string} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  return (
    <Modal titulo={`Ficha de postulación — ${estudiante.nombres} ${estudiante.apellido_paterno}`} onCerrar={onCerrar} ancho="max-w-2xl"
      pie={<><button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className="btn-primario" disabled={guardar.isPending} onClick={enviar}>Guardar ficha</button></>}>
      <div className="space-y-5 text-sm">
        <p className="text-gray-500">
          Copia los datos desde la cartola del Registro Social de Hogares que envió el estudiante. La cartola no se sube al sistema.
          Deja en blanco lo que no tengas.
        </p>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">¿Cuál es el tramo del hogar?</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="label">Tramo RSH</span>
              <select className="input py-1.5" value={d.tramo} disabled={d.pendiente} onChange={(e) => set('tramo', e.target.value)}>
                <option value="">Sin dato</option>
                {[40, 50, 60, 70, 80, 90, 100].map((t) => <option key={t} value={t}>{textoTramo(t)}</option>)}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2">
              <input type="checkbox" checked={d.pendiente} onChange={(e) => set('pendiente', e.target.checked)} />
              <span>RSH pendiente</span>
            </label>
            <label className="block">
              <span className="label">Última actualización de información</span>
              <input type="date" className="input py-1.5" value={d.actualizada} onChange={(e) => set('actualizada', e.target.value)} />
            </label>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Personas que conforman el hogar</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {numero('personas', 'Total', 1)}
            {numero('menores', 'Menores de 18 años')}
            {numero('mayores', 'Mayores de 60 años')}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Personas del hogar con…</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            {numero('discapacidad', 'Discapacidad')}
            {numero('dependencia', 'Dependencia')}
            {numero('invalidez', 'Invalidez')}
            {numero('nee', 'Necesidades educativas especiales')}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <label className="block">
            <span className="label">Total ingresos del hogar (como lo dice la cartola)</span>
            <input className="input py-1.5" placeholder="Ej: Entre $290.000 y $390.000" value={d.ingresos} onChange={(e) => set('ingresos', e.target.value)} />
          </label>
          {numero('formulario', 'Personas según el formulario', 1)}
        </section>

        {alertas.length > 0 && (
          <Caja tono={alertas.some((x) => x.tono === 'rojo') ? 'rojo' : 'amarillo'}>
            <ul className="space-y-0.5">{alertas.map((x) => <li key={x.texto}>⚠ {x.texto}</li>)}</ul>
          </Caja>
        )}

        <label className="block">
          <span className="label">Observaciones</span>
          <textarea rows={2} className="input" placeholder="Ej: RSH no actualizado, el padre cambió de trabajo" value={d.observaciones}
            onChange={(e) => set('observaciones', e.target.value)} />
        </label>
        {error && <p className="text-red-700" role="alert">{error}</p>}
        {f && <p className="text-xs text-gray-400">Última modificación: {fecha(f.actualizado_en)}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ranking: subir el Excel y marcar según el ranking
// ---------------------------------------------------------------------------

const pts = (n: number | null) => (n === null ? '—' : String(Math.round(n * 10) / 10).replace('.', ','));

export function SubirRanking({ onCerrar }: { onCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const input = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<PreviaRanking | null>(null);

  const formulario = (f: File, hoja?: string | null) => {
    const x = new FormData();
    x.append('archivo', f);
    if (hoja) x.append('hoja', hoja);
    return x;
  };
  const leer = useMutation({
    mutationFn: (v: { f: File; hoja?: string | null }) => api.enviarFormulario<PreviaRanking>('/ranking/previsualizar', formulario(v.f, v.hoja)),
    onSuccess: setPrevia,
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  const guardar = useMutation({
    mutationFn: () => api.enviarFormulario<CargaRanking>('/ranking', formulario(archivo!, previa?.hoja)),
    onSuccess: (r) => {
      ['avance', 'ranking'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      avisar(`Ranking cargado: ${r.carga?.filas_ok} estudiantes`);
      onCerrar();
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });

  if (!previa) {
    return (
      <Modal titulo="Subir ranking" onCerrar={onCerrar} ancho="max-w-lg">
        <div className="space-y-4 text-sm text-gray-700">
          <p>Sube el Excel del ranking calculado por la fundación. Cada fila se cruza con el invitado por su <strong>Id.</strong> (ej. <code>16.054a</code>).
            Si el archivo tiene varias pestañas de ponderación, después eliges cuál cargar.</p>
          <input ref={input} type="file" accept=".xlsx" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setArchivo(f); leer.mutate({ f }); } }} />
          <button className="btn-primario" disabled={leer.isPending} onClick={() => input.current?.click()}>
            {leer.isPending ? 'Leyendo archivo…' : 'Elegir Excel del ranking'}
          </button>
        </div>
      </Modal>
    );
  }

  const r = previa.resumen;
  return (
    <Modal titulo={`Revisar ranking — ${archivo?.name ?? ''}`} onCerrar={onCerrar} ancho="max-w-5xl"
      pie={<>
        <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className="btn-primario" disabled={!r.calzan || guardar.isPending} onClick={() => guardar.mutate()}>
          {guardar.isPending ? 'Guardando…' : `Cargar ranking de ${r.calzan} estudiantes`}
        </button>
      </>}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {previa.hojas.length > 1 && (
            <label className="mr-2 flex items-center gap-2">
              <span className="text-gray-600">Pestaña:</span>
              <select className="input w-auto py-1" value={previa.hoja ?? ''} disabled={leer.isPending}
                onChange={(e) => leer.mutate({ f: archivo!, hoja: e.target.value })}>
                {previa.hojas.map((h) => <option key={h.nombre} value={h.nombre}>{h.nombre} ({h.filas} filas)</option>)}
              </select>
            </label>
          )}
          <Etiqueta>{r.filas} filas</Etiqueta>
          <Etiqueta tono="verde">{r.calzan} calzan con un invitado</Etiqueta>
          {r.sinCalce > 0 && <Etiqueta tono="rojo">{r.sinCalce} sin calce (no se cargan)</Etiqueta>}
          <Etiqueta tono="azul">{r.finalistas} finalistas</Etiqueta>
        </div>
        {previa.anterior && (
          <Caja tono="amarillo">Ya hay un ranking cargado ({previa.anterior.nombre_archivo}, {fecha(previa.anterior.cargado_en)}). Al cargar este, se reemplaza.</Caja>
        )}
        {previa.advertencias.length > 0 && (
          <Caja tono="amarillo"><ul className="list-disc space-y-0.5 pl-5">{previa.advertencias.map((a, i) => <li key={i}>{a}</li>)}</ul></Caja>
        )}
        <div className="tarjeta max-h-[50vh] overflow-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-14">Lugar</th><th>Id.</th><th>Estudiante (Excel)</th><th>Establecimiento</th>
                <th className="text-right">Académico</th><th className="text-right">Socioecon.</th><th className="text-right">Compromiso</th>
                <th className="text-right">Total</th><th>RSH</th><th>Finalista</th>
              </tr>
            </thead>
            <tbody>
              {previa.filas.map((f) => (
                <tr key={f.fila} className={!f.postulacion ? 'bg-red-50/60' : f.avisos.length ? 'bg-yellow-50/60' : ''}>
                  <td className="font-semibold tabular-nums">{f.posicion ?? '—'}°</td>
                  <td className="font-mono text-xs">{f.id ?? '—'}</td>
                  <td>
                    {f.apellidoPaterno} {f.apellidoMaterno}, {f.nombre}
                    {f.avisos.map((a, i) => <div key={i} className="text-xs text-red-700">⚠ {a}</div>)}
                  </td>
                  <td className="max-w-[180px] truncate text-gray-500" title={f.establecimiento ?? ''}>{f.establecimiento}</td>
                  <td className="text-right tabular-nums text-gray-500">{pts(f.puntajeAcademico)}</td>
                  <td className="text-right tabular-nums text-gray-500">{pts(f.puntajeSocioeconomico)}</td>
                  <td className="text-right tabular-nums text-gray-500">{pts(f.puntajeCompromiso)}</td>
                  <td className="text-right font-semibold tabular-nums">{pts(f.puntajeTotal)}</td>
                  <td>{f.rsh === 'P' ? <Etiqueta tono="amarillo">Pendiente</Etiqueta> : f.rsh ?? '—'}</td>
                  <td>{f.finalista ? <Etiqueta tono="azul">Sí</Etiqueta> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

export function MarcarSegunRanking({ etapaId, cupo, finalistas, onCerrar }: {
  etapaId: string; cupo: number | null; finalistas: number; onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const [criterio, setCriterio] = useState<'finalistas' | 'primeros'>(finalistas ? 'finalistas' : 'primeros');
  const [n, setN] = useState(String(cupo ?? 60));
  const marcar = useMutation({
    mutationFn: () => api.post<{ pasan: number; noPasan: number; sinRanking: number }>(`/avance/${etapaId}/marcar-segun-ranking`,
      criterio === 'finalistas' ? { criterio } : { criterio, n: Number(n) }),
    onSuccess: (r) => {
      ['avance', 'proceso', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      avisar(`Marcados: ${r.pasan} avanzan y ${r.noPasan} no avanzan${r.sinRanking ? ` · ${r.sinRanking} sin ranking quedaron como estaban` : ''}. Revisa y confirma.`, 'info');
      onCerrar();
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  return (
    <Modal titulo="Marcar según el ranking" onCerrar={onCerrar} ancho="max-w-md"
      pie={<><button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className="btn-primario" disabled={marcar.isPending || (criterio === 'primeros' && !(Number(n) > 0))} onClick={() => marcar.mutate()}>Marcar</button></>}>
      <div className="space-y-3 text-sm">
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-1" checked={criterio === 'finalistas'} disabled={!finalistas} onChange={() => setCriterio('finalistas')} />
          <span>Avanzan los <strong>finalistas</strong> marcados en el Excel ({finalistas})</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-1" checked={criterio === 'primeros'} onChange={() => setCriterio('primeros')} />
          <span className="flex flex-wrap items-center gap-1.5">
            Avanzan los primeros
            <input type="number" min={1} className="input w-20 py-1" value={n} onChange={(e) => { setN(e.target.value); setCriterio('primeros'); }} aria-label="Cuántos avanzan" />
            lugares del ranking (los empates entran)
          </span>
        </label>
        <p className="text-xs text-gray-500">
          El resto de los estudiantes con ranking queda como “no avanza”. Reemplaza las marcas que aún no estén confirmadas;
          quienes no aparecen en el ranking no se tocan. Nada se aplica hasta que presiones “Confirmar avance”.
        </p>
      </div>
    </Modal>
  );
}