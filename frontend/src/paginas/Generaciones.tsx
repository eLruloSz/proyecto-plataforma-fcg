import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, EtapaResumen, Generacion, GeneracionHistoricaDatos, GRUPOS, PROPOSITOS, ResumenGeneracion } from '../api';
import { Caja, Cargando, ErrorCarga, Etiqueta, fecha, Modal, useAviso, Vacio } from '../ui';

// Histórico de generaciones: un año = un proceso. Los cerrados se muestran
// desde la foto guardada al cerrarlos (solo lectura); el que está en curso,
// con sus números del momento; los ingresados a mano, como los escribieron.

export function useGeneraciones() {
  return useQuery({ queryKey: ['generaciones'], queryFn: () => api.get<Generacion[]>('/generaciones') });
}

const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('es-CL'));
const pct = (n: number | null | undefined, de: number | null | undefined) =>
  n === null || n === undefined || !de ? null : Math.round((n / de) * 100);

/** Filas del embudo: invitados (etapa 1), las etapas siguientes y los becarios. */
function filasEmbudo(r: ResumenGeneracion) {
  const filas: { texto: string; valor: number | null; final?: boolean }[] = [{ texto: 'Invitados', valor: r.invitados }];
  r.etapas.filter((e) => e.orden > 1).forEach((e) => filas.push({ texto: e.nombre, valor: e.llegaron }));
  filas.push({ texto: 'Becarios', valor: r.becarios, final: true });
  return filas;
}

function EtiquetaGeneracion({ g }: { g: Generacion }) {
  if (g.estado === 'ACTIVO') return <Etiqueta tono="amarillo">En curso</Etiqueta>;
  if (g.historico) return <Etiqueta>Histórica</Etiqueta>;
  return <Etiqueta tono="verde">Cerrado</Etiqueta>;
}

function Barra({ valor, de, final }: { valor: number | null; de: number | null; final?: boolean }) {
  const ancho = pct(valor, de);
  return (
    <div className="h-2 rounded-full bg-gray-100">
      {ancho !== null && (
        <div className={`h-2 rounded-full ${final ? 'bg-green-600' : 'bg-marca-700'}`} style={{ width: `${Math.max(Math.min(ancho, 100), valor ? 2 : 0)}%` }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tarjetas
// ---------------------------------------------------------------------------

/**
 * Grilla de tarjetas. `base` es la ruta del detalle ("/generaciones").
 * Se usa en la pantalla "Iniciar proceso" y en el menú del sistema.
 */
export function ListaGeneraciones({ base = '/generaciones' }: { base?: string }) {
  const { data, isLoading, error } = useGeneraciones();
  const [agregando, setAgregando] = useState(false);
  if (isLoading) return <Cargando />;
  if (error || !data) return <ErrorCarga error={error} />;

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((g) => <TarjetaGeneracion key={g.anio} g={g} a={`${base}/${g.anio}`} />)}
        <button onClick={() => setAgregando(true)}
          className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 p-6 text-center text-gray-600 transition-colors hover:border-marca-600 hover:bg-marca-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca-600">
          <span className="text-3xl leading-none text-marca-700" aria-hidden="true">+</span>
          <span className="font-semibold text-gray-900">Agregar generación anterior</span>
          <span className="max-w-[260px] text-sm">Para años antes del sistema: los números del embudo y la lista de becarios, ingresados a mano.</span>
        </button>
      </div>
      {agregando && <FormHistorica onCerrar={() => setAgregando(false)} base={base} />}
    </>
  );
}

function TarjetaGeneracion({ g, a }: { g: Generacion; a: string }) {
  const r = g.resumen;
  const filas = r ? filasEmbudo(r) : [];
  const tope = r?.invitados ?? Math.max(0, ...filas.map((f) => f.valor ?? 0));
  const sub = g.estado === 'ACTIVO' ? `Desde el ${fecha(g.inicio, false)}`
    : g.historico ? 'Ingresada a mano'
      : `Cerrado el ${fecha(g.cerrado_en, false)}`;

  return (
    <article className={`tarjeta flex flex-col gap-5 rounded-xl p-6 ${g.estado === 'ACTIVO' ? 'border-yellow-300' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-4xl font-bold leading-none tabular-nums text-gray-900">{g.anio}</div>
          <div className="mt-2 text-sm text-gray-500">{sub}</div>
        </div>
        <EtiquetaGeneracion g={g} />
      </div>
      <div className="space-y-3">
        {filas.map((f) => (
          <div key={f.texto} className="space-y-1.5">
            <div className="flex justify-between gap-3 text-sm">
              <span className="truncate text-gray-600">{f.texto}</span>
              <span className={`font-semibold tabular-nums ${f.final ? 'text-green-800' : 'text-gray-900'}`}>{num(f.valor)}</span>
            </div>
            <Barra valor={f.valor} de={tope} final={f.final} />
          </div>
        ))}
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <span className="text-sm text-gray-500">{num(r?.liceos.convocados)} liceos convocados</span>
        <Link to={a} className="py-1 text-sm font-semibold text-marca-700 hover:text-marca-800 hover:underline">
          {g.historico ? 'Ver resumen' : 'Ver generación'} →
        </Link>
      </div>
    </article>
  );
}

/** Página del menú "Generaciones" (con el proceso en curso). */
export function PaginaGeneraciones() {
  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="titulo">Generaciones</h1>
        <p className="mt-1 text-sm text-gray-500">Procesos de cada año. Los cerrados se pueden consultar, pero no modificar.</p>
      </div>
      <ListaGeneraciones />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------
type Pestana = 'resumen' | 'becarios' | 'liceos' | 'correos';

export function DetalleGeneracion({ volver = '/generaciones' }: { volver?: string }) {
  const { anio } = useParams();
  const { data: g, isLoading, error } = useQuery({
    queryKey: ['generacion', Number(anio)],
    queryFn: () => api.get<Generacion>(`/generaciones/${anio}`),
  });
  const [pestana, setPestana] = useState<Pestana>('resumen');
  const [editando, setEditando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  if (isLoading) return <Cargando />;
  if (error || !g) return <div className="space-y-4"><VolverA a={volver} /><ErrorCarga error={error} /></div>;
  const r = g.resumen;

  const pestanas: { id: Pestana; texto: string }[] = [
    { id: 'resumen', texto: 'Resumen' },
    { id: 'becarios', texto: `Becarios (${r?.lista_becarios?.length ?? 0})` },
    ...(!g.historico ? [
      { id: 'liceos' as const, texto: `Liceos (${r?.por_liceo?.length ?? 0})` },
      { id: 'correos' as const, texto: `Correos (${r?.material?.envios.length ?? 0})` },
    ] : []),
  ];

  return (
    <div className="max-w-6xl space-y-6">
      <VolverA a={volver} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">Generación {g.anio}</h1>
            <EtiquetaGeneracion g={g} />
          </div>
          <p className="text-sm text-gray-500">
            {g.historico ? 'Datos ingresados a mano (año anterior al sistema)'
              : g.estado === 'ACTIVO' ? `En curso desde el ${fecha(g.inicio, false)}. Los números cambian hasta que se cierre el proceso.`
                : `Del ${fecha(g.inicio, false)} al ${fecha(g.cerrado_en, false)}`}
          </p>
        </div>
        {g.historico ? (
          <div className="flex gap-2">
            <button className="btn-secundario" onClick={() => setEditando(true)}>Corregir datos</button>
            <button className="btn-peligro" onClick={() => setEliminando(true)}>Eliminar</button>
          </div>
        ) : g.estado === 'CERRADO' && (
          <span className="inline-flex items-center gap-2 rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Solo lectura
          </span>
        )}
      </div>

      {!r ? <Caja tono="amarillo">Esta generación no tiene datos guardados.</Caja> : (
        <>
          <nav aria-label="Secciones de la generación" className="flex flex-wrap gap-1 border-b border-gray-200">
            {pestanas.map((p) => (
              <button key={p.id} onClick={() => setPestana(p.id)} aria-current={pestana === p.id ? 'page' : undefined}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${pestana === p.id ? 'border-marca-700 font-semibold text-marca-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
                {p.texto}
              </button>
            ))}
          </nav>
          {pestana === 'resumen' && <Resumen g={g} r={r} irA={setPestana} />}
          {pestana === 'becarios' && <Becarios r={r} />}
          {pestana === 'liceos' && <PorLiceo r={r} />}
          {pestana === 'correos' && <Correos r={r} />}
        </>
      )}

      {editando && <FormHistorica g={g} base="/generaciones" onCerrar={() => setEditando(false)} />}
      {eliminando && <EliminarHistorica anio={g.anio} volver={volver} onCerrar={() => setEliminando(false)} />}
    </div>
  );
}

function VolverA({ a }: { a: string }) {
  return <Link to={a} className="inline-block py-1 text-sm font-semibold text-marca-700 hover:underline">← Generaciones</Link>;
}

function Resumen({ g, r, irA }: { g: Generacion; r: ResumenGeneracion; irA: (p: Pestana) => void }) {
  const cifras = [
    { texto: 'Liceos convocados', valor: r.liceos.convocados },
    { texto: 'Invitados', valor: r.invitados },
    { texto: 'Aceptaron postular', valor: r.aceptaron },
    { texto: 'Becarios', valor: r.becarios, final: true },
  ];
  const becarios = r.lista_becarios ?? [];
  const m = r.material;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cifras.map((c) => (
          <div key={c.texto} className="tarjeta rounded-xl px-5 py-4">
            <div className="text-xs text-gray-500">{c.texto}</div>
            <div className={`mt-1 text-3xl font-bold tabular-nums ${c.final ? 'text-green-800' : 'text-gray-900'}`}>{num(c.valor)}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="tarjeta rounded-xl p-6">
          <h2 className="subtitulo mb-4 text-base">Embudo de selección</h2>
          <Embudo r={r} />
        </section>
        <section className="tarjeta flex flex-col rounded-xl p-6">
          <h2 className="subtitulo mb-2 text-base">Becarios {g.anio}</h2>
          {becarios.length === 0 ? <Vacio>Sin becarios registrados.</Vacio> : (
            <ul className="divide-y divide-gray-100">
              {becarios.slice(0, 6).map((b, i) => <FilaBecario key={i} b={b} />)}
            </ul>
          )}
          {becarios.length > 6 && (
            <button className="mt-2 self-start py-1 text-sm font-semibold text-marca-700 hover:underline" onClick={() => irA('becarios')}>
              Ver los {becarios.length} becarios
            </button>
          )}
        </section>
      </div>

      {g.observaciones && <Caja tono="azul" titulo="Observaciones"><p className="whitespace-pre-line">{g.observaciones}</p></Caja>}

      {m && (
        <section className="space-y-3">
          <h2 className="subtitulo text-base">Material del proceso</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Material titulo="Nóminas de notas" texto={`${m.nominas} ${m.nominas === 1 ? 'liceo envió' : 'liceos enviaron'} su nómina`} />
            <Material titulo="Ranking Preselección N°1"
              texto={m.ranking ? `${m.ranking.nombre_archivo} · subido el ${fecha(m.ranking.cargado_en, false)}` : 'No se subió un ranking ese año'} />
            <Material titulo="Entrevistas" texto={`${m.entrevistas} entrevistas realizadas`} />
            <Material titulo="Correos enviados" texto={`${m.envios.length} envíos · ${m.correos} correos en total`}
              accion={m.envios.length ? { texto: 'Ver correos', fn: () => irA('correos') } : undefined} />
          </div>
        </section>
      )}
    </div>
  );
}

function Embudo({ r }: { r: ResumenGeneracion }) {
  const filas = filasEmbudo(r);
  const tope = r.invitados ?? Math.max(0, ...filas.map((f) => f.valor ?? 0));
  return (
    <ol className="space-y-4">
      {filas.map((f, i) => {
        const sig = filas[i + 1];
        const paso = sig ? pct(sig.valor, f.valor) : null;
        return (
          <li key={f.texto}>
            <div className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_3.5rem] items-center gap-3 sm:grid-cols-[180px_minmax(0,1fr)_3.5rem]">
              <span className="text-sm text-gray-700">{f.texto}</span>
              <div className="h-6 rounded-md bg-gray-100">
                {pct(f.valor, tope) !== null && (
                  <div className={`h-6 rounded-md ${f.final ? 'bg-green-600' : 'bg-marca-700'}`}
                    style={{ width: `${Math.max(Math.min(pct(f.valor, tope)!, 100), f.valor ? 1.5 : 0)}%` }} />
                )}
              </div>
              <span className="text-right font-bold tabular-nums">{num(f.valor)}</span>
            </div>
            {paso !== null && (
              <div className="mt-1 text-xs text-gray-500 sm:pl-[192px]">{paso}% {sig.final ? 'quedó seleccionado' : `pasó a ${sig.texto}`}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Material({ titulo, texto, accion }: { titulo: string; texto: string; accion?: { texto: string; fn: () => void } }) {
  return (
    <div className="tarjeta flex flex-col gap-1.5 rounded-xl p-5">
      <span className="font-semibold text-gray-900">{titulo}</span>
      <span className="text-sm text-gray-500">{texto}</span>
      {accion && <button className="mt-1 self-start py-1 text-sm font-semibold text-marca-700 hover:underline" onClick={accion.fn}>{accion.texto}</button>}
    </div>
  );
}

function FilaBecario({ b }: { b: { codigo: string | null; nombre: string; liceo: string | null } }) {
  const iniciales = b.nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-green-50 text-xs font-bold text-green-800" aria-hidden="true">{iniciales}</span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-gray-900">{b.nombre}</div>
        <div className="truncate text-xs text-gray-500">{[b.liceo, b.codigo].filter(Boolean).join(' · ') || '—'}</div>
      </div>
    </li>
  );
}

function Becarios({ r }: { r: ResumenGeneracion }) {
  const lista = r.lista_becarios ?? [];
  return (
    <section className="tarjeta rounded-xl px-6 py-2">
      {lista.length === 0 ? <Vacio>Sin becarios registrados.</Vacio> : (
        <ul className="grid divide-y divide-gray-100 sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0">
          {lista.map((b, i) => <FilaBecario key={i} b={b} />)}
        </ul>
      )}
    </section>
  );
}

function PorLiceo({ r }: { r: ResumenGeneracion }) {
  const etapas: (EtapaResumen & { i: number })[] = r.etapas.map((e, i) => ({ ...e, i })).filter((e) => e.orden > 1);
  const lista = r.por_liceo ?? [];
  return (
    <section className="tarjeta overflow-x-auto rounded-xl">
      <table className="tabla">
        <thead>
          <tr>
            <th>Liceo</th>
            <th className="text-right">Invitados</th>
            <th className="text-right">Aceptaron</th>
            {etapas.map((e) => <th key={e.orden} className="text-right">{e.nombre}</th>)}
            <th className="text-right">Becarios</th>
          </tr>
        </thead>
        <tbody>
          {lista.length === 0 && <tr><td colSpan={4 + etapas.length}><Vacio>Sin liceos registrados.</Vacio></td></tr>}
          {lista.map((l) => (
            <tr key={l.codigo}>
              <td className="font-medium"><span className="text-gray-400">{l.codigo}.</span> {l.nombre}</td>
              <td className="text-right tabular-nums">{l.invitados}</td>
              <td className="text-right tabular-nums">{l.aceptaron}</td>
              {etapas.map((e) => <td key={e.orden} className="text-right tabular-nums">{l.llegaron[e.i]}</td>)}
              <td className={`text-right font-bold tabular-nums ${l.becarios ? 'text-green-800' : 'text-gray-400'}`}>{l.becarios}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Correos({ r }: { r: ResumenGeneracion }) {
  const envios = r.material?.envios ?? [];
  return (
    <section className="tarjeta overflow-x-auto rounded-xl">
      <table className="tabla">
        <thead><tr><th>Fecha</th><th>Asunto</th><th>Tipo</th><th>Destinatarios</th><th className="text-right">Correos</th></tr></thead>
        <tbody>
          {envios.length === 0 && <tr><td colSpan={5}><Vacio>No se enviaron correos.</Vacio></td></tr>}
          {envios.map((e, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap text-gray-500">{fecha(e.enviado_en)}</td>
              <td className="font-medium">{e.asunto}</td>
              <td className="text-gray-600">{PROPOSITOS[e.proposito] ?? e.proposito}</td>
              <td className="text-gray-600">{GRUPOS[e.grupo] ?? e.grupo}</td>
              <td className="text-right tabular-nums">{e.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Generación ingresada a mano: crear, corregir y eliminar
// ---------------------------------------------------------------------------
const ETAPAS_SUGERIDAS = ['Presentación de la beca', 'Preselección N°1', 'Preselección N°2', 'Selección de becarios'];
const texto = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const numero = (s: string) => (s.trim() === '' ? null : Number(s));

/** "Nombre — Liceo" por línea (también acepta guion, punto y coma o tabulación). */
function leerBecarios(s: string) {
  return s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [nombre, ...resto] = l.split(/\s+[—–-]\s+|\t|;/);
    return { nombre: nombre.trim(), liceo: resto.join(' ').trim() || null };
  });
}

function FormHistorica({ g, base, onCerrar }: { g?: Generacion; base: string; onCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const navigate = useNavigate();
  const r = g?.resumen;
  const [f, setF] = useState({
    anio: texto(g?.anio),
    liceos: texto(r?.liceos.convocados), invitados: texto(r?.invitados), aceptaron: texto(r?.aceptaron), becarios: texto(r?.becarios),
    observaciones: g?.observaciones ?? '',
    becariosTexto: (r?.lista_becarios ?? []).map((b) => (b.liceo ? `${b.nombre} — ${b.liceo}` : b.nombre)).join('\n'),
  });
  const [etapas, setEtapas] = useState(
    r ? r.etapas.map((e) => ({ nombre: e.nombre, llegaron: texto(e.llegaron) })) : ETAPAS_SUGERIDAS.map((nombre) => ({ nombre, llegaron: '' })));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const numeros = [f.liceos, f.invitados, f.aceptaron, f.becarios, ...etapas.map((e) => e.llegaron)];
  const anioValido = /^\d{4}$/.test(f.anio);
  const numerosValidos = numeros.every((n) => n.trim() === '' || /^\d+$/.test(n.trim()));
  const etapasValidas = etapas.every((e) => e.nombre.trim());

  const guardar = useMutation({
    mutationFn: () => {
      const datos: GeneracionHistoricaDatos = {
        anio: Number(f.anio), liceos: numero(f.liceos), invitados: numero(f.invitados), aceptaron: numero(f.aceptaron), becarios: numero(f.becarios),
        etapas: etapas.map((e) => ({ nombre: e.nombre.trim(), llegaron: numero(e.llegaron) })),
        listaBecarios: leerBecarios(f.becariosTexto),
        observaciones: f.observaciones.trim() || null,
      };
      return g ? api.put<Generacion>(`/generaciones/historicas/${g.anio}`, datos) : api.post<Generacion>('/generaciones/historicas', datos);
    },
    onSuccess: (nueva) => {
      qc.invalidateQueries({ queryKey: ['generaciones'] });
      qc.invalidateQueries({ queryKey: ['inicio'] });
      qc.setQueryData(['generacion', nueva.anio], nueva);
      if (g && g.anio !== nueva.anio) qc.removeQueries({ queryKey: ['generacion', g.anio] });
      avisar(g ? `Generación ${nueva.anio} corregida` : `Generación ${nueva.anio} agregada`);
      onCerrar();
      if (!g || g.anio !== nueva.anio) navigate(`${base}/${nueva.anio}`);
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });

  return (
    <Modal titulo={g ? `Corregir generación ${g.anio}` : 'Agregar generación anterior'} onCerrar={onCerrar} ancho="max-w-2xl"
      pie={<>
        <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className="btn-primario" disabled={!anioValido || !numerosValidos || !etapasValidas || guardar.isPending} onClick={() => guardar.mutate()}>
          {guardar.isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </>}>
      <div className="space-y-5 text-sm">
        <p className="text-gray-600">Ingresa lo que tengas de ese año. Los campos vacíos se muestran como "sin dato".</p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Campo id="h-anio" texto="Año" valor={f.anio} onChange={set('anio')} />
          <Campo id="h-liceos" texto="Liceos convocados" valor={f.liceos} onChange={set('liceos')} />
          <Campo id="h-invitados" texto="Invitados" valor={f.invitados} onChange={set('invitados')} />
          <Campo id="h-aceptaron" texto="Aceptaron postular" valor={f.aceptaron} onChange={set('aceptaron')} />
          <Campo id="h-becarios" texto="Becarios" valor={f.becarios} onChange={set('becarios')} />
        </div>

        <fieldset>
          <legend className="label">Estudiantes que llegaron a cada etapa (después de la invitación)</legend>
          <div className="space-y-2">
            {etapas.map((e, i) => (
              <div key={i} className="flex gap-2">
                <input className="input" value={e.nombre} aria-label={`Nombre de la etapa ${i + 2}`}
                  onChange={(ev) => setEtapas(etapas.map((x, j) => (j === i ? { ...x, nombre: ev.target.value } : x)))} />
                <input className="input w-28" inputMode="numeric" placeholder="N°" value={e.llegaron} aria-label={`Llegaron a ${e.nombre || `la etapa ${i + 2}`}`}
                  onChange={(ev) => setEtapas(etapas.map((x, j) => (j === i ? { ...x, llegaron: ev.target.value } : x)))} />
                <button className="btn-secundario px-2.5" aria-label={`Quitar ${e.nombre || 'etapa'}`}
                  onClick={() => setEtapas(etapas.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
          {etapas.length < 20 && (
            <button className="btn-secundario btn-chico mt-2" onClick={() => setEtapas([...etapas, { nombre: '', llegaron: '' }])}>+ Agregar etapa</button>
          )}
        </fieldset>

        <div>
          <label className="label" htmlFor="h-lista">Becarios (uno por línea, opcional: Nombre — Liceo)</label>
          <textarea id="h-lista" className="input min-h-[110px] font-mono text-xs" value={f.becariosTexto} onChange={set('becariosTexto')}
            placeholder={'Ana Pérez Soto — Liceo Ejemplo\nLuis Rojas'} />
        </div>
        <div>
          <label className="label" htmlFor="h-obs">Observaciones</label>
          <textarea id="h-obs" className="input min-h-[70px]" value={f.observaciones} onChange={set('observaciones')} placeholder="Ej. datos tomados de la planilla de ese año" />
        </div>
        {!numerosValidos && <p className="text-red-700">Los números deben ser enteros sin puntos ni comas.</p>}
      </div>
    </Modal>
  );
}

function Campo({ id, texto, valor, onChange }: { id: string; texto: string; valor: string; onChange: (e: { target: { value: string } }) => void }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{texto}</label>
      <input id={id} className="input" inputMode="numeric" value={valor} onChange={onChange} />
    </div>
  );
}

function EliminarHistorica({ anio, volver, onCerrar }: { anio: number; volver: string; onCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const navigate = useNavigate();
  const eliminar = useMutation({
    mutationFn: () => api.del(`/generaciones/historicas/${anio}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['generaciones'] });
      qc.invalidateQueries({ queryKey: ['inicio'] });
      qc.removeQueries({ queryKey: ['generacion', anio] });
      avisar(`Generación ${anio} eliminada`);
      navigate(volver);
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  return (
    <Modal titulo={`Eliminar generación ${anio}`} onCerrar={onCerrar} ancho="max-w-md"
      pie={<>
        <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className="btn-peligro" disabled={eliminar.isPending} onClick={() => eliminar.mutate()}>Eliminar</button>
      </>}>
      <p className="text-sm text-gray-700">Se borrarán los datos ingresados a mano de {anio}. Esto no se puede deshacer.</p>
    </Modal>
  );
}
