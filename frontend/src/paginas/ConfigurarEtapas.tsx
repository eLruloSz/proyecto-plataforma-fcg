import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, Etapa, Proceso } from '../api';
import { useProceso } from '../Layout';
import { Modal, useAviso } from '../ui';

/** Renombrar etapas, fijar su cupo, agregar una entre dos existentes o quitar una vacía. */
export function ConfigurarEtapas({ onCerrar }: { onCerrar: () => void }) {
  const { data: proceso } = useProceso();
  const qc = useQueryClient();
  const avisar = useAviso();
  const [cambios, setCambios] = useState<Record<string, { nombre: string; cupo: string }>>({});
  const [nueva, setNueva] = useState({ nombre: '', despuesDe: '', cupo: '' });
  const [borrando, setBorrando] = useState<Etapa | null>(null);

  const aplicar = (p: Proceso) => { qc.setQueryData(['proceso'], p); ['avance', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const guardar = useMutation({
    mutationFn: (x: { id: string; nombre: string; cupo: string }) =>
      api.patch<Proceso>(`/proceso/etapas/${x.id}`, { nombre: x.nombre, cupo: x.cupo ? Number(x.cupo) : null }),
    onSuccess: (p, x) => { aplicar(p); setCambios((c) => { const n = { ...c }; delete n[x.id]; return n; }); avisar('Etapa guardada'); },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  const crear = useMutation({
    mutationFn: () => api.post<Proceso>('/proceso/etapas', { nombre: nueva.nombre, despuesDe: nueva.despuesDe, ...(nueva.cupo ? { cupo: Number(nueva.cupo) } : {}) }),
    onSuccess: (p) => { aplicar(p); setNueva({ nombre: '', despuesDe: '', cupo: '' }); avisar('Etapa agregada'); },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  const borrar = useMutation({
    mutationFn: (id: string) => api.del<Proceso>(`/proceso/etapas/${id}`),
    onSuccess: (p) => { aplicar(p); setBorrando(null); avisar('Etapa eliminada'); },
    onError: (e: Error) => { avisar(e.message, 'error'); setBorrando(null); },
  });
  if (!proceso) return null;

  return (
    <Modal titulo="Configurar etapas" onCerrar={onCerrar} ancho="max-w-2xl">
      <p className="mb-3 text-sm text-gray-500">Cada etapa tiene su propio cupo y sus propios requisitos (los requisitos se editan en la página de cada etapa).</p>
      <table className="tabla mb-5">
        <thead><tr><th className="w-8">#</th><th>Nombre</th><th className="w-24">Cupo</th><th className="w-20 text-right">Estudiantes</th><th /></tr></thead>
        <tbody>
          {proceso.etapas.map((e) => {
            const c = cambios[e.id] ?? { nombre: e.nombre, cupo: e.cupo?.toString() ?? '' };
            const sucio = c.nombre !== e.nombre || c.cupo !== (e.cupo?.toString() ?? '');
            const set = (k: 'nombre' | 'cupo', val: string) => setCambios((x) => ({ ...x, [e.id]: { ...c, [k]: val } }));
            return (
              <tr key={e.id}>
                <td className="text-gray-400">{e.orden}</td>
                <td><input className="input py-1" value={c.nombre} onChange={(ev) => set('nombre', ev.target.value)} aria-label={`Nombre de la etapa ${e.orden}`} /></td>
                <td><input className="input py-1" type="number" min={1} placeholder="—" value={c.cupo} onChange={(ev) => set('cupo', ev.target.value)} aria-label={`Cupo de la etapa ${e.orden}`} /></td>
                <td className="text-right tabular-nums">{e.estudiantes}</td>
                <td className="whitespace-nowrap text-right">
                  {sucio && <button className="btn-primario btn-chico" disabled={!c.nombre.trim()} onClick={() => guardar.mutate({ id: e.id, ...c })}>Guardar</button>}
                  {!sucio && e.estado !== 'ACTIVA' && e.estudiantes === 0 && (
                    <button className="text-xs text-gray-400 hover:text-red-700" onClick={() => setBorrando(e)}>Eliminar</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="rounded-md border border-gray-200 p-3">
        <div className="mb-2 text-xs font-semibold text-gray-600">Agregar una etapa</div>
        <div className="grid gap-2 sm:grid-cols-[1fr_180px_90px_auto]">
          <input className="input" placeholder="Nombre de la etapa" value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} aria-label="Nombre de la etapa nueva" />
          <select className="input" value={nueva.despuesDe} onChange={(e) => setNueva({ ...nueva, despuesDe: e.target.value })} aria-label="Ubicación">
            <option value="">Ubicar después de…</option>
            {proceso.etapas.map((e) => <option key={e.id} value={e.id}>después de {e.orden}. {e.nombre}</option>)}
          </select>
          <input className="input" type="number" min={1} placeholder="Cupo" value={nueva.cupo} onChange={(e) => setNueva({ ...nueva, cupo: e.target.value })} aria-label="Cupo de la etapa nueva" />
          <button className="btn-primario" disabled={!nueva.nombre.trim() || !nueva.despuesDe || crear.isPending} onClick={() => crear.mutate()}>Agregar</button>
        </div>
      </div>

      {borrando && (
        <Modal titulo="Eliminar etapa" onCerrar={() => setBorrando(null)} ancho="max-w-md"
          pie={<><button className="btn-secundario" onClick={() => setBorrando(null)}>Cancelar</button><button className="btn-peligro" onClick={() => borrar.mutate(borrando.id)}>Eliminar</button></>}>
          <p className="text-sm">¿Eliminar la etapa “{borrando.nombre}”? Las siguientes se corren un lugar.</p>
        </Modal>
      )}
    </Modal>
  );
}
