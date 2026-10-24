import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, CargaRanking, VistaAvance } from '../api';
import { useProceso } from '../Layout';
import { Caja, Cargando, ErrorCarga, Etiqueta, fecha, Modal, nota, useAviso, Vacio } from '../ui';
import { ConfigurarEtapas } from './ConfigurarEtapas';
import { CeldaFicha, FichaModal, MarcarSegunRanking, SubirRanking } from './Preseleccion';
import { ESTADOS } from './Entrevistas';

type Fila = VistaAvance['estudiantes'][number];
type Filtro = 'todos' | 'sin-decidir' | 'faltan' | 'pasa' | 'no-pasa' | 'confirmados';

/** Tras cualquier cambio de avance hay que refrescar varias vistas. */
const CLAVES = ['avance', 'proceso', 'dashboard', 'invitados'];

function Requisitos({ vista, onCerrar }: { vista: VistaAvance; onCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const [nuevo, setNuevo] = useState('');
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null);
  const refrescar = () => CLAVES.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const base = `/avance/${vista.etapa.id}/requisitos`;
  const crear = useMutation({ mutationFn: () => api.post(base, { nombre: nuevo }), onSuccess: () => { setNuevo(''); refrescar(); }, onError: (e: Error) => avisar(e.message, 'error') });
  const renombrar = useMutation({ mutationFn: (r: { id: string; nombre: string }) => api.patch(`${base}/${r.id}`, { nombre: r.nombre }), onSuccess: () => { setEditando(null); refrescar(); } });
  const quitar = useMutation({ mutationFn: (id: string) => api.del(`${base}/${id}`), onSuccess: refrescar });
  return (
    <Modal titulo={`Requisitos de "${vista.etapa.nombre}"`} onCerrar={onCerrar} ancho="max-w-lg">
      <p className="mb-3 text-sm text-gray-500">Lo que cada estudiante debe entregar o completar en esta etapa. Aparecen como columnas para marcar, y la página principal avisa quiénes tienen pendientes.</p>
      <ul className="mb-3 divide-y divide-gray-100 rounded-md border border-gray-200">
        {vista.requisitos.length === 0 && <li><Vacio>Esta etapa no tiene requisitos.</Vacio></li>}
        {vista.requisitos.map((r) => (
          <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            {editando?.id === r.id ? (
              <>
                <input className="input py-1" autoFocus value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && editando.nombre.trim() && renombrar.mutate(editando)} aria-label="Nombre del requisito" />
                <button className="btn-primario btn-chico" disabled={!editando.nombre.trim()} onClick={() => renombrar.mutate(editando)}>Guardar</button>
              </>
            ) : (
              <>
                <span className="flex-1">{r.nombre}</span>
                <button className="text-xs text-gray-500 hover:text-gray-900" onClick={() => setEditando({ id: r.id, nombre: r.nombre })}>Renombrar</button>
                <button className="text-xs text-gray-400 hover:text-red-700" onClick={() => quitar.mutate(r.id)} aria-label={`Quitar ${r.nombre}`}>Quitar</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className="input" placeholder="Ej: Cartola RSH" value={nuevo} onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && nuevo.trim() && crear.mutate()} aria-label="Nuevo requisito" />
        <button className="btn-primario" disabled={!nuevo.trim()} onClick={() => crear.mutate()}>Agregar</button>
      </div>
    </Modal>
  );
}

export function Avance() {
  const { etapaId: param } = useParams<{ etapaId?: string }>();
  const navegar = useNavigate();
  const qc = useQueryClient();
  const avisar = useAviso();
  const { data: proceso } = useProceso();
  const etapaId = param ?? proceso?.etapas.find((e) => e.estado === 'ACTIVA')?.id ?? proceso?.etapas[0]?.id;
  const { data: v, isLoading, error } = useQuery({
    queryKey: ['avance', etapaId], enabled: !!etapaId,
    queryFn: () => api.get<VistaAvance>(`/avance/${etapaId}`),
  });
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [confirmando, setConfirmando] = useState(false);
  const [deshaciendo, setDeshaciendo] = useState<Fila | null>(null);
  const [viendoRequisitos, setViendoRequisitos] = useState(false);
  const [configEtapas, setConfigEtapas] = useState(false);
  const [liceoFiltro, setLiceoFiltro] = useState('');
  const [orden, setOrden] = useState<'id' | 'ranking'>('ranking');
  const [fichaDe, setFichaDe] = useState<Fila | null>(null);
  const [subiendoRanking, setSubiendoRanking] = useState(false);
  const [marcandoRanking, setMarcandoRanking] = useState(false);
  // Preselección N°1: ficha de postulación y ranking.
  const esPre = v?.etapa.clave === 'PRESELECCION';
  const esEntrevista = ['ENTREVISTA', 'ENTREVISTA_COMITE'].includes(v?.etapa.clave ?? '');
  const { data: ranking } = useQuery({ queryKey: ['ranking'], queryFn: () => api.get<CargaRanking>('/ranking'), enabled: esPre });

  const refrescar = () => CLAVES.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const error409 = (e: Error) => avisar(e.message, 'error');

  // Marcar requisito y resultado: se actualiza la pantalla al tiro (sin esperar al servidor).
  const actualizarLocal = (id: string, cambio: (f: Fila) => Fila) =>
    qc.setQueryData<VistaAvance>(['avance', etapaId], (d) => d && { ...d, estudiantes: d.estudiantes.map((f) => (f.id === id ? cambio(f) : f)) });

  const requisito = useMutation({
    mutationFn: (x: { f: Fila; req: string; cumplido: boolean }) =>
      api.put(`/avance/${etapaId}/estudiantes/${x.f.id}/requisitos/${x.req}`, { cumplido: x.cumplido }),
    onMutate: (x) => actualizarLocal(x.f.id, (f) => ({ ...f, cumplidos: x.cumplido ? [...f.cumplidos, x.req] : f.cumplidos.filter((c) => c !== x.req) })),
    onSettled: refrescar, onError: error409,
  });
  const marcar = useMutation({
    mutationFn: (x: { f: Fila; resultado: 'PASA' | 'NO_PASA' | null }) =>
      api.put(`/avance/${etapaId}/estudiantes/${x.f.id}/resultado`, { resultado: x.resultado }),
    onMutate: (x) => actualizarLocal(x.f.id, (f) => ({ ...f, resultado: x.resultado })),
    onSettled: refrescar, onError: error409,
  });
  const sugerir = useMutation({
    mutationFn: () => api.post<{ marcados: number }>(`/avance/${etapaId}/sugerir-desde-confirmacion`),
    onSuccess: (r) => { avisar(r.marcados ? `${r.marcados} marcados según su respuesta a la invitación` : 'No había estudiantes nuevos para marcar', 'info'); refrescar(); },
  });
  const confirmar = useMutation({
    mutationFn: () => api.post<{ pasan: number; noPasan: number; siguiente: { nombre: string } | null }>(`/avance/${etapaId}/confirmar`, {}),
    onSuccess: (r) => {
      avisar(`Confirmado: ${r.pasan} pasan${r.siguiente ? ` a ${r.siguiente.nombre}` : ''}, ${r.noPasan} no pasan`);
      setConfirmando(false); refrescar();
    },
    onError: error409,
  });
  const deshacer = useMutation({
    mutationFn: (f: Fila) => api.post(`/avance/${etapaId}/estudiantes/${f.id}/deshacer`),
    onSuccess: () => { avisar('Confirmación deshecha: el estudiante vuelve a esta etapa con su marca provisoria'); setDeshaciendo(null); refrescar(); },
    onError: (e: Error) => { avisar(e.message, 'error'); setDeshaciendo(null); },
  });

  const liceos = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of v?.estudiantes ?? []) m.set(f.liceo_id, `${f.liceo_codigo}. ${f.liceo}`);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [v]);

  const filas = useMemo(() => (v?.estudiantes ?? []).filter((f) => {
    if (liceoFiltro && f.liceo_id !== liceoFiltro) return false;
    const pendiente = f.en_esta_etapa && !f.confirmado;
    if (filtro === 'sin-decidir') return pendiente && !f.resultado;
    if (filtro === 'faltan') return pendiente && f.cumplidos.length < (v?.requisitos.length ?? 0);
    if (filtro === 'pasa') return pendiente && f.resultado === 'PASA';
    if (filtro === 'no-pasa') return pendiente && f.resultado === 'NO_PASA';
    if (filtro === 'confirmados') return f.confirmado;
    return true;
  }).sort((a, b) => (esPre && orden === 'ranking'
    ? (a.ranking?.posicion ?? Infinity) - (b.ranking?.posicion ?? Infinity)
    : 0)), [v, filtro, liceoFiltro, esPre, orden]);

  if (!proceso || isLoading) return <Cargando />;
  if (error || !v) return <ErrorCarga error={error} />;

  const { etapa: e, resumen: r, requisitos } = v;
  const primera = e.orden === 1;
  const marcadas = r.marcados_pasa + r.marcados_no_pasa;
  const marcadosPasa = v.estudiantes.filter((f) => f.en_esta_etapa && !f.confirmado && f.resultado === 'PASA');
  const marcadosNo = v.estudiantes.filter((f) => f.en_esta_etapa && !f.confirmado && f.resultado === 'NO_PASA');
  const totalPasan = r.marcados_pasa + r.confirmados_pasa;
  const avisarA = (tipo: string, soloSinAviso = true) =>
    navegar(`/comunicacion?nuevo=1&etapa=${e.id}&tipo=${tipo}${soloSinAviso ? '&soloSinAviso=1' : ''}`);

  return (
    <div className="max-w-full space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titulo">Avance por etapa</h1>
          <p className="text-sm text-gray-500">Marca quién avanza y quién no. Nada cambia hasta que confirmas.</p>
        </div>
        <button className="btn-secundario" onClick={() => setConfigEtapas(true)}>Configurar etapas</button>
      </div>

      {/* Selector de etapa */}
      <div className="flex flex-wrap gap-2" role="tablist">
        {proceso.etapas.map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === e.id} onClick={() => navegar(`/avance/${x.id}`)}
            className={`rounded-md border px-3 py-1.5 text-sm ${x.id === e.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {x.orden}. {x.nombre} <span className={x.id === e.id ? 'text-gray-300' : 'text-gray-400'}>({x.estudiantes})</span>
          </button>
        ))}
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="tarjeta p-3"><div className="text-xl font-bold">{r.pendientes_de_decidir}</div><div className="text-xs text-gray-500">sin decidir</div></div>
        <div className="tarjeta p-3"><div className="text-xl font-bold text-green-700">{r.marcados_pasa}</div><div className="text-xs text-gray-500">marcados “pasa”</div></div>
        <div className="tarjeta p-3"><div className="text-xl font-bold text-red-700">{r.marcados_no_pasa}</div><div className="text-xs text-gray-500">marcados “no pasa”</div></div>
        <div className="tarjeta p-3"><div className="text-xl font-bold">{r.confirmados_pasa + r.confirmados_no_pasa}</div><div className="text-xs text-gray-500">ya confirmados</div></div>
        <div className="tarjeta p-3">
          <div className={`text-xl font-bold ${e.cupo && totalPasan > e.cupo ? 'text-red-700' : ''}`}>{totalPasan}{e.cupo ? <span className="text-sm font-normal text-gray-400"> / {e.cupo}</span> : ''}</div>
          <div className="text-xs text-gray-500">{e.cupo ? 'pasan / cupo' : 'pasan (sin cupo)'}</div>
        </div>
      </div>

      {e.cupo !== null && totalPasan > e.cupo && <Caja tono="rojo">Hay {totalPasan} estudiantes que avanzan y el cupo de esta etapa es {e.cupo}.</Caja>}

      {/* Acciones */}
      <div className="tarjeta flex flex-wrap items-center gap-2 bg-gray-50 px-4 py-3">
        {primera && (
          <button className="btn-secundario" disabled={sugerir.isPending} onClick={() => sugerir.mutate()}
            title="Aceptó la invitación → pasa · Rechazó → no pasa">Marcar según respuesta a la invitación</button>
        )}
        {esPre && (
          <>
            <button className="btn-secundario" onClick={() => setSubiendoRanking(true)}>{ranking?.carga ? 'Reemplazar ranking' : 'Subir ranking (Excel)'}</button>
            <button className="btn-secundario" disabled={!ranking?.carga} onClick={() => setMarcandoRanking(true)}
              title={ranking?.carga ? 'Marca avanza / no avanza según el ranking' : 'Primero sube el ranking'}>Marcar según ranking</button>
          </>
        )}
        {esEntrevista && <Link className="btn-secundario" to={`/entrevistas/${e.id}`}>Calendario de entrevistas</Link>}
        <button className="btn-secundario" onClick={() => setViendoRequisitos(true)}>Requisitos ({requisitos.length})</button>
        {r.con_requisitos_pendientes > 0 && (
          <button className="btn-secundario" onClick={() => avisarA('FALTAN_REQUISITOS', false)}>Recordar requisitos pendientes ({r.con_requisitos_pendientes})</button>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {r.sin_avisar_pasa > 0 && <button className="btn-secundario" onClick={() => avisarA('PASA')}>Avisar a los que avanzan ({r.sin_avisar_pasa})</button>}
          {r.sin_avisar_no_pasa > 0 && <button className="btn-secundario" onClick={() => avisarA('NO_PASA')}>Avisar a los que no avanzan ({r.sin_avisar_no_pasa})</button>}
          <button className="btn-primario" disabled={!marcadas} onClick={() => setConfirmando(true)}>Confirmar avance ({marcadas})</button>
        </div>
      </div>

      {/* Tabla */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-gray-500">
          {filas.length} estudiantes
          {esPre && ranking?.carga && <> · ranking: {ranking.carga.nombre_archivo}, cargado {fecha(ranking.carga.cargado_en)}</>}
        </span>
        <div className="flex flex-wrap gap-2">
        {esPre && (
          <select className="input w-auto" value={orden} onChange={(ev) => setOrden(ev.target.value as typeof orden)} aria-label="Ordenar">
            <option value="ranking">Ordenar por ranking</option>
            <option value="id">Ordenar por Id</option>
          </select>
        )}
        <select className="input w-auto max-w-[240px]" value={liceoFiltro} onChange={(ev) => setLiceoFiltro(ev.target.value)} aria-label="Filtrar por liceo">
          <option value="">Todos los liceos</option>
          {liceos.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
        </select>
        <select className="input w-auto" value={filtro} onChange={(ev) => setFiltro(ev.target.value as Filtro)} aria-label="Filtrar">
          <option value="todos">Todos</option>
          <option value="sin-decidir">Sin decidir</option>
          {requisitos.length > 0 && <option value="faltan">Les falta algún requisito</option>}
          <option value="pasa">Marcados “pasa”</option>
          <option value="no-pasa">Marcados “no pasa”</option>
          <option value="confirmados">Ya confirmados</option>
        </select>
        </div>
      </div>
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              {esPre && <th title="Lugar en el ranking y puntaje total">Ranking</th>}
              <th>Id</th><th>Estudiante</th><th>Liceo</th><th className="text-right">Prom.</th>
              {esPre && <th>RSH y hogar</th>}
              {esEntrevista && <th>Entrevista</th>}
              {primera && <th>Aceptó postular</th>}
              {requisitos.map((q) => <th key={q.id} className="min-w-[90px] text-center leading-tight">{q.nombre}</th>)}
              <th className="min-w-[170px]">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={6 + requisitos.length + (esPre ? 2 : 0) + (esEntrevista ? 1 : 0)}><Vacio>No hay estudiantes con este filtro.</Vacio></td></tr>}
            {filas.map((f) => {
              const bloqueado = f.confirmado || !f.en_esta_etapa;
              const fondo = f.confirmado ? 'bg-gray-50 text-gray-500' : f.resultado === 'PASA' ? 'bg-green-50/70' : f.resultado === 'NO_PASA' ? 'bg-red-50/60' : '';
              return (
                <tr key={f.id} className={fondo}>
                  {esPre && (
                    <td className="whitespace-nowrap">
                      {f.ranking ? (
                        <>
                          <div><strong className="tabular-nums">{f.ranking.posicion ?? '—'}°</strong>
                            <span className="ml-1 text-xs text-gray-500">{f.ranking.puntaje_total ?? '—'} pts</span></div>
                          {f.ranking.finalista && <Etiqueta tono="azul">Finalista</Etiqueta>}
                        </>
                      ) : <span className="text-xs text-gray-400">sin ranking</span>}
                    </td>
                  )}
                  <td className="font-mono text-xs">{f.codigo}</td>
                  <td className={`whitespace-nowrap ${f.resultado === 'NO_PASA' ? 'line-through decoration-red-400' : ''}`}>
                    {f.apellido_paterno} {f.apellido_materno}, {f.nombres}
                    {!f.email && <span className="ml-1 text-[11px] text-red-700">sin email</span>}
                  </td>
                  <td className="max-w-[160px] truncate text-gray-600" title={f.liceo}>{f.liceo}</td>
                  <td className="text-right tabular-nums">{nota(f.promedio)}</td>
                  {esPre && <td><CeldaFicha f={f} onAbrir={() => setFichaDe(f)} /></td>}
                  {esEntrevista && (
                    <td className="whitespace-nowrap text-xs">
                      <Link to={`/entrevistas/${e.id}`} className="hover:underline">
                        {f.entrevista_estado
                          ? <span className={`rounded border px-1.5 py-0.5 ${ESTADOS[f.entrevista_estado].chip}`}>{ESTADOS[f.entrevista_estado].texto}</span>
                          : <span className="text-gray-400">por agendar</span>}
                        {f.entrevista_fecha && <span className="ml-1.5 text-gray-500">{fecha(f.entrevista_fecha)}</span>}
                      </Link>
                    </td>
                  )}
                  {primera && (
                    <td>{f.confirmacion === 'CONFIRMADO' ? <Etiqueta tono="verde">Sí</Etiqueta> : f.confirmacion === 'RECHAZADO' ? <Etiqueta tono="rojo">No</Etiqueta> : <Etiqueta tono="amarillo">Sin respuesta</Etiqueta>}</td>
                  )}
                  {requisitos.map((q) => {
                    const ok = f.cumplidos.includes(q.id);
                    return (
                      <td key={q.id} className="text-center">
                        <input type="checkbox" checked={ok} disabled={bloqueado}
                          onChange={() => requisito.mutate({ f, req: q.id, cumplido: !ok })}
                          aria-label={`${q.nombre} de ${f.nombres} ${f.apellido_paterno}`} />
                      </td>
                    );
                  })}
                  <td>
                    {f.confirmado ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {f.resultado === 'PASA' ? <Etiqueta tono="verde">Pasó ✓</Etiqueta> : <Etiqueta tono="rojo">No pasó</Etiqueta>}
                        {f.avisado_en ? <span className="text-[11px] text-gray-400" title={fecha(f.avisado_en)}>avisado</span> : <span className="text-[11px] text-yellow-700">sin avisar</span>}
                        <button className="text-[11px] text-gray-400 underline hover:text-gray-800" onClick={() => setDeshaciendo(f)}>deshacer</button>
                      </div>
                    ) : (
                      <div className="inline-flex">
                        <button onClick={() => marcar.mutate({ f, resultado: f.resultado === 'PASA' ? null : 'PASA' })}
                          className={`btn btn-chico rounded-r-none border ${f.resultado === 'PASA' ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
                          aria-pressed={f.resultado === 'PASA'}>Avanza</button>
                        <button onClick={() => marcar.mutate({ f, resultado: f.resultado === 'NO_PASA' ? null : 'NO_PASA' })}
                          className={`btn btn-chico -ml-px rounded-l-none border ${f.resultado === 'NO_PASA' ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
                          aria-pressed={f.resultado === 'NO_PASA'}>No Avanza</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirmando && (
        <Modal titulo={`Confirmar avance — ${e.nombre}`} onCerrar={() => setConfirmando(false)} ancho="max-w-2xl"
          pie={<>
            <button className="btn-secundario" onClick={() => setConfirmando(false)}>Revisar de nuevo</button>
            <button className="btn-primario" disabled={confirmar.isPending} onClick={() => confirmar.mutate()}>
              {confirmar.isPending ? 'Confirmando…' : `Confirmar ${marcadas} resultados`}
            </button>
          </>}>
          <div className="space-y-4 text-sm">
            <p className="text-gray-600">
              Se aplicarán las marcas: <strong className="text-green-700">{marcadosPasa.length} avanzan</strong>
              {e.siguiente ? <> a <strong>{e.siguiente.nombre}</strong></> : ' y quedan seleccionados como becarios'} y{' '}
              <strong className="text-red-700">{marcadosNo.length} no pasan</strong> (quedan fuera del proceso).
              {r.pendientes_de_decidir > 0 && <> Los {r.pendientes_de_decidir} sin decidir se quedan en esta etapa.</>}
            </p>
            {e.cupo !== null && totalPasan > e.cupo && <Caja tono="rojo">Con esta confirmación avanzan {totalPasan} y el cupo es {e.cupo}.</Caja>}
            <div className="grid gap-4 sm:grid-cols-2">
              {[['Pasan', marcadosPasa, 'text-green-700'], ['No pasan', marcadosNo, 'text-red-700']].map(([t, l, c]) => (
                <div key={t as string}>
                  <div className={`mb-1 text-xs font-semibold ${c}`}>{t as string} ({(l as Fila[]).length})</div>
                  <ul className="max-h-60 space-y-0.5 overflow-y-auto rounded-md border border-gray-200 p-2 text-xs">
                    {(l as Fila[]).length === 0 && <li className="text-gray-400">—</li>}
                    {(l as Fila[]).map((f) => <li key={f.id}><span className="font-mono text-gray-400">{f.codigo}</span> {f.nombres} {f.apellido_paterno}</li>)}
                  </ul>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500">Después podrás avisarles por correo. Si te equivocas, una confirmación se puede deshacer mientras el estudiante no tenga resultados en la etapa siguiente.</p>
          </div>
        </Modal>
      )}

      {deshaciendo && (
        <Modal titulo="Deshacer confirmación" onCerrar={() => setDeshaciendo(null)} ancho="max-w-md"
          pie={<><button className="btn-secundario" onClick={() => setDeshaciendo(null)}>Cancelar</button>
            <button className="btn-peligro" disabled={deshacer.isPending} onClick={() => deshacer.mutate(deshaciendo)}>Deshacer</button></>}>
          <p className="text-sm text-gray-700">
            {deshaciendo.nombres} {deshaciendo.apellido_paterno} vuelve a <strong>{e.nombre}</strong> con la marca “{deshaciendo.resultado === 'PASA' ? 'pasa' : 'no pasa'}” sin confirmar.
            {deshaciendo.avisado_en && ' Ojo: ya se le avisó el resultado por correo.'}
          </p>
        </Modal>
      )}
      {viendoRequisitos && <Requisitos vista={v} onCerrar={() => setViendoRequisitos(false)} />}
      {configEtapas && <ConfigurarEtapas onCerrar={() => setConfigEtapas(false)} />}
      {fichaDe && <FichaModal estudiante={fichaDe} onCerrar={() => setFichaDe(null)} />}
      {subiendoRanking && <SubirRanking onCerrar={() => setSubiendoRanking(false)} />}
      {marcandoRanking && (
        <MarcarSegunRanking etapaId={e.id} cupo={e.cupo} onCerrar={() => setMarcandoRanking(false)}
          finalistas={v.estudiantes.filter((x) => x.ranking?.finalista && x.en_esta_etapa).length} />
      )}
      <p className="text-xs text-gray-400">¿Buscas a un estudiante en particular? Revisa <Link to="/invitados" className="underline">Invitados</Link>.</p>
    </div>
  );
}