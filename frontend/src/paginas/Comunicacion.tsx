import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, EnvioDetalle, EnvioResumen, GRUPOS, Plantilla, PROPOSITOS } from '../api';
import { Cargando, ErrorCarga, Etiqueta, fecha, Modal, useAviso, Vacio } from '../ui';
import { Redactor } from './Redactor';

function Progreso({ hecho, total }: { hecho: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded bg-gray-200"><div className="h-1.5 rounded bg-green-600" style={{ width: `${total ? (hecho / total) * 100 : 0}%` }} /></div>
      <span className="text-xs tabular-nums text-gray-600">{hecho}/{total}</span>
    </div>
  );
}

function ListaEnvios() {
  const { data, isLoading, error } = useQuery({ queryKey: ['envios'], queryFn: () => api.get<EnvioResumen[]>('/comunicacion/envios') });
  if (isLoading) return <Cargando />;
  if (error) return <ErrorCarga error={error} />;
  return (
    <div className="tarjeta overflow-x-auto">
      <table className="tabla">
        <thead><tr><th>Fecha</th><th>Asunto</th><th>Para</th><th>Entrega</th><th>Respondieron</th></tr></thead>
        <tbody>
          {!data?.length && <tr><td colSpan={5}><Vacio>Aún no se han enviado correos.</Vacio></td></tr>}
          {data?.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap text-gray-500">{fecha(e.enviado_en)}</td>
              <td>
                <Link to={`/comunicacion/envios/${e.id}`} className="font-medium text-gray-900 hover:underline">{e.asunto}</Link>
                <div className="text-xs text-gray-400">
                  {PROPOSITOS[e.proposito] ?? e.proposito}{e.envio_origen_id ? ' · recordatorio' : ''}{e.adjuntos ? ` · 📎 ${e.adjuntos}` : ''}{e.enviado_por ? ` · ${e.enviado_por}` : ''}
                </div>
              </td>
              <td className="whitespace-nowrap text-gray-600">{GRUPOS[e.grupo]} ({e.total})</td>
              <td className="whitespace-nowrap">
                {e.en_cola > 0 && <Etiqueta tono="azul">Enviando… {e.en_cola}</Etiqueta>}
                {e.con_problema > 0 && <Etiqueta tono="rojo">{e.con_problema} no llegaron</Etiqueta>}
                {!e.en_cola && !e.con_problema && <Etiqueta tono="verde">Enviados</Etiqueta>}
              </td>
              <td><Progreso hecho={e.respondidos} total={e.total} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditarPlantilla({ plantilla, onCerrar }: { plantilla: Plantilla | null; onCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const [f, setF] = useState({ nombre: plantilla?.nombre ?? '', proposito: plantilla?.proposito ?? 'OTRO', asunto: plantilla?.asunto ?? '', cuerpo: plantilla?.cuerpo ?? '' });
  const [actual, setActual] = useState<Plantilla | null>(plantilla);
  const [error, setError] = useState('');
  const refrescar = () => qc.invalidateQueries({ queryKey: ['plantillas'] });
  const guardar = useMutation({
    mutationFn: () => (actual ? api.patch<Plantilla>(`/comunicacion/plantillas/${actual.id}`, f) : api.post<Plantilla>('/comunicacion/plantillas', f)),
    onSuccess: (p) => { refrescar(); avisar('Plantilla guardada'); if (actual) onCerrar(); else setActual(p); },
    onError: (e: Error) => setError(e.message),
  });
  const adjuntar = useMutation({
    mutationFn: (file: File) => api.subir<Plantilla>(`/comunicacion/plantillas/${actual!.id}/adjuntos`, file),
    onSuccess: (p) => { setActual(p); refrescar(); },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  const quitar = useMutation({
    mutationFn: (archivoId: string) => api.del<Plantilla>(`/comunicacion/plantillas/${actual!.id}/adjuntos/${archivoId}`),
    onSuccess: (p) => { setActual(p); refrescar(); },
  });
  const enviar = () => {
    if (!f.nombre.trim() || !f.asunto.trim() || !f.cuerpo.trim()) return setError('Completa nombre, asunto y cuerpo.');
    guardar.mutate();
  };
  return (
    <Modal titulo={actual ? 'Editar plantilla' : 'Nueva plantilla'} onCerrar={onCerrar} ancho="max-w-3xl"
      pie={<><button className="btn-secundario" onClick={onCerrar}>{actual && !plantilla ? 'Listo' : 'Cancelar'}</button>
        <button className="btn-primario" disabled={guardar.isPending} onClick={enviar}>{actual ? 'Guardar cambios' : 'Crear plantilla'}</button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="pn">Nombre</label><input id="pn" className="input" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
          <div><label className="label" htmlFor="pp">Tipo de correo</label>
            <select id="pp" className="input" value={f.proposito} onChange={(e) => setF({ ...f, proposito: e.target.value })}>
              {Object.entries(PROPOSITOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select></div>
        </div>
        <div><label className="label" htmlFor="pa">Asunto</label><input id="pa" className="input" value={f.asunto} onChange={(e) => setF({ ...f, asunto: e.target.value })} /></div>
        <div><label className="label" htmlFor="pc">Cuerpo</label>
          <textarea id="pc" rows={10} className="input font-mono text-[13px]" value={f.cuerpo} onChange={(e) => setF({ ...f, cuerpo: e.target.value })} />
          <p className="mt-1 text-xs text-gray-400">Variables: {'{{nombre}} {{cargo}} {{liceo}} {{anio}} {{firma}} {{codigo}} {{curso}}'}</p></div>
        <div>
          <span className="label">Adjuntos fijos (se envían siempre con esta plantilla)</span>
          {!actual ? <p className="text-xs text-gray-400">Crea la plantilla para poder agregarle adjuntos.</p> : (
            <div className="flex flex-wrap items-center gap-2">
              {actual.adjuntos.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs">
                  <button className="hover:underline" onClick={() => api.descargar(`/comunicacion/adjuntos/${a.id}`, a.nombre)}>📎 {a.nombre}</button>
                  <button onClick={() => quitar.mutate(a.id)} className="ml-1 text-gray-400 hover:text-red-700" aria-label={`Quitar ${a.nombre}`}>✕</button>
                </span>
              ))}
              <label className="btn-secundario btn-chico cursor-pointer">{adjuntar.isPending ? 'Subiendo…' : '+ Adjuntar'}
                <input type="file" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x) adjuntar.mutate(x); e.target.value = ''; }} /></label>
            </div>
          )}
        </div>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

function Plantillas({ onUsar }: { onUsar: (id: string) => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['plantillas'], queryFn: () => api.get<Plantilla[]>('/comunicacion/plantillas') });
  const [editando, setEditando] = useState<Plantilla | null | 'nueva'>(null);
  const [borrando, setBorrando] = useState<Plantilla | null>(null);
  const borrar = useMutation({
    mutationFn: (id: string) => api.del(`/comunicacion/plantillas/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plantillas'] }); setBorrando(null); },
  });
  if (isLoading) return <Cargando />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button className="btn-secundario" onClick={() => setEditando('nueva')}>+ Nueva plantilla</button></div>
      <div className="tarjeta divide-y divide-gray-100">
        {data?.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900">{p.nombre}</div>
              <div className="truncate text-xs text-gray-500">{PROPOSITOS[p.proposito]} · {p.asunto}{p.adjuntos.length ? ` · 📎 ${p.adjuntos.length}` : ''}</div>
            </div>
            <div className="flex flex-shrink-0 gap-2">
              <button className="btn-primario btn-chico" onClick={() => onUsar(p.id)}>Usar</button>
              <button className="btn-secundario btn-chico" onClick={() => setEditando(p)}>Editar</button>
              <button className="btn-secundario btn-chico" onClick={() => setBorrando(p)} aria-label={`Eliminar ${p.nombre}`}>✕</button>
            </div>
          </div>
        ))}
      </div>
      {editando && <EditarPlantilla plantilla={editando === 'nueva' ? null : editando} onCerrar={() => setEditando(null)} />}
      {borrando && (
        <Modal titulo="Eliminar plantilla" onCerrar={() => setBorrando(null)} ancho="max-w-md"
          pie={<><button className="btn-secundario" onClick={() => setBorrando(null)}>Cancelar</button><button className="btn-peligro" onClick={() => borrar.mutate(borrando.id)}>Eliminar</button></>}>
          <p className="text-sm">¿Eliminar “{borrando.nombre}”? Los correos ya enviados con ella no se ven afectados.</p>
        </Modal>
      )}
    </div>
  );
}

/**
 * /comunicacion                 → lista de envíos y plantillas
 * /comunicacion?nuevo=1         → redactar
 * /comunicacion?liceo=ID        → redactar a un liceo
 * /comunicacion?plantilla=ID    → redactar desde una plantilla
 * /comunicacion?reenviar=ID     → recordatorio a los que no respondieron
 * /comunicacion?base=ID         → nuevo correo a partir de uno ya enviado
 */
export function Comunicacion() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const [pestana, setPestana] = useState<'envios' | 'plantillas'>('envios');
  const reenviar = params.get('reenviar');
  const base = params.get('base');
  const idOrigen = reenviar ?? base;
  const { data: origen, isLoading } = useQuery({
    queryKey: ['envio', idOrigen], enabled: !!idOrigen,
    queryFn: () => api.get<EnvioDetalle>(`/comunicacion/envios/${idOrigen}`),
  });
  const { data: plantillas } = useQuery({ queryKey: ['plantillas'], queryFn: () => api.get<Plantilla[]>('/comunicacion/plantillas') });

  const redactando = params.has('nuevo') || params.has('liceo') || params.has('plantilla') || !!idOrigen;
  if (redactando) {
    if (idOrigen && isLoading) return <Cargando />;
    const liceo = params.get('liceo');
    const plantilla = plantillas?.find((p) => p.id === params.get('plantilla'));
    // Desde una plantilla, se arma un "envío base" con su contenido.
    const desdePlantilla = plantilla ? {
      id: '', grupo: plantilla.proposito === 'INVITACION_ESTUDIANTES' ? 'POSTULANTES' : 'CONTRAPARTES', proposito: plantilla.proposito,
      asunto: plantilla.asunto, cuerpo: plantilla.cuerpo, plantilla_id: plantilla.id,
      adjuntos: plantilla.adjuntos.map((a) => ({ id: a.id, nombre_original: a.nombre, tamano_bytes: a.tamano })),
    } as unknown as EnvioDetalle : undefined;
    if (params.get('plantilla') && !plantillas) return <Cargando />;
    return (
      <div>
        <h1 className="titulo mb-4">{reenviar ? 'Recordatorio a los que faltan' : 'Nuevo correo'}</h1>
        <Redactor
          key={params.toString()}
          inicial={{
            grupo: liceo ? 'LICEO' : undefined,
            liceoIds: liceo ? [liceo] : undefined,
            reenviar: reenviar ? origen : undefined,
            base: base ? origen : desdePlantilla,
          }}
          onCancelar={() => (idOrigen ? navegar(-1) : setParams({}))}
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="titulo">Comunicación</h1>
        <button className="btn-primario" onClick={() => setParams({ nuevo: '1' })}>Nuevo correo</button>
      </div>
      <div className="mb-4 flex gap-1 border-b border-gray-200" role="tablist">
        {(['envios', 'plantillas'] as const).map((p) => (
          <button key={p} role="tab" aria-selected={pestana === p} onClick={() => setPestana(p)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${pestana === p ? 'border-gray-900 font-semibold text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {p === 'envios' ? 'Correos enviados' : 'Plantillas'}
          </button>
        ))}
      </div>
      {pestana === 'envios' ? <ListaEnvios /> : <Plantillas onUsar={(id) => setParams({ plantilla: id })} />}
    </div>
  );
}
