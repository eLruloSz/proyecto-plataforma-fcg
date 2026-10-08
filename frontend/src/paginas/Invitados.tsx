import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Confirmacion, Encuentro, Invitado } from '../api';
import { Cargando, ErrorCarga, Etiqueta, fecha, Modal, nota, useAviso, Vacio } from '../ui';

function useActualizar() {
  const qc = useQueryClient();
  const avisar = useAviso();
  return useMutation({
    mutationFn: (v: { id: string; datos: Record<string, unknown> }) => api.patch<Invitado>(`/invitados/${v.id}`, v.datos),
    onSuccess: (inv) => {
      qc.setQueryData<Invitado[]>(['invitados'], (l) => l?.map((x) => (x.id === inv.id ? inv : x)));
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['encuentros'] });
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
}

/** Celda que se edita en el lugar: guarda al salir del campo o con Enter. */
function CeldaEditable({ valor, onGuardar, tipo = 'text', placeholder }: { valor: string | null; onGuardar: (v: string) => void; tipo?: string; placeholder: string }) {
  const [v, setV] = useState(valor ?? '');
  const [editando, setEditando] = useState(false);
  if (!editando) {
    return (
      <button className={`w-full truncate text-left ${valor ? 'text-gray-700' : 'text-gray-300'} hover:text-gray-900`} onClick={() => { setV(valor ?? ''); setEditando(true); }}>
        {valor || placeholder}
      </button>
    );
  }
  const guardar = () => { setEditando(false); if (v.trim() !== (valor ?? '')) onGuardar(v.trim()); };
  return (
    <input autoFocus type={tipo} className="input py-1 text-xs" value={v} onChange={(e) => setV(e.target.value)}
      onBlur={guardar} onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false); }} aria-label={placeholder} />
  );
}

function Comentarios({ inv, onCerrar }: { inv: Invitado; onCerrar: () => void }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const { data } = useQuery({ queryKey: ['comentarios', inv.id], queryFn: () => api.get<{ id: string; texto: string; creado_en: string; autor: string }[]>(`/invitados/${inv.id}/comentarios`) });
  const agregar = useMutation({
    mutationFn: () => api.post(`/invitados/${inv.id}/comentarios`, { texto }),
    onSuccess: () => { setTexto(''); qc.invalidateQueries({ queryKey: ['comentarios', inv.id] }); qc.invalidateQueries({ queryKey: ['invitados'] }); },
  });
  return (
    <Modal titulo={`Comentarios — ${inv.codigo} ${inv.nombres} ${inv.apellido_paterno}`} onCerrar={onCerrar} ancho="max-w-lg">
      <div className="mb-3 flex gap-2">
        <input className="input" placeholder="Ej: RSH no actualizado, el padre cambió de trabajo" value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && texto.trim() && agregar.mutate()} />
        <button className="btn-primario" disabled={!texto.trim() || agregar.isPending} onClick={() => agregar.mutate()}>Agregar</button>
      </div>
      <ul className="space-y-2">
        {data?.length === 0 && <Vacio>Sin comentarios.</Vacio>}
        {data?.map((c) => (
          <li key={c.id} className="rounded-md bg-gray-50 px-3 py-2 text-sm">
            <div>{c.texto}</div>
            <div className="mt-0.5 text-xs text-gray-400">{c.autor} · {fecha(c.creado_en)}</div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function Invitados() {
  const { data, isLoading, error } = useQuery({ queryKey: ['invitados'], queryFn: () => api.get<Invitado[]>('/invitados') });
  const { data: encuentros } = useQuery({ queryKey: ['encuentros'], queryFn: () => api.get<Encuentro[]>('/encuentros') });
  const actualizar = useActualizar();
  const qc = useQueryClient();
  const avisar = useAviso();
  const [filtro, setFiltro] = useState<'todos' | Confirmacion | 'sin-email'>('todos');
  const [q, setQ] = useState('');
  const [comentando, setComentando] = useState<Invitado | null>(null);
  const [quitando, setQuitando] = useState<Invitado | null>(null);
  const quitar = useMutation({
    mutationFn: (id: string) => api.del(`/invitados/${id}`),
    onSuccess: () => { ['invitados', 'nomina', 'dashboard', 'liceos'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); setQuitando(null); avisar('Invitado quitado'); },
    onError: (e: Error) => avisar(e.message, 'error'),
  });

  const lista = useMemo(() => (data ?? []).filter((i) => {
    if (q && !`${i.codigo} ${i.nombres} ${i.apellido_paterno} ${i.apellido_materno} ${i.liceo}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filtro === 'sin-email') return !i.email;
    if (filtro !== 'todos') return i.confirmacion === filtro;
    return true;
  }), [data, filtro, q]);

  if (isLoading) return <Cargando />;
  if (error) return <ErrorCarga error={error} />;

  const cuenta = (c: Confirmacion) => data!.filter((i) => i.confirmacion === c).length;
  const set = (id: string, datos: Record<string, unknown>) => actualizar.mutate({ id, datos });
  const fechaEncuentro = (e: Encuentro) => new Date(e.fecha).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="max-w-full">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titulo">Invitados</h1>
          <p className="text-sm text-gray-500">
            {data!.length} invitados · <span className="text-green-700">{cuenta('CONFIRMADO')} aceptaron</span> · <span className="text-yellow-700">{cuenta('PENDIENTE')} sin respuesta</span> · {cuenta('RECHAZADO')} rechazaron.
            Para invitar estudiantes, entra a un liceo en <Link to="/liceos" className="underline">Liceos y nóminas</Link>.
          </p>
        </div>
        <div className="flex gap-2">
          <input className="input w-56" placeholder="Buscar por nombre o Id…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
          <select className="input w-auto" value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} aria-label="Filtrar">
            <option value="todos">Todos</option>
            <option value="PENDIENTE">Sin respuesta</option>
            <option value="CONFIRMADO">Aceptaron</option>
            <option value="RECHAZADO">Rechazaron</option>
            <option value="sin-email">Sin email</option>
          </select>
        </div>
      </div>

      {encuentros && encuentros.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          {encuentros.map((e) => (
            <span key={e.id} className="rounded-md border border-gray-200 px-2 py-1 text-gray-600">
              Encuentro {fechaEncuentro(e)}: <strong>{e.inscritos}</strong> inscritos · {e.asistentes} asistieron
            </span>
          ))}
        </div>
      )}

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Id</th><th>Estudiante</th><th>Liceo</th><th>Curso</th><th className="text-right">Prom.</th>
              <th className="min-w-[180px]">Email</th><th className="min-w-[120px]">Teléfono</th>
              <th>Aceptó postular</th><th>Encuentro online</th><th>Asistió</th><th />
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={11}><Vacio>No hay invitados con este filtro.</Vacio></td></tr>}
            {lista.map((i) => (
              <tr key={i.id} className={i.confirmacion === 'RECHAZADO' ? 'text-gray-400' : ''}>
                <td className="font-mono text-xs">{i.codigo}</td>
                <td className="whitespace-nowrap">{i.apellido_paterno} {i.apellido_materno}, {i.nombres}</td>
                <td className="max-w-[160px] truncate text-gray-600" title={i.liceo}>{i.liceo}</td>
                <td>{i.curso}</td>
                <td className="text-right tabular-nums">{nota(i.promedio)}</td>
                <td><CeldaEditable valor={i.email} tipo="email" placeholder="agregar email" onGuardar={(v) => set(i.id, { email: v || null })} /></td>
                <td><CeldaEditable valor={i.telefono} placeholder="agregar teléfono" onGuardar={(v) => set(i.id, { telefono: v || null })} /></td>
                <td>
                  <select className={`rounded border px-1.5 py-1 text-xs ${i.confirmacion === 'CONFIRMADO' ? 'border-green-300 bg-green-50 text-green-800' : i.confirmacion === 'RECHAZADO' ? 'border-gray-200 bg-gray-50' : 'border-yellow-300 bg-yellow-50 text-yellow-800'}`}
                    value={i.confirmacion} onChange={(e) => set(i.id, { confirmacion: e.target.value })} aria-label="Aceptó postular">
                    <option value="PENDIENTE">Sin respuesta</option>
                    <option value="CONFIRMADO">Sí</option>
                    <option value="RECHAZADO">No</option>
                  </select>
                </td>
                <td>
                  <select className="rounded border border-gray-200 px-1.5 py-1 text-xs" value={i.encuentro_evento_id ?? ''}
                    onChange={(e) => set(i.id, { encuentroEventoId: e.target.value || null })} aria-label="Encuentro online">
                    <option value="">—</option>
                    {encuentros?.map((e) => <option key={e.id} value={e.id}>{fechaEncuentro(e)}</option>)}
                  </select>
                </td>
                <td className="text-center">
                  <input type="checkbox" checked={!!i.asistio_encuentro} onChange={(e) => set(i.id, { asistioEncuentro: e.target.checked })} aria-label="Asistió al encuentro" />
                </td>
                <td className="whitespace-nowrap text-right">
                  <button className="text-xs text-gray-500 hover:text-gray-900" onClick={() => setComentando(i)}>
                    {i.comentarios ? <Etiqueta tono="azul">{i.comentarios} coment.</Etiqueta> : 'Comentar'}
                  </button>
                  {i.estado === 'INVITADO' && i.confirmacion === 'PENDIENTE' && (
                    <button className="ml-2 text-xs text-gray-400 hover:text-red-700" onClick={() => setQuitando(i)} aria-label="Quitar invitado">✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {comentando && <Comentarios inv={comentando} onCerrar={() => setComentando(null)} />}
      {quitando && (
        <Modal titulo="Quitar invitado" onCerrar={() => setQuitando(null)} ancho="max-w-md"
          pie={<><button className="btn-secundario" onClick={() => setQuitando(null)}>Cancelar</button><button className="btn-peligro" onClick={() => quitar.mutate(quitando.id)}>Quitar</button></>}>
          <p className="text-sm text-gray-700">¿Quitar a {quitando.nombres} {quitando.apellido_paterno} de los invitados? Su Id <code>{quitando.codigo}</code> no se volverá a usar.</p>
        </Modal>
      )}
    </div>
  );
}
