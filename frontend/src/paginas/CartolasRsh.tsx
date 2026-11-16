import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { DATOS_DE_CARTOLA, datosFaltantes } from '../cartolas';
import { Cargando, Caja, ErrorCarga, Etiqueta, fecha, Vacio } from '../ui';
import { CargarRsh, EstudianteRsh } from './CargarRsh';

/**
 * Cartolas RSH: la lista de estudiantes de Preselección N°1 con el estado de su ficha del hogar.
 * Desde aquí se carga el RSH de UN estudiante ya elegido (desde el PDF o digitado a mano, con vista previa),
 * o se abre la carga masiva de varios PDF. Se puede llegar con `?cargar=<id>` (por ejemplo desde «completar ficha»
 * en Resultados): el estudiante queda asignado y la carga se abre lista para usar.
 */

interface FilaEstado {
  id: string; codigo: string; nombres: string; apellido_paterno: string; apellido_materno: string | null;
  liceo_id: string; liceo_codigo: string; liceo: string;
  ficha: Record<string, unknown> | null; ranking: number | null;
  cartola: { emitida_en: string | null; leida_en: string; cantidad: number } | null;
}
interface Estado { diasMaximos: number; estudiantes: FilaEstado[] }

type EstadoCartola = 'AL_DIA' | 'ANTIGUA' | 'MANUAL' | 'SIN';
type Filtro = 'todos' | EstadoCartola | 'incompleta';

const DIA = 24 * 3600 * 1000;
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nombreDe = (f: FilaEstado) => `${f.apellido_paterno}${f.apellido_materno ? ' ' + f.apellido_materno : ''}, ${f.nombres}`;

/** Cartola leída (al día o antigua), datos digitados a mano sin cartola, o nada. */
function estadoCartola(f: FilaEstado, diasMaximos: number): EstadoCartola {
  if (f.cartola) {
    const emitida = f.cartola.emitida_en ? new Date(f.cartola.emitida_en + 'T00:00:00Z').getTime() : null;
    return emitida !== null && (Date.now() - emitida) / DIA > diasMaximos ? 'ANTIGUA' : 'AL_DIA';
  }
  const faltan = datosFaltantes(f.ficha);
  return f.ficha && faltan !== null && faltan < DATOS_DE_CARTOLA.length ? 'MANUAL' : 'SIN';
}

const TEXTO_FILTRO: Record<Filtro, string> = {
  todos: 'Todos', SIN: 'Sin cartola ni datos', AL_DIA: 'Con cartola al día', ANTIGUA: 'Con cartola antigua',
  MANUAL: 'Digitada a mano', incompleta: 'Ficha incompleta',
};

export function CartolasRsh() {
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error } = useQuery({ queryKey: ['cartolas', 'estado'], queryFn: () => api.get<Estado>('/cartolas/estado') });
  const [busca, setBusca] = useState('');
  const [liceo, setLiceo] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const filas = useMemo(() => (data?.estudiantes ?? []).map((f) => ({ f, cartola: estadoCartola(f, data?.diasMaximos ?? 365), faltan: datosFaltantes(f.ficha) })), [data]);
  const liceos = useMemo(() => {
    const m = new Map<string, string>();
    for (const { f } of filas) m.set(f.liceo_id, `${f.liceo_codigo}. ${f.liceo}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true }));
  }, [filas]);

  const lista = useMemo(() => {
    const q = sinTildes(busca.trim());
    return filas.filter(({ f, cartola, faltan }) => {
      if (q && !sinTildes(`${nombreDe(f)} ${f.nombres} ${f.codigo} ${f.liceo}`).includes(q)) return false;
      if (liceo && f.liceo_id !== liceo) return false;
      if (filtro === 'todos') return true;
      if (filtro === 'incompleta') return faltan === null || faltan > 0;
      return cartola === filtro;
    });
  }, [filas, busca, liceo, filtro]);

  const abierto = useMemo(() => {
    const id = params.get('cargar');
    return id ? data?.estudiantes.find((x) => x.id === id) ?? null : null;
  }, [params, data]);
  const abrir = (id: string) => setParams({ cargar: id });
  const cerrar = () => setParams({}, { replace: true });

  if (isLoading) return <Cargando />;
  if (error || !data) return <ErrorCarga error={error} />;

  const cuenta = (c: EstadoCartola) => filas.filter((x) => x.cartola === c).length;
  const completas = filas.filter((x) => x.faltan === 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo">Cartolas RSH</h1>
          <p className="text-sm text-gray-500">Qué estudiantes ya tienen su cartola del Registro Social de Hogares cargada. Elige a quién cargarle los datos.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-secundario" to="/cartolas/masiva" title="Subir varias cartolas (PDF) a la vez: el sistema reconoce a cada estudiante por su nombre">Carga masiva (varios PDF)</Link>
          <Link className="btn-secundario" to="/avance">Volver a Resultados</Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {([
          ['Estudiantes', filas.length, 'text-gray-900'],
          ['Con cartola leída', cuenta('AL_DIA') + cuenta('ANTIGUA'), 'text-green-700'],
          ['Digitadas a mano', cuenta('MANUAL'), 'text-blue-700'],
          ['Sin cartola ni datos', cuenta('SIN'), 'text-red-700'],
          ['Fichas completas', completas, 'text-gray-900'],
        ] as const).map(([t, n, color]) => (
          <div key={t} className="tarjeta px-4 py-3"><div className={`text-2xl font-semibold ${color}`}>{n}</div><div className="text-xs text-gray-500">{t}</div></div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-gray-500">{lista.length === filas.length ? `${lista.length} estudiantes` : `${lista.length} de ${filas.length} estudiantes`}</span>
        <div className="flex flex-wrap gap-2">
          <input className="input w-auto min-w-[220px] py-1.5" placeholder="Buscar por nombre, Id o liceo" aria-label="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <select className="input w-auto max-w-[240px]" value={liceo} onChange={(e) => setLiceo(e.target.value)} aria-label="Filtrar por liceo">
            <option value="">Todos los liceos</option>
            {liceos.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          </select>
          <select className="input w-auto" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} aria-label="Filtrar por estado">
            {(Object.keys(TEXTO_FILTRO) as Filtro[]).map((k) => <option key={k} value={k}>{TEXTO_FILTRO[k]}</option>)}
          </select>
        </div>
      </div>

      {lista.length === 0 ? (
        <Vacio>{filas.length ? 'Ningún estudiante coincide con el filtro.' : 'Todavía no hay estudiantes en Preselección N°1.'}</Vacio>
      ) : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-14 text-center">Lugar</th>
                <th>Estudiante</th>
                <th>Datos del hogar</th>
                <th>Cartola</th>
                <th>Ficha</th>
                <th className="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(({ f, cartola, faltan }) => <Fila key={f.id} f={f} cartola={cartola} faltan={faltan} onCargar={() => abrir(f.id)} />)}
            </tbody>
          </table>
        </div>
      )}

      <Caja tono="azul">
        El PDF no se guarda: se lee, se te muestra lo que encontró junto al nombre del estudiante y de la cartola, y solo se guarda cuando confirmas.
        La cartola trae el RUT tapado, por eso el estudiante se reconoce por su nombre.
      </Caja>

      {abierto && (
        <CargarRsh onCerrar={cerrar} e={{
          id: abierto.id, codigo: abierto.codigo, nombres: abierto.nombres, apellido_paterno: abierto.apellido_paterno,
          apellido_materno: abierto.apellido_materno, liceo: abierto.liceo, ficha: abierto.ficha,
        } satisfies EstudianteRsh} />
      )}
    </div>
  );
}

function Fila({ f, cartola, faltan, onCargar }: { f: FilaEstado; cartola: EstadoCartola; faltan: number | null; onCargar: () => void }) {
  const ficha = f.ficha;
  const apoyo = ficha ? (Number(ficha.con_discapacidad) || 0) + (Number(ficha.con_dependencia) || 0) + (Number(ficha.con_invalidez) || 0) + (Number(ficha.con_nee) || 0) : 0;
  const personas = ficha?.personas_hogar as number | null | undefined;
  const tramo = ficha?.tramo_rsh as number | null | undefined;
  const ingresos = ficha?.ingresos_hogar as string | null | undefined;
  return (
    <tr>
      <td className="text-center text-sm font-semibold text-gray-700">{f.ranking ?? <span className="font-normal text-gray-300">—</span>}</td>
      <td className="min-w-[220px]">
        <div className="font-medium">{nombreDe(f)}</div>
        <div className="max-w-[260px] truncate text-xs text-gray-500" title={f.liceo}><span className="font-mono text-gray-700">{f.codigo}</span> · {f.liceo}</div>
      </td>
      <td className="min-w-[170px] text-xs">
        {!ficha || (personas == null && tramo == null && !ingresos) ? <span className="text-gray-300">sin datos</span> : (
          <div className="space-y-0.5">
            <div className="text-gray-800">
              {personas ? `${personas} personas` : 'Personas sin dato'}
              {apoyo > 0 && <span className="text-gray-400"> · {apoyo} con apoyo</span>}
              {tramo != null && <span className="text-gray-400"> · tramo {tramo}%</span>}
            </div>
            {ingresos && <div className="max-w-[220px] truncate text-gray-500" title={ingresos}>{ingresos}</div>}
          </div>
        )}
      </td>
      <td className="whitespace-nowrap">
        {cartola === 'AL_DIA' && <Etiqueta tono="verde">Cargada</Etiqueta>}
        {cartola === 'ANTIGUA' && <Etiqueta tono="amarillo">Cartola antigua</Etiqueta>}
        {cartola === 'MANUAL' && <Etiqueta tono="azul">Digitada a mano</Etiqueta>}
        {cartola === 'SIN' && <Etiqueta tono="rojo">Sin cartola</Etiqueta>}
        {f.cartola && (
          <div className="mt-0.5 text-[11px] text-gray-500">
            {f.cartola.emitida_en ? `emitida ${fecha(f.cartola.emitida_en + 'T12:00:00', false)}` : `leída ${fecha(f.cartola.leida_en, false)}`}
            {f.cartola.cantidad > 1 ? ` · ${f.cartola.cantidad} cargas` : ''}
          </div>
        )}
      </td>
      <td className="whitespace-nowrap text-xs">
        {faltan === 0 ? <span className="text-green-700">Completa</span> : (
          <span className="text-gray-500">{faltan === null ? 'Sin ficha' : `Faltan ${faltan} dato${faltan === 1 ? '' : 's'}`}</span>
        )}
      </td>
      <td className="text-right">
        <button className={cartola === 'SIN' || faltan === null || faltan > 0 ? 'btn-primario btn-chico' : 'btn-secundario btn-chico'} onClick={onCargar}>
          {cartola === 'SIN' ? 'Cargar' : 'Actualizar'}
        </button>
      </td>
    </tr>
  );
}
