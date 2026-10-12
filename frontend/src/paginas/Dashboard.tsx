import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, Dashboard as D, GRUPOS } from '../api';
import { Caja, Cargando, ErrorCarga, EtiquetaParticipacion, fecha, Vacio } from '../ui';

function Cifra({ valor, texto, detalle, tono }: { valor: number; texto: string; detalle?: string; tono?: string }) {
  return (
    <div className="tarjeta p-4">
      <div className={`text-2xl font-bold ${tono ?? 'text-gray-900'}`}>{valor}</div>
      <div className="mt-1 text-xs text-gray-500">{texto}</div>
      {detalle && <div className="mt-0.5 text-xs text-gray-400">{detalle}</div>}
    </div>
  );
}

export function Dashboard() {
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<D>('/dashboard') });
  if (isLoading) return <Cargando />;
  if (error || !data) return <ErrorCarga error={error} />;
  const { embudo: e, liceos: l } = data;
  const pct = (n: number) => (e.invitados ? `${Math.round((n / e.invitados) * 100)}% de los invitados` : undefined);
  const max = Math.max(1, e.invitados, ...data.porEtapa.map((x) => x.llegaron));
  const p = data.pendientes;
  const sinConfirmar = p.resultados.filter((r) => r.sin_confirmar > 0);
  const sinAvisar = p.resultados.filter((r) => r.sin_avisar > 0);
  const hayAlertas = data.rebotados > 0 || e.sin_email > 0 || e.sin_respuesta > 0 || p.con_requisitos_pendientes > 0 || sinConfirmar.length > 0 || sinAvisar.length > 0;
  // Agrupa los requisitos pendientes por etapa para mostrarlos juntos.
  const reqPorEtapa = new Map<string, { etapa: string; items: { requisito: string; faltan: number }[] }>();
  for (const r of p.requisitos) {
    const g = reqPorEtapa.get(r.etapa_id) ?? { etapa: r.etapa, items: [] };
    g.items.push(r);
    reqPorEtapa.set(r.etapa_id, g);
  }

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="titulo">Dashboard</h1>
        <p className="text-sm text-gray-500">{data.proceso.nombre}</p>
      </div>

      {hayAlertas ? (
        <section className="tarjeta border-l-4 border-l-yellow-500 p-4" aria-label="Pendientes">
          <h2 className="subtitulo mb-3">Pendientes</h2>
          <ul className="space-y-3 text-sm">
            {[...reqPorEtapa].map(([id, g]) => (
              <li key={id}>
                <div>
                  <strong>{reqPorEtapa.size === 1 ? `${p.con_requisitos_pendientes} estudiante${p.con_requisitos_pendientes > 1 ? 's' : ''} con documentos pendientes` : 'Documentos pendientes'}</strong> en {g.etapa}.{' '}
                  <Link to={`/avance/${id}`} className="underline">Ver estudiantes</Link>
                  {' · '}
                  <Link to={`/comunicacion?nuevo=1&etapa=${id}&tipo=FALTAN_REQUISITOS`} className="underline">Enviar recordatorio</Link>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {g.items.map((x) => (
                    <span key={x.requisito} className="rounded bg-yellow-50 px-2 py-0.5 text-xs text-yellow-800 ring-1 ring-yellow-200">
                      {x.requisito}: faltan {x.faltan}
                    </span>
                  ))}
                </div>
              </li>
            ))}
            {sinConfirmar.map((r) => (
              <li key={'c' + r.etapa_id}>
                <strong>{r.sin_confirmar} decisión{r.sin_confirmar > 1 ? 'es' : ''} sin confirmar</strong> en {r.etapa} (marcados como pasa / no pasa, aún no aplicados).{' '}
                <Link to={`/avance/${r.etapa_id}`} className="underline">Revisar y confirmar</Link>
              </li>
            ))}
            {sinAvisar.map((r) => (
              <li key={'a' + r.etapa_id}>
                <strong>{r.sin_avisar} estudiante{r.sin_avisar > 1 ? 's' : ''} sin avisar</strong> del resultado de {r.etapa}.{' '}
                <Link to={`/avance/${r.etapa_id}`} className="underline">Avisar</Link>
              </li>
            ))}
            {e.sin_respuesta > 0 && (
              <li>
                <strong>{e.sin_respuesta} invitado{e.sin_respuesta > 1 ? 's' : ''}</strong> {e.sin_respuesta > 1 ? 'no han respondido si aceptan' : 'no ha respondido si acepta'} postular.{' '}
                <Link to="/invitados" className="underline">Ver invitados</Link>
              </li>
            )}
            {e.sin_email > 0 && (
              <li>
                <strong>{e.sin_email} invitado{e.sin_email > 1 ? 's' : ''} sin email</strong>: no les llegarán los correos.{' '}
                <Link to="/invitados" className="underline">Completar datos</Link>
              </li>
            )}
            {data.rebotados > 0 && (
              <li className="text-red-800">
                <strong>{data.rebotados} correo{data.rebotados > 1 ? 's no llegaron' : ' no llegó'}</strong> (rebotados o con error).{' '}
                <Link to="/comunicacion" className="underline">Revisar en Comunicación</Link>
              </li>
            )}
          </ul>
        </section>
      ) : (
        <Caja tono="verde">No hay pendientes: todos los estudiantes tienen sus documentos y los resultados están confirmados y avisados.</Caja>
      )}

      <section>
        <h2 className="subtitulo mb-3">Invitación a estudiantes</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Cifra valor={e.invitados} texto="Invitados" />
          <Cifra valor={e.confirmaron} texto="Aceptaron postular" detalle={pct(e.confirmaron)} tono="text-green-700" />
          <Cifra valor={e.sin_respuesta} texto="Sin respuesta" detalle={e.sin_respuesta ? 'Enviar recordatorio' : undefined} tono={e.sin_respuesta ? 'text-yellow-600' : undefined} />
          <Cifra valor={e.rechazaron} texto="Rechazaron" />
        </div>

        <div className="tarjeta mt-4 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-xs font-semibold text-gray-600">Avance por etapa</span>
            <span className="text-xs text-gray-400">barra = llegaron a la etapa · número oscuro = siguen en ella</span>
          </div>
          <dl className="space-y-2">
            <div className="grid grid-cols-[190px_1fr_90px] items-center gap-3 text-sm">
              <dt className="text-gray-600">Invitados</dt>
              <dd className="h-4 rounded bg-gray-100"><div className="h-4 rounded bg-gray-400" style={{ width: `${(e.invitados / max) * 100}%` }} /></dd>
              <dd className="text-right font-semibold tabular-nums">{e.invitados}</dd>
            </div>
            {data.porEtapa.map((x) => (
              <div key={x.id} className="grid grid-cols-[190px_1fr_90px] items-center gap-3 text-sm">
                <dt className="truncate">
                  <Link to={`/avance/${x.id}`} className={`hover:underline ${x.estado === 'ACTIVA' ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{x.orden}. {x.nombre}</Link>
                </dt>
                <dd className="relative h-4 rounded bg-gray-100">
                  <div className="h-4 rounded bg-gray-800" style={{ width: `${(x.llegaron / max) * 100}%` }} />
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
    </div>
  );
}
