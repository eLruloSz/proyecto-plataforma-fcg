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

  const pasos = [
    ['Invitados', e.invitados],
    ['Aceptaron postular', e.confirmaron],
    ['Asistieron al encuentro', e.asistieron_encuentro],
    ['Postularon', e.postularon],
    ['Preseleccionados', e.preseleccionados],
    ['Finalistas', e.finalistas],
    ['Becarios', e.becarios],
  ] as const;
  const max = Math.max(1, e.invitados);

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="titulo">Dashboard</h1>
        <p className="text-sm text-gray-500">{data.proceso.nombre}</p>
      </div>

      {(data.rebotados > 0 || e.sin_email > 0) && (
        <div className="space-y-2">
          {data.rebotados > 0 && (
            <Caja tono="rojo">
              <strong>{data.rebotados} correo{data.rebotados > 1 ? 's' : ''} no llegaron</strong> (rebotados o con error).{' '}
              <Link to="/comunicacion" className="underline">Revisar en Comunicación</Link>
            </Caja>
          )}
          {e.sin_email > 0 && (
            <Caja tono="amarillo">
              {e.sin_email} invitado{e.sin_email > 1 ? 's' : ''} sin email registrado: no les llegará la invitación.{' '}
              <Link to="/invitados" className="underline">Completar datos</Link>
            </Caja>
          )}
        </div>
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
          <div className="mb-3 text-xs font-semibold text-gray-600">Avance del proceso</div>
          <dl className="space-y-2">
            {pasos.map(([t, v]) => (
              <div key={t} className="grid grid-cols-[170px_1fr_40px] items-center gap-3 text-sm">
                <dt className="text-gray-600">{t}</dt>
                <dd className="h-4 rounded bg-gray-100">
                  <div className="h-4 rounded bg-gray-800" style={{ width: `${(v / max) * 100}%` }} />
                </dd>
                <dd className="text-right font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
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
