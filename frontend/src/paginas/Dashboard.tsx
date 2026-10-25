import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, Dashboard as D, GRUPOS, TareasEtapa } from '../api';
import { useEtapa } from '../etapa';
import { Caja, Cargando, ErrorCarga, EtiquetaParticipacion, fecha, Vacio } from '../ui';
import { TerminarEtapa } from './TerminarEtapa';

function Cifra({ valor, texto, detalle, tono }: { valor: number; texto: string; detalle?: string; tono?: string }) {
  return (
    <div className="tarjeta p-4">
      <div className={`text-2xl font-bold ${tono ?? 'text-gray-900'}`}>{valor}</div>
      <div className="mt-1 text-xs text-gray-500">{texto}</div>
      {detalle && <div className="mt-0.5 text-xs text-gray-400">{detalle}</div>}
    </div>
  );
}

/** Checklist de lo que hay que hacer en la etapa, con el botón para ir a hacerlo. */
function Tareas({ t, consultando, onTerminar }: { t: TareasEtapa; consultando: boolean; onTerminar: () => void }) {
  const hechas = t.tareas.filter((x) => x.hecha).length;
  return (
    <section className="tarjeta overflow-hidden" aria-label="Tareas de la etapa">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
        <div>
          <h2 className="subtitulo">{consultando ? 'Tareas de esta etapa' : 'Qué hacer ahora'}</h2>
          <p className="text-xs text-gray-500">{hechas} de {t.tareas.length} hechas</p>
        </div>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={hechas} aria-valuemax={t.tareas.length}>
          <div className="h-full rounded-full bg-green-600 transition-all" style={{ width: `${(hechas / Math.max(1, t.tareas.length)) * 100}%` }} />
        </div>
      </div>
      <ol className="divide-y divide-gray-100">
        {t.tareas.map((x, i) => (
          <li key={x.clave} className={`flex items-center gap-3 px-5 py-3 ${x.hecha ? 'bg-gray-50/60' : ''}`}>
            <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${x.hecha ? 'bg-green-600 text-white' : 'border-2 border-gray-300 text-gray-500'}`}>
              {x.hecha ? '✓' : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`text-sm ${x.hecha ? 'text-gray-500' : 'font-medium text-gray-900'}`}>{x.titulo}</div>
              <div className="text-xs text-gray-500">{x.detalle}</div>
            </div>
            {x.accion && (
              <Link to={x.accion.ruta} className={x.hecha ? 'text-xs text-gray-500 underline hover:text-gray-900' : 'btn-secundario btn-chico'}>
                {x.accion.texto}
              </Link>
            )}
          </li>
        ))}
      </ol>
      {!consultando && (
        <div className={`flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 ${t.lista ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
          <span className={`text-sm ${t.lista ? 'font-medium text-green-800' : 'text-gray-600'}`}>
            {t.lista
              ? (t.siguiente ? `Todo listo: puedes pasar a la etapa ${t.siguiente.orden}, ${t.siguiente.nombre}.` : 'Todo listo: es la última etapa.')
              : 'Cuando termines estas tareas, pasa a la etapa siguiente.'}
          </span>
          <button className={t.lista ? 'btn-primario' : 'btn-secundario btn-chico'} onClick={onTerminar}>
            {t.siguiente ? `Terminar etapa y pasar a ${t.siguiente.nombre}` : 'Terminar la última etapa'}
          </button>
        </div>
      )}
    </section>
  );
}

function CorreosPendientes({ data }: { data: D }) {
  return (
    <section>
      <h2 className="subtitulo mb-3">Correos esperando respuesta</h2>
      <div className="tarjeta divide-y divide-gray-100">
        {data.correosPendientes.length === 0 && <Vacio>No hay correos con respuestas pendientes.</Vacio>}
        {data.correosPendientes.map((c) => (
          <Link key={c.id} to={`/comunicacion/envios/${c.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50">
            <div className="min-w-0">
              <div className="truncate text-sm text-gray-800">{c.asunto}</div>
              <div className="text-xs text-gray-400">{GRUPOS[c.grupo]} · {fecha(c.enviado_en)}</div>
            </div>
            <div className="whitespace-nowrap text-sm">
              <span className="font-semibold text-yellow-700">{c.sin_respuesta}</span>
              <span className="text-gray-400"> de {c.total} sin responder</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function AvanceProceso({ data }: { data: D }) {
  const e = data.embudo;
  const max = Math.max(1, e.invitados, ...data.porEtapa.map((x) => x.llegaron));
  return (
    <div className="tarjeta p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-gray-600">Avance del proceso</span>
        <span className="text-xs text-gray-400">cuántos llegaron a cada etapa</span>
      </div>
      <dl className="space-y-2">
        <div className="grid grid-cols-[190px_1fr_90px] items-center gap-3 text-sm">
          <dt className="text-gray-600">Invitados</dt>
          <dd className="h-4 rounded bg-gray-100"><div className="h-4 rounded bg-gray-400" style={{ width: `${(e.invitados / max) * 100}%` }} /></dd>
          <dd className="text-right font-semibold tabular-nums">{e.invitados}</dd>
        </div>
        {data.porEtapa.map((x) => (
          <div key={x.id} className="grid grid-cols-[190px_1fr_90px] items-center gap-3 text-sm">
            <dt className={`truncate ${x.estado === 'ACTIVA' ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{x.orden}. {x.nombre}</dt>
            <dd className="relative h-4 rounded bg-gray-100">
              <div className={`h-4 rounded ${x.estado === 'PENDIENTE' ? 'bg-gray-300' : 'bg-gray-800'}`} style={{ width: `${(x.llegaron / max) * 100}%` }} />
              {x.cupo != null && x.cupo <= max && (
                <div className="absolute inset-y-[-3px] w-0.5 bg-red-500" style={{ left: `${(x.cupo / max) * 100}%` }} title={`Cupo: ${x.cupo}`} />
              )}
            </dd>
            <dd className="text-right tabular-nums">
              <span className="font-semibold">{x.llegaron}</span>
              {x.cupo != null && <span className="text-xs text-gray-400"> / {x.cupo}</span>}
            </dd>
          </div>
        ))}
        <div className="grid grid-cols-[190px_1fr_90px] items-center gap-3 text-sm">
          <dt className="text-gray-600">Becarios</dt>
          <dd className="h-4 rounded bg-gray-100"><div className="h-4 rounded bg-green-700" style={{ width: `${(e.becarios / max) * 100}%` }} /></dd>
          <dd className="text-right font-semibold tabular-nums">{e.becarios}</dd>
        </div>
      </dl>
      {data.porEtapa.some((x) => x.cupo != null) && <p className="mt-2 text-xs text-gray-400">La línea roja marca el cupo de la etapa.</p>}
    </div>
  );
}

/** Lo de la etapa 1: invitados, liceos y el detalle por liceo. */
function DatosInvitacion({ data }: { data: D }) {
  const { embudo: e, liceos: l } = data;
  const pct = (n: number) => (e.invitados ? `${Math.round((n / e.invitados) * 100)}% de los invitados` : undefined);
  return (
    <>
      <section>
        <h2 className="subtitulo mb-3">Invitación a estudiantes</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Cifra valor={e.invitados} texto="Invitados" />
          <Cifra valor={e.confirmaron} texto="Aceptaron postular" detalle={pct(e.confirmaron)} tono="text-green-700" />
          <Cifra valor={e.sin_respuesta} texto="Sin respuesta" tono={e.sin_respuesta ? 'text-yellow-600' : undefined} />
          <Cifra valor={e.rechazaron} texto="Rechazaron" />
        </div>
      </section>
      <section>
        <h2 className="subtitulo mb-3">Liceos</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Cifra valor={l.participan} texto="Participan" tono="text-green-700" detalle={`de ${l.total} liceos`} />
          <Cifra valor={l.sin_respuesta} texto="Sin respuesta" tono={l.sin_respuesta ? 'text-yellow-600' : undefined} />
          <Cifra valor={l.no_participan} texto="No participan" />
          <Cifra valor={l.con_nomina} texto="Nóminas recibidas" detalle={`faltan ${Math.max(0, l.total - l.no_participan - l.con_nomina)}`} />
        </div>
      </section>
      <CorreosPendientes data={data} />
      <section>
        <h2 className="subtitulo mb-3">Por liceo</h2>
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Liceo</th><th>Participación</th>
                <th className="text-right">Alumnos en nómina</th><th className="text-right">Invitados</th>
                <th className="text-right">Aceptaron</th><th className="text-right">Sin respuesta</th>
              </tr>
            </thead>
            <tbody>
              {data.porLiceo.map((x) => (
                <tr key={x.id}>
                  <td><Link to={`/liceos/${x.id}`} className="hover:underline"><span className="text-gray-400">{x.codigo}.</span> {x.nombre}</Link></td>
                  <td><EtiquetaParticipacion estado={x.participacion} /></td>
                  <td className="text-right tabular-nums">{x.alumnos_nomina || '—'}</td>
                  <td className="text-right tabular-nums">{x.invitados || '—'}</td>
                  <td className={`text-right tabular-nums ${x.confirmaron ? 'text-green-700' : ''}`}>{x.confirmaron || '—'}</td>
                  <td className={`text-right tabular-nums ${x.sin_respuesta ? 'text-yellow-700' : ''}`}>{x.sin_respuesta || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/**
 * Inicio: qué hacer en la etapa que se está mirando (la en curso, o una
 * terminada en modo consulta) y solo la información de esa etapa.
 */
export function Dashboard() {
  const { vista, consultando } = useEtapa();
  const [terminando, setTerminando] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<D>('/dashboard') });
  const { data: t, error: errorT } = useQuery({
    queryKey: ['tareas', vista?.id], enabled: !!vista,
    queryFn: () => api.get<TareasEtapa>(`/dashboard/tareas?etapaId=${vista!.id}`),
  });
  if (isLoading || !t) return errorT ? <ErrorCarga error={errorT} /> : <Cargando />;
  if (error || !data) return <ErrorCarga error={error} />;
  const r = t.resumen;

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {data.proceso.nombre} · Etapa {t.etapa.orden} de {t.total_etapas}{consultando ? ' (consulta)' : ''}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">{t.etapa.nombre}</h1>
        {t.etapa.descripcion && <p className="text-sm text-gray-500">{t.etapa.descripcion}</p>}
      </div>

      {data.rebotados > 0 && (
        <Caja tono="rojo">
          <strong>{data.rebotados} correo{data.rebotados > 1 ? 's no llegaron' : ' no llegó'}</strong> (rebotados o con error).{' '}
          <Link to="/comunicacion" className="underline">Revisar en Comunicación</Link>
        </Caja>
      )}

      <Tareas t={t} consultando={consultando} onTerminar={() => setTerminando(true)} />

      {t.etapa.tipo === 'INVITACION' ? <DatosInvitacion data={data} /> : (
        <>
          <section>
            <h2 className="subtitulo mb-3">Estudiantes en esta etapa</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Cifra valor={r.en_etapa} texto="Esperan una decisión" />
              <Cifra valor={r.pendientes_de_decidir} texto="Sin decidir" tono={r.pendientes_de_decidir ? 'text-yellow-600' : undefined} />
              <Cifra valor={r.marcados_pasa + r.confirmados_pasa} texto={t.siguiente ? 'Avanzan' : 'Becarios'} tono="text-green-700"
                detalle={t.etapa.cupo ? `cupo ${t.etapa.cupo}` : undefined} />
              <Cifra valor={r.confirmados_no_pasa + r.marcados_no_pasa} texto="No avanzan" />
            </div>
          </section>
          <AvanceProceso data={data} />
          <CorreosPendientes data={data} />
        </>
      )}

      {terminando && <TerminarEtapa etapaId={t.etapa.id} onCerrar={() => setTerminando(false)} />}
    </div>
  );
}