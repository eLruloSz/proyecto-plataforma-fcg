import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, CargaRanking, Encuentro, Invitado, VistaAvance } from '../api';
import { useProceso } from '../Layout';
import { tipoEtapa, useEtapa } from '../etapa';
import { TerminarEtapa } from './TerminarEtapa';
import { FechasEncuentro, fechaEncuentro, InscribirEnBloque, RegistrarAsistencia, useEncuentros } from './Encuentro';
import { ImportarContactos } from './ImportarContactos';
import { Caja, Cargando, ErrorCarga, Etiqueta, fecha, Modal, nota, useAviso, Vacio } from '../ui';
import { ConfigurarEtapas } from './ConfigurarEtapas';
import { CeldaFicha, CeldasRanking, COLUMNAS_RANKING, EncabezadosRanking, FichaModal, MarcarSegunRanking, SubirRanking } from './Preseleccion';
import { ESTADOS } from './Entrevistas';

type Fila = VistaAvance['estudiantes'][number];
type Filtro = 'todos' | 'sin-decidir' | 'faltan' | 'pasa' | 'no-pasa' | 'confirmados';
/** Encuentro online: filtro por asistencia ('' = todos). */
type FiltroAsistencia = '' | 'si' | 'no' | 'sin-registrar';

/** Cómo se llama el trabajo de cada etapa y qué se hace en ella. */
const TITULOS: Record<string, string> = {
  INVITACION: 'Quién avanza', ENCUENTRO: 'Encuentro online', PRESELECCION: 'Postulantes y ranking', ENTREVISTA: 'Resultados de entrevistas',
};
const AYUDA: Record<string, string> = {
  INVITACION: 'Marca quién sigue a la etapa siguiente según su respuesta a la invitación.',
  ENCUENTRO: 'Inscribe a los estudiantes en una fecha del encuentro, registra la asistencia (solo marcas a los que no asistieron) y quién avanza.',
  PRESELECCION: 'Revisa documentos, sube el ranking, completa la ficha del hogar y marca quién avanza.',
  ENTREVISTA: 'Después de las entrevistas, marca quién avanza.',
  GENERAL: 'Marca quién avanza y quién no.',
};

/** Tras cualquier cambio de avance hay que refrescar varias vistas. */
const CLAVES = ['avance', 'proceso', 'dashboard', 'invitados', 'tareas'];

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
  const { actual, vista, verEtapa } = useEtapa();
  // Sin etapa en la dirección, se muestra la que se está mirando (la en curso, salvo en modo consulta).
  const etapaId = param ?? vista?.id;
  // Si se llega por un enlace a otra etapa, el menú y el aviso de consulta la siguen.
  // Una sola vez por enlace: así no "persigue" a la etapa cuando cambia la etapa en curso.
  const sincronizada = useRef<string | null>(null);
  useEffect(() => {
    if (!param || !actual || sincronizada.current === param) return;
    sincronizada.current = param;
    if (param !== vista?.id) verEtapa(param === actual.id ? null : param);
  }, [param, actual, vista, verEtapa]);
  const { data: v, isLoading, error } = useQuery({
    queryKey: ['avance', etapaId], enabled: !!etapaId,
    queryFn: () => api.get<VistaAvance>(`/avance/${etapaId}`),
  });
  // En la etapa en curso se revisa si en la etapa anterior quedó gente sin avisar de su resultado
  // (por ejemplo, si se terminó la etapa antes de mandar los correos).
  const anteriorId = v && proceso && v.etapa.id === actual?.id
    ? proceso.etapas.find((x) => x.orden === v.etapa.orden - 1)?.id : undefined;
  const { data: vAnterior } = useQuery({
    queryKey: ['avance', anteriorId], enabled: !!anteriorId,
    queryFn: () => api.get<VistaAvance>(`/avance/${anteriorId}`),
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
  const [terminando, setTerminando] = useState<{ mensaje?: string } | null>(null);
  // Justo después de confirmar: ofrecer avisar el resultado ANTES de terminar la etapa.
  // `terminar` = ya no queda nadie por decidir, así que después se puede pasar a la siguiente etapa.
  const [avisando, setAvisando] = useState<{ pasan: number; noPasan: number; terminar: boolean } | null>(null);
  // Encuentro online (etapa 2). fechaFiltro: '' = todas, 'sin' = sin fecha, o el id de una fecha.
  const [fechaFiltro, setFechaFiltro] = useState('');
  const [asistenciaFiltro, setAsistenciaFiltro] = useState<FiltroAsistencia>('');
  const [asistenciaDe, setAsistenciaDe] = useState<Encuentro | null>(null);
  const [inscribiendo, setInscribiendo] = useState(false);
  const [importando, setImportando] = useState(false);
  // Preselección N°1: ficha de postulación y ranking.
  const esPre = v?.etapa.clave === 'PRESELECCION';
  const esEntrevista = ['ENTREVISTA', 'ENTREVISTA_COMITE'].includes(v?.etapa.clave ?? '');
  const esEncuentro = v?.etapa.clave === 'ENCUENTRO';
  const { data: encuentros } = useEncuentros();
  const { data: ranking } = useQuery({ queryKey: ['ranking'], queryFn: () => api.get<CargaRanking>('/ranking'), enabled: esPre });
  // La importación del Excel del formulario necesita la lista de invitados.
  const { data: invitados } = useQuery({ queryKey: ['invitados'], queryFn: () => api.get<Invitado[]>('/invitados'), enabled: importando });

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
  const sugerirAsistencia = useMutation({
    mutationFn: () => api.post<{ marcados: number }>(`/avance/${etapaId}/sugerir-desde-asistencia`),
    onSuccess: (r) => { avisar(r.marcados ? `${r.marcados} marcados según su asistencia` : 'No había estudiantes nuevos para marcar (o falta registrar la asistencia)', 'info'); refrescar(); },
  });
  const confirmar = useMutation({
    mutationFn: () => api.post<{ pasan: number; noPasan: number; siguiente: { nombre: string } | null }>(`/avance/${etapaId}/confirmar`, {}),
    onSuccess: (r) => {
      avisar(`Confirmado: ${r.pasan} avanzan${r.siguiente ? ` a ${r.siguiente.nombre}` : ''}, ${r.noPasan} no avanzan`);
      setConfirmando(false); refrescar();
      // Primero se ofrece avisar el resultado (mientras se está en esta etapa). Si ya nadie queda por decidir
      // en la etapa en curso, después se ofrece pasar a la siguiente (avanza la barra de arriba).
      setAvisando({
        pasan: r.pasan, noPasan: r.noPasan,
        terminar: !!v && v.etapa.id === actual?.id && v.resumen.pendientes_de_decidir === 0,
      });
    },
    onError: error409,
  });
  const deshacer = useMutation({
    mutationFn: (f: Fila) => api.post(`/avance/${etapaId}/estudiantes/${f.id}/deshacer`),
    onSuccess: () => { avisar('Confirmación deshecha: el estudiante vuelve a esta etapa con su marca provisoria'); setDeshaciendo(null); refrescar(); },
    onError: (e: Error) => { avisar(e.message, 'error'); setDeshaciendo(null); },
  });

  const encuentro = useMutation({
    mutationFn: (x: { f: Fila; datos: { encuentroEventoId?: string | null; asistioEncuentro?: boolean } }) => api.patch(`/invitados/${x.f.id}`, x.datos),
    onMutate: (x) => actualizarLocal(x.f.id, (f) => ({
      ...f,
      ...(x.datos.encuentroEventoId !== undefined ? { encuentro_evento_id: x.datos.encuentroEventoId } : {}),
      ...(x.datos.asistioEncuentro !== undefined ? { asistio_encuentro: x.datos.asistioEncuentro } : {}),
    })),
    onSettled: () => ['avance', 'encuentros', 'tareas'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
    onError: error409,
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
  }).filter((f) => {
    if (!esEncuentro) return true;
    if (fechaFiltro === 'sin' && f.encuentro_evento_id) return false;
    if (fechaFiltro && fechaFiltro !== 'sin' && f.encuentro_evento_id !== fechaFiltro) return false;
    if (asistenciaFiltro === 'si') return f.asistio_encuentro === true;
    if (asistenciaFiltro === 'no') return f.asistio_encuentro === false;
    if (asistenciaFiltro === 'sin-registrar') return !!f.encuentro_evento_id && f.asistio_encuentro === null;
    return true;
  }).sort((a, b) => (esPre && orden === 'ranking'
    ? (a.ranking?.posicion ?? Infinity) - (b.ranking?.posicion ?? Infinity)
    : 0)), [v, filtro, liceoFiltro, esPre, orden, esEncuentro, fechaFiltro, asistenciaFiltro]);

  if (!proceso || isLoading) return <Cargando />;
  if (error || !v) return <ErrorCarga error={error} />;

  const { etapa: e, resumen: r, requisitos } = v;
  const primera = e.orden === 1;
  const marcadas = r.marcados_pasa + r.marcados_no_pasa;
  const marcadosPasa = v.estudiantes.filter((f) => f.en_esta_etapa && !f.confirmado && f.resultado === 'PASA');
  const marcadosNo = v.estudiantes.filter((f) => f.en_esta_etapa && !f.confirmado && f.resultado === 'NO_PASA');
  const totalPasan = r.marcados_pasa + r.confirmados_pasa;
  const muestraAcepta = primera || esEncuentro;
  // Visor del encuentro: cuántos asistieron (de los que están o pasaron por esta etapa).
  const enc = esEncuentro ? {
    sinFecha: v.estudiantes.filter((f) => f.en_esta_etapa && !f.encuentro_evento_id).length,
    asistieron: v.estudiantes.filter((f) => f.asistio_encuentro === true).length,
    noAsistieron: v.estudiantes.filter((f) => f.asistio_encuentro === false).length,
    sinRegistrar: v.estudiantes.filter((f) => f.encuentro_evento_id && f.asistio_encuentro === null).length,
  } : null;
  // Criterio para marcar automáticamente quién avanza (uno por tipo de etapa).
  const criterio: { texto: string; ayuda: string; accion: () => void; deshabilitado?: boolean } | null =
    primera ? { texto: 'Marcar según respuesta a la invitación', ayuda: 'Aceptó postular → avanza · Rechazó → no avanza. Solo a quienes aún no tienen marca.',
      accion: () => sugerir.mutate(), deshabilitado: sugerir.isPending }
    : esEncuentro ? { texto: 'Marcar según asistencia', ayuda: 'Asistió → avanza · No asistió → no avanza. Solo a quienes aún no tienen marca.',
      accion: () => sugerirAsistencia.mutate(), deshabilitado: sugerirAsistencia.isPending }
    : esPre ? { texto: 'Marcar según ranking', ayuda: ranking?.carga ? 'Los primeros N del ranking avanzan, el resto no.' : 'Primero sube el ranking (Excel) en Herramientas.',
      accion: () => setMarcandoRanking(true), deshabilitado: !ranking?.carga }
    : null;
  const avisarA = (tipo: string, soloSinAviso = true, deEtapa = e.id) =>
    navegar(`/comunicacion?nuevo=1&etapa=${deEtapa}&tipo=${tipo}${soloSinAviso ? '&soloSinAviso=1' : ''}`);
  const ra = vAnterior?.resumen;

  return (
    <div className="max-w-full space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Etapa {e.orden} de {proceso.etapas.length}</p>
          <h1 className="titulo">{TITULOS[tipoEtapa(e)] ?? e.nombre}{TITULOS[tipoEtapa(e)] ? <span className="font-normal text-gray-500"> · {e.nombre}</span> : null}</h1>
          <p className="text-sm text-gray-500">{AYUDA[tipoEtapa(e)]} Nada cambia hasta que confirmas.</p>
        </div>
        <div className="flex gap-2">
          <BotonExcel etapaId={e.id} nombre={`Etapa ${e.orden} - ${e.nombre}.xlsx`} />
          <button className="btn-secundario" onClick={() => setConfigEtapas(true)}>Configurar etapas</button>
          {e.id === actual?.id && (
            <button className="btn-secundario" onClick={() => setTerminando({})}>{e.siguiente ? 'Terminar etapa' : 'Última etapa'}</button>
          )}
        </div>
      </div>

      {esEncuentro && (
        <>
          <FechasEncuentro seleccionada={fechaFiltro} onSeleccionar={setFechaFiltro} onAsistencia={setAsistenciaDe} />
          {enc && (
            <div className="flex flex-wrap gap-2 text-sm">
              {([
                ['si', enc.asistieron, 'asistieron', 'text-green-700'],
                ['no', enc.noAsistieron, 'no asistieron', 'text-red-700'],
                ['sin-registrar', enc.sinRegistrar, 'inscritos sin asistencia registrada', 'text-yellow-700'],
              ] as const).map(([k, n, t, c]) => (
                <button key={k} onClick={() => setAsistenciaFiltro(asistenciaFiltro === k ? '' : k)} aria-pressed={asistenciaFiltro === k}
                  className={`tarjeta px-3 py-2 text-left hover:bg-gray-50 ${asistenciaFiltro === k ? 'ring-1 ring-gray-900' : ''}`}>
                  <strong className={`text-lg ${c}`}>{n}</strong> <span className="text-xs text-gray-500">{t}</span>
                </button>
              ))}
              <button onClick={() => setFechaFiltro(fechaFiltro === 'sin' ? '' : 'sin')} aria-pressed={fechaFiltro === 'sin'}
                className={`tarjeta px-3 py-2 text-left hover:bg-gray-50 ${fechaFiltro === 'sin' ? 'ring-1 ring-gray-900' : ''}`}>
                <strong className="text-lg">{enc.sinFecha}</strong> <span className="text-xs text-gray-500">sin fecha asignada</span>
              </button>
            </div>
          )}
        </>
      )}

      {anteriorId && ra && ra.sin_avisar_pasa + ra.sin_avisar_no_pasa > 0 && (
        <Caja tono="amarillo" titulo={`Falta avisar el resultado de la etapa anterior (${vAnterior!.etapa.nombre})`}>
          <p>Hay estudiantes con su resultado confirmado a los que todavía no se les ha enviado el correo.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ra.sin_avisar_pasa > 0 && <button className="btn-secundario btn-chico" onClick={() => avisarA('PASA', true, anteriorId)}>Avisar a los que avanzaron ({ra.sin_avisar_pasa})</button>}
            {ra.sin_avisar_no_pasa > 0 && <button className="btn-secundario btn-chico" onClick={() => avisarA('NO_PASA', true, anteriorId)}>Avisar a los que no avanzaron ({ra.sin_avisar_no_pasa})</button>}
          </div>
        </Caja>
      )}

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="tarjeta p-3"><div className="text-xl font-bold">{r.pendientes_de_decidir}</div><div className="text-xs text-gray-500">sin decidir</div></div>
        <div className="tarjeta p-3"><div className="text-xl font-bold text-green-700">{r.marcados_pasa}</div><div className="text-xs text-gray-500">marcados “avanza”</div></div>
        <div className="tarjeta p-3"><div className="text-xl font-bold text-red-700">{r.marcados_no_pasa}</div><div className="text-xs text-gray-500">marcados “no avanza”</div></div>
        <div className="tarjeta p-3"><div className="text-xl font-bold">{r.confirmados_pasa + r.confirmados_no_pasa}</div><div className="text-xs text-gray-500">ya confirmados</div></div>
        <div className="tarjeta p-3">
          <div className={`text-xl font-bold ${e.cupo && totalPasan > e.cupo ? 'text-red-700' : ''}`}>{totalPasan}{e.cupo ? <span className="text-sm font-normal text-gray-400"> / {e.cupo}</span> : ''}</div>
          <div className="text-xs text-gray-500">{e.cupo ? 'avanzan / cupo' : 'avanzan (sin cupo)'}</div>
        </div>
      </div>

      {e.cupo !== null && totalPasan > e.cupo && <Caja tono="rojo">Hay {totalPasan} estudiantes que avanzan y el cupo de esta etapa es {e.cupo}.</Caja>}

      {/* Herramientas propias de la etapa */}
      <div className="tarjeta flex flex-wrap items-center gap-2 bg-gray-50 px-4 py-3">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Herramientas</span>
        {muestraAcepta && (
          <button className="btn-secundario" onClick={() => setImportando(true)}
            title="Excel de Microsoft Forms: llena “Aceptó postular” y los datos de contacto">Importar respuestas del formulario (Excel)</button>
        )}
        {esEncuentro && (
          <button className="btn-secundario" disabled={!encuentros?.length} onClick={() => setInscribiendo(true)}
            title={encuentros?.length ? 'Asignar una fecha a varios estudiantes de una vez' : 'Primero agrega fechas'}>Inscribir en una fecha</button>
        )}
        {esPre && (
          <button className="btn-secundario" onClick={() => setSubiendoRanking(true)}>{ranking?.carga ? 'Reemplazar ranking' : 'Subir ranking (Excel)'}</button>
        )}
        {esEntrevista && <Link className="btn-secundario" to={`/entrevistas/${e.id}`}>Calendario de entrevistas</Link>}
        <button className="btn-secundario" onClick={() => setViendoRequisitos(true)}>Requisitos ({requisitos.length})</button>
        {r.con_requisitos_pendientes > 0 && (
          <button className="btn-secundario" onClick={() => avisarA('FALTAN_REQUISITOS', false)}>Recordar requisitos pendientes ({r.con_requisitos_pendientes})</button>
        )}
      </div>

      {/* ¿Quién avanza? Mismo panel en todas las etapas: 1 marcar, 2 revisar, 3 confirmar. */}
      <div className="tarjeta overflow-hidden border-marca-200">
        <div className="border-b border-marca-100 bg-marca-50 px-4 py-2">
          <h2 className="text-sm font-semibold text-marca-800">¿Quién avanza{e.siguiente ? ` a ${e.siguiente.nombre}` : ''}?</h2>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500"><span className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-marca-700 text-[11px] text-white">1</span>Marcar</p>
            {criterio ? (
              <>
                <button className="btn-sugerir w-full" disabled={criterio.deshabilitado} onClick={criterio.accion} title={criterio.ayuda}>
                  ✓ {criterio.texto}
                </button>
                <p className="text-xs text-gray-500">{criterio.ayuda}</p>
              </>
            ) : (
              <p className="text-xs text-gray-500">En esta etapa se marca uno por uno con los botones <strong>Avanza / No avanza</strong> de la tabla.</p>
            )}
            {criterio && <p className="text-[11px] text-gray-400">También puedes cambiar cualquier marca a mano en la tabla.</p>}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500"><span className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-marca-700 text-[11px] text-white">2</span>Revisar</p>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {([['pasa', r.marcados_pasa, 'avanza', 'border-green-300 bg-green-50 text-green-800'],
                ['no-pasa', r.marcados_no_pasa, 'no avanza', 'border-red-300 bg-red-50 text-red-800'],
                ['sin-decidir', r.pendientes_de_decidir, 'sin decidir', 'border-gray-300 bg-white text-gray-700']] as const).map(([k, n, t, c]) => (
                <button key={k} onClick={() => setFiltro(filtro === k ? 'todos' : k)} aria-pressed={filtro === k}
                  className={`rounded-full border px-2.5 py-1 ${c} ${filtro === k ? 'ring-2 ring-gray-900' : ''}`}>
                  <strong>{n}</strong> {t}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500">Haz clic en un grupo para verlo en la tabla.</p>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500"><span className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-marca-700 text-[11px] text-white">3</span>Confirmar</p>
            <button className="btn-primario w-full" disabled={!marcadas} onClick={() => setConfirmando(true)}>Confirmar avance ({marcadas})</button>
            {(r.sin_avisar_pasa > 0 || r.sin_avisar_no_pasa > 0) && (
              <div className="flex flex-wrap gap-2">
                {r.sin_avisar_pasa > 0 && <button className="btn-secundario btn-chico" onClick={() => avisarA('PASA')}>Avisar a los que avanzan ({r.sin_avisar_pasa})</button>}
                {r.sin_avisar_no_pasa > 0 && <button className="btn-secundario btn-chico" onClick={() => avisarA('NO_PASA')}>Avisar a los que no avanzan ({r.sin_avisar_no_pasa})</button>}
              </div>
            )}
            {!marcadas && <p className="text-xs text-gray-500">Nada cambia hasta que confirmas.</p>}
          </div>
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
        {esEncuentro && (
          <>
            <select className="input w-auto" value={fechaFiltro} onChange={(ev) => setFechaFiltro(ev.target.value)} aria-label="Filtrar por fecha del encuentro">
              <option value="">Todas las fechas</option>
              {encuentros?.map((x) => <option key={x.id} value={x.id}>{fechaEncuentro(x.fecha)}</option>)}
              <option value="sin">Sin fecha asignada</option>
            </select>
            <select className="input w-auto" value={asistenciaFiltro} onChange={(ev) => setAsistenciaFiltro(ev.target.value as FiltroAsistencia)} aria-label="Filtrar por asistencia">
              <option value="">Asistencia: todos</option>
              <option value="si">Asistieron</option>
              <option value="no">No asistieron</option>
              <option value="sin-registrar">Sin registrar</option>
            </select>
          </>
        )}
        <select className="input w-auto" value={filtro} onChange={(ev) => setFiltro(ev.target.value as Filtro)} aria-label="Filtrar">
          <option value="todos">Todos</option>
          <option value="sin-decidir">Sin decidir</option>
          {requisitos.length > 0 && <option value="faltan">Les falta algún requisito</option>}
          <option value="pasa">Marcados “avanza”</option>
          <option value="no-pasa">Marcados “no avanza”</option>
          <option value="confirmados">Ya confirmados</option>
        </select>
        </div>
      </div>
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              {esPre && <EncabezadosRanking />}
              <th>Id</th><th>Estudiante</th><th>Liceo</th><th className="text-right">Prom.</th>
              {esPre && <th title="Datos del hogar según la cartola RSH">Hogar (ficha)</th>}
              {esEntrevista && <th>Entrevista</th>}
              {esEncuentro && <><th className="min-w-[170px]">Fecha del encuentro</th><th>Asistió</th></>}
              {muestraAcepta && <th>Aceptó postular</th>}
              {requisitos.map((q) => <th key={q.id} className="min-w-[90px] text-center leading-tight">{q.nombre}</th>)}
              <th className="min-w-[170px]">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={5 + requisitos.length + (esPre ? COLUMNAS_RANKING + 1 : 0) + (esEntrevista ? 1 : 0) + (esEncuentro ? 2 : 0) + (muestraAcepta ? 1 : 0)}><Vacio>No hay estudiantes con este filtro.</Vacio></td></tr>}
            {filas.map((f) => {
              const bloqueado = f.confirmado || !f.en_esta_etapa;
              const fondo = f.confirmado ? 'bg-gray-50 text-gray-500' : f.resultado === 'PASA' ? 'bg-green-50/70' : f.resultado === 'NO_PASA' ? 'bg-red-50/60' : '';
              return (
                <tr key={f.id} className={fondo}>
                  {esPre && <CeldasRanking r={f.ranking} />}
                  <td className="font-mono text-xs">{f.codigo}</td>
                  <td className={`whitespace-nowrap ${f.resultado === 'NO_PASA' ? 'line-through decoration-red-400' : ''}`}>
                    {f.apellido_paterno} {f.apellido_materno}, {f.nombres}
                    {!f.email && <span className="ml-1 text-[11px] text-red-700">sin email</span>}
                  </td>
                  <td className="max-w-[160px] truncate text-gray-600" title={f.liceo}>{f.liceo}</td>
                  <td className="text-right tabular-nums">{nota(f.promedio)}</td>
                  {esPre && <td><CeldaFicha f={f} onAbrir={() => setFichaDe(f)} /></td>}
                  {esEncuentro && (
                    <>
                      <td>
                        <select className="rounded border border-gray-200 px-1.5 py-1 text-xs" value={f.encuentro_evento_id ?? ''} disabled={!f.en_esta_etapa && !f.confirmado}
                          onChange={(ev) => encuentro.mutate({ f, datos: { encuentroEventoId: ev.target.value || null } })} aria-label={`Fecha del encuentro de ${f.nombres}`}>
                          <option value="">{encuentros?.length ? 'Sin inscribir' : 'Primero agrega fechas'}</option>
                          {encuentros?.map((x) => <option key={x.id} value={x.id}>{fechaEncuentro(x.fecha)}</option>)}
                        </select>
                      </td>
                      <td className="whitespace-nowrap text-center">
                        <input type="checkbox" checked={!!f.asistio_encuentro} disabled={!f.encuentro_evento_id}
                          onChange={(ev) => encuentro.mutate({ f, datos: { asistioEncuentro: ev.target.checked } })} aria-label={`Asistió ${f.nombres}`} />
                        {f.asistio_encuentro === false && <span className="ml-1 text-[11px] text-red-700">no</span>}
                      </td>
                    </>
                  )}
                  {esEntrevista && (
                    <td className="whitespace-nowrap text-xs">
                      <Link to={`/entrevistas/${e.id}`} className="hover:underline">
                        {f.entrevista_estado
                          ? <span className={`rounded border px-1.5 py-0.5 ${ESTADOS[f.entrevista_estado].chip}`}>{ESTADOS[f.entrevista_estado].texto}</span>
                          : <span className="text-gray-400">por agendar</span>}
                        {f.entrevista_fecha && <span className="ml-1.5 text-gray-500">{fecha(f.entrevista_fecha)}</span>}
                      </Link>
                      {(f.pautas_completadas ?? []).map((pc) => (
                        <button key={pc.etapa_id} className="ml-1.5 rounded border border-[#2B579A]/30 bg-blue-50 px-1.5 py-0.5 text-[#2B579A] hover:bg-blue-100"
                          title={`Pauta completada de la entrevista (${pc.etapa}), subida ${fecha(pc.subido_en)}`}
                          onClick={() => api.descargar(`/entrevistas/${pc.etapa_id}/estudiantes/${f.id}/pauta-completada`, `Pauta completada ${f.codigo} ${f.apellido_paterno} ${f.nombres}.docx`)
                            .catch((err: Error) => avisar(err.message, 'error'))}>
                          📄 Pauta{(f.pautas_completadas?.length ?? 0) > 1 ? ` · ${pc.etapa}` : ''}
                        </button>
                      ))}
                    </td>
                  )}
                  {muestraAcepta && (
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
                        {f.resultado === 'PASA' ? <Etiqueta tono="verde">Avanzó ✓</Etiqueta> : <Etiqueta tono="rojo">No avanzó</Etiqueta>}
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
                          aria-pressed={f.resultado === 'NO_PASA'}>No avanza</button>
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
              <strong className="text-red-700">{marcadosNo.length} no avanzan</strong> (quedan fuera del proceso).
              {r.pendientes_de_decidir > 0 && <> Los {r.pendientes_de_decidir} sin decidir se quedan en esta etapa.</>}
            </p>
            {e.cupo !== null && totalPasan > e.cupo && <Caja tono="rojo">Con esta confirmación avanzan {totalPasan} y el cupo es {e.cupo}.</Caja>}
            <div className="grid gap-4 sm:grid-cols-2">
              {[['Avanzan', marcadosPasa, 'text-green-700'], ['No avanzan', marcadosNo, 'text-red-700']].map(([t, l, c]) => (
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

      {avisando && (
        <Modal titulo="Avisar el resultado" onCerrar={() => setAvisando(null)} ancho="max-w-lg"
          pie={<>
            <button className="btn-secundario" onClick={() => setAvisando(null)}>Más tarde</button>
            {avisando.terminar && e.siguiente && (
              <button className="btn-secundario" onClick={() => {
                setAvisando(null);
                setTerminando({ mensaje: 'Todos los estudiantes de esta etapa ya tienen su resultado confirmado.' });
              }}>Terminar la etapa</button>
            )}
          </>}>
          <div className="space-y-3 text-sm">
            <p className="text-gray-700">
              Se confirmaron <strong className="text-green-700">{avisando.pasan} que avanzan</strong> y{' '}
              <strong className="text-red-700">{avisando.noPasan} que no avanzan</strong>. ¿Les avisas ahora por correo?
            </p>
            {avisando.terminar && e.siguiente && (
              <p className="text-gray-500">Conviene avisar antes de terminar la etapa. Cuando vuelvas, la etapa se termina con el botón «Terminar etapa» de arriba.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {r.sin_avisar_pasa > 0 && <button className="btn-primario" onClick={() => { setAvisando(null); avisarA('PASA'); }}>Avisar a los que avanzan ({r.sin_avisar_pasa})</button>}
              {r.sin_avisar_no_pasa > 0 && <button className="btn-primario" onClick={() => { setAvisando(null); avisarA('NO_PASA'); }}>Avisar a los que no avanzan ({r.sin_avisar_no_pasa})</button>}
              {r.sin_avisar_pasa + r.sin_avisar_no_pasa === 0 && <span className="text-gray-500">Actualizando…</span>}
            </div>
          </div>
        </Modal>
      )}
      {deshaciendo && (
        <Modal titulo="Deshacer confirmación" onCerrar={() => setDeshaciendo(null)} ancho="max-w-md"
          pie={<><button className="btn-secundario" onClick={() => setDeshaciendo(null)}>Cancelar</button>
            <button className="btn-peligro" disabled={deshacer.isPending} onClick={() => deshacer.mutate(deshaciendo)}>Deshacer</button></>}>
          <p className="text-sm text-gray-700">
            {deshaciendo.nombres} {deshaciendo.apellido_paterno} vuelve a <strong>{e.nombre}</strong> con la marca “{deshaciendo.resultado === 'PASA' ? 'avanza' : 'no avanza'}” sin confirmar.
            {deshaciendo.avisado_en && ' Ojo: ya se le avisó el resultado por correo.'}
          </p>
        </Modal>
      )}
      {asistenciaDe && <RegistrarAsistencia encuentro={asistenciaDe} estudiantes={v.estudiantes} onCerrar={() => setAsistenciaDe(null)} />}
      {inscribiendo && encuentros && <InscribirEnBloque estudiantes={v.estudiantes} encuentros={encuentros} onCerrar={() => setInscribiendo(false)} />}
      {importando && invitados && <ImportarContactos invitados={invitados} onCerrar={() => setImportando(false)} />}
      {viendoRequisitos && <Requisitos vista={v} onCerrar={() => setViendoRequisitos(false)} />}
      {configEtapas && <ConfigurarEtapas onCerrar={() => setConfigEtapas(false)} />}
      {terminando && <TerminarEtapa etapaId={e.id} mensaje={terminando.mensaje} onCerrar={() => setTerminando(null)} />}
      {fichaDe && <FichaModal estudiante={fichaDe} onCerrar={() => setFichaDe(null)} />}
      {subiendoRanking && <SubirRanking onCerrar={() => setSubiendoRanking(false)} />}
      {marcandoRanking && (
        <MarcarSegunRanking etapaId={e.id} cupo={e.cupo} onCerrar={() => setMarcandoRanking(false)} />
      )}
      <p className="text-xs text-gray-400">¿Buscas a un estudiante en particular? Revisa <Link to="/invitados" className="underline">Invitados</Link>.</p>
    </div>
  );
}

/**
 * Descarga el Excel de la etapa: sus estudiantes con los datos que se tienen hasta esa etapa, más las hojas
 * del Listado Final de Invitados. Funciona también al consultar una etapa terminada.
 */
function BotonExcel({ etapaId, nombre }: { etapaId: string; nombre: string }) {
  const avisar = useAviso();
  const [bajando, setBajando] = useState(false);
  const bajar = async () => {
    setBajando(true);
    try { await api.descargar(`/exportar/etapa/${etapaId}/excel`, nombre); }
    catch (err) { avisar((err as Error).message, 'error'); }
    finally { setBajando(false); }
  };
  return (
    <button className="btn-excel" disabled={bajando} onClick={bajar}
      title="Excel con los estudiantes de esta etapa y los datos hasta aquí, más el Listado Final de Invitados">
      {bajando ? 'Preparando…' : '⬇ Exportar a Excel'}
    </button>
  );
}
