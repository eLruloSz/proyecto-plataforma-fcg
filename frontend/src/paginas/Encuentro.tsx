import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Encuentro } from '../api';
import { useAviso } from '../ui';

export const fechaEncuentro = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function useEncuentros() {
  return useQuery({ queryKey: ['encuentros'], queryFn: () => api.get<Encuentro[]>('/encuentros') });
}

/** Fechas del encuentro online de la etapa 2: inscritos y asistentes de cada una, y agregar o quitar fechas. */
export function FechasEncuentro() {
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
          return (
            <div key={e.id} className={`rounded-md border px-3 py-2 text-sm ${paso ? 'border-gray-200 bg-gray-50' : 'border-green-200 bg-green-50'}`}>
              <div className="font-medium capitalize text-gray-900">{fechaEncuentro(e.fecha)}</div>
              <div className="text-xs text-gray-600">
                <strong>{e.inscritos}</strong> inscritos{paso && <> · <strong>{e.asistentes}</strong> asistieron</>}
                {e.enlace && <> · <a href={e.enlace} target="_blank" rel="noreferrer" className="underline">enlace</a></>}
                {!e.inscritos && (
                  <button className="ml-2 text-gray-400 hover:text-red-700" onClick={() => borrar.mutate(e.id)} aria-label="Eliminar fecha">eliminar</button>
                )}
              </div>
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