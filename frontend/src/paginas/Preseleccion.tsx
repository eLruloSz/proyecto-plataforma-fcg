import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, CargaRanking, FichaPostulacion, PreviaRanking, VistaAvance } from '../api';
import { Caja, Etiqueta, fecha, Modal, useAviso } from '../ui';

type Fila = VistaAvance['estudiantes'][number];

// ---------------------------------------------------------------------------
// Ranking en la tabla de la etapa
// ---------------------------------------------------------------------------

/** Columnas del ranking: "Lugar" va al inicio (antes del estudiante) y los puntajes a la derecha. */
export const COLUMNAS_RANKING = 6;
export function EncabezadoLugar() {
  return <th title="Lugar en el ranking general">Lugar</th>;
}
export function EncabezadosPuntajes() {
  return (
    <>
      <th className="text-right" title="Puntaje total (máx. 110 = 35 + 50 + 25)">Total <span className="font-normal text-gray-400">/110</span></th>
      <th className="text-right" title="Puntaje académico (máx. 35): según el lugar del estudiante en su liceo (1° → 35, 2° → 30, 3° → 25)">Académico <span className="font-normal text-gray-400">/35</span></th>
      <th className="text-right" title="Puntaje socioeconómico (máx. 50) = I.P.C. (máx. 30) + nivel educacional de los padres (máx. 15) + vulnerabilidad (máx. 5)">Socioeconómico <span className="font-normal text-gray-400">/50</span></th>
      <th className="text-right" title="Compromiso y participación (máx. 25)">Compromiso <span className="font-normal text-gray-400">/25</span></th>
      <th title="RSH según el Excel del ranking">RSH</th>
    </>
  );
}

/** "40%" → 40 · "P" → 'P' · otro texto → null */
function leerRsh(rsh: string | null): number | 'P' | null {
  if (!rsh) return null;
  if (/^p/i.test(rsh.trim())) return 'P';
  const n = Number(rsh.replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) ? (n > 0 && n <= 1 ? Math.round(n * 100) : n) : null; // 0,4 → 40 si viene como fracción
}

/** RSH con color: hasta 40% verde, 41–50% amarillo (caso a caso), sobre 50% rojo, P = pendiente. */
export function EtiquetaRsh({ rsh }: { rsh: string | null }) {
  const v = leerRsh(rsh);
  if (v === null) return <span className="text-xs text-gray-400">{rsh ?? '—'}</span>;
  if (v === 'P') return <Etiqueta tono="amarillo">Pendiente</Etiqueta>;
  const tono = v <= 40 ? 'verde' : v <= 50 ? 'amarillo' : 'rojo';
  const ayuda = v <= 40 ? 'Dentro del requisito (≤ 40%)' : v <= 50 ? 'Entre 41% y 50%: revisar caso a caso' : 'Sobre el máximo (50%)';
  return <span title={ayuda}><Etiqueta tono={tono}>{v}%</Etiqueta></span>;
}

const p1 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(Math.round(n * 10) / 10).replace('.', ','));

/** Lugar en su liceo como etiqueta: 1° dorado, 2° plateado, 3° bronce. */
function LugarLiceo({ n }: { n: number }) {
  const estilo = n === 1 ? 'border-amber-300 bg-amber-50 text-amber-800'
    : n === 2 ? 'border-slate-300 bg-slate-50 text-slate-700'
    : n === 3 ? 'border-orange-300 bg-orange-50 text-orange-800'
    : 'border-gray-200 bg-white text-gray-600';
  return (
    <span className={`mt-1 inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${estilo}`} title={`${n}° lugar en notas dentro de su liceo`}>
      {n}° en su liceo
    </span>
  );
}

/** Celda "Lugar" (va antes del nombre). */
export function CeldaLugar({ r }: { r: Fila['ranking'] }) {
  return <td className="font-semibold tabular-nums">{r?.posicion ? `${r.posicion}°` : <span className="text-gray-400">—</span>}</td>;
}

/** Celdas de puntajes (van a la derecha), o "sin ranking" ocupando todas. */
export function CeldasPuntajes({ r }: { r: Fila['ranking'] }) {
  if (!r) return <td colSpan={COLUMNAS_RANKING - 1} className="text-xs text-gray-400">sin ranking</td>;
  return (
    <>
      <td className="text-right font-semibold tabular-nums">{p1(r.puntaje_total)}</td>
      <td className="text-right tabular-nums" title={r.notas !== null ? `Notas ${p1(r.notas)}` : undefined}>
        <div>{p1(r.puntaje_academico)}</div>
        {r.ranking_notas ? <LugarLiceo n={r.ranking_notas} /> : null}
      </td>
      <td className="text-right tabular-nums">
        <div>{p1(r.puntaje_socioeconomico)}</div>
        <div className="whitespace-nowrap text-[11px] text-gray-400">
          <span title="Puntaje I.P.C. (máx. 30)">IPC {p1(r.puntaje_ipc)}/30</span>
          {' · '}<span title="Nivel educacional de los padres (máx. 15)">Padres {p1(r.puntaje_nivel_padres)}/15</span>
          {' · '}<span title="Vulnerabilidad (máx. 5)">Vul. {p1(r.puntaje_vulnerabilidad)}/5</span>
        </div>
      </td>
      <td className="text-right tabular-nums">{p1(r.puntaje_compromiso)}</td>
      <td><EtiquetaRsh rsh={r.rsh} /></td>
    </>
  );
}

// ---------------------------------------------------------------------------
// Ficha de postulación (datos de la cartola RSH)
// ---------------------------------------------------------------------------

/**
 * Alertas de la ficha: lo que la fundación revisa a mano hoy.
 * El % de RSH ya no se digita aquí: viene del Excel del ranking (columna RSH, con su color).
 */
export function alertasFicha(f: FichaPostulacion | null): { tono: 'amarillo' | 'rojo'; texto: string }[] {
  if (!f) return [];
  const a: { tono: 'amarillo' | 'rojo'; texto: string }[] = [];
  if (f.personas_formulario && f.personas_hogar && f.personas_formulario !== f.personas_hogar) {
    a.push({ tono: 'amarillo', texto: `Formulario dice ${f.personas_formulario} personas y la cartola ${f.personas_hogar}` });
  }
  if (f.rsh_actualizada) {
    const meses = (Date.now() - new Date(f.rsh_actualizada).getTime()) / (30.4 * 24 * 3600 * 1000);
    if (meses > 12) a.push({ tono: 'amarillo', texto: 'Cartola con más de un año sin actualizar' });
  }
  return a;
}

/** Celda de la tabla de la etapa: datos del hogar y alertas, con botón para abrir la ficha. */
export function CeldaFicha({ f, onAbrir }: { f: Fila; onAbrir: () => void }) {
  const alertas = alertasFicha(f.ficha);
  const apoyo = f.ficha ? (f.ficha.con_discapacidad ?? 0) + (f.ficha.con_dependencia ?? 0) + (f.ficha.con_invalidez ?? 0) + (f.ficha.con_nee ?? 0) : 0;
  return (
    <button onClick={onAbrir} className="w-full min-w-[150px] rounded-md px-1 py-0.5 text-left hover:bg-gray-100" title="Ver o editar la ficha de postulación">
      {!f.ficha ? <span className="text-xs text-gray-400 underline">completar ficha</span> : (
        <div className="space-y-0.5 text-xs">
          <div className="text-gray-800">
            {f.ficha.personas_hogar ? `${f.ficha.personas_hogar} personas` : 'Sin personas del hogar'}
            {apoyo > 0 && <span className="text-gray-400"> · {apoyo} con apoyo</span>}
            {f.ficha.observaciones && <span className="text-gray-400" title={f.ficha.observaciones}> · 💬</span>}
          </div>
          {alertas.map((x) => <div key={x.texto} className={x.tono === 'rojo' ? 'text-red-700' : 'text-yellow-800'}>⚠ {x.texto}</div>)}
        </div>
      )}
    </button>
  );
}

type FormFicha = Record<
  'actualizada' | 'personas' | 'menores' | 'mayores' | 'discapacidad' | 'dependencia' | 'invalidez' | 'nee' | 'ingresos' | 'formulario' | 'observaciones',
  string
>;

const aTexto = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const aNumero = (s: string) => (s.trim() === '' ? null : Number(s));

export function FichaModal({ estudiante, onCerrar }: { estudiante: Fila; onCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const f = estudiante.ficha;
  const [d, setD] = useState<FormFicha>({
    actualizada: f?.rsh_actualizada?.slice(0, 10) ?? '',
    personas: aTexto(f?.personas_hogar), menores: aTexto(f?.menores_18), mayores: aTexto(f?.mayores_60),
    discapacidad: aTexto(f?.con_discapacidad), dependencia: aTexto(f?.con_dependencia), invalidez: aTexto(f?.con_invalidez), nee: aTexto(f?.con_nee),
    ingresos: f?.ingresos_hogar ?? '', formulario: aTexto(f?.personas_formulario), observaciones: f?.observaciones ?? '',
  });
  const [error, setError] = useState('');
  const set = (k: keyof FormFicha, v: string) => { setD((x) => ({ ...x, [k]: v })); setError(''); };

  const guardar = useMutation({
    mutationFn: () => api.put<FichaPostulacion>(`/postulaciones/${estudiante.id}/ficha`, {
      rshActualizada: d.actualizada || null,
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
    rsh_actualizada: d.actualizada || null,
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
          Copia los datos del hogar desde la cartola del Registro Social de Hogares que envió el estudiante. La cartola no se sube al sistema.
          Deja en blanco lo que no tengas.
        </p>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Registro Social de Hogares</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="label">% RSH (del Excel del ranking)</span>
              <div className="py-1.5">
                {estudiante.ranking ? <EtiquetaRsh rsh={estudiante.ranking.rsh} />
                  : <span className="text-xs text-gray-400">Aparece al subir el ranking</span>}
              </div>
            </div>
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
                <th className="text-right">Total</th><th>RSH</th>
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
                  <td><EtiquetaRsh rsh={f.rsh} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

export function MarcarSegunRanking({ etapaId, cupo, onCerrar }: {
  etapaId: string; cupo: number | null; onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const [n, setN] = useState(String(cupo ?? 60));
  const marcar = useMutation({
    mutationFn: () => api.post<{ pasan: number; noPasan: number; sinRanking: number }>(`/avance/${etapaId}/marcar-segun-ranking`,
      { n: Number(n) }),
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
        <button className="btn-primario" disabled={marcar.isPending || !(Number(n) > 0)} onClick={() => marcar.mutate()}>Marcar</button></>}>
      <div className="space-y-3 text-sm">
        <label className="flex flex-wrap items-center gap-1.5">
          Avanzan los primeros
          <input type="number" min={1} className="input w-20 py-1" value={n} onChange={(e) => setN(e.target.value)} aria-label="Cuántos avanzan" />
          lugares del ranking (los empates entran)
        </label>
        <p className="text-xs text-gray-500">
          El resto de los estudiantes con ranking queda como “no avanza”. Reemplaza las marcas que aún no estén confirmadas;
          quienes no aparecen en el ranking no se tocan. Nada se aplica hasta que presiones “Confirmar avance”.
        </p>
      </div>
    </Modal>
  );
}