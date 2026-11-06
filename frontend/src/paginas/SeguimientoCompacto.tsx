import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, GrillaHitos, HitosEtapa } from '../api';
import { Cargando, ErrorCarga } from '../ui';
import { TablaSeguimiento } from './Seguimiento';

// Versiones resumidas de "Seguimiento por liceo":
//  - SeguimientoInicio: cuadro del Inicio con los hitos de la etapa en curso.
//  - IndicadorSeguimiento / SeguimientoConcurso: para Concursos anteriores.
// Si el cliente pide cambios en cómo se ve el seguimiento resumido, se hacen aquí.

type Fila = GrillaHitos['filas'][number];
type Hito = GrillaHitos['catalogo'][number];

/** Cuántos liceos se muestran antes de "Ver los N". */
const VISIBLES = 5;

/** Liceos que cuentan: los que no participan nunca completarán sus hitos. */
function participantes(filas: Fila[]) {
  return filas.filter((f) => f.participacion !== 'NO_PARTICIPA');
}
function hechos(f: Fila, catalogo: Hito[]) {
  return catalogo.filter((h) => f.hitos[h.codigo]?.completado).length;
}

function Barra({ valor, total, tono = 'bg-green-600' }: { valor: number; total: number; tono?: string }) {
  const pct = total ? Math.round((valor / total) * 100) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={valor} aria-valuemax={total}>
      <div className={`h-full rounded-full ${tono} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Un punto por hito: verde = hecho, naranjo = el siguiente que falta, gris = pendiente. */
function Puntos({ f, catalogo }: { f: Fila; catalogo: Hito[] }) {
  const siguiente = catalogo.find((h) => !f.hitos[h.codigo]?.completado);
  return (
    <span className="flex flex-shrink-0 items-center gap-1" aria-hidden="true">
      {catalogo.map((h) => {
        const hecho = !!f.hitos[h.codigo]?.completado;
        const color = hecho ? 'bg-green-600' : h.codigo === siguiente?.codigo ? 'bg-amber-400' : 'bg-gray-200';
        return <span key={h.codigo} title={`${h.nombre}: ${hecho ? 'hecho' : 'pendiente'}`} className={`h-2.5 w-2.5 rounded-full ${color}`} />;
      })}
    </span>
  );
}

/** Cuadro del Inicio: qué liceos van atrasados en los hitos de la etapa y qué les falta. Solo lectura. */
export function SeguimientoInicio({ etapaId }: { etapaId: string }) {
  const [todos, setTodos] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['hitos-etapa', etapaId],
    queryFn: () => api.get<HitosEtapa>(`/hitos/etapa/${etapaId}`),
  });
  if (isLoading) return <section className="tarjeta p-5"><Cargando /></section>;
  if (error || !data) return <ErrorCarga error={error} />;

  const { catalogo } = data;
  const filas = participantes(data.filas);
  if (!catalogo.length || !filas.length) return null;

  const alDia = filas.filter((f) => hechos(f, catalogo) === catalogo.length).length;
  const pendientes = filas
    .filter((f) => hechos(f, catalogo) < catalogo.length)
    .sort((a, b) => hechos(a, catalogo) - hechos(b, catalogo) || a.codigo.localeCompare(b.codigo));
  const visibles = todos ? pendientes : pendientes.slice(0, VISIBLES);
  const noParticipan = data.filas.length - filas.length;

  return (
    <section className="tarjeta overflow-hidden" aria-label="Seguimiento por liceo">
      <div className="px-5 pb-3 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="subtitulo">Seguimiento por liceo</h2>
            <span className="text-xs text-gray-500">
              {alDia} de {filas.length} liceos al día
              {noParticipan > 0 && ` · ${noParticipan} no participan`}
            </span>
          </div>
          <Link to="/seguimiento" className="text-sm font-semibold text-marca-700 hover:underline">Ver tabla completa →</Link>
        </div>
        <div className="mt-3"><Barra valor={alDia} total={filas.length} /></div>
      </div>

      {pendientes.length === 0 ? (
        <p className="border-t border-gray-100 px-5 py-3 text-sm text-green-800">Todos los liceos tienen sus hitos al día.</p>
      ) : (
        <>
          <div className="border-t border-gray-100 px-5 pb-1 pt-2.5 text-xs text-gray-500">
            Con pendientes ({pendientes.length}) · los más atrasados primero
          </div>
          <ul className="divide-y divide-gray-100">
            {visibles.map((f) => {
              const falta = catalogo.find((h) => !f.hitos[h.codigo]?.completado)!;
              return (
                <li key={f.id} className="grid grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1fr)] items-center gap-4 px-5 py-2 text-sm">
                  <Link to={`/liceos/${f.id}`} className="truncate hover:underline">
                    <span className="text-gray-400">{f.codigo}.</span> {f.nombre}
                  </Link>
                  <Puntos f={f} catalogo={catalogo} />
                  <span className="truncate text-xs text-amber-700" title={falta.nombre}>Falta: {falta.nombre.toLowerCase()}</span>
                </li>
              );
            })}
          </ul>
          {pendientes.length > VISIBLES && (
            <button onClick={() => setTodos(!todos)} className="w-full border-t border-gray-100 px-5 py-2 text-left text-sm text-gray-600 hover:bg-gray-50">
              {todos ? 'Mostrar menos' : `Ver los ${pendientes.length} liceos con pendientes`}
            </button>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 bg-gray-50/60 px-5 py-2 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-green-600" />hecho</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />siguiente</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-gray-200" />pendiente</span>
        <span className="ml-auto">{data.todos ? 'Todos los hitos (esta etapa no tiene hitos propios)' : `Hitos de la etapa: ${catalogo.length}`}</span>
      </div>
    </section>
  );
}

function useSeguimientoConcurso(anio: number) {
  return useQuery({
    queryKey: ['hitos-concurso', anio],
    queryFn: () => api.get<GrillaHitos>(`/hitos/concurso/${anio}`),
  });
}

/** Indicador para el Resumen de un concurso: % de hitos cumplidos y avance de cada hito. */
export function IndicadorSeguimiento({ anio, onVerTodo }: { anio: number; onVerTodo: () => void }) {
  const { data } = useSeguimientoConcurso(anio);
  if (!data) return null;
  const filas = participantes(data.filas);
  const { catalogo } = data;
  if (!filas.length || !catalogo.length) return null;

  const total = filas.length * catalogo.length;
  const cumplidos = filas.reduce((s, f) => s + hechos(f, catalogo), 0);
  const completos = filas.filter((f) => hechos(f, catalogo) === catalogo.length).length;
  const pct = Math.round((cumplidos / total) * 100);
  const porHito = catalogo.map((h) => ({ h, n: filas.filter((f) => f.hitos[h.codigo]?.completado).length }));

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="subtitulo text-base">Seguimiento de liceos</h2>
        <button onClick={onVerTodo} className="text-sm font-semibold text-marca-700 hover:underline">Ver tabla por liceo →</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]">
        <div className="tarjeta rounded-xl px-5 py-4">
          <div className="text-xs text-gray-500">Hitos cumplidos</div>
          <div className={`mt-1 text-3xl font-bold tabular-nums ${pct === 100 ? 'text-green-800' : 'text-gray-900'}`}>{pct}%</div>
          <div className="mt-2"><Barra valor={cumplidos} total={total} /></div>
          <div className="mt-3 text-sm text-gray-700">{completos} de {filas.length} liceos con todo completo</div>
        </div>
        <div className="tarjeta rounded-xl px-5 py-4">
          <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {porHito.map(({ h, n }) => (
              <li key={h.codigo} className="grid grid-cols-[minmax(0,1fr)_5rem_2.75rem] items-center gap-2 text-xs">
                <span className="truncate text-gray-700" title={h.nombre}>{h.nombre}</span>
                <Barra valor={n} total={filas.length} tono={n === filas.length ? 'bg-green-600' : 'bg-marca-600'} />
                <span className="text-right tabular-nums text-gray-500">{n}/{filas.length}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** Pestaña "Seguimiento" de un concurso: la tabla completa en solo lectura. */
export function SeguimientoConcurso({ anio }: { anio: number }) {
  const { data, isLoading, error } = useSeguimientoConcurso(anio);
  if (isLoading) return <Cargando />;
  if (error || !data) return <ErrorCarga error={error} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">Así quedó el seguimiento de cada liceo. Es solo de consulta: no se puede modificar.</p>
      <TablaSeguimiento data={data} />
    </div>
  );
}
