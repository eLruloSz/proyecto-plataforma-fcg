import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { compararPersonas, cuerpoFicha, DatosFicha, Estudiante, ResultadoCartola as Resultado, Verificacion } from '../cartolas';
import { Caja, Etiqueta, fecha, Icono, useAviso } from '../ui';

/**
 * Carga de cartolas RSH (PDF): el sistema lee cada una, muestra lo que encontró y, si la persona del equipo
 * confirma, lo guarda en la ficha del estudiante. Los PDF NO se guardan: se leen en el servidor, se descartan y
 * aquí solo queda lo leído (que además no incluye datos de los demás integrantes del hogar).
 */

/** Una fila por estudiante: una cartola puede servir a varios hermanos; una sin reconocer espera que la asignen. */
interface Fila {
  clave: string; r: Resultado; archivo: File; estudiante: Estudiante | null; aplicar: boolean;
  estadoGuardado: 'pendiente' | 'guardado' | { error: string };
  /** Resultado de comparar la cartola con un estudiante asignado a mano (el servidor relee el PDF). */
  verificacion?: Verificacion; verificando?: boolean;
}

const PORTE_ENVIO = 5; // nginx acepta 12 MB por envío y cada PDF puede pesar hasta 2 MB
const CAMPOS: { k: keyof DatosFicha; t: string; col: string }[] = [
  { k: 'tramoRsh', t: 'Tramo', col: 'tramo_rsh' }, { k: 'personasHogar', t: 'Personas', col: 'personas_hogar' },
  { k: 'menores18', t: 'Menores 18', col: 'menores_18' }, { k: 'mayores60', t: 'Mayores 60', col: 'mayores_60' },
  { k: 'conDiscapacidad', t: 'Discap.', col: 'con_discapacidad' }, { k: 'conDependencia', t: 'Depend.', col: 'con_dependencia' },
  { k: 'conInvalidez', t: 'Invalidez', col: 'con_invalidez' }, { k: 'conNee', t: 'NEE', col: 'con_nee' },
  { k: 'ingresosHogar', t: 'Ingreso', col: 'ingresos_hogar' }, { k: 'rshActualizada', t: 'Actualizada', col: 'rsh_actualizada' },
];

export function CargarCartolas() {
  const avisar = useAviso();
  const qc = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [leyendo, setLeyendo] = useState<{ hechos: number; total: number } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const leer = async (archivos: File[]) => {
    setLeyendo({ hechos: 0, total: archivos.length });
    try {
      for (let i = 0; i < archivos.length; i += PORTE_ENVIO) {
        const lote = archivos.slice(i, i + PORTE_ENVIO);
        const datos = new FormData();
        lote.forEach((a) => datos.append('archivos', a));
        const res = await api.enviarFormulario<Resultado[]>('/cartolas/leer', datos);
        setFilas((previas) => [...previas, ...res.flatMap((r, j) => aFilas(r, lote[j], `${previas.length}-${i}-${j}`))]);
        setLeyendo({ hechos: Math.min(i + lote.length, archivos.length), total: archivos.length });
      }
    } catch (e) { avisar((e as Error).message, 'error'); }
    finally { setLeyendo(null); }
  };

  const cambiar = (clave: string, cambio: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)));
  /** Asignar a mano: el servidor vuelve a leer el PDF y dice si el nombre del estudiante aparece en esa cartola. */
  const asignar = async (f: Fila, est: Estudiante) => {
    cambiar(f.clave, { estudiante: est, aplicar: false, verificando: true, verificacion: undefined });
    try {
      const datos = new FormData();
      datos.append('archivos', f.archivo);
      const [r] = await api.enviarFormulario<Resultado[]>(`/cartolas/leer?postulacionId=${est.id}`, datos);
      const v = r?.verificacion;
      cambiar(f.clave, { verificando: false, verificacion: v, r: r?.ficha ? { ...f.r, avisos: r.avisos } : f.r, aplicar: v?.estado === 'COINCIDE' && !est.yaCargada });
    } catch (e) { cambiar(f.clave, { verificando: false }); avisar((e as Error).message, 'error'); }
  };

  const [soloRevisar, setSoloRevisar] = useState(false);
  const pendientes = filas.filter((f) => f.estadoGuardado !== 'guardado');
  const aRevisar = pendientes.filter(necesitaRevision).length;
  const mostradas = soloRevisar ? filas.filter(necesitaRevision) : filas;
  const elegibles = filas.filter((f) => f.aplicar && f.estudiante && f.estadoGuardado === 'pendiente');

  const guardar = async () => {
    setGuardando(true);
    let bien = 0;
    for (const f of elegibles) {
      try {
        // Solo se envía lo que la cartola trajo: lo que no se pudo leer no borra lo que ya había en la ficha.
        const cuerpo = cuerpoFicha(f.r.ficha ?? {});
        await api.put(`/postulaciones/${f.estudiante!.id}/ficha`, cuerpo);
        await api.post('/cartolas/registro', { postulacionId: f.estudiante!.id, hash: f.r.hash, emitidaEn: f.r.emitidaEn ?? null });
        cambiar(f.clave, { estadoGuardado: 'guardado', aplicar: false });
        bien++;
      } catch (e) { cambiar(f.clave, { estadoGuardado: { error: (e as Error).message } }); }
    }
    setGuardando(false);
    if (bien) { avisar(`${bien} ficha${bien === 1 ? '' : 's'} actualizada${bien === 1 ? '' : 's'}`); ['avance', 'seleccion', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo">Carga masiva de cartolas RSH</h1>
          <p className="text-sm text-gray-500">Sube varias cartolas en PDF a la vez. El sistema las lee, reconoce al estudiante por su nombre y descarta el archivo. Para una sola, usa «Cargar» en la lista.</p>
        </div>
        <Link className="btn-secundario" to="/cartolas">Volver a Cartolas RSH</Link>
      </div>

      <Caja tono="azul">
        Los PDF no se guardan en el sistema: se leen y se descartan. De los otros integrantes del hogar no se guarda nada: sus nombres se usan solo para reconocer al estudiante.
        Revisa cada fila antes de guardar: nada se escribe en la ficha hasta que lo confirmes.
      </Caja>

      <div className="tarjeta flex flex-wrap items-center gap-3 p-3">
        <input ref={entrada} type="file" hidden multiple accept=".pdf,application/pdf"
          onChange={(e) => { const a = Array.from(e.target.files ?? []); e.target.value = ''; if (a.length) leer(a); }} />
        <button className="btn-pdf" disabled={!!leyendo || guardando} onClick={() => entrada.current?.click()}>
          {leyendo ? `Leyendo… ${leyendo.hechos} de ${leyendo.total}` : <><Icono tipo="carpeta" /> Subir cartolas (PDF)</>}
        </button>
        <button className="btn-primario" disabled={!elegibles.length || guardando || !!leyendo} onClick={guardar}>
          {guardando ? 'Guardando…' : `Guardar en la ficha (${elegibles.length})`}
        </button>
        {filas.length > 0 && <button className="btn-secundario" disabled={guardando || !!leyendo} onClick={() => setFilas([])}>Limpiar lista</button>}
      </div>

      {filas.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-gray-500">
              {filas.length} cartola{filas.length === 1 ? '' : 's'} · {aRevisar === 0 ? <span className="text-green-700">todas coinciden</span> : <span className="font-medium text-amber-700">{aRevisar} por revisar</span>}
            </span>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" className="h-4 w-4" checked={soloRevisar} onChange={(e) => setSoloRevisar(e.target.checked)} />
              Mostrar solo las que hay que revisar
            </label>
          </div>
          {soloRevisar && mostradas.length === 0 && <div className="py-4 text-center text-sm text-gray-400">No hay cartolas por revisar.</div>}
          {mostradas.map((f) => <FilaCartola key={f.clave} f={f} onCambio={(c) => cambiar(f.clave, c)} onAsignar={(e) => asignar(f, e)} />)}
        </div>
      )}
    </div>
  );
}

function aFilas(r: Resultado, archivo: File, base: string): Fila[] {
  const lista: (Estudiante | null)[] = r.coincidencias.length ? r.coincidencias : [null];
  return lista.map((est, i) => ({
    clave: `${base}-${i}`, r, archivo, estudiante: est,
    // Solo se marca sola la fila limpia: sin avisos, con estudiante reconocido y que no se haya cargado antes.
    aplicar: r.estado === 'OK' && !!est && !est.yaCargada,
    estadoGuardado: 'pendiente',
  }));
}

type EstadoIdentidad = 'COINCIDE' | 'APROXIMADO' | 'NO_COINCIDE';
interface Identidad { estado: EstadoIdentidad; nombreCartola: string | null; rutCartola: string | null; rutCoincide: boolean | null; motivo?: Verificacion['motivo'] }

/** ¿La cartola es de este estudiante? Del reconocimiento automático, o de la comprobación al asignar a mano. */
function identidadDe(f: Fila): Identidad | null {
  const e = f.estudiante;
  if (!e) return null;
  if (f.verificacion) {
    const v = f.verificacion;
    return { estado: v.estado, nombreCartola: v.nombreCartola, rutCartola: v.rutCartola, rutCoincide: v.rutCoincide, motivo: v.motivo };
  }
  if (e.por) {
    return { estado: e.por === 'NOMBRE_APROXIMADO' ? 'APROXIMADO' : 'COINCIDE', nombreCartola: e.nombreCartola ?? null, rutCartola: e.rutCartola ?? null, rutCoincide: e.rutCoincide ?? null };
  }
  return null;
}

const IDENTIDAD: Record<EstadoIdentidad, { tono: 'verde' | 'amarillo' | 'rojo'; texto: string; borde: string }> = {
  COINCIDE: { tono: 'verde', texto: 'Coincide', borde: 'border-green-200 bg-green-50/30' },
  APROXIMADO: { tono: 'amarillo', texto: 'Nombre parecido: confirma', borde: 'border-yellow-300 bg-yellow-50/50' },
  NO_COINCIDE: { tono: 'rojo', texto: 'No coincide', borde: 'border-red-300 bg-red-50/50' },
};

/** Nombre que tenemos del estudiante junto al que trae la cartola: para ver de un vistazo cuál no calza. */
function Identidad({ f }: { f: Fila }) {
  const e = f.estudiante!;
  const id = identidadDe(f);
  if (f.verificando) return <div className="rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-400">Comprobando que la cartola sea de {e.nombre}…</div>;
  if (!id) return <div className="rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-400">Asignado a mano: no se comprobó el nombre.</div>;
  const est = IDENTIDAD[id.estado];
  return (
    <div className={`grid gap-x-6 gap-y-1 rounded-md border px-3 py-2 text-xs sm:grid-cols-[1fr_1fr_auto] ${est.borde}`}>
      <div><div className="text-[10px] uppercase text-gray-400">En el sistema</div><div className="font-medium text-gray-800">{e.nombre}</div></div>
      <div>
        <div className="text-[10px] uppercase text-gray-400">En la cartola</div>
        {id.nombreCartola ? <div className="font-medium text-gray-800">{id.nombreCartola}</div> : <div className="italic text-gray-400">No aparece entre los integrantes</div>}
        {id.rutCartola && (
          <div className="text-gray-500">RUT {id.rutCartola}
            {id.rutCoincide === true && <span className="ml-1 text-green-700">· calza con el cargado</span>}
            {id.rutCoincide === false && <span className="ml-1 text-red-700">· NO calza con el cargado</span>}
          </div>
        )}
      </div>
      <div className="self-center"><Etiqueta tono={est.tono}>{est.texto}</Etiqueta></div>
    </div>
  );
}

/** Lo que conviene mirar antes de guardar: sin estudiante, nombre que no calza o parecido, avisos o error de lectura. */
function necesitaRevision(f: Fila): boolean {
  if (f.estadoGuardado === 'guardado') return false;
  if (f.r.estado === 'ERROR' || !f.estudiante || f.r.avisos.length > 0) return true;
  const id = identidadDe(f);
  return !id || id.estado !== 'COINCIDE';
}

function FilaCartola({ f, onCambio, onAsignar }: { f: Fila; onCambio: (c: Partial<Fila>) => void; onAsignar: (e: Estudiante) => void }) {
  const { r, estudiante } = f;
  const guardado = f.estadoGuardado === 'guardado';
  if (r.estado === 'ERROR') {
    return (
      <div className="tarjeta flex flex-wrap items-center gap-3 border-red-200 bg-red-50/40 p-3 text-sm">
        <span className="font-medium">{r.archivo}</span><Etiqueta tono="rojo">No se pudo leer</Etiqueta>
        <span className="text-red-700">{r.error}</span>
      </div>
    );
  }
  return (
    <div className={`tarjeta space-y-2 p-3 ${guardado ? 'border-green-300 bg-green-50/30' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        <input type="checkbox" aria-label="Aplicar" className="h-4 w-4" checked={f.aplicar} disabled={!estudiante || guardado}
          onChange={(e) => onCambio({ aplicar: e.target.checked })} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{estudiante ? estudiante.nombre : <span className="text-amber-700">Sin estudiante asignado</span>}</div>
          <div className="truncate text-xs text-gray-500">
            {estudiante && <><span className="font-mono">{estudiante.codigo}</span> · {estudiante.liceo} · </>}
            {r.archivo}{r.emitidaEn && <> · emitida {fecha(r.emitidaEn, false)}</>}{r.integrantes ? ` · ${r.integrantes} integrantes` : ''}
          </div>
        </div>
        {guardado && <Etiqueta tono="verde">Guardada</Etiqueta>}
        {typeof f.estadoGuardado === 'object' && <Etiqueta tono="rojo">{f.estadoGuardado.error}</Etiqueta>}
        {!estudiante && <Buscador onElegir={onAsignar} />}
        {estudiante && !guardado && <button className="text-xs text-gray-500 underline" onClick={() => onCambio({ estudiante: null, aplicar: false, verificacion: undefined })}>cambiar</button>}
      </div>
      {estudiante && <Identidad f={f} />}
      {r.ficha && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {CAMPOS.map(({ k, t, col }) => {
            const nuevo = r.ficha![k];
            const antes = estudiante?.fichaActual?.[col];
            const cambia = nuevo !== null && antes !== null && antes !== undefined && String(antes) !== String(nuevo);
            return (
              <div key={k}>
                <dt className="text-[10px] uppercase text-gray-400">{t}</dt>
                <dd className={nuevo === null ? 'text-gray-300' : cambia ? 'font-semibold text-amber-700' : ''}>
                  {nuevo === null ? '—' : String(nuevo)}
                  {cambia && <span className="ml-1 font-normal text-gray-400" title="Valor que había en la ficha">(antes {String(antes)})</span>}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {estudiante && r.ficha && <PersonasFormulario f={f} />}
      {r.avisos.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">{r.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
    </div>
  );
}

/** Personas del hogar según el formulario del estudiante (ya cargado en su ficha) vs. según esta cartola. */
function PersonasFormulario({ f }: { f: Fila }) {
  const c = compararPersonas(f.estudiante?.fichaActual?.personas_formulario, f.r.ficha?.personasHogar);
  if (!c) return <div className="text-xs text-gray-400">Personas según el formulario: sin dato (se puede anotar al cargar la cartola de a una).</div>;
  return c.coincide
    ? <div className="text-xs text-green-700">Personas del hogar: formulario {c.formulario} = cartola {c.cartola} ✓</div>
    : <div className="text-xs font-medium text-amber-800">Personas del hogar no coinciden: el formulario dice {c.formulario} y la cartola {c.cartola}.</div>;
}

/** Para asignar a mano una cartola cuyo RUT no se reconoció. */
function Buscador({ onElegir }: { onElegir: (e: Estudiante) => void }) {
  const avisar = useAviso();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Estudiante[] | null>(null);
  const buscar = async () => {
    try { setRes(await api.get<Estudiante[]>(`/cartolas/estudiantes?q=${encodeURIComponent(q)}`)); }
    catch (e) { avisar((e as Error).message, 'error'); }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input className="input w-44 py-1 text-xs" placeholder="Buscar nombre o Id" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && buscar()} />
      <button className="btn-secundario btn-chico" disabled={q.trim().length < 2} onClick={buscar}>Buscar</button>
      {res && (res.length === 0 ? <span className="text-xs text-gray-400">Sin resultados</span> : (
        <select className="input w-56 py-1 text-xs" defaultValue="" onChange={(e) => { const x = res.find((r) => r.id === e.target.value); if (x) onElegir(x); }}>
          <option value="" disabled>Elegir estudiante…</option>
          {res.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
        </select>
      ))}
    </div>
  );
}
