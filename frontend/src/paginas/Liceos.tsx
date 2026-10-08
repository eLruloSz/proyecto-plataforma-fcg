import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, Liceo } from '../api';
import { Cargando, Etiqueta, ErrorCarga, EtiquetaParticipacion, fecha } from '../ui';

export function useLiceos() {
  return useQuery({ queryKey: ['liceos'], queryFn: () => api.get<Liceo[]>('/liceos') });
}

export function Liceos() {
  const { data, isLoading, error } = useLiceos();
  const [filtro, setFiltro] = useState<'todos' | 'sin-nomina' | 'sin-email'>('todos');
  const [q, setQ] = useState('');

  const lista = useMemo(() => (data ?? []).filter((l) => {
    if (q && !`${l.codigo} ${l.nombre} ${l.comuna}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filtro === 'sin-nomina') return !l.nomina && l.participacion !== 'NO_PARTICIPA';
    if (filtro === 'sin-email') return !l.contraparte?.email;
    return true;
  }), [data, filtro, q]);

  if (isLoading) return <Cargando />;
  if (error) return <ErrorCarga error={error} />;

  return (
    <div className="max-w-6xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titulo">Liceos y nóminas</h1>
          <p className="text-sm text-gray-500">Entra a un liceo para editar su contraparte, subir su nómina de notas y elegir invitados.</p>
        </div>
        <div className="flex gap-2">
          <input className="input w-56" placeholder="Buscar liceo…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar liceo" />
          <select className="input w-auto" value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} aria-label="Filtrar">
            <option value="todos">Todos</option>
            <option value="sin-nomina">Falta la nómina</option>
            <option value="sin-email">Contraparte sin email</option>
          </select>
        </div>
      </div>

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr><th>Liceo</th><th>Contraparte</th><th>Participación</th><th>Nómina</th><th className="text-right">Invitados</th></tr>
          </thead>
          <tbody>
            {lista.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link to={`/liceos/${l.id}`} className="font-medium text-gray-900 hover:underline">
                    <span className="text-gray-400">{l.codigo}.</span> {l.nombre}
                  </Link>
                  <div className="text-xs text-gray-400">{l.comuna}</div>
                </td>
                <td>
                  {l.contraparte ? (
                    <>
                      <div>{l.contraparte.nombre} <span className="text-xs text-gray-400">({l.contraparte.cargo})</span></div>
                      {l.contraparte.email
                        ? <div className="text-xs text-gray-500">{l.contraparte.email}</div>
                        : <div className="text-xs font-medium text-red-700">Sin email</div>}
                    </>
                  ) : <span className="text-xs text-red-700">Sin contraparte</span>}
                </td>
                <td><EtiquetaParticipacion estado={l.participacion} /></td>
                <td>
                  {l.nomina
                    ? <><Etiqueta tono="verde">{l.nomina.alumnos} alumnos · {l.nomina.cursos} cursos</Etiqueta><div className="mt-0.5 text-xs text-gray-400">{fecha(l.nomina.cargado_en)}</div></>
                    : l.participacion === 'NO_PARTICIPA' ? <span className="text-xs text-gray-400">—</span>
                    : <Link to={`/liceos/${l.id}`} className="text-xs font-medium text-gray-700 underline">Subir nómina</Link>}
                </td>
                <td className="text-right tabular-nums">{l.invitados || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">{lista.length} de {data?.length} liceos</p>
    </div>
  );
}
