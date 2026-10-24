import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, BloqueoAgenda, CalendarioEntrevistas, EstadoEntrevista, EstudianteAgenda } from '../api';
import { useProceso } from '../Layout';
import { Caja, Cargando, ErrorCarga, fecha, Modal, useAviso, Vacio } from '../ui';

/** Mismos estados y colores que la planilla de la fundación. */
export const ESTADOS: Record<EstadoEntrevista, { texto: string; chip: string; punto: string }> = {
  POR_SOLICITAR: { texto: 'Por solicitar', chip: 'bg-yellow-200 text-yellow-950 border-yellow-300', punto: 'bg-yellow-300' },
  SOLICITADA: { texto: 'Solicitada', chip: 'bg-orange-300 text-orange-950 border-orange-400', punto: 'bg-orange-400' },
  CONFIRMADA: { texto: 'Visita confirmada', chip: 'bg-green-600 text-white border-green-700', punto: 'bg-green-600' },
  REALIZADA: { texto: 'Realizada', chip: 'bg-sky-500 text-white border-sky-600', punto: 'bg-sky-500' },
  CANCELADA: { texto: 'Cancelada', chip: 'bg-gray-300 text-gray-600 border-gray-400', punto: 'bg-gray-400' },
  CONFLICTO: { texto: 'Conflicto de horario', chip: 'bg-purple-600 text-white border-purple-700', punto: 'bg-purple-600' },
};
const ORDEN_ESTADOS = Object.keys(ESTADOS) as EstadoEntrevista[];
const CLAVES_ENTREVISTA = ['ENTREVISTA', 'ENTREVISTA_COMITE'];

// --- Fechas en hora local -----------------------------------------------------
const dos = (n: number) => String(n).padStart(2, '0');
const claveDia = (d: Date) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const lunesDe = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const masDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const horaDe = (iso: string) => { const d = new Date(iso); return `${dos(d.getHours())}:${dos(d.getMinutes())}`; };
const aIso = (dia: string, hora: string) => new Date(`${dia}T${hora}:00`).toISOString();
const nombreDia = (d: Date) => d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'short' });
const nombre = (e: EstudianteAgenda) => `${e.nombres.split(' ')[0]} ${e.apellido_paterno}`;

function Chip({ estado, children, onClick, alerta }: { estado: EstadoEntrevista; children: ReactNode; onClick?: () => void; alerta?: boolean }) {
  return (
    <button onClick={onClick}
      className={`w-full rounded-md border px-2 py-1 text-left text-xs leading-tight shadow-sm transition hover:brightness-95 ${ESTADOS[estado].chip} ${alerta ? 'ring-2 ring-purple-500 ring-offset-1' : ''}`}>
      {children}
    </button>
  );
}

/**
 * Calendario de entrevistas: semana a semana, días en columnas y bloques
 * horarios en filas, como la planilla "Cronograma Entrevistas" de la fundación.
 */
export function Entrevistas() {
  const { etapaId: param } = useParams<{ etapaId?: string }>();
  const navegar = useNavigate();
  const { data: proceso } = useProceso();
  const etapasEntrevista = useMemo(
    () => proceso?.etapas.filter((e) => CLAVES_ENTREVISTA.includes(e.clave ?? '')) ?? [], [proceso]);
  const etapaId = param ?? etapasEntrevista.find((e) => e.estado === 'ACTIVA')?.id ?? etapasEntrevista[0]?.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['entrevistas', etapaId], enabled: !!etapaId,
    queryFn: () => api.get<CalendarioEntrevistas>(`/entrevistas/${etapaId}`),
  });
  // Semana que se está mirando (se recuerda por etapa: al cambiar de etapa se vuelve a calcular).
  const [semanaSel, setSemanaSel] = useState<{ etapa: string; lunes: Date } | null>(null);
  const semana = semanaSel?.etapa === etapaId ? semanaSel.lunes : null;
  const setSemana = (d: Date) => setSemanaSel({ etapa: etapaId!, lunes: d });
  const [editando, setEditando] = useState<{ e: EstudianteAgenda; dia?: string; hora?: string } | null>(null);
  const [celda, setCelda] = useState<{ dia: string; hora: string | null } | null>(null);
  const [editandoHoras, setEditandoHoras] = useState(false);

  // Semana inicial: la de la próxima entrevista agendada (o la última, o la actual).
  useEffect(() => {
    if (!data || semana) return;
    const fechas = data.estudiantes.map((e) => e.entrevista?.fecha_hora).filter((x): x is string => !!x).map((x) => new Date(x)).sort((a, b) => +a - +b);
    const ahora = new Date();
    const proxima = fechas.find((d) => d >= ahora) ?? fechas.at(-1) ?? ahora;
    setSemana(lunesDe(proxima));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, semana]);

  if (!proceso) return <Cargando />;
  if (!etapasEntrevista.length) {
    return <Caja tono="amarillo">El proceso no tiene etapas de entrevista (con clave ENTREVISTA o ENTREVISTA_COMITE).</Caja>;
  }
  if (isLoading || !semana) return <Cargando />;
  if (error || !data) return <ErrorCarga error={error} />;

  const lunes = semana;
  const conEntrevista = data.estudiantes.filter((e) => e.entrevista?.fecha_hora);
  const enSemana = conEntrevista.filter((e) => { const d = new Date(e.entrevista!.fecha_hora!); return d >= lunes && d < masDias(lunes, 7); });
  // Lunes a viernes; sábado y domingo solo si hay algo agendado.
  const dias = [0, 1, 2, 3, 4, 5, 6].map((i) => masDias(lunes, i))
    .filter((d, i) => i < 5 || enSemana.some((e) => claveDia(new Date(e.entrevista!.fecha_hora!)) === claveDia(d)));
  const horas = [...new Set([...data.etapa.horas, ...enSemana.map((e) => horaDe(e.entrevista!.fecha_hora!))])].sort();
  const bloqueoDia = (dia: string) => data.bloqueos.find((b) => b.fecha === dia && !b.hora);
  const bloqueoHora = (dia: string, hora: string) => data.bloqueos.find((b) => b.fecha === dia && b.hora === hora);
  const enCelda = (dia: string, hora: string) =>
    enSemana.filter((e) => claveDia(new Date(e.entrevista!.fecha_hora!)) === dia && horaDe(e.entrevista!.fecha_hora!) === hora);

  // Por agendar: los que siguen en la etapa sin fecha (o con la entrevista cancelada).
  const porAgendar = data.estudiantes.filter((e) => e.en_esta_etapa && !e.confirmado
    && (!e.entrevista?.fecha_hora || e.entrevista.estado === 'CANCELADA'));
  const cuenta = (s: EstadoEntrevista) => data.estudiantes.filter((e) => (e.entrevista?.estado ?? (e.en_esta_etapa ? 'POR_SOLICITAR' : null)) === s).length;
  const etiquetaSemana = `${lunes.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })} – ${masDias(lunes, 4).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div className="max-w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titulo">Entrevistas</h1>
          <p className="text-sm text-gray-500">Haz clic en un bloque libre para agendar, o en una entrevista para cambiar su estado, moverla o comentar.</p>
        </div>
        {etapasEntrevista.length > 1 && (
          <div className="flex gap-2" role="tablist">
            {etapasEntrevista.map((x) => (
              <button key={x.id} role="tab" aria-selected={x.id === etapaId} onClick={() => navegar(`/entrevistas/${x.id}`)}
                className={`rounded-md border px-3 py-1.5 text-sm ${x.id === etapaId ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>
                {x.orden}. {x.nombre}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Leyenda con totales */}
      <div className="flex flex-wrap gap-2 text-xs">
        {ORDEN_ESTADOS.map((s) => (
          <span key={s} className={`rounded-md border px-2 py-1 ${ESTADOS[s].chip}`}>{ESTADOS[s].texto} · <strong>{cuenta(s)}</strong></span>
        ))}
      </div>

      {/* Navegación de semanas */}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-secundario btn-chico" onClick={() => setSemana(masDias(lunes, -7))} aria-label="Semana anterior">‹ Anterior</button>
        <span className="min-w-[180px] text-center text-sm font-semibold text-gray-900">{etiquetaSemana}</span>
        <button className="btn-secundario btn-chico" onClick={() => setSemana(masDias(lunes, 7))} aria-label="Semana siguiente">Siguiente ›</button>
        <button className="btn-secundario btn-chico" onClick={() => setSemana(lunesDe(new Date()))}>Hoy</button>
        <input type="date" className="input w-auto py-1 text-xs" aria-label="Ir a una fecha"
          onChange={(ev) => ev.target.value && setSemana(lunesDe(new Date(`${ev.target.value}T12:00:00`)))} />
        <span className="ml-auto text-xs text-gray-500">
          Bloques: {data.etapa.horas.join(' · ')} <button className="ml-1 underline hover:text-gray-900" onClick={() => setEditandoHoras(true)}>editar</button>
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        {/* Grilla de la semana */}
        <div className="tarjeta overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-20 border-b border-gray-200 bg-gray-50 px-2 py-2 text-left text-xs font-semibold text-gray-600">Horario</th>
                {dias.map((d) => {
                  const b = bloqueoDia(claveDia(d));
                  return (
                    <th key={claveDia(d)} className={`border-b border-l border-gray-200 px-2 py-2 text-left text-xs font-semibold capitalize ${b ? 'bg-gray-800 text-white' : 'bg-gray-50 text-gray-700'}`}>
                      <button className="w-full text-left capitalize hover:underline" onClick={() => setCelda({ dia: claveDia(d), hora: null })}
                        title={b ? `Bloqueado: ${b.motivo}` : 'Bloquear este día'}>{nombreDia(d)}</button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {horas.map((h) => (
                <tr key={h}>
                  <td className="border-b border-gray-100 px-2 py-2 align-top text-xs font-semibold text-gray-600">{h} hrs</td>
                  {dias.map((d) => {
                    const dia = claveDia(d);
                    const bd = bloqueoDia(dia);
                    const bh = bloqueoHora(dia, h);
                    const lista = enCelda(dia, h);
                    const activas = lista.filter((e) => e.entrevista!.estado !== 'CANCELADA');
                    const choque = activas.length > 1;
                    if (bd) {
                      return (
                        <td key={dia} className="border-b border-l border-gray-700 bg-gray-800 px-2 py-2 align-top text-xs text-gray-300">
                          {h === horas[0] && bd.motivo}
                          {lista.map((e) => <div key={e.id} className="mt-1"><Chip estado={e.entrevista!.estado} onClick={() => setEditando({ e })}>{nombre(e)}</Chip></div>)}
                        </td>
                      );
                    }
                    return (
                      <td key={dia} className={`group h-[72px] border-b border-l border-gray-100 px-1.5 py-1.5 align-top ${bh ? 'bg-[repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6_6px,#e5e7eb_6px,#e5e7eb_12px)]' : ''}`}>
                        <div className="space-y-1">
                          {bh && (
                            <button className="w-full rounded px-1 text-left text-xs text-gray-600 hover:underline" onClick={() => setCelda({ dia, hora: h })}>
                              🔒 {bh.motivo}
                            </button>
                          )}
                          {lista.map((e) => (
                            <Chip key={e.id} estado={e.entrevista!.estado} alerta={choque && e.entrevista!.estado !== 'CANCELADA'} onClick={() => setEditando({ e })}>
                              <div className="truncate font-medium">{nombre(e)}</div>
                              <div className="truncate opacity-80">{e.liceo_codigo}. {e.liceo}</div>
                            </Chip>
                          ))}
                          {choque && <div className="text-[11px] font-medium text-purple-700">⚠ {activas.length} en el mismo horario</div>}
                          {!bh && !activas.length && (
                            <button onClick={() => setCelda({ dia, hora: h })}
                              className="w-full rounded border border-dashed border-transparent px-1 py-1 text-left text-xs text-gray-300 group-hover:border-gray-300 group-hover:text-gray-500">
                              + agendar
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Por agendar */}
        <aside className="tarjeta h-fit">
          <div className="border-b border-gray-200 px-4 py-2.5">
            <h2 className="subtitulo">Por agendar ({porAgendar.length})</h2>
            <p className="text-xs text-gray-500">Siguen en la etapa y no tienen fecha.</p>
          </div>
          <ul className="max-h-[520px] divide-y divide-gray-100 overflow-y-auto">
            {porAgendar.length === 0 && <li><Vacio>Todos tienen fecha.</Vacio></li>}
            {porAgendar.map((e) => {
              const s = e.entrevista?.estado ?? 'POR_SOLICITAR';
              return (
                <li key={e.id}>
                  <button className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm hover:bg-gray-50" onClick={() => setEditando({ e })}>
                    <span className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${ESTADOS[s].punto}`} title={ESTADOS[s].texto} />
                    <span className="min-w-0">
                      <span className="block truncate text-gray-900">{e.nombres} {e.apellido_paterno}</span>
                      <span className="block truncate text-xs text-gray-400">{e.codigo} · {e.liceo}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>

      {editando && (
        <EditarEntrevista calendario={data} estudiante={editando.e} diaInicial={editando.dia} horaInicial={editando.hora}
          onCerrar={() => setEditando(null)} />
      )}
      {celda && (
        <AccionCelda calendario={data} dia={celda.dia} hora={celda.hora} porAgendar={porAgendar}
          onAgendar={(e) => { setCelda(null); setEditando({ e, dia: celda.dia, hora: celda.hora ?? undefined }); }}
          onCerrar={() => setCelda(null)} />
      )}
      {editandoHoras && <EditarHoras calendario={data} onCerrar={() => setEditandoHoras(false)} />}
    </div>
  );
}

/** Al guardar cualquier cambio, el servidor devuelve el calendario completo actualizado. */
function useGuardarCalendario(etapaId: string) {
  const qc = useQueryClient();
  return (c: CalendarioEntrevistas) => {
    qc.setQueryData(['entrevistas', etapaId], c);
    qc.invalidateQueries({ queryKey: ['avance'] });
  };
}

function EditarEntrevista({ calendario, estudiante: e, diaInicial, horaInicial, onCerrar }: {
  calendario: CalendarioEntrevistas; estudiante: EstudianteAgenda; diaInicial?: string; horaInicial?: string; onCerrar: () => void;
}) {
  const avisar = useAviso();
  const aplicar = useGuardarCalendario(calendario.etapa.id);
  const actual = e.entrevista;
  const [dia, setDia] = useState(diaInicial ?? (actual?.fecha_hora ? claveDia(new Date(actual.fecha_hora)) : ''));
  const [hora, setHora] = useState(horaInicial ?? (actual?.fecha_hora ? horaDe(actual.fecha_hora) : calendario.etapa.horas[0] ?? '10:00'));
  // Al agendar en un bloque, la entrevista queda "solicitada" (si estaba por solicitar).
  const [estado, setEstado] = useState<EstadoEntrevista>(
    diaInicial && (!actual || actual.estado === 'POR_SOLICITAR' || actual.estado === 'CANCELADA') ? 'SOLICITADA' : actual?.estado ?? 'POR_SOLICITAR');
  const [comentario, setComentario] = useState(actual?.comentario ?? '');

  const guardar = useMutation({
    mutationFn: (quitar?: boolean) => api.put<CalendarioEntrevistas>(`/entrevistas/${calendario.etapa.id}/estudiantes/${e.id}`, quitar
      ? { fechaHora: null, estado: 'POR_SOLICITAR', comentario: comentario || null }
      : { fechaHora: dia ? aIso(dia, hora) : null, estado, comentario: comentario || null }),
    onSuccess: (c, quitar) => { aplicar(c); avisar(quitar ? 'Entrevista quitada del calendario' : 'Entrevista guardada'); onCerrar(); },
    onError: (err: Error) => avisar(err.message, 'error'),
  });
  const horasDisponibles = [...new Set([...calendario.etapa.horas, hora])].sort();

  return (
    <Modal titulo={`Entrevista — ${e.nombres} ${e.apellido_paterno} ${e.apellido_materno ?? ''}`} onCerrar={onCerrar} ancho="max-w-lg"
      pie={<>
        {actual?.fecha_hora && <button className="mr-auto text-sm text-red-700 hover:underline" onClick={() => guardar.mutate(true)}>Quitar del calendario</button>}
        <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className="btn-primario" disabled={guardar.isPending || (!!dia && !hora)} onClick={() => guardar.mutate(false)}>Guardar</button>
      </>}>
      <div className="space-y-4 text-sm">
        <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <div><span className="font-mono">{e.codigo}</span> · {e.liceo_codigo}. {e.liceo}</div>
          <div>{e.email ?? 'sin email'} · {e.telefono ?? 'sin teléfono'}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Día</span>
            <input type="date" className="input py-1.5" value={dia} onChange={(ev) => setDia(ev.target.value)} />
          </label>
          <label className="block">
            <span className="label">Hora</span>
            <select className="input py-1.5" value={hora} onChange={(ev) => setHora(ev.target.value)} disabled={!dia}>
              {horasDisponibles.map((h) => <option key={h} value={h}>{h} hrs</option>)}
            </select>
          </label>
        </div>
        <div>
          <span className="label">Estado</span>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {ORDEN_ESTADOS.map((s) => (
              <button key={s} onClick={() => setEstado(s)} aria-pressed={estado === s}
                className={`rounded-md border px-2 py-1.5 text-xs ${estado === s ? `${ESTADOS[s].chip} font-semibold ring-2 ring-gray-900 ring-offset-1` : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                {ESTADOS[s].texto}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="label">Comentarios</span>
          <textarea rows={3} className="input" placeholder="Ej: viene con su apoderada; pidió cambiar al jueves" value={comentario} onChange={(ev) => setComentario(ev.target.value)} />
        </label>
        {actual && <p className="text-xs text-gray-400">Última modificación: {fecha(actual.actualizado_en)}</p>}
      </div>
    </Modal>
  );
}

/** Clic en un bloque libre (agendar o bloquear) o en el nombre de un día (bloquear el día completo). */
function AccionCelda({ calendario, dia, hora, porAgendar, onAgendar, onCerrar }: {
  calendario: CalendarioEntrevistas; dia: string; hora: string | null; porAgendar: EstudianteAgenda[];
  onAgendar: (e: EstudianteAgenda) => void; onCerrar: () => void;
}) {
  const avisar = useAviso();
  const aplicar = useGuardarCalendario(calendario.etapa.id);
  const [q, setQ] = useState('');
  const [motivo, setMotivo] = useState('');
  const existente: BloqueoAgenda | undefined = calendario.bloqueos.find((b) => b.fecha === dia && b.hora === hora);
  const bloquear = useMutation({
    mutationFn: () => api.post<CalendarioEntrevistas>(`/entrevistas/${calendario.etapa.id}/bloqueos`, { fecha: dia, hora, motivo }),
    onSuccess: (c) => { aplicar(c); avisar(hora ? 'Horario bloqueado' : 'Día bloqueado'); onCerrar(); },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  const desbloquear = useMutation({
    mutationFn: (id: string) => api.del<CalendarioEntrevistas>(`/entrevistas/${calendario.etapa.id}/bloqueos/${id}`),
    onSuccess: (c) => { aplicar(c); avisar('Bloqueo quitado'); onCerrar(); },
  });
  const titulo = new Date(`${dia}T12:00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  const lista = porAgendar.filter((e) => `${e.codigo} ${e.nombres} ${e.apellido_paterno} ${e.liceo}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Modal titulo={`${titulo}${hora ? `, ${hora} hrs` : ''}`} onCerrar={onCerrar} ancho="max-w-lg">
      <div className="space-y-5 text-sm">
        {existente ? (
          <Caja tono="amarillo">
            <div className="flex items-center justify-between gap-3">
              <span>Bloqueado: <strong>{existente.motivo}</strong></span>
              <button className="btn-secundario btn-chico" onClick={() => desbloquear.mutate(existente.id)}>Quitar bloqueo</button>
            </div>
          </Caja>
        ) : (
          <>
            {hora && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Agendar a</h3>
                {porAgendar.length === 0 ? <p className="text-gray-500">No quedan estudiantes por agendar en esta etapa.</p> : (
                  <>
                    <input className="input mb-2 py-1.5" placeholder="Buscar por nombre, Id o liceo…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                    <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
                      {lista.map((e) => (
                        <li key={e.id}>
                          <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50" onClick={() => onAgendar(e)}>
                            <span>{e.nombres} {e.apellido_paterno} <span className="text-xs text-gray-400">· {e.liceo_codigo}. {e.liceo}</span></span>
                            <span className="text-xs text-gray-400">{e.codigo}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{hora ? 'O bloquear este horario' : 'Bloquear el día completo'}</h3>
              <div className="flex gap-2">
                <input className="input py-1.5" placeholder="Motivo (ej. Directorio, feriado)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <button className="btn-secundario" disabled={!motivo.trim() || bloquear.isPending} onClick={() => bloquear.mutate()}>Bloquear</button>
              </div>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function EditarHoras({ calendario, onCerrar }: { calendario: CalendarioEntrevistas; onCerrar: () => void }) {
  const avisar = useAviso();
  const aplicar = useGuardarCalendario(calendario.etapa.id);
  const [texto, setTexto] = useState(calendario.etapa.horas.join(', '));
  const horas = texto.split(/[,\s]+/).filter(Boolean).map((h) => (/^\d{1,2}$/.test(h) ? `${dos(Number(h))}:00` : h.padStart(5, '0')));
  const validas = horas.length > 0 && horas.every((h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h));
  const guardar = useMutation({
    mutationFn: () => api.put<CalendarioEntrevistas>(`/entrevistas/${calendario.etapa.id}/horas`, { horas }),
    onSuccess: (c) => { aplicar(c); avisar('Bloques horarios guardados'); onCerrar(); },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  return (
    <Modal titulo="Bloques horarios de entrevista" onCerrar={onCerrar} ancho="max-w-md"
      pie={<><button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className="btn-primario" disabled={!validas || guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button></>}>
      <label className="block text-sm">
        <span className="label">Horas de inicio, separadas por coma</span>
        <input className="input" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="10:00, 11:00, 12:00" />
      </label>
      <p className="mt-2 text-xs text-gray-500">{validas ? `Quedarían: ${horas.sort().join(' · ')}` : 'Escribe horas como 10:00 o 15:30.'}</p>
    </Modal>
  );
}