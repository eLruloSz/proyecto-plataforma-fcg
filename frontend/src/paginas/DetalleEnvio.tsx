import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Destinatario, EnvioDetalle, GRUPOS, PROPOSITOS } from '../api';
import { Caja, Cargando, ErrorCarga, Etiqueta, fecha, Modal, useAviso } from '../ui';

function EtiquetaEntrega({ d }: { d: Destinatario }) {
  const m = {
    PENDIENTE: <Etiqueta tono="azul">En cola</Etiqueta>,
    ENVIADO: <Etiqueta tono="gris">Enviado</Etiqueta>,
    ENTREGADO: <Etiqueta tono="verde">Entregado</Etiqueta>,
    REBOTADO: <Etiqueta tono="rojo">Rebotó</Etiqueta>,
    FALLIDO: <Etiqueta tono="rojo">Error</Etiqueta>,
  }[d.entrega];
  return <span title={d.error ?? undefined}>{m}</span>;
}

export function DetalleEnvio() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const avisar = useAviso();
  const [viendo, setViendo] = useState<Destinatario | null>(null);
  const [filtro, setFiltro] = useState<'todos' | 'faltan' | 'respondieron' | 'problemas'>('todos');

  const { data: e, isLoading, error } = useQuery({
    queryKey: ['envio', id],
    queryFn: () => api.get<EnvioDetalle>(`/comunicacion/envios/${id}`),
    // Mientras quedan correos en cola, se actualiza solo.
    refetchInterval: (q) => (q.state.data?.destinatarios.some((d) => d.entrega === 'PENDIENTE') ? 1500 : false),
  });
  const marcar = useMutation({
    mutationFn: (v: { d: Destinatario; respondido: boolean; participa?: boolean }) =>
      api.patch<EnvioDetalle>(`/comunicacion/envios/${id}/destinatarios/${v.d.id}`, { respondido: v.respondido, participa: v.participa }),
    onSuccess: (r) => {
      qc.setQueryData(['envio', id], r);
      ['envios', 'dashboard', 'hitos', 'liceos', 'liceo'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (err: Error) => avisar(err.message, 'error'),
  });

  if (isLoading) return <Cargando />;
  if (error || !e) return <ErrorCarga error={error} />;

  const respondidos = e.destinatarios.filter((d) => d.respuesta === 'RESPONDIDO').length;
  const faltan = e.total - respondidos;
  const problemas = e.destinatarios.filter((d) => d.entrega === 'REBOTADO' || d.entrega === 'FALLIDO');
  const enCola = e.destinatarios.filter((d) => d.entrega === 'PENDIENTE').length;
  const esPresentacion = e.proposito === 'PRESENTACION';
  const esLiceo = e.grupo !== 'POSTULANTES';
  const lista = e.destinatarios.filter((d) =>
    filtro === 'faltan' ? d.respuesta === 'PENDIENTE' : filtro === 'respondieron' ? d.respuesta === 'RESPONDIDO'
      : filtro === 'problemas' ? d.entrega === 'REBOTADO' || d.entrega === 'FALLIDO' : true);

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <Link to="/comunicacion" className="text-xs text-gray-500 hover:text-gray-900">← Comunicación</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="titulo">{e.asunto_visible}</h1>
            <p className="text-sm text-gray-500">
              {PROPOSITOS[e.proposito]} · {GRUPOS[e.grupo]} · {fecha(e.enviado_en)}{e.enviado_por_nombre ? ` · por ${e.enviado_por_nombre}` : ''}
            </p>
            {e.adjuntos.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                {e.adjuntos.map((a) => <button key={a.id} className="text-gray-600 hover:underline" onClick={() => api.descargar(`/comunicacion/adjuntos/${a.id}`, a.nombre_original)}>📎 {a.nombre_original}</button>)}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Link className="btn-secundario" to={`/comunicacion?base=${e.id}`}>Usar como base</Link>
            <Link className={`btn-primario ${faltan ? '' : 'pointer-events-none opacity-50'}`} to={`/comunicacion?reenviar=${e.id}`} aria-disabled={!faltan}>
              Reenviar a los que faltan ({faltan})
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="tarjeta p-4"><div className="text-2xl font-bold">{e.total}</div><div className="text-xs text-gray-500">destinatarios</div></div>
        <div className="tarjeta p-4"><div className="text-2xl font-bold text-green-700">{respondidos}</div><div className="text-xs text-gray-500">respondieron</div></div>
        <div className="tarjeta p-4"><div className={`text-2xl font-bold ${faltan ? 'text-yellow-600' : ''}`}>{faltan}</div><div className="text-xs text-gray-500">faltan</div></div>
        <div className="tarjeta p-4"><div className={`text-2xl font-bold ${problemas.length ? 'text-red-700' : ''}`}>{problemas.length}</div><div className="text-xs text-gray-500">no llegaron</div></div>
      </div>

      {enCola > 0 && <Caja tono="azul">Enviando… quedan {enCola} en cola.</Caja>}
      {problemas.length > 0 && (
        <Caja tono="rojo" titulo={`${problemas.length} correo${problemas.length > 1 ? 's' : ''} no llegaron`}>
          Corrige el email (en la ficha del liceo o en Invitados) y usa “Reenviar a los que faltan”: el recordatorio usa el email nuevo.
        </Caja>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Marca a quienes ya respondieron; los que faltan quedan arriba.</p>
        <select className="input w-auto" value={filtro} onChange={(ev) => setFiltro(ev.target.value as typeof filtro)} aria-label="Filtrar destinatarios">
          <option value="todos">Todos ({e.total})</option>
          <option value="faltan">Faltan ({faltan})</option>
          <option value="respondieron">Respondieron ({respondidos})</option>
          <option value="problemas">No llegaron ({problemas.length})</option>
        </select>
      </div>

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th className="w-24">Respondió</th>
              <th>{esLiceo ? 'Liceo' : 'Estudiante'}</th>
              <th>Destinatario</th>
              <th>Entrega</th>
              {esPresentacion && <th>¿Participa?</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {lista.map((d) => {
              const listo = d.respuesta === 'RESPONDIDO';
              return (
                <tr key={d.id} className={listo ? 'bg-gray-50/80' : ''}>
                  <td>
                    <label className="inline-flex cursor-pointer items-center gap-1.5">
                      <input type="checkbox" checked={listo} onChange={() => marcar.mutate({ d, respondido: !listo })}
                        aria-label={`Marcar respuesta de ${d.liceo ?? d.nombre}`} />
                      {listo && d.respuesta_auto && <span className="text-[10px] text-gray-400" title={d.respuesta_nota ?? ''}>auto</span>}
                    </label>
                  </td>
                  <td className={listo ? 'text-gray-400 line-through' : 'font-medium text-gray-900'}>
                    {esLiceo ? d.liceo : <>{d.codigo && <span className="mr-1 font-mono text-xs">{d.codigo}</span>}{d.nombre}</>}
                  </td>
                  <td className={listo ? 'text-gray-400 line-through' : ''}>
                    {esLiceo && <div>{d.nombre}</div>}
                    <div className="text-xs text-gray-500">{d.email}</div>
                    {listo && d.respondido_en && <div className="text-[11px] text-gray-400 no-underline">{fecha(d.respondido_en)}{d.respondido_por ? ` · ${d.respondido_por}` : ''}{d.respuesta_nota ? ` · ${d.respuesta_nota}` : ''}</div>}
                  </td>
                  <td><EtiquetaEntrega d={d} />{d.error && <div className="max-w-[200px] truncate text-[11px] text-red-700" title={d.error}>{d.error}</div>}</td>
                  {esPresentacion && (
                    <td className="whitespace-nowrap">
                      <button className={`btn-chico btn rounded-r-none border ${d.participacion === 'PARTICIPA' ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                        onClick={() => marcar.mutate({ d, respondido: true, participa: true })}>Sí</button>
                      <button className={`btn-chico btn -ml-px rounded-l-none border ${d.participacion === 'NO_PARTICIPA' ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                        onClick={() => marcar.mutate({ d, respondido: true, participa: false })}>No</button>
                    </td>
                  )}
                  <td className="text-right"><button className="text-xs text-gray-500 hover:text-gray-900" onClick={() => setViendo(d)}>Ver correo</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {viendo && (
        <Modal titulo="Correo enviado" onCerrar={() => setViendo(null)}>
          <div className="text-xs text-gray-500">Para: {viendo.nombre} &lt;{viendo.email}&gt;</div>
          <div className="mb-3 mt-1 font-semibold">{viendo.asunto_final}</div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{viendo.cuerpo_final}</div>
        </Modal>
      )}
    </div>
  );
}
