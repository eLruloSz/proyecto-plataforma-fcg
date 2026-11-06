import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, GrillaHitos } from '../api';
import { Cargando, DesplazamientoDoble, ErrorCarga, EtiquetaParticipacion, fecha, useAviso } from '../ui';

/** Columna del liceo: queda fija a la izquierda al desplazar la tabla hacia la derecha. */
const FIJA = 'sticky left-0 z-[2] shadow-[inset_-1px_0_0_theme(colors.gray.200)]';

/** Reemplaza la planilla de seguimiento con semáforo: un clic marca o desmarca. */
export function Seguimiento() {
  const qc = useQueryClient();
  const avisar = useAviso();
  const { data, isLoading, error } = useQuery({ queryKey: ['hitos'], queryFn: () => api.get<GrillaHitos>('/hitos') });
  const marcar = useMutation({
    mutationFn: (v: { liceoId: string; codigo: string; completado: boolean }) =>
      api.put(`/hitos/${v.liceoId}/${v.codigo}`, { completado: v.completado }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hitos'] });
      qc.invalidateQueries({ queryKey: ['hitos-etapa'] });
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });

  if (isLoading) return <Cargando />;
  if (error || !data) return <ErrorCarga error={error} />;

  return (
    <div>
      <h1 className="titulo">Seguimiento por liceo</h1>
      <p className="mb-4 text-sm text-gray-500">
        Los hitos con borde se marcaron solos (al enviar un correo, recibir una respuesta o subir la nómina). Haz clic en cualquier celda para marcarla o desmarcarla a mano.
      </p>
      <TablaSeguimiento data={data} onMarcar={(liceoId, codigo, completado) => marcar.mutate({ liceoId, codigo, completado })} />
    </div>
  );
}

/**
 * Tabla de hitos por liceo. Sin `onMarcar` queda en solo lectura
 * (se usa así en Concursos anteriores).
 */
export function TablaSeguimiento({ data, onMarcar }: {
  data: GrillaHitos;
  onMarcar?: (liceoId: string, codigo: string, completado: boolean) => void;
}) {
  const completados = (codigo: string) => data.filas.filter((f) => f.hitos[codigo]?.completado).length;
  return (
    <DesplazamientoDoble className="tarjeta">
      <table className="tabla">
        <thead>
          <tr>
            <th className={`min-w-[220px] ${FIJA} !z-[3] bg-gray-50`}>Liceo</th>
            <th>Participación</th>
            {data.catalogo.map((h) => (
              <th key={h.codigo} className="min-w-[84px] text-center align-bottom leading-tight" title={h.nombre}>{h.nombre}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.filas.map((f) => (
            <tr key={f.id} className="group">
              <td className={`${FIJA} bg-white group-hover:bg-gray-50`}>
                {onMarcar
                  ? <Link to={`/liceos/${f.id}`} className="hover:underline"><span className="text-gray-400">{f.codigo}.</span> {f.nombre}</Link>
                  : <span><span className="text-gray-400">{f.codigo}.</span> {f.nombre}</span>}
                <div className="text-xs text-gray-400">{f.contraparte ?? 'sin contraparte'}{f.contraparte_cargo ? ` (${f.contraparte_cargo})` : ''}</div>
              </td>
              <td><EtiquetaParticipacion estado={f.participacion} /></td>
              {data.catalogo.map((h) => {
                const v = f.hitos[h.codigo];
                const hecho = !!v?.completado;
                const titulo = `${h.nombre}: ${hecho ? `hecho ${fecha(v?.fecha)}${v?.automatico ? ' (automático)' : ''}` : 'pendiente'}${v?.observaciones ? ` — ${v.observaciones}` : ''}`;
                const clase = `inline-flex h-5 w-5 items-center justify-center rounded-full ${
                  hecho ? (v?.automatico ? 'bg-green-600 ring-2 ring-green-200' : 'bg-green-600') : 'bg-gray-200'}`;
                const marca = hecho && <span className="text-[10px] text-white">✓</span>;
                return (
                  <td key={h.codigo} className="text-center">
                    {onMarcar ? (
                      <button onClick={() => onMarcar(f.id, h.codigo, !hecho)} title={titulo}
                        aria-label={`${h.nombre} en ${f.nombre}: ${hecho ? 'hecho' : 'pendiente'}`}
                        className={`${clase} transition hover:scale-125`}>{marca}</button>
                    ) : (
                      <span title={titulo} aria-label={`${h.nombre}: ${hecho ? 'hecho' : 'pendiente'}`} className={clase}>{marca}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-50 text-xs font-semibold text-gray-600">
            <td className={`px-3 py-2 ${FIJA} bg-gray-50`}>Completados</td>
            <td className="px-3 py-2" />
            {data.catalogo.map((h) => <td key={h.codigo} className="px-3 py-2 text-center tabular-nums">{completados(h.codigo)}/{data.filas.length}</td>)}
          </tr>
        </tfoot>
      </table>
    </DesplazamientoDoble>
  );
}
