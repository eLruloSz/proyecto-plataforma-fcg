import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, FichaPostulacion } from '../api';
import { etiquetaEntrevista, useEtapa } from '../etapa';
import { subirPautaCompletada } from '../pautas';
import { useSesion } from '../sesion';
import { Caja, Cargando, ErrorCarga, Etiqueta, fecha, Icono, Modal, nombreCompleto, nota, useAviso, Vacio } from '../ui';
import { ESTADOS } from './Entrevistas';

/**
 * Selección final (última etapa): cada finalista con todo lo que se sabe de él o ella y cómo le fue en las
 * entrevistas, para que quienes deciden la beca lo vean en un solo lugar. Aquí solo se decide: las marcas
 * quedan en "Resultados", que es donde se confirma (confirmar en la última etapa deja al estudiante como
 * becario/a) y desde donde se avisa a los estudiantes.
 */

type Apreciacion = 'ACEPTARIA' | 'ACEPTARIA_CON_DUDAS' | 'NO_ACEPTARIA';
type Resultado = 'PASA' | 'NO_PASA' | null;
/** Lo que se elige en esta pantalla: seleccionar, dejar en espera o no seleccionar (null = quitar la marca). */
type Eleccion = 'PASA' | 'NO_PASA' | 'ESPERA' | null;

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
  /** En lista de espera (no es un resultado de la etapa) y su puesto, que sigue el ranking. */
  en_espera: boolean; puesto_espera: number | null; notas: string | null;
  ficha: FichaPostulacion | null;
  ranking: { posicion: number | null; puntaje_total: number | null; rsh: string | null } | null;
  entrevistas: EntrevistaFinalista[];
  sugerencia: { apreciacion: Apreciacion; etapa: string; resultado: Resultado } | null;
}
/**
 * RSH del finalista. Igual que en el backend (common/rsh.ts): manda el Excel del ranking y la ficha
 * (tramo leído de la cartola) es el respaldo, también cuando el ranking dice "P" y después se cargó la cartola.
 * valor = porcentaje; pendiente = no hay porcentaje y está marcado como pendiente.
 */
function rshDe(f: Finalista): { valor: number | null; pendiente: boolean } {
  const r = f.ranking?.rsh;
  const tramo = f.ficha?.tramo_rsh ?? null;
  if (r !== null && r !== undefined && String(r).trim() !== '') {
    const s = String(r).trim();
    if (/^p/i.test(s)) return tramo !== null ? { valor: tramo, pendiente: false } : { valor: null, pendiente: true };
    const n = Number(s.replace('%', '').replace(',', '.'));
    if (Number.isFinite(n)) return { valor: n > 0 && n <= 1 ? Math.round(n * 100) : n, pendiente: false };
  }
  if (tramo !== null) return { valor: tramo, pendiente: false };
  return { valor: null, pendiente: !!f.ficha?.rsh_pendiente };
}
const textoRsh = (f: Finalista) => { const r = rshDe(f); return r.pendiente ? 'Pendiente' : r.valor !== null ? `${r.valor}%` : null; };
function EtiquetaRshFinalista({ f }: { f: Finalista }) {
  const r = rshDe(f);
  if (r.pendiente) return <Etiqueta tono="amarillo">RSH pendiente</Etiqueta>;
  return r.valor !== null ? <Etiqueta>RSH {r.valor}%</Etiqueta> : null;
}

interface VistaSeleccion {
  etapa: { id: string; orden: number; nombre: string; cupo: number | null; estado: string };
  resumen: {
    cupo: number | null; total: number; becarios_confirmados: number; marcados_pasa: number; marcados_no_pasa: number; en_espera: number; sin_decidir: number;
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

type Filtro = 'todos' | 'sin-decidir' | 'seleccionados' | 'en-espera' | 'no-seleccionados' | 'sin-apreciacion' | 'aceptaria' | 'con-dudas' | 'no-aceptaria';
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
  // La ficha navega por la lista tal como estaba al abrirla (así, si marcar una decisión saca al estudiante
  // del filtro actual, las flechas no se pierden).
  const [abierto, setAbierto] = useState<string | null>(null);
  const [recorrido, setRecorrido] = useState<string[]>([]);
  const [mandando, setMandando] = useState(false);
  const [marcadas, setMarcadas] = useState<string[]>([]); // para comparar (máximo 3)
  const [comparando, setComparando] = useState(false);
  const [bajandoExcel, setBajandoExcel] = useState(false);

  const navegar = useNavigate();
  const refrescar = () => CLAVES.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const errorAviso = (e: Error) => avisar(e.message, 'error');

  const marcar = useMutation({
    mutationFn: (x: { f: Finalista; decision: Eleccion }) => api.put(`/seleccion/${etapaId}/estudiantes/${x.f.id}/decision`, { decision: x.decision }),
    onSuccess: refrescar, onError: errorAviso,
  });
  const sugerencias = useMutation({
    mutationFn: () => api.post<{ marcados: number }>(`/seleccion/${etapaId}/aplicar-sugerencias`),
    onSuccess: (r) => { avisar(r.marcados ? `${r.marcados} marcados según su apreciación` : 'No había estudiantes nuevos para marcar', 'info'); refrescar(); },
    onError: errorAviso,
  });
  // «Enviar a los directivos»: se guarda el Excel y se abre Comunicación con el correo ya armado.
  const prepararCorreo = useMutation({
    mutationFn: () => api.post<{ id: string; nombre: string }>(`/seleccion/${etapaId}/excel-adjunto`, {}),
    onSuccess: (a) => navegar(`/comunicacion?nuevo=1&proposito=INFORME_DIRECTIVOS&adjunto=${a.id}&adjuntoNombre=${encodeURIComponent(a.nombre)}`),
    onError: errorAviso,
  });

  const bajarExcel = async () => {
    if (!v) return;
    setBajandoExcel(true);
    try { await api.descargar(`/seleccion/${etapaId}/excel`, `Selección final - ${v.etapa.nombre}.xlsx`); }
    catch (err) { avisar((err as Error).message, 'error'); }
    finally { setBajandoExcel(false); }
  };
  const alternarComparar = (id: string) => setMarcadas((m) => (m.includes(id) ? m.filter((x) => x !== id) : m.length >= 3 ? m : [...m, id]));
  const abrirFicha = (id: string) => { setRecorrido(lista.map((x) => x.id)); setAbierto(id); };

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
        case 'sin-decidir': return !f.confirmado && !f.resultado && !f.en_espera;
        case 'seleccionados': return f.resultado === 'PASA';
        case 'en-espera': return f.en_espera;
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="tarjeta col-span-2 p-3 md:col-span-2">
          <div className={`text-xl font-bold ${sobreCupo ? 'text-red-700' : ''}`}>
            {pasanTodos}{r.cupo !== null && <span className="text-sm font-normal text-gray-400"> de {r.cupo}</span>}
          </div>
          <div className="text-xs text-gray-500">{r.cupo !== null ? 'becas asignadas / cupo' : 'becas asignadas (sin cupo definido)'}</div>
          {r.cupo !== null && (
            <>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={r.cupo} aria-valuenow={pasanTodos}>
                <div className={`h-2 rounded-full ${sobreCupo ? 'bg-red-500' : 'bg-green-600'}`} style={{ width: `${Math.min(100, (pasanTodos / r.cupo) * 100)}%` }} />
              </div>
              <div className={`mt-1 text-[11px] ${sobreCupo ? 'font-medium text-red-700' : 'text-gray-500'}`}>
                {sobreCupo ? `Se pasan del cupo por ${pasanTodos - r.cupo}` : r.cupo - pasanTodos === 0 ? 'Cupo completo' : `${r.cupo - pasanTodos} cupos libres`}
              </div>
            </>
          )}
        </div>
        <div className="tarjeta p-3"><div className="text-xl font-bold text-green-700">{r.becarios_confirmados}</div><div className="text-xs text-gray-500">becarios confirmados</div></div>
        <div className="tarjeta p-3"><div className="text-xl font-bold text-green-700">{r.marcados_pasa}</div><div className="text-xs text-gray-500">seleccionados sin confirmar</div></div>
        <div className="tarjeta p-3"><div className="text-xl font-bold text-amber-700">{r.en_espera}</div><div className="text-xs text-gray-500">en lista de espera</div></div>
        <div className="tarjeta p-3"><div className="text-xl font-bold">{r.sin_decidir}</div><div className="text-xs text-gray-500">sin decidir <span className="text-red-700">· {r.marcados_no_pasa} no sel.</span></div></div>
      </div>
      {sobreCupo && <Caja tono="amarillo">Hay más becas asignadas ({pasanTodos}) que el cupo ({r.cupo}). Revísalo antes de mandar a Resultados.</Caja>}
      {r.cupos_libres !== null && r.cupos_libres > 0 && r.sin_decidir === 0 && pendientesDeConfirmar === 0 && (
        <Caja tono="azul">Quedan {r.cupos_libres} cupos sin asignar.</Caja>
      )}

      <div className="tarjeta flex flex-wrap items-center gap-2 p-3">
        {!soloLectura && (
          <>
            <button className="btn-secundario" disabled={!sugeridos || sugerencias.isPending} onClick={() => sugerencias.mutate()}
              title="Marca “seleccionado” a quien la entrevista dice que aceptaría y “no seleccionado” a quien no aceptaría. Las marcas son provisorias y se pueden cambiar.">
              ✓ Marcar según apreciación ({sugeridos})
            </button>
            <button className="btn-primario" disabled={!pendientesDeConfirmar} onClick={() => setMandando(true)}
              title="Las marcas pasan a Resultados, donde se confirman. Nada es definitivo hasta confirmar allá.">
              Mandar a Resultados ({pendientesDeConfirmar})
            </button>
          </>
        )}
        <button className="btn-secundario" disabled={marcadas.length < 2} onClick={() => setComparando(true)}
          title="Marca de 2 a 3 finalistas en la tabla (casilla de la izquierda) para verlos lado a lado">
          Comparar ({marcadas.length})
        </button>
        {marcadas.length > 0 && <button className="text-xs text-gray-500 underline hover:text-gray-800" onClick={() => setMarcadas([])}>quitar selección</button>}
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="btn-excel" disabled={bajandoExcel} onClick={bajarExcel}
            title="Excel con lo importante de cada finalista: ranking, notas, RSH, apreciación, observaciones y decisión">
            {bajandoExcel ? 'Preparando…' : <><Icono tipo="bajar" /> Exportar a Excel</>}
          </button>
          {!soloLectura && (
            <button className="btn-secundario" disabled={prepararCorreo.isPending} onClick={() => prepararCorreo.mutate()}
              title="Abre Comunicación con el Excel adjunto y una plantilla para los directivos">
              {prepararCorreo.isPending ? 'Preparando…' : 'Enviar a los directivos'}
            </button>
          )}
        </div>
        {!soloLectura && <p className="w-full text-xs text-gray-500">“Aceptaría con dudas” no se marca solo: lo decide una persona, caso por caso. Quien queda “en espera” no se confirma: sigue aquí por si se libera un cupo. La confirmación y el aviso a los estudiantes se hacen en Resultados.</p>}
      </div>

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
            <option value="en-espera">En espera</option>
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
                <th className="w-8" />
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
                comparar={marcadas.includes(f.id)} sinCupoParaComparar={marcadas.length >= 3 && !marcadas.includes(f.id)} onComparar={() => alternarComparar(f.id)}
                onAbrir={() => abrirFicha(f.id)} onMarcar={(decision) => marcar.mutate({ f, decision })} />)}
            </tbody>
          </table>
        </div>
      )}

      {fichaAbierta && (() => {
        const i = recorrido.indexOf(fichaAbierta.id);
        const ir = (d: number) => { const id = recorrido[i + d]; if (id && v.candidatos.some((x) => x.id === id)) setAbierto(id); };
        return (
          <FichaFinalista key={fichaAbierta.id} f={fichaAbierta} soloLectura={soloLectura} ocupado={marcar.isPending}
            etapaId={etapaId} posicion={i >= 0 ? i + 1 : null} total={recorrido.length}
            onAnterior={i > 0 ? () => ir(-1) : null} onSiguiente={i >= 0 && i < recorrido.length - 1 ? () => ir(1) : null}
            onCerrar={() => setAbierto(null)} onCambio={refrescar} onMarcar={(decision) => marcar.mutate({ f: fichaAbierta, decision })} />
        );
      })()}

      {comparando && (
        <Comparador finalistas={marcadas.map((id) => v.candidatos.find((x) => x.id === id)).filter((x): x is Finalista => !!x)}
          soloLectura={soloLectura} ocupado={marcar.isPending} onCerrar={() => setComparando(false)}
          onAbrir={(id) => { setComparando(false); abrirFicha(id); }} onMarcar={(f, decision) => marcar.mutate({ f, decision })} />
      )}

      {mandando && (
        <Modal titulo="Mandar a Resultados" onCerrar={() => setMandando(false)} ancho="max-w-md"
          pie={<>
            <button className="btn-secundario" onClick={() => setMandando(false)}>Seguir aquí</button>
            <button className="btn-primario" onClick={() => navegar(`/avance/${etapaId}`)}>Ir a Resultados</button>
          </>}>
          <div className="space-y-2 text-sm">
            <p>Tus marcas ya están guardadas: <strong>{r.marcados_pasa}</strong> seleccionados/as y <strong>{r.marcados_no_pasa}</strong> no seleccionados/as.</p>
            {sobreCupo && <p className="text-red-700">Ojo: hay {pasanTodos} becas asignadas y el cupo es {r.cupo}.</p>}
            {r.en_espera > 0 && <p><strong>{r.en_espera}</strong> en lista de espera siguen aquí, sin confirmar.</p>}
            <p className="text-gray-500">Todavía nada es definitivo: en Resultados se revisa, se confirma y se avisa a los estudiantes. Mientras tanto puedes volver a esta pantalla y cambiar lo que quieras.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Botones de decisión: se usan en la tabla, en la ficha y en el comparador. */
function Decision({ f, soloLectura, ocupado, onMarcar }: { f: Finalista; soloLectura: boolean; ocupado: boolean; onMarcar: (d: Eleccion) => void }) {
  if (f.confirmado) return f.resultado === 'PASA' ? <Etiqueta tono="verde">Becario/a</Etiqueta> : <Etiqueta tono="rojo">No seleccionado/a</Etiqueta>;
  const actual: Eleccion = f.resultado ?? (f.en_espera ? 'ESPERA' : null);
  if (soloLectura) {
    return actual === 'PASA' ? <Etiqueta tono="verde">Seleccionado/a</Etiqueta>
      : actual === 'NO_PASA' ? <Etiqueta tono="rojo">No seleccionado/a</Etiqueta>
      : actual === 'ESPERA' ? <Etiqueta tono="amarillo">En espera · N°{f.puesto_espera}</Etiqueta>
      : <span className="text-xs text-gray-400">sin decidir</span>;
  }
  const boton = (d: 'PASA' | 'ESPERA' | 'NO_PASA', texto: string, activo: string, hover: string) => (
    <button disabled={ocupado} aria-pressed={actual === d} onClick={() => onMarcar(actual === d ? null : d)}
      className={`whitespace-nowrap rounded-md border px-2.5 py-1 text-xs ${actual === d ? activo : `border-gray-300 bg-white text-gray-700 ${hover}`}`}>{texto}</button>
  );
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {boton('PASA', 'Seleccionar', 'border-green-600 bg-green-600 text-white', 'hover:bg-green-50')}
      {boton('ESPERA', actual === 'ESPERA' && f.puesto_espera ? `En espera · N°${f.puesto_espera}` : 'En espera', 'border-amber-500 bg-amber-500 text-white', 'hover:bg-amber-50')}
      {boton('NO_PASA', 'No seleccionar', 'border-red-600 bg-red-600 text-white', 'hover:bg-red-50')}
    </div>
  );
}

function FilaFinalista({ f, soloLectura, ocupado, comparar, sinCupoParaComparar, onComparar, onAbrir, onMarcar }: {
  f: Finalista; soloLectura: boolean; ocupado: boolean; comparar: boolean; sinCupoParaComparar: boolean;
  onComparar: () => void; onAbrir: () => void; onMarcar: (d: Eleccion) => void;
}) {
  const avisar = useAviso();
  const ap = apreciacionActual(f);
  const bajar = async (e: EntrevistaFinalista) => {
    try { await api.descargar(`/entrevistas/${e.etapa_id}/estudiantes/${f.id}/pauta-completada`, e.pauta?.nombre ?? `Pauta ${f.codigo}.docx`); }
    catch (err) { avisar((err as Error).message, 'error'); }
  };
  const rsh = <EtiquetaRshFinalista f={f} />;
  return (
    <tr className={f.resultado === 'PASA' ? 'bg-green-50/50' : f.resultado === 'NO_PASA' ? 'bg-red-50/40' : f.en_espera ? 'bg-amber-50/50' : ''}>
      <td className="w-8 text-center">
        <input type="checkbox" className="h-4 w-4 accent-marca-700" checked={comparar} disabled={sinCupoParaComparar} onChange={onComparar}
          aria-label={`Comparar a ${nombreCompleto(f)}`} title={sinCupoParaComparar ? 'Se pueden comparar hasta 3 finalistas' : 'Marcar para comparar'} />
      </td>
      <td className="text-center" title={f.ranking?.puntaje_total != null ? `Puntaje ${nota(f.ranking.puntaje_total)}` : 'Posición en el ranking'}>
        <div className="text-base font-bold text-gray-800">{f.ranking?.posicion ?? '—'}</div>
        {f.ranking?.puntaje_total != null && <div className="text-[10px] text-gray-400">{nota(f.ranking.puntaje_total)} pts</div>}
      </td>
      <td className="min-w-[200px]">
        <button className="text-left font-medium hover:underline" onClick={onAbrir}>{nombreCompleto(f)}</button>
        {f.notas && <span className="ml-1.5 rounded bg-gray-100 px-1 text-[10px] text-gray-500" title={f.notas}>nota</span>}
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
              {e.pauta
                ? <button className="btn-word btn-chico" onClick={() => bajar(e)} title={`Pauta completada de ${e.etapa} · subida ${fecha(e.pauta.subido_en)}`}><Icono tipo="bajar" /> {etiquetaEntrevista(e.etapa)}</button>
                : <span className="text-gray-400" title={`Sin pauta completada de ${e.etapa}`}>{etiquetaEntrevista(e.etapa)} · sin Word</span>}
              {e.estado && <span className={`whitespace-nowrap rounded border px-1 py-0.5 text-[10px] ${ESTADOS[e.estado].chip}`}>{ESTADOS[e.estado].texto}</span>}
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

/** Por qué se decidió así: lo escribe el comité, una nota por estudiante. */
function NotasComite({ f, etapaId, soloLectura, onCambio }: { f: Finalista; etapaId: string; soloLectura: boolean; onCambio: () => void }) {
  const avisar = useAviso();
  const [texto, setTexto] = useState(f.notas ?? '');
  const cambio = texto.trim() !== (f.notas ?? '');
  const guardar = useMutation({
    mutationFn: () => api.put(`/seleccion/${etapaId}/estudiantes/${f.id}/notas`, { notas: texto.trim() || null }),
    onSuccess: () => { avisar('Notas guardadas'); onCambio(); },
    onError: (err: Error) => avisar(err.message, 'error'),
  });
  if (soloLectura && !f.notas) return null;
  return (
    <section>
      <h3 className="subtitulo mb-2">Notas del comité</h3>
      <textarea rows={2} className="input" disabled={soloLectura} value={texto} maxLength={4000}
        placeholder="Por qué se decidió así, acuerdos, condiciones…" onChange={(ev) => setTexto(ev.target.value)} />
      {!soloLectura && (
        <div className="mt-1.5 flex items-center justify-end gap-2">
          {cambio && <span className="text-[11px] text-amber-700">Sin guardar</span>}
          <button className="btn-primario btn-chico" disabled={!cambio || guardar.isPending} onClick={() => guardar.mutate()}>Guardar notas</button>
        </div>
      )}
    </section>
  );
}

/** Línea fina de extremos redondeados para separar secciones. */
function Separador() {
  return <div className="my-5 h-[3px] w-full rounded-full bg-gray-200" role="separator" />;
}

function FichaFinalista({ f, soloLectura, ocupado, etapaId, posicion, total, onAnterior, onSiguiente, onCerrar, onCambio, onMarcar }: {
  f: Finalista; soloLectura: boolean; ocupado: boolean; etapaId: string; posicion: number | null; total: number;
  onAnterior: (() => void) | null; onSiguiente: (() => void) | null; onCerrar: () => void; onCambio: () => void; onMarcar: (d: Eleccion) => void;
}) {
  const fi = f.ficha;
  const ap = apreciacionActual(f);

  // Flechas del teclado para pasar de una ficha a otra (no se activan mientras se escribe).
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (ev.key === 'ArrowLeft' && onAnterior) onAnterior();
      if (ev.key === 'ArrowRight' && onSiguiente) onSiguiente();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onAnterior, onSiguiente]);

  return (
    <Modal titulo={nombreCompleto(f)} onCerrar={onCerrar} ancho="max-w-6xl"
      pie={<>
        <div className="mr-auto flex items-center gap-2">
          <button className="btn-secundario" disabled={!onAnterior} onClick={() => onAnterior?.()} title="Finalista anterior (flecha izquierda)">← Anterior</button>
          {posicion !== null && <span className="text-xs text-gray-500">{posicion} de {total}</span>}
          <button className="btn-secundario" disabled={!onSiguiente} onClick={() => onSiguiente?.()} title="Finalista siguiente (flecha derecha)">Siguiente →</button>
        </div>
        <button className="btn-secundario" onClick={onCerrar}>Cerrar</button>
      </>}>
      <div className="text-sm">
        <p className="-mt-1 mb-3 text-xs text-gray-500">
          <span className="font-mono text-gray-700">{f.codigo}</span> · {f.liceo}{f.comuna ? ` · ${f.comuna}` : ''}{f.curso ? ` · ${f.curso}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-gray-200 bg-gray-50 px-5 py-3">
          <div className="text-center"><div className="text-xl font-bold">{f.ranking?.posicion ?? '—'}</div><div className="text-[10px] uppercase text-gray-400">ranking</div></div>
          {f.ranking?.puntaje_total != null && <div className="text-center"><div className="text-xl font-bold">{nota(f.ranking.puntaje_total)}</div><div className="text-[10px] uppercase text-gray-400">puntaje</div></div>}
          {f.promedio !== null && <div className="text-center"><div className="text-xl font-bold">{nota(f.promedio)}</div><div className="text-[10px] uppercase text-gray-400">promedio</div></div>}
          <div className="flex flex-wrap items-center gap-1.5">
            <EtiquetaRshFinalista f={f} />
            {ap ? <span className={`rounded border px-1.5 py-0.5 text-xs ${APRECIACIONES[ap].chip}`}>{APRECIACIONES[ap].texto}</span> : <span className="text-xs text-gray-400">sin apreciación</span>}
          </div>
          <div className="ml-auto"><Decision f={f} soloLectura={soloLectura} ocupado={ocupado} onMarcar={onMarcar} /></div>
        </div>

        {/* A la izquierda, quién es; a la derecha, cómo le fue en las entrevistas. */}
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div>
            <section>
              <h3 className="subtitulo mb-3">Datos</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
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
              <>
                <Separador />
                <section>
                  <h3 className="subtitulo mb-3">Situación familiar (ficha RSH)</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    <Dato t="Tramo RSH" v={textoRsh(f)} />
                    <Dato t="Personas del hogar" v={SI_NO(fi.personas_hogar)} />
                    <Dato t="Ingresos del hogar" v={fi.ingresos_hogar} />
                    <Dato t="Menores de 18" v={SI_NO(fi.menores_18)} />
                    <Dato t="Mayores de 60" v={SI_NO(fi.mayores_60)} />
                    <Dato t="Con discapacidad" v={SI_NO(fi.con_discapacidad)} />
                    <Dato t="Con dependencia" v={SI_NO(fi.con_dependencia)} />
                    <Dato t="Con NEE" v={SI_NO(fi.con_nee)} />
                  </dl>
                  {fi.observaciones && <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-700">{fi.observaciones}</p>}
                </section>
              </>
            )}

            {(!soloLectura || f.notas) && (
              <>
                <Separador />
                <NotasComite f={f} etapaId={etapaId} soloLectura={soloLectura} onCambio={onCambio} />
              </>
            )}
          </div>

          <section className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
            <h3 className="subtitulo mb-3">Entrevistas</h3>
            {f.entrevistas.length === 0 && <p className="text-xs text-gray-500">Todavía no tiene entrevistas registradas.</p>}
            <div className="space-y-3">
              {f.entrevistas.map((e) => <BloqueEntrevista key={`${f.id}:${e.etapa_id}`} f={f} e={e} soloLectura={soloLectura} onCambio={onCambio} />)}
            </div>
          </section>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Comparador: de 2 a 3 finalistas lado a lado
// ---------------------------------------------------------------------------------------------------------

interface FilaComparacion {
  titulo: string;
  valor: (f: Finalista) => number | null;      // para decidir qué resaltar
  texto?: (f: Finalista) => ReactNode;          // lo que se muestra (si no, el valor)
  mejor?: 'mayor' | 'menor';                    // desempeño: el mejor valor se pinta de verde
  necesidad?: 'mayor' | 'menor';                // situación familiar: el valor de mayor necesidad se subraya (discreto)
}
const PUNTAJE_APRECIACION: Record<Apreciacion, number> = { ACEPTARIA: 3, ACEPTARIA_CON_DUDAS: 2, NO_ACEPTARIA: 1 };
const numFicha = (campo: 'personas_hogar' | 'menores_18' | 'mayores_60' | 'con_discapacidad' | 'con_dependencia' | 'con_nee') =>
  (f: Finalista) => f.ficha?.[campo] ?? null;

const GRUPOS_COMPARACION: { titulo: string; filas: FilaComparacion[] }[] = [
  { titulo: 'Desempeño', filas: [
    { titulo: 'Ranking', valor: (f) => f.ranking?.posicion ?? null, mejor: 'menor' },
    { titulo: 'Promedio', valor: (f) => f.promedio, texto: (f) => (f.promedio !== null ? nota(f.promedio) : null), mejor: 'mayor' },
    { titulo: 'Posición en el curso', valor: (f) => f.posicion_curso, mejor: 'menor' },
    { titulo: 'Apreciación', valor: (f) => { const a = apreciacionActual(f); return a ? PUNTAJE_APRECIACION[a] : null; },
      texto: (f) => { const a = apreciacionActual(f); return a ? APRECIACIONES[a].texto : null; }, mejor: 'mayor' },
  ] },
  { titulo: 'Situación familiar', filas: [
    // Tramo más bajo = hogar con menos recursos.
    { titulo: 'Tramo RSH', valor: (f) => rshDe(f).valor, texto: textoRsh, necesidad: 'menor' },
    { titulo: 'Personas del hogar', valor: numFicha('personas_hogar'), necesidad: 'mayor' },
    { titulo: 'Ingresos del hogar', valor: () => null, texto: (f) => f.ficha?.ingresos_hogar ?? null },
    { titulo: 'Menores de 18', valor: numFicha('menores_18'), necesidad: 'mayor' },
    { titulo: 'Mayores de 60', valor: numFicha('mayores_60'), necesidad: 'mayor' },
    { titulo: 'Con discapacidad', valor: numFicha('con_discapacidad'), necesidad: 'mayor' },
    { titulo: 'Con dependencia', valor: numFicha('con_dependencia'), necesidad: 'mayor' },
    { titulo: 'Con NEE', valor: numFicha('con_nee'), necesidad: 'mayor' },
  ] },
];

/** Posiciones (0, 1, 2) cuyo valor es el mejor según la regla. Si hay menos de dos valores o son todos iguales, ninguna. */
function extremos(valores: (number | null)[], regla: 'mayor' | 'menor' | undefined): Set<number> {
  const definidos = valores.filter((x): x is number => x !== null);
  if (!regla || definidos.length < 2 || definidos.every((x) => x === definidos[0])) return new Set();
  const meta = regla === 'mayor' ? Math.max(...definidos) : Math.min(...definidos);
  return new Set(valores.flatMap((x, i) => (x === meta ? [i] : [])));
}

function Comparador({ finalistas, soloLectura, ocupado, onCerrar, onAbrir, onMarcar }: {
  finalistas: Finalista[]; soloLectura: boolean; ocupado: boolean; onCerrar: () => void; onAbrir: (id: string) => void; onMarcar: (f: Finalista, d: Eleccion) => void;
}) {
  const observaciones = (f: Finalista) => f.entrevistas.filter((e) => e.observaciones).map((e) => `${etiquetaEntrevista(e.etapa)}: ${e.observaciones}`).join('\n');
  const columnas = `grid-cols-[150px_repeat(${finalistas.length},minmax(0,1fr))]`;
  return (
    <Modal titulo="Comparar finalistas" onCerrar={onCerrar} ancho="max-w-6xl" pie={<button className="btn-secundario" onClick={onCerrar}>Cerrar</button>}>
      <div className="overflow-x-auto text-sm">
        <div className={`grid min-w-[640px] ${columnas} gap-x-3`}>
          <div />
          {finalistas.map((f) => (
            <div key={f.id} className="border-b border-gray-200 pb-2">
              <button className="text-left font-semibold hover:underline" onClick={() => onAbrir(f.id)} title="Ver ficha completa">{nombreCompleto(f)}</button>
              <div className="text-xs text-gray-500"><span className="font-mono text-gray-700">{f.codigo}</span> · {f.liceo}</div>
            </div>
          ))}

          {GRUPOS_COMPARACION.map((g) => {
            const filas = g.filas.filter((fila) => finalistas.some((f) => (fila.texto ? fila.texto(f) : fila.valor(f)) !== null));
            if (!filas.length) return null;
            return (
              <div key={g.titulo} className="contents">
                <div className={`col-span-full mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400`}>{g.titulo}</div>
                {filas.map((fila) => {
                  const valores = finalistas.map(fila.valor);
                  const mejores = extremos(valores, fila.mejor);
                  const necesitan = extremos(valores, fila.necesidad);
                  return (
                    <div key={fila.titulo} className="contents">
                      <div className="border-b border-gray-100 py-1.5 text-xs text-gray-500">{fila.titulo}</div>
                      {finalistas.map((f, i) => {
                        const v = fila.texto ? fila.texto(f) : fila.valor(f);
                        const vacio = v === null || v === undefined || v === '';
                        return (
                          <div key={f.id} className={`border-b border-gray-100 px-1.5 py-1.5 ${mejores.has(i) ? 'rounded bg-green-50 font-semibold text-green-800' : ''}`}
                            title={mejores.has(i) ? 'Mejor de los comparados' : necesitan.has(i) ? 'Mayor necesidad de los comparados' : undefined}>
                            {vacio ? <span className="text-gray-300">—</span>
                              : necesitan.has(i) ? <span className="underline decoration-amber-500 decoration-2 underline-offset-4">{v}</span> : v}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {finalistas.some((f) => observaciones(f)) && (
            <div className="contents">
              <div className="col-span-full mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Entrevistas</div>
              <div className="border-b border-gray-100 py-1.5 text-xs text-gray-500">Observaciones</div>
              {finalistas.map((f) => <div key={f.id} className="whitespace-pre-line border-b border-gray-100 px-1.5 py-1.5 text-xs text-gray-700">{observaciones(f) || <span className="text-gray-300">—</span>}</div>)}
            </div>
          )}
          {finalistas.some((f) => f.notas) && (
            <div className="contents">
              <div className="border-b border-gray-100 py-1.5 text-xs text-gray-500">Notas del comité</div>
              {finalistas.map((f) => <div key={f.id} className="whitespace-pre-line border-b border-gray-100 px-1.5 py-1.5 text-xs text-gray-700">{f.notas || <span className="text-gray-300">—</span>}</div>)}
            </div>
          )}

          <div className="contents">
            <div className="py-3 text-xs text-gray-500">Decisión</div>
            {finalistas.map((f) => (
              <div key={f.id} className="py-2"><div className="flex justify-start"><Decision f={f} soloLectura={soloLectura} ocupado={ocupado} onMarcar={(d) => onMarcar(f, d)} /></div></div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-500">
        <span><span className="rounded bg-green-50 px-1.5 py-0.5 font-semibold text-green-800">verde</span> mejor desempeño de los comparados</span>
        <span><span className="underline decoration-amber-500 decoration-2 underline-offset-4">subrayado</span> mayor necesidad (hogar con menos recursos o más cargas)</span>
        <span>Sin marca cuando los valores son iguales o falta el dato.</span>
      </p>
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
            ? <button className="btn-word btn-chico" disabled={bajando} onClick={bajar} title={`Subida el ${fecha(e.pauta.subido_en)}`}>{bajando ? 'Preparando…' : <><Icono tipo="bajar" /> Pauta completada (Word)</>}</button>
            : <span className="text-xs text-gray-400">Sin pauta completada</span>}
          {!soloLectura && (
            <button className="btn-word-suave btn-chico" disabled={subiendo} onClick={() => entrada.current?.click()}
              title="Sube el Word de la pauta ya rellenado después de la entrevista">
              {subiendo ? 'Subiendo…' : <><Icono tipo="carpeta" /> {e.pauta ? 'Reemplazar' : 'Subir Word completado'}</>}
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