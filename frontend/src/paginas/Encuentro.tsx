import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Encuentro, VistaAvance } from '../api';
import { Caja, Modal, useAviso, Vacio } from '../ui';

type Fila = VistaAvance['estudiantes'][number];
const nombre = (f: Fila) => `${f.apellido_paterno} ${f.apellido_materno ?? ''}, ${f.nombres}`.replace(' ,', ',');

export const fechaEncuentro = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function useEncuentros() {
  return useQuery({ queryKey: ['encuentros'], queryFn: () => api.get<Encuentro[]>('/encuentros') });
}

/**
 * Fechas del encuentro online de la etapa 2: inscritos, asistentes y ausentes de
 * cada una, y agregar o quitar fechas. Al hacer clic en una fecha se filtra la tabla.
 */
export function FechasEncuentro({ seleccionada, onSeleccionar, onAsistencia }: {
  seleccionada?: string; onSeleccionar?: (id: string) => void; onAsistencia?: (e: Encuentro) => void;
} = {}) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const { data: encuentros } = useEncuentros();
  const [agregando, setAgregando] = useState(false);
  const [nueva, setNueva] = useState({ fecha: '', enlace: '' });
  const aplicar = (l: Encuentro[]) => { qc.setQueryData(['encuentros'], l); qc.invalidateQueries({ queryKey: ['tareas'] }); };
  const crear = useMutation({
    mutationFn: () => api.post<Encuentro[]>('/encuentros', { fecha: new Date(nueva.fecha).toISOString(), enlace: nueva.enlace.trim() || null }),
    onSuccess: (l) => { aplicar(l); setNueva({ fecha: '', enlace: '' }); setAgregando(false); avisar('Fecha agregada'); },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  const borrar = useMutation({
    mutationFn: (id: string) => api.del<Encuentro[]>(`/encuentros/${id}`),
    onSuccess: (l) => { aplicar(l); avisar('Fecha eliminada'); },
    onError: (e: Error) => avisar(e.message, 'error'),
  });

  return (
    <div className="tarjeta p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="subtitulo">Fechas del encuentro online</h2>
        {!agregando && <button className="btn-secundario btn-chico" onClick={() => setAgregando(true)}>+ Agregar fecha</button>}
      </div>
      {encuentros?.length === 0 && !agregando && (
        <p className="text-sm text-gray-500">Aún no hay fechas. Agrega las fechas del encuentro para poder inscribir a los estudiantes.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {encuentros?.map((e) => {
          const paso = new Date(e.fecha) < new Date();
          const activa = seleccionada === e.id;
          const sinRegistrar = e.inscritos - e.asistentes - e.ausentes;
          return (
            <div key={e.id} className={`rounded-md border px-3 py-2 text-sm ${activa ? 'border-gray-900 ring-1 ring-gray-900' : paso ? 'border-gray-200' : 'border-green-200'} ${paso ? 'bg-gray-50' : 'bg-green-50'}`}>
              <button className="block text-left font-medium capitalize text-gray-900 hover:underline disabled:no-underline" disabled={!onSeleccionar}
                onClick={() => onSeleccionar?.(activa ? '' : e.id)} title={onSeleccionar ? (activa ? 'Quitar filtro' : 'Ver solo esta fecha en la tabla') : undefined}>
                {fechaEncuentro(e.fecha)}
              </button>
              <div className="text-xs text-gray-600">
                <strong>{e.inscritos}</strong> inscritos
                {(paso || e.asistentes + e.ausentes > 0) && <>
                  {' · '}<strong className="text-green-700">{e.asistentes}</strong> asistieron
                  {' · '}<strong className="text-red-700">{e.ausentes}</strong> no
                  {sinRegistrar > 0 && <> · <span className="text-yellow-700">{sinRegistrar} sin registrar</span></>}
                </>}
                {e.enlace && <> · <a href={e.enlace} target="_blank" rel="noreferrer" className="underline">enlace</a></>}
                {!e.inscritos && (
                  <button className="ml-2 text-gray-400 hover:text-red-700" onClick={() => borrar.mutate(e.id)} aria-label="Eliminar fecha">eliminar</button>
                )}
              </div>
              {onAsistencia && e.inscritos > 0 && (
                <button className="mt-1 text-xs font-medium text-green-800 underline hover:text-green-950" onClick={() => onAsistencia(e)}>
                  {e.asistentes + e.ausentes > 0 ? 'Corregir asistencia' : 'Registrar asistencia'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {agregando && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="label">Día y hora</span>
            <input type="datetime-local" className="input py-1.5" value={nueva.fecha} onChange={(e) => setNueva({ ...nueva, fecha: e.target.value })} />
          </label>
          <label className="min-w-[260px] flex-1 text-sm">
            <span className="label">Enlace de la reunión (opcional)</span>
            <input className="input py-1.5" placeholder="https://teams.microsoft.com/…" value={nueva.enlace} onChange={(e) => setNueva({ ...nueva, enlace: e.target.value })} />
          </label>
          <button className="btn-primario" disabled={!nueva.fecha || crear.isPending} onClick={() => crear.mutate()}>Agregar</button>
          <button className="btn-secundario" onClick={() => setAgregando(false)}>Cancelar</button>
        </div>
      )}
    </div>
  );
}

/**
 * Asistencia de una fecha en un paso: todos parten como "asistió" y solo se
 * desmarcan los que no se conectaron. Si ya se había registrado, se parte de eso.
 */
export function RegistrarAsistencia({ encuentro, estudiantes, onCerrar }: { encuentro: Encuentro; estudiantes: Fila[]; onCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const inscritos = useMemo(() => estudiantes.filter((f) => f.encuentro_evento_id === encuentro.id)
    .sort((a, b) => nombre(a).localeCompare(nombre(b))), [estudiantes, encuentro.id]);
  const [ausentes, setAusentes] = useState<Set<string>>(() => new Set(inscritos.filter((f) => f.asistio_encuentro === false).map((f) => f.id)));
  const [buscar, setBuscar] = useState('');
  const visibles = inscritos.filter((f) => !buscar.trim() || `${nombre(f)} ${f.codigo} ${f.liceo}`.toLowerCase().includes(buscar.trim().toLowerCase()));
  const alternar = (id: string) => setAusentes((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const guardar = useMutation({
    mutationFn: () => api.post<{ asistieron: number; ausentes: number; encuentros: Encuentro[] }>(`/encuentros/${encuentro.id}/asistencia`, { ausentes: [...ausentes] }),
    onSuccess: (r) => {
      qc.setQueryData(['encuentros'], r.encuentros);
      ['avance', 'tareas', 'dashboard', 'invitados'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      avisar(`Asistencia guardada: ${r.asistieron} asistieron, ${r.ausentes} no asistieron`);
      onCerrar();
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  return (
    <Modal titulo={`Asistencia — ${fechaEncuentro(encuentro.fecha)}`} onCerrar={onCerrar} ancho="max-w-xl"
      pie={<>
        <span className="mr-auto self-center text-sm text-gray-600">
          <strong className="text-green-700">{inscritos.length - ausentes.size}</strong> asistieron · <strong className="text-red-700">{ausentes.size}</strong> no asistieron
        </span>
        <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className="btn-primario" disabled={!inscritos.length || guardar.isPending} onClick={() => guardar.mutate()}>
          {guardar.isPending ? 'Guardando…' : 'Guardar asistencia'}
        </button>
      </>}>
      <div className="space-y-3 text-sm">
        <Caja tono="azul">Todos los inscritos parten como <strong>“asistió”</strong>. Haz clic solo en los que <strong>no</strong> se conectaron.</Caja>
        <div className="flex flex-wrap gap-2">
          <input className="input flex-1" placeholder="Buscar por nombre, Id o liceo" value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar estudiante" />
          <button className="btn-secundario btn-chico" onClick={() => setAusentes(new Set())}>Todos asistieron</button>
          <button className="btn-secundario btn-chico" onClick={() => setAusentes(new Set(inscritos.map((f) => f.id)))}>Nadie asistió</button>
        </div>
        <ul className="max-h-[50vh] divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
          {visibles.length === 0 && <li><Vacio>{inscritos.length ? 'Nadie coincide con la búsqueda.' : 'No hay inscritos en esta fecha.'}</Vacio></li>}
          {visibles.map((f) => {
            const fue = !ausentes.has(f.id);
            return (
              <li key={f.id}>
                <button onClick={() => alternar(f.id)} aria-pressed={!fue}
                  className={`flex w-full items-center gap-3 px-3 py-1.5 text-left ${fue ? 'hover:bg-gray-50' : 'bg-red-50 hover:bg-red-100'}`}>
                  <span className={`inline-flex w-20 justify-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${fue ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-white text-red-700'}`}>
                    {fue ? 'Asistió' : 'No asistió'}
                  </span>
                  <span className={`flex-1 ${fue ? '' : 'text-red-800 line-through decoration-red-300'}`}>{nombre(f)}</span>
                  <span className="max-w-[140px] truncate text-xs text-gray-400" title={f.liceo}>{f.codigo} · {f.liceo}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

/** Inscribe a varios estudiantes de una vez en una fecha (por defecto, los que aún no tienen fecha). */
export function InscribirEnBloque({ estudiantes, encuentros, onCerrar }: { estudiantes: Fila[]; encuentros: Encuentro[]; onCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const candidatos = useMemo(() => estudiantes.filter((f) => f.en_esta_etapa && !f.confirmado)
    .sort((a, b) => nombre(a).localeCompare(nombre(b))), [estudiantes]);
  const [fechaId, setFechaId] = useState(encuentros.find((e) => new Date(e.fecha) > new Date())?.id ?? encuentros[0]?.id ?? '');
  const [incluirConFecha, setIncluirConFecha] = useState(false);
  const [liceo, setLiceo] = useState('');
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(candidatos.filter((f) => !f.encuentro_evento_id).map((f) => f.id)));
  const liceos = useMemo(() => [...new Map(candidatos.map((f) => [f.liceo_id, `${f.liceo_codigo}. ${f.liceo}`]))].sort((a, b) => a[1].localeCompare(b[1])), [candidatos]);
  const visibles = candidatos.filter((f) => (incluirConFecha || !f.encuentro_evento_id) && (!liceo || f.liceo_id === liceo));
  const elegidosVisibles = visibles.filter((f) => elegidos.has(f.id));
  const marcarVisibles = (si: boolean) => setElegidos((s) => { const n = new Set(s); visibles.forEach((f) => (si ? n.add(f.id) : n.delete(f.id))); return n; });
  const guardar = useMutation({
    mutationFn: () => api.post<{ inscritos: number; encuentros: Encuentro[] }>(`/encuentros/${fechaId}/inscribir`, { postulacionIds: elegidosVisibles.map((f) => f.id) }),
    onSuccess: (r) => {
      qc.setQueryData(['encuentros'], r.encuentros);
      ['avance', 'tareas', 'invitados'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      avisar(`${r.inscritos} estudiantes inscritos`);
      onCerrar();
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  return (
    <Modal titulo="Inscribir en una fecha del encuentro" onCerrar={onCerrar} ancho="max-w-xl"
      pie={<>
        <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className="btn-primario" disabled={!fechaId || !elegidosVisibles.length || guardar.isPending} onClick={() => guardar.mutate()}>
          {guardar.isPending ? 'Inscribiendo…' : `Inscribir ${elegidosVisibles.length}`}
        </button>
      </>}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <select className="input w-auto" value={fechaId} onChange={(e) => setFechaId(e.target.value)} aria-label="Fecha del encuentro">
            {encuentros.map((e) => <option key={e.id} value={e.id}>{fechaEncuentro(e.fecha)} ({e.inscritos} inscritos)</option>)}
          </select>
          <select className="input w-auto max-w-[220px]" value={liceo} onChange={(e) => setLiceo(e.target.value)} aria-label="Filtrar por liceo">
            <option value="">Todos los liceos</option>
            {liceos.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={incluirConFecha} onChange={(e) => setIncluirConFecha(e.target.checked)} />
            Mostrar también a los que ya tienen fecha (se cambian a esta)
          </label>
          <button className="ml-auto underline" onClick={() => marcarVisibles(true)}>Marcar todos</button>
          <button className="underline" onClick={() => marcarVisibles(false)}>Ninguno</button>
        </div>
        <ul className="max-h-[45vh] divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
          {visibles.length === 0 && <li><Vacio>No hay estudiantes sin fecha{liceo ? ' en este liceo' : ''}.</Vacio></li>}
          {visibles.map((f) => (
            <li key={f.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-1.5 hover:bg-gray-50">
                <input type="checkbox" checked={elegidos.has(f.id)}
                  onChange={() => setElegidos((s) => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; })} />
                <span className="flex-1">{nombre(f)}</span>
                {f.encuentro_evento_id && <span className="text-[11px] text-gray-400">ya inscrito</span>}
                <span className="max-w-[140px] truncate text-xs text-gray-400" title={f.liceo}>{f.codigo} · {f.liceo}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
