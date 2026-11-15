import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, FichaPostulacion } from '../api';
import { useEtapa } from '../etapa';
import { useSesion } from '../sesion';
import { Caja, Cargando, ErrorCarga, Etiqueta, fecha, Modal, nombreCompleto, nota, useAviso, Vacio } from '../ui';
import { ESTADOS } from './Entrevistas';

/**
 * Selección final (última etapa): cada finalista con todo lo que se sabe de él o ella y cómo le fue en las
 * entrevistas, para que quienes deciden la beca lo vean en un solo lugar. La decisión y su confirmación usan
 * lo mismo que "Resultados" (confirmar en la última etapa deja al estudiante como becario/a).
 */

type Apreciacion = 'ACEPTARIA' | 'ACEPTARIA_CON_DUDAS' | 'NO_ACEPTARIA';
type Resultado = 'PASA' | 'NO_PASA' | null;

interface EntrevistaFinalista {
  etapa_id: string; etapa: string; orden: number; fecha_hora: string | null; estado: keyof typeof ESTADOS | null; realizada: boolean;
  comentario: string | null; apreciacion: Apreciacion | null; observaciones: string | null; apreciacion_en: string | null;
  pauta: { nombre: string; subido_en: string } | null;
}
interface Finalista {
  id: string; codigo: string; curso: string | null; promedio: number | null; posicion_curso: number | null; estado: string;
  nombres: string; apellido_paterno: string; apellido_materno: string | null; email: string | null; telefono: string | null;
  liceo_codigo: string; liceo: string; comuna: string | null; en_esta_etapa: boolean;
  resultado: Resultado; confirmado: boolean;
  ficha: FichaPostulacion | null;
  ranking: { posicion: number | null; puntaje_total: number | null; rsh: string | null } | null;
  entrevistas: EntrevistaFinalista[];
  sugerencia: { apreciacion: Apreciacion; etapa: string; resultado: Resultado } | null;
}
interface VistaSeleccion {
  etapa: { id: string; orden: number; nombre: string; cupo: number | null; estado: string };
  resumen: {
    cupo: number | null; total: number; becarios_confirmados: number; marcados_pasa: number; marcados_no_pasa: number; sin_decidir: number;
    cupos_libres: number | null; con_apreciacion: number; sugeridos_pasa: number; sugeridos_no_pasa: number;
  };
  candidatos: Finalista[];
}

const APRECIACIONES: Record<Apreciacion, { texto: string; chip: string; activo: string }> = {
  ACEPTARIA: { texto: 'Aceptaría', chip: 'border-green-300 bg-green-50 text-green-800', activo: 'border-green-400 bg-green-100 text-green-900 ring-2 ring-green-600' },
  ACEPTARIA_CON_DUDAS: { texto: 'Aceptaría con dudas', chip: 'border-amber-300 bg-amber-50 text-amber-800', activo: 'border-amber-400 bg-amber-100 text-amber-900 ring-2 ring-amber-600' },
  NO_ACEPTARIA: { texto: 'No aceptaría', chip: 'border-red-300 bg-red-50 text-red-800', activo: 'border-red-400 bg-red-100 text-red-900 ring-2 ring-red-600' },
};
const ORDEN_APRECIACION = Object.keys(APRECIACIONES) as Apreciacion[];

type Filtro = 'todos' | 'sin-decidir' | 'seleccionados' | 'no-seleccionados' | 'sin-apreciacion';
const CLAVES = ['seleccion', 'avance', 'proceso', 'dashboard', 'tareas', 'entrevistas'];

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** La apreciación que vale hoy: la de la entrevista más reciente que la tenga. */
const apreciacionActual = (f: Finalista) => f.sugerencia?.apreciacion ?? null;

export function Seleccion() {
  const { etapaId: param } = useParams<{ etapaId?: string }>();
  const qc = useQueryClient();
  const avisar = useAviso();
  const { soloLectura } = useSesion();
  const { actual, vista, verEtapa } = useEtapa();
  const etapaId = param ?? vista?.id;
  // Igual que en "Resultados": si se llega por un enlace a otra etapa, el menú la sigue (una sola vez por enlace).
  const sincronizada = useRef<string | null>(null);
  useEffect(() => {
    if (!param || !actual || sincronizada.current === param) return;
    sincronizada.current = param;
    if (param !== vista?.id) verEtapa(param === actual.id ? null : param);
  }, [param, actual, vista, verEtapa]);

  const { data: v, isLoading, error } = useQuery({
    queryKey: ['seleccion', etapaId], enabled: !!etapaId,
    queryFn: () => api.get<VistaSeleccion>(`/seleccion/${etapaId}`),
  });
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const refrescar = () => CLAVES.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const errorAviso = (e: Error) => avisar(e.message, 'error');

  const marcar = useMutation({
    mutationFn: (x: { f: Finalista; resultado: Resultado }) => api.put(`/avance/${etapaId}/estudiantes/${x.f.id}/resultado`, { resultado: x.resultado }),
    onSuccess: refrescar, onError: errorAviso,
  });
  const sugerencias = useMutation({
    mutationFn: () => api.post<{ marcados: number }>(`/seleccion/${etapaId}/aplicar-sugerencias`),
    onSuccess: (r) => { avisar(r.marcados ? `${r.marcados} marcados según su apreciación` : 'No había estudiantes nuevos para marcar', 'info'); refrescar(); },
    onError: errorAviso,
  });
  const confirmar = useMutation({
    mutationFn: () => api.post<{ pasan: number; noPasan: number }>(`/avance/${etapaId}/confirmar`, {}),
    onSuccess: (r) => { avisar(`Confirmado: ${r.pasan} becarios, ${r.noPasan} no seleccionados`); setConfirmando(false); refrescar(); },
    onError: errorAviso,
  });

  const lista = useMemo(() => {
    if (!v) return [];
    const q = sinTildes(busca.trim());
    return v.candidatos.filter((f) => {
      if (q && !sinTildes(`${nombreCompleto(f)} ${f.codigo} ${f.liceo}`).includes(q)) return false;
      switch (filtro) {
        case 'sin-decidir': return !f.confirmado && !f.resultado;
        case 'seleccionados': return f.resultado === 'PASA';
        case 'no-seleccionados': return f.resultado === 'NO_PASA';
        case 'sin-apreciacion': return !f.sugerencia;
        default: return true;
      }
    });
  }, [v, busca, filtro]);

  if (isLoading || !etapaId) return <Cargando />;
  if (error) return <ErrorCarga error={error} />;
  if (!v) return null;

  const r = v.resumen;
  const sugeridos = r.sugeridos_pasa + r.sugeridos_no_pasa;
  const pendientesDeConfirmar = r.marcados_pasa + r.marcados_no_pasa;
  const pasanTodos = r.becarios_confirmados + r.marcados_pasa;
  const sobreCupo = r.cupo !== null && pasanTodos > r.cupo;
  const fichaAbierta = abierto ? v.candidatos.find((f) => f.id === abierto) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo">Selección final</h1>
          <p className="text-sm text-gray-500">{v.etapa.nombre}: aquí se ve a cada finalista completo y se decide quién recibe la beca.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-secundario" to={`/entrevistas/${v.etapa.id}`}>Calendario de entrevistas</Link>
          <Link className="btn-secundario" to={`/avance/${v.etapa.id}`}>Resultados</Link>
        </div>
      </div>

      {/* Cupo y avance de la decisión */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="tarjeta p-3">
          <div className={`text-xl font-bold ${sobreCupo ? 'text-red-700' : ''}`}>
            {pasanTodos}{r.cupo !== null && <span className="text-sm font-normal text-gray-400"> / {r.cupo}</span>}
          </div>
          <div className="text-xs text-gray-500">{r.cupo !== null ? 'becas asignadas / cupo' : 'becas asignadas (sin cupo definido)'}</div>
        </div>
        <div className="tarjeta p-3"><div className="text-xl font-bold text-green-700">{r.becarios_confirmados}</div><div className="text-xs text-gray-500">becarios confirmados</div></div>
        <div className="tarjeta p-3"><div className="text-xl font-bold text-green-700">{r.marcados_pasa}</div><div className="text-xs text-gray-500">seleccionados sin confirmar</div></div>
        <div className="tarjeta p-3"><div className="text-xl font-bold text-red-700">{r.marcados_no_pasa}</div><div className="text-xs text-gray-500">no seleccionados sin confirmar</div></div>
        <div className="tarjeta p-3"><div className="text-xl font-bold">{r.sin_decidir}</div><div className="text-xs text-gray-500">sin decidir</div></div>
      </div>
      {sobreCupo && <Caja tono="amarillo">Hay más becas asignadas ({pasanTodos}) que el cupo ({r.cupo}). Revisa antes de confirmar.</Caja>}
      {r.cupos_libres !== null && r.cupos_libres > 0 && r.sin_decidir === 0 && pendientesDeConfirmar === 0 && (
        <Caja tono="azul">Quedan {r.cupos_libres} cupos sin asignar.</Caja>
      )}

      {!soloLectura && (
        <div className="tarjeta flex flex-wrap items-center gap-3 p-3">
          <button className="btn-secundario" disabled={!sugeridos || sugerencias.isPending} onClick={() => sugerencias.mutate()}
            title="Marca “seleccionado” a quien la entrevista dice que aceptaría y “no seleccionado” a quien no aceptaría. Las marcas son provisorias y se pueden cambiar.">
            ✓ Marcar según apreciación ({sugeridos})
          </button>
          <button className="btn-primario" disabled={!pendientesDeConfirmar} onClick={() => setConfirmando(true)}>
            Confirmar selección ({pendientesDeConfirmar})
          </button>
          <p className="text-xs text-gray-500">“Aceptaría con dudas” no se marca solo: lo decide una persona, caso por caso.</p>
        </div>
      )}

      {/* Búsqueda y filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs py-1.5" placeholder="Buscar por nombre, Id o liceo" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {([['todos', 'Todos'], ['sin-decidir', 'Sin decidir'], ['seleccionados', 'Seleccionados'], ['no-seleccionados', 'No seleccionados'], ['sin-apreciacion', 'Sin apreciación']] as const).map(([k, t]) => (
          <button key={k} onClick={() => setFiltro(k)} aria-pressed={filtro === k}
            className={`rounded-full border px-3 py-1 text-xs ${filtro === k ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>{t}</button>
        ))}
        <span className="text-xs text-gray-400">{lista.length} de {v.candidatos.length}</span>
      </div>

      {lista.length === 0 ? <Vacio>{v.candidatos.length ? 'Ningún finalista coincide con el filtro.' : 'Todavía no hay estudiantes en esta etapa.'}</Vacio> : (
        <div className="space-y-2">
          {lista.map((f) => <TarjetaFinalista key={f.id} f={f} soloLectura={soloLectura} ocupado={marcar.isPending}
            onAbrir={() => setAbierto(f.id)} onMarcar={(resultado) => marcar.mutate({ f, resultado })} />)}
        </div>
      )}

      {fichaAbierta && <FichaFinalista f={fichaAbierta} soloLectura={soloLectura} onCerrar={() => setAbierto(null)} onCambio={refrescar} />}

      {confirmando && (
        <Modal titulo="Confirmar selección" onCerrar={() => setConfirmando(false)} ancho="max-w-md"
          pie={<>
            <button className="btn-secundario" onClick={() => setConfirmando(false)}>Cancelar</button>
            <button className="btn-primario" disabled={confirmar.isPending} onClick={() => confirmar.mutate()}>Confirmar</button>
          </>}>
          <div className="space-y-2 text-sm">
            <p><strong>{r.marcados_pasa}</strong> quedarán como <strong>becarios/as</strong> y <strong>{r.marcados_no_pasa}</strong> saldrán del proceso.</p>
            {sobreCupo && <p className="text-red-700">Ojo: con esto hay {pasanTodos} becas y el cupo es {r.cupo}.</p>}
            <p className="text-gray-500">Después se puede deshacer uno por uno desde Resultados. El aviso del resultado se envía desde ahí.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TarjetaFinalista({ f, soloLectura, ocupado, onAbrir, onMarcar }: {
  f: Finalista; soloLectura: boolean; ocupado: boolean; onAbrir: () => void; onMarcar: (r: Resultado) => void;
}) {
  const ap = apreciacionActual(f);
  const conPauta = f.entrevistas.filter((e) => e.pauta).length;
  return (
    <div className={`tarjeta flex flex-wrap items-center gap-x-4 gap-y-2 p-3 ${f.resultado === 'PASA' ? 'border-green-300' : f.resultado === 'NO_PASA' ? 'border-red-200 bg-red-50/30' : ''}`}>
      <div className="w-10 text-center" title="Posición en el ranking">
        <div className="text-lg font-bold text-gray-800">{f.ranking?.posicion ?? '—'}</div>
        <div className="text-[10px] uppercase text-gray-400">ranking</div>
      </div>
      <button className="min-w-0 flex-1 text-left" onClick={onAbrir}>
        <div className="truncate font-medium hover:underline">{nombreCompleto(f)}</div>
        <div className="truncate text-xs text-gray-500"><span className="font-mono">{f.codigo}</span> · {f.liceo}{f.promedio !== null ? ` · promedio ${nota(f.promedio)}` : ''}</div>
      </button>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {f.ficha && (f.ficha.rsh_pendiente ? <Etiqueta tono="amarillo">RSH pendiente</Etiqueta> : f.ficha.tramo_rsh !== null && <Etiqueta>RSH {f.ficha.tramo_rsh}%</Etiqueta>)}
        {ap ? <span className={`rounded border px-1.5 py-0.5 ${APRECIACIONES[ap].chip}`}>{APRECIACIONES[ap].texto}</span>
          : <span className="text-gray-400">sin apreciación</span>}
        {conPauta > 0 && <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-800" title="Word de la pauta completada">📄 Pauta{conPauta > 1 ? ` ×${conPauta}` : ''}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        {f.confirmado ? (
          f.resultado === 'PASA' ? <Etiqueta tono="verde">Becario/a</Etiqueta> : <Etiqueta tono="rojo">No seleccionado/a</Etiqueta>
        ) : soloLectura ? (
          f.resultado === 'PASA' ? <Etiqueta tono="verde">Seleccionado/a</Etiqueta> : f.resultado === 'NO_PASA' ? <Etiqueta tono="rojo">No seleccionado/a</Etiqueta> : <span className="text-xs text-gray-400">sin decidir</span>
        ) : (
          <>
            <button disabled={ocupado} aria-pressed={f.resultado === 'PASA'} onClick={() => onMarcar(f.resultado === 'PASA' ? null : 'PASA')}
              className={`rounded-md border px-2.5 py-1 text-xs ${f.resultado === 'PASA' ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-green-50'}`}>Seleccionar</button>
            <button disabled={ocupado} aria-pressed={f.resultado === 'NO_PASA'} onClick={() => onMarcar(f.resultado === 'NO_PASA' ? null : 'NO_PASA')}
              className={`rounded-md border px-2.5 py-1 text-xs ${f.resultado === 'NO_PASA' ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-red-50'}`}>No seleccionar</button>
          </>
        )}
        <button className="btn-secundario btn-chico" onClick={onAbrir}>Ver ficha</button>
      </div>
    </div>
  );
}

const SI_NO = (n: number | null | undefined) => (n === null || n === undefined ? null : n);

function Dato({ t, v }: { t: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === '') return null;
  return <div><dt className="text-[11px] text-gray-500">{t}</dt><dd className="text-sm">{v}</dd></div>;
}

function FichaFinalista({ f, soloLectura, onCerrar, onCambio }: { f: Finalista; soloLectura: boolean; onCerrar: () => void; onCambio: () => void }) {
  const fi = f.ficha;
  return (
    <Modal titulo={nombreCompleto(f)} onCerrar={onCerrar} ancho="max-w-3xl" pie={<button className="btn-secundario" onClick={onCerrar}>Cerrar</button>}>
      <div className="space-y-5 text-sm">
        <section>
          <h3 className="subtitulo mb-2">Datos</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            <Dato t="Id" v={<span className="font-mono">{f.codigo}</span>} />
            <Dato t="Establecimiento" v={`${f.liceo_codigo}. ${f.liceo}`} />
            <Dato t="Comuna" v={f.comuna} />
            <Dato t="Curso" v={f.curso} />
            <Dato t="Promedio" v={f.promedio !== null ? nota(f.promedio) : null} />
            <Dato t="Posición en el curso" v={f.posicion_curso} />
            <Dato t="Correo" v={f.email} />
            <Dato t="Teléfono" v={f.telefono} />
            <Dato t="Posición en el ranking" v={f.ranking?.posicion} />
          </dl>
        </section>

        {fi && (
          <section>
            <h3 className="subtitulo mb-2">Situación familiar (ficha RSH)</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              <Dato t="Tramo RSH" v={fi.rsh_pendiente ? 'Pendiente' : fi.tramo_rsh !== null ? `${fi.tramo_rsh}%` : null} />
              <Dato t="Personas del hogar" v={SI_NO(fi.personas_hogar)} />
              <Dato t="Ingresos del hogar" v={fi.ingresos_hogar} />
              <Dato t="Menores de 18" v={SI_NO(fi.menores_18)} />
              <Dato t="Mayores de 60" v={SI_NO(fi.mayores_60)} />
              <Dato t="Con discapacidad" v={SI_NO(fi.con_discapacidad)} />
              <Dato t="Con dependencia" v={SI_NO(fi.con_dependencia)} />
              <Dato t="Con NEE" v={SI_NO(fi.con_nee)} />
            </dl>
            {fi.observaciones && <p className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-700">{fi.observaciones}</p>}
          </section>
        )}

        <section>
          <h3 className="subtitulo mb-2">Entrevistas</h3>
          {f.entrevistas.length === 0 && <p className="text-xs text-gray-500">Todavía no tiene entrevistas registradas.</p>}
          <div className="space-y-3">
            {f.entrevistas.map((e) => <BloqueEntrevista key={e.etapa_id} f={f} e={e} soloLectura={soloLectura} onCambio={onCambio} />)}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function BloqueEntrevista({ f, e, soloLectura, onCambio }: { f: Finalista; e: EntrevistaFinalista; soloLectura: boolean; onCambio: () => void }) {
  const avisar = useAviso();
  const [apreciacion, setApreciacion] = useState<Apreciacion | null>(e.apreciacion);
  const [observaciones, setObservaciones] = useState(e.observaciones ?? '');
  const [bajando, setBajando] = useState(false);
  const cambio = apreciacion !== e.apreciacion || observaciones.trim() !== (e.observaciones ?? '');

  const guardar = useMutation({
    mutationFn: () => api.put(`/seleccion/entrevistas/${e.etapa_id}/estudiantes/${f.id}/apreciacion`, { apreciacion, observaciones: observaciones.trim() || null }),
    onSuccess: () => { avisar('Apreciación guardada'); onCambio(); },
    onError: (err: Error) => avisar(err.message, 'error'),
  });
  const bajar = async () => {
    setBajando(true);
    try { await api.descargar(`/entrevistas/${e.etapa_id}/estudiantes/${f.id}/pauta-completada`, e.pauta?.nombre ?? `Pauta ${f.codigo}.docx`); }
    catch (err) { avisar((err as Error).message, 'error'); }
    finally { setBajando(false); }
  };

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{e.etapa}</strong>
        {e.estado && <span className={`rounded border px-1.5 py-0.5 text-xs ${ESTADOS[e.estado].chip}`}>{ESTADOS[e.estado].texto}</span>}
        {e.fecha_hora && <span className="text-xs text-gray-500">{fecha(e.fecha_hora)}</span>}
        <span className="ml-auto">
          {e.pauta
            ? <button className="btn-word btn-chico" disabled={bajando} onClick={bajar} title={`Subida el ${fecha(e.pauta.subido_en)}`}>{bajando ? 'Preparando…' : '⬇ Pauta completada (Word)'}</button>
            : <span className="text-xs text-gray-400" title="Se sube desde el Calendario de entrevistas">Sin pauta completada</span>}
        </span>
      </div>
      {e.comentario && <p className="mt-2 text-xs text-gray-600"><span className="text-gray-400">Nota de la agenda:</span> {e.comentario}</p>}

      <div className="mt-3">
        <span className="label">Apreciación general</span>
        <div className="flex flex-wrap gap-1.5">
          {ORDEN_APRECIACION.map((a) => (
            <button key={a} disabled={soloLectura} aria-pressed={apreciacion === a} onClick={() => setApreciacion(apreciacion === a ? null : a)}
              className={`rounded-md border px-2.5 py-1.5 text-xs ${apreciacion === a ? `${APRECIACIONES[a].activo} font-semibold` : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:hover:bg-white'}`}>
              {APRECIACIONES[a].texto}
            </button>
          ))}
        </div>
      </div>
      <label className="mt-3 block">
        <span className="label">Observaciones de la entrevista</span>
        <textarea rows={3} className="input" disabled={soloLectura} value={observaciones} maxLength={4000}
          placeholder={soloLectura ? 'Sin observaciones' : 'Qué se destacó, dudas, compromisos…'} onChange={(ev) => setObservaciones(ev.target.value)} />
      </label>
      {!soloLectura && (
        <div className="mt-2 flex items-center justify-end gap-2">
          {e.apreciacion_en && <span className="mr-auto text-[11px] text-gray-400">Última modificación: {fecha(e.apreciacion_en)}</span>}
          <button className="btn-primario btn-chico" disabled={!cambio || guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button>
        </div>
      )}
    </div>
  );
}
