import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, FichaPostulacion } from '../api';
import { useEtapa } from '../etapa';
import { subirPautaCompletada } from '../pautas';
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

type Filtro = 'todos' | 'sin-decidir' | 'seleccionados' | 'no-seleccionados' | 'sin-apreciacion' | 'aceptaria' | 'con-dudas' | 'no-aceptaria';
type Orden = 'ranking' | 'id' | 'apreciacion';
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
  const [liceoFiltro, setLiceoFiltro] = useState('');
  const [orden, setOrden] = useState<Orden>('ranking');
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

  const liceos = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of v?.candidatos ?? []) m.set(f.liceo_codigo, `${f.liceo_codigo}. ${f.liceo}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true }));
  }, [v]);

  const lista = useMemo(() => {
    if (!v) return [];
    const q = sinTildes(busca.trim());
    const filtrados = v.candidatos.filter((f) => {
      if (q && !sinTildes(`${nombreCompleto(f)} ${f.codigo} ${f.liceo}`).includes(q)) return false;
      if (liceoFiltro && f.liceo_codigo !== liceoFiltro) return false;
      switch (filtro) {
        case 'sin-decidir': return !f.confirmado && !f.resultado;
        case 'seleccionados': return f.resultado === 'PASA';
        case 'no-seleccionados': return f.resultado === 'NO_PASA';
        case 'sin-apreciacion': return !f.sugerencia;
        case 'aceptaria': return apreciacionActual(f) === 'ACEPTARIA';
        case 'con-dudas': return apreciacionActual(f) === 'ACEPTARIA_CON_DUDAS';
        case 'no-aceptaria': return apreciacionActual(f) === 'NO_ACEPTARIA';
        default: return true;
      }
    });
    const rango = (f: Finalista) => { const a = apreciacionActual(f); return a ? ORDEN_APRECIACION.indexOf(a) : 99; };
    return [...filtrados].sort((a, b) => {
      if (orden === 'id') return a.codigo.localeCompare(b.codigo, 'es', { numeric: true });
      if (orden === 'apreciacion') return rango(a) - rango(b) || (a.ranking?.posicion ?? 9999) - (b.ranking?.posicion ?? 9999);
      return (a.ranking?.posicion ?? 9999) - (b.ranking?.posicion ?? 9999) || a.codigo.localeCompare(b.codigo, 'es', { numeric: true });
    });
  }, [v, busca, filtro, liceoFiltro, orden]);

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
      <div>
        <h1 className="titulo">Selección final</h1>
        <p className="text-sm text-gray-500">{v.etapa.nombre}: aquí se ve a cada finalista completo y se decide quién recibe la beca.</p>
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

      {/* Búsqueda, filtros y orden */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-gray-500">{lista.length === v.candidatos.length ? `${lista.length} finalistas` : `${lista.length} de ${v.candidatos.length} finalistas`}</span>
        <div className="flex flex-wrap gap-2">
          <input className="input w-auto min-w-[200px] py-1.5" placeholder="Buscar por nombre, Id o liceo" aria-label="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <select className="input w-auto" value={orden} onChange={(e) => setOrden(e.target.value as Orden)} aria-label="Ordenar">
            <option value="ranking">Ordenar por ranking</option>
            <option value="id">Ordenar por Id</option>
            <option value="apreciacion">Ordenar por apreciación</option>
          </select>
          <select className="input w-auto max-w-[240px]" value={liceoFiltro} onChange={(e) => setLiceoFiltro(e.target.value)} aria-label="Filtrar por liceo">
            <option value="">Todos los liceos</option>
            {liceos.map(([codigo, nombre]) => <option key={codigo} value={codigo}>{nombre}</option>)}
          </select>
          <select className="input w-auto" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} aria-label="Filtrar">
            <option value="todos">Todos</option>
            <option value="sin-decidir">Sin decidir</option>
            <option value="seleccionados">Seleccionados</option>
            <option value="no-seleccionados">No seleccionados</option>
            <option value="aceptaria">Apreciación: aceptaría</option>
            <option value="con-dudas">Apreciación: con dudas</option>
            <option value="no-aceptaria">Apreciación: no aceptaría</option>
            <option value="sin-apreciacion">Sin apreciación</option>
          </select>
        </div>
      </div>

      {lista.length === 0 ? <Vacio>{v.candidatos.length ? 'Ningún finalista coincide con el filtro.' : 'Todavía no hay estudiantes en esta etapa.'}</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-16 text-center">Ranking</th>
                <th>Finalista</th>
                <th>Notas y RSH</th>
                <th>Entrevistas</th>
                <th>Apreciación</th>
                <th className="text-right">Decisión</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => <FilaFinalista key={f.id} f={f} soloLectura={soloLectura} ocupado={marcar.isPending}
                onAbrir={() => setAbierto(f.id)} onMarcar={(resultado) => marcar.mutate({ f, resultado })} />)}
            </tbody>
          </table>
        </div>
      )}

      {fichaAbierta && <FichaFinalista f={fichaAbierta} soloLectura={soloLectura} ocupado={marcar.isPending} onCerrar={() => setAbierto(null)} onCambio={refrescar}
    onMarcar={(resultado) => marcar.mutate({ f: fichaAbierta, resultado })} />}

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

/** Botones de decisión: se usan en la tabla y dentro de la ficha. */
function Decision({ f, soloLectura, ocupado, onMarcar }: { f: Finalista; soloLectura: boolean; ocupado: boolean; onMarcar: (r: Resultado) => void }) {
  if (f.confirmado) return f.resultado === 'PASA' ? <Etiqueta tono="verde">Becario/a</Etiqueta> : <Etiqueta tono="rojo">No seleccionado/a</Etiqueta>;
  if (soloLectura) {
    return f.resultado === 'PASA' ? <Etiqueta tono="verde">Seleccionado/a</Etiqueta>
      : f.resultado === 'NO_PASA' ? <Etiqueta tono="rojo">No seleccionado/a</Etiqueta> : <span className="text-xs text-gray-400">sin decidir</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <button disabled={ocupado} aria-pressed={f.resultado === 'PASA'} onClick={() => onMarcar(f.resultado === 'PASA' ? null : 'PASA')}
        className={`whitespace-nowrap rounded-md border px-2.5 py-1 text-xs ${f.resultado === 'PASA' ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-green-50'}`}>Seleccionar</button>
      <button disabled={ocupado} aria-pressed={f.resultado === 'NO_PASA'} onClick={() => onMarcar(f.resultado === 'NO_PASA' ? null : 'NO_PASA')}
        className={`whitespace-nowrap rounded-md border px-2.5 py-1 text-xs ${f.resultado === 'NO_PASA' ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-red-50'}`}>No seleccionar</button>
    </div>
  );
}

const nombreCorto = (s: string) => s.replace(/^Preselección\s*/i, 'Presel. ').replace(/^Selección de becarios$/i, 'Selección final');

function FilaFinalista({ f, soloLectura, ocupado, onAbrir, onMarcar }: {
  f: Finalista; soloLectura: boolean; ocupado: boolean; onAbrir: () => void; onMarcar: (r: Resultado) => void;
}) {
  const avisar = useAviso();
  const ap = apreciacionActual(f);
  const bajar = async (e: EntrevistaFinalista) => {
    try { await api.descargar(`/entrevistas/${e.etapa_id}/estudiantes/${f.id}/pauta-completada`, e.pauta?.nombre ?? `Pauta ${f.codigo}.docx`); }
    catch (err) { avisar((err as Error).message, 'error'); }
  };
  const rsh = f.ficha ? (f.ficha.rsh_pendiente ? <Etiqueta tono="amarillo">RSH pendiente</Etiqueta> : f.ficha.tramo_rsh !== null ? <Etiqueta>RSH {f.ficha.tramo_rsh}%</Etiqueta> : null) : null;
  return (
    <tr className={f.resultado === 'PASA' ? 'bg-green-50/50' : f.resultado === 'NO_PASA' ? 'bg-red-50/40' : ''}>
      <td className="text-center" title={f.ranking?.puntaje_total != null ? `Puntaje ${nota(f.ranking.puntaje_total)}` : 'Posición en el ranking'}>
        <div className="text-base font-bold text-gray-800">{f.ranking?.posicion ?? '—'}</div>
        {f.ranking?.puntaje_total != null && <div className="text-[10px] text-gray-400">{nota(f.ranking.puntaje_total)} pts</div>}
      </td>
      <td className="min-w-[200px]">
        <button className="text-left font-medium hover:underline" onClick={onAbrir}>{nombreCompleto(f)}</button>
        <div className="max-w-[240px] truncate text-xs text-gray-500" title={f.liceo}><span className="font-mono text-gray-700">{f.codigo}</span> · {f.liceo}{f.comuna ? ` · ${f.comuna}` : ''}</div>
      </td>
      <td className="whitespace-nowrap">
        <div className="text-sm">{f.promedio !== null ? nota(f.promedio) : '—'}{f.posicion_curso ? <span className="text-xs text-gray-400" title="Posición en su curso"> · N°{f.posicion_curso}</span> : null}</div>
        <div className="mt-0.5">{rsh}</div>
      </td>
      <td className="min-w-[190px]">
        {f.entrevistas.length === 0 && <span className="text-xs text-gray-400">sin entrevistas</span>}
        <div className="space-y-1">
          {f.entrevistas.map((e) => (
            <div key={e.etapa_id} className="flex items-center gap-1.5 text-xs">
              <span className="w-[84px] shrink-0 truncate text-gray-700" title={e.etapa}>{nombreCorto(e.etapa)}</span>
              {e.estado && <span className={`whitespace-nowrap rounded border px-1 py-0.5 text-[10px] ${ESTADOS[e.estado].chip}`}>{ESTADOS[e.estado].texto}</span>}
              {e.pauta
                ? <button className="whitespace-nowrap rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-800 hover:bg-blue-100" onClick={() => bajar(e)} title="Descargar el Word de la pauta completada">📄 Word</button>
                : <span className="text-gray-300" title="Sin pauta completada">sin Word</span>}
            </div>
          ))}
        </div>
      </td>
      <td className="whitespace-nowrap">
        {ap ? <span className={`rounded border px-1.5 py-0.5 text-xs ${APRECIACIONES[ap].chip}`}>{APRECIACIONES[ap].texto}</span> : <span className="text-xs text-gray-400">sin apreciación</span>}
      </td>
      <td>
        <div className="flex items-center justify-end gap-1.5">
          <Decision f={f} soloLectura={soloLectura} ocupado={ocupado} onMarcar={onMarcar} />
          <button className="btn-secundario btn-chico whitespace-nowrap" onClick={onAbrir}>Ver ficha</button>
        </div>
      </td>
    </tr>
  );
}

const SI_NO = (n: number | null | undefined) => (n === null || n === undefined ? null : n);

function Dato({ t, v }: { t: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === '') return null;
  return <div><dt className="text-[11px] text-gray-500">{t}</dt><dd className="text-sm">{v}</dd></div>;
}

function FichaFinalista({ f, soloLectura, ocupado, onCerrar, onCambio, onMarcar }: {
  f: Finalista; soloLectura: boolean; ocupado: boolean; onCerrar: () => void; onCambio: () => void; onMarcar: (r: Resultado) => void;
}) {
  const fi = f.ficha;
  const ap = apreciacionActual(f);
  return (
    <Modal titulo={nombreCompleto(f)} onCerrar={onCerrar} ancho="max-w-3xl" pie={<button className="btn-secundario" onClick={onCerrar}>Cerrar</button>}>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-center"><div className="text-xl font-bold">{f.ranking?.posicion ?? '—'}</div><div className="text-[10px] uppercase text-gray-400">ranking</div></div>
          {f.ranking?.puntaje_total != null && <div className="text-center"><div className="text-xl font-bold">{nota(f.ranking.puntaje_total)}</div><div className="text-[10px] uppercase text-gray-400">puntaje</div></div>}
          {f.promedio !== null && <div className="text-center"><div className="text-xl font-bold">{nota(f.promedio)}</div><div className="text-[10px] uppercase text-gray-400">promedio</div></div>}
          <div className="flex flex-wrap items-center gap-1.5">
            {fi && (fi.rsh_pendiente ? <Etiqueta tono="amarillo">RSH pendiente</Etiqueta> : fi.tramo_rsh !== null && <Etiqueta>RSH {fi.tramo_rsh}%</Etiqueta>)}
            {ap ? <span className={`rounded border px-1.5 py-0.5 text-xs ${APRECIACIONES[ap].chip}`}>{APRECIACIONES[ap].texto}</span> : <span className="text-xs text-gray-400">sin apreciación</span>}
          </div>
          <div className="ml-auto"><Decision f={f} soloLectura={soloLectura} ocupado={ocupado} onMarcar={onMarcar} /></div>
        </div>

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
  const [subiendo, setSubiendo] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const cambio = observaciones.trim() !== (e.observaciones ?? '');

  // La apreciación se guarda en cuanto se elige (un clic); el botón «Guardar» es solo para las observaciones.
  const guardarApreciacion = useMutation({
    mutationFn: (a: Apreciacion | null) => api.put(`/seleccion/entrevistas/${e.etapa_id}/estudiantes/${f.id}/apreciacion`, { apreciacion: a }),
    onSuccess: () => { avisar('Apreciación guardada'); onCambio(); },
    onError: (err: Error) => { setApreciacion(e.apreciacion); avisar(err.message, 'error'); },
  });
  const guardar = useMutation({
    mutationFn: () => api.put(`/seleccion/entrevistas/${e.etapa_id}/estudiantes/${f.id}/apreciacion`, { observaciones: observaciones.trim() || null }),
    onSuccess: () => { avisar('Observaciones guardadas'); onCambio(); },
    onError: (err: Error) => avisar(err.message, 'error'),
  });
  const bajar = async () => {
    setBajando(true);
    try { await api.descargar(`/entrevistas/${e.etapa_id}/estudiantes/${f.id}/pauta-completada`, e.pauta?.nombre ?? `Pauta ${f.codigo}.docx`); }
    catch (err) { avisar((err as Error).message, 'error'); }
    finally { setBajando(false); }
  };

  const subir = async (archivo: File) => {
    setSubiendo(true);
    try {
      const r = await subirPautaCompletada(e.etapa_id, f.id, archivo);
      if (r) { avisar(r.reemplazada ? 'Pauta reemplazada' : 'Pauta guardada'); onCambio(); }
    } catch (err) { avisar((err as Error).message, 'error'); }
    finally { setSubiendo(false); }
  };

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <input ref={entrada} type="file" hidden accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(ev) => { const a = ev.target.files?.[0]; ev.target.value = ''; if (a) subir(a); }} />
      <div className="flex flex-wrap items-center gap-2">
        <strong>{e.etapa}</strong>
        {e.estado && <span className={`rounded border px-1.5 py-0.5 text-xs ${ESTADOS[e.estado].chip}`}>{ESTADOS[e.estado].texto}</span>}
        {e.fecha_hora && <span className="text-xs text-gray-500">{fecha(e.fecha_hora)}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {e.pauta
            ? <button className="btn-word btn-chico" disabled={bajando} onClick={bajar} title={`Subida el ${fecha(e.pauta.subido_en)}`}>{bajando ? 'Preparando…' : '⬇ Pauta completada (Word)'}</button>
            : <span className="text-xs text-gray-400">Sin pauta completada</span>}
          {!soloLectura && (
            <button className="btn-secundario btn-chico" disabled={subiendo} onClick={() => entrada.current?.click()}
              title="Sube el Word de la pauta ya rellenado después de la entrevista">
              {subiendo ? 'Subiendo…' : e.pauta ? '⬆ Reemplazar' : '⬆ Subir Word completado'}
            </button>
          )}
        </span>
      </div>
      {e.comentario && <p className="mt-2 text-xs text-gray-600"><span className="text-gray-400">Nota de la agenda:</span> {e.comentario}</p>}

      <div className="mt-3">
        <span className="label">Apreciación general</span>
        <div className="flex flex-wrap gap-1.5">
          {ORDEN_APRECIACION.map((a) => (
            <button key={a} disabled={soloLectura || guardarApreciacion.isPending} aria-pressed={apreciacion === a}
              onClick={() => { const nueva = apreciacion === a ? null : a; setApreciacion(nueva); guardarApreciacion.mutate(nueva); }}
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
          {cambio && <span className="text-[11px] text-amber-700">Observaciones sin guardar</span>}
          <button className="btn-primario btn-chico" disabled={!cambio || guardar.isPending} onClick={() => guardar.mutate()}>Guardar observaciones</button>
        </div>
      )}
    </div>
  );
}