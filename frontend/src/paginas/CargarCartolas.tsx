import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Caja, Etiqueta, fecha, useAviso } from '../ui';

/**
 * Carga de cartolas RSH (PDF): el sistema lee cada una, muestra lo que encontró y, si la persona del equipo
 * confirma, lo guarda en la ficha del estudiante. Los PDF NO se guardan: se leen en el servidor, se descartan y
 * aquí solo queda lo leído (que además no incluye datos de los demás integrantes del hogar).
 */

interface DatosFicha {
  tramoRsh: number | null; rshActualizada: string | null; personasHogar: number | null; menores18: number | null; mayores60: number | null;
  conDiscapacidad: number | null; conDependencia: number | null; conInvalidez: number | null; conNee: number | null; ingresosHogar: string | null;
}
interface Estudiante { id: string; codigo: string; nombre: string; liceo: string; por?: 'RUT' | 'NOMBRE' | 'NOMBRE_APROXIMADO'; fichaActual: Record<string, unknown> | null; yaCargada: string | null }
interface Resultado {
  archivo: string; estado: 'OK' | 'REVISAR' | 'ERROR'; error?: string; hash?: string; emitidaEn?: string | null;
  ficha?: DatosFicha; integrantes?: number; avisos: string[]; coincidencias: Estudiante[];
}
/** Una fila por estudiante: una cartola puede servir a varios hermanos; una sin reconocer espera que la asignen. */
interface Fila {
  clave: string; r: Resultado; estudiante: Estudiante | null; aplicar: boolean; estadoGuardado: 'pendiente' | 'guardado' | { error: string };
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
        setFilas((previas) => [...previas, ...res.flatMap((r, j) => aFilas(r, `${previas.length}-${i}-${j}`))]);
        setLeyendo({ hechos: Math.min(i + lote.length, archivos.length), total: archivos.length });
      }
    } catch (e) { avisar((e as Error).message, 'error'); }
    finally { setLeyendo(null); }
  };

  const cambiar = (clave: string, cambio: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)));
  const elegibles = filas.filter((f) => f.aplicar && f.estudiante && f.estadoGuardado === 'pendiente');

  const guardar = async () => {
    setGuardando(true);
    let bien = 0;
    for (const f of elegibles) {
      try {
        // Solo se envía lo que la cartola trajo: lo que no se pudo leer no borra lo que ya había en la ficha.
        const cuerpo = Object.fromEntries(Object.entries(f.r.ficha ?? {}).filter(([, v]) => v !== null));
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
          <h1 className="titulo">Cargar cartolas RSH</h1>
          <p className="text-sm text-gray-500">Sube las cartolas en PDF (varias a la vez). El sistema lee los datos de la ficha y descarta el archivo.</p>
        </div>
        <Link className="btn-secundario" to="/avance">Volver a Resultados</Link>
      </div>

      <Caja tono="azul">
        Los PDF no se guardan en el sistema: se leen y se descartan. De los otros integrantes del hogar no se guarda nada: sus nombres se usan solo para reconocer al estudiante.
        Revisa cada fila antes de guardar: nada se escribe en la ficha hasta que lo confirmes.
      </Caja>

      <div className="tarjeta flex flex-wrap items-center gap-3 p-3">
        <input ref={entrada} type="file" hidden multiple accept=".pdf,application/pdf"
          onChange={(e) => { const a = Array.from(e.target.files ?? []); e.target.value = ''; if (a.length) leer(a); }} />
        <button className="btn-primario" disabled={!!leyendo || guardando} onClick={() => entrada.current?.click()}>
          {leyendo ? `Leyendo… ${leyendo.hechos} de ${leyendo.total}` : 'Subir cartolas (PDF)'}
        </button>
        <button className="btn-primario" disabled={!elegibles.length || guardando || !!leyendo} onClick={guardar}>
          {guardando ? 'Guardando…' : `Guardar en la ficha (${elegibles.length})`}
        </button>
        {filas.length > 0 && <button className="btn-secundario" disabled={guardando || !!leyendo} onClick={() => setFilas([])}>Limpiar lista</button>}
      </div>

      {filas.length > 0 && (
        <div className="space-y-2">
          {filas.map((f) => <FilaCartola key={f.clave} f={f} onCambio={(c) => cambiar(f.clave, c)} />)}
        </div>
      )}
    </div>
  );
}

function aFilas(r: Resultado, base: string): Fila[] {
  const lista: (Estudiante | null)[] = r.coincidencias.length ? r.coincidencias : [null];
  return lista.map((est, i) => ({
    clave: `${base}-${i}`, r, estudiante: est,
    // Solo se marca sola la fila limpia: sin avisos, con estudiante reconocido y que no se haya cargado antes.
    aplicar: r.estado === 'OK' && !!est && !est.yaCargada,
    estadoGuardado: 'pendiente',
  }));
}

function FilaCartola({ f, onCambio }: { f: Fila; onCambio: (c: Partial<Fila>) => void }) {
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
        {estudiante?.por === 'NOMBRE_APROXIMADO' && <Etiqueta tono="amarillo">Nombre aproximado: confirma</Etiqueta>}
        {guardado && <Etiqueta tono="verde">Guardada</Etiqueta>}
        {typeof f.estadoGuardado === 'object' && <Etiqueta tono="rojo">{f.estadoGuardado.error}</Etiqueta>}
        {!estudiante && <Buscador onElegir={(e) => onCambio({ estudiante: e, aplicar: true })} />}
      </div>
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
      {r.avisos.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">{r.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
    </div>
  );
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
