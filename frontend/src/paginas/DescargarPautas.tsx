import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErrorApi } from '../api';
import { useSesion } from '../sesion';
import { Cargando, ErrorCarga, fecha, Modal, useAviso, Vacio } from '../ui';

/** Un estudiante de la etapa y los datos que le faltan a su pauta (lo que quedará en blanco en el Word). */
export interface FilaPauta {
  id: string; codigo: string; nombre: string; apellido_paterno: string; nombres: string;
  liceo: string; ranking: number | null; fecha_hora: string | null; faltan: string[];
  /** Word de la pauta ya rellenado tras la entrevista (null = aún no se sube). */
  completada: { nombre: string; subido_en: string } | null;
}

type Datos = 'todos' | 'faltan' | 'completos' | 'sin-fecha';
type Orden = 'fecha' | 'ranking' | 'liceo' | 'nombre';

/** Más que esto en una sola dirección podría no caber; se parte en varios .zip. */
const MAXIMO_POR_ZIP = 150;

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nombreSeguro = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
const minuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Ventana "Descargar Word": cada estudiante de la etapa con su botón, filtros para encontrarlo y una
 * opción para descargar todas las que se ven. Lo que falta no impide descargar: esa parte queda en blanco.
 * `bajadas` recuerda (mientras la página esté abierta) cuáles ya se descargaron, solo como aviso: se pueden
 * descargar de nuevo cuantas veces se quiera.
 */
export function DescargarPautas({ etapaId, etapaNombre, bajadas, onBajadas, onCerrar }: {
  etapaId: string; etapaNombre: string; bajadas: Set<string>; onBajadas: (claves: string[]) => void; onCerrar: () => void;
}) {
  const avisar = useAviso();
  const { soloLectura } = useSesion();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['pautas-lista', etapaId], queryFn: () => api.get<FilaPauta[]>(`/entrevistas/${etapaId}/pautas/lista`),
    staleTime: 0, refetchOnMount: 'always',
  });
  const [busca, setBusca] = useState('');
  const [liceo, setLiceo] = useState('');
  const [datos, setDatos] = useState<Datos>('todos');
  const [orden, setOrden] = useState<Orden>('fecha');
  const [rankingHasta, setRankingHasta] = useState('');
  const [bajando, setBajando] = useState<string | null>(null); // id del estudiante, o 'todas'
  const [subiendo, setSubiendo] = useState<string | null>(null); // id del estudiante al que se sube el Word completado
  const entrada = useRef<HTMLInputElement>(null);
  const destino = useRef<FilaPauta | null>(null);

  const clave = (id: string) => `${etapaId}:${id}`;
  const todos = data ?? [];
  const liceos = useMemo(() => [...new Set(todos.map((f) => f.liceo))].sort((a, b) => a.localeCompare(b, 'es')), [todos]);
  const hayFiltros = !!(busca.trim() || liceo || datos !== 'todos' || rankingHasta.trim());

  const lista = useMemo(() => {
    const q = sinTildes(busca.trim());
    const tope = Number(rankingHasta);
    let r = todos.filter((f) => {
      if (q && !sinTildes(`${f.nombre} ${f.codigo} ${f.liceo}`).includes(q)) return false;
      if (liceo && f.liceo !== liceo) return false;
      if (datos === 'faltan' && !f.faltan.length) return false;
      if (datos === 'completos' && f.faltan.length) return false;
      if (datos === 'sin-fecha' && f.fecha_hora) return false;
      if (rankingHasta.trim() && tope > 0 && !(f.ranking !== null && f.ranking <= tope)) return false;
      return true;
    });
    if (orden === 'ranking') r = [...r].sort((a, b) => (a.ranking ?? 1e9) - (b.ranking ?? 1e9));
    if (orden === 'liceo') r = [...r].sort((a, b) => a.liceo.localeCompare(b.liceo, 'es') || a.apellido_paterno.localeCompare(b.apellido_paterno, 'es'));
    if (orden === 'nombre') r = [...r].sort((a, b) => a.apellido_paterno.localeCompare(b.apellido_paterno, 'es') || a.nombres.localeCompare(b.nombres, 'es'));
    return r; // 'fecha': el servidor ya las manda por fecha de entrevista (sin fecha al final)
  }, [todos, busca, liceo, datos, orden, rankingHasta]);

  const conFaltantes = lista.filter((f) => f.faltan.length).length;

  const bajarUna = async (f: FilaPauta) => {
    setBajando(f.id);
    try {
      await api.descargar(`/entrevistas/${etapaId}/estudiantes/${f.id}/pauta`, nombreSeguro(`Pauta ${f.codigo} ${f.apellido_paterno} ${f.nombres}.docx`));
      onBajadas([clave(f.id)]);
      avisar(`Pauta de ${f.nombres} ${f.apellido_paterno} descargada.` +
        (f.faltan.length ? ` Quedó en blanco: ${f.faltan.map(minuscula).join(', ')}.` : ''));
    } catch (e) { avisar((e as Error).message, 'error'); }
    finally { setBajando(null); }
  };

  /** Sube el Word completado. Si el servidor avisa que no trae el código del estudiante, se pide confirmar. */
  const subirCompletada = async (f: FilaPauta, archivo: File, forzar = false) => {
    setSubiendo(f.id);
    try {
      const datos = new FormData();
      datos.append('archivo', archivo);
      if (forzar) datos.append('forzar', 'true');
      const r = await api.enviarFormulario<{ reemplazada: boolean }>(`/entrevistas/${etapaId}/estudiantes/${f.id}/pauta-completada`, datos);
      avisar(`${r.reemplazada ? 'Pauta reemplazada' : 'Pauta guardada'} en el perfil de ${f.nombres} ${f.apellido_paterno}.`);
      await refetch();
      qc.invalidateQueries({ queryKey: ['avance'] });
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 409 && !forzar) {
        if (window.confirm(`${e.message}\n\n¿Guardarla igual?`)) { await subirCompletada(f, archivo, true); return; }
      } else avisar((e as Error).message, 'error');
    } finally { setSubiendo(null); }
  };

  const elegirArchivo = (f: FilaPauta) => { destino.current = f; entrada.current?.click(); };

  const bajarCompletada = async (f: FilaPauta) => {
    try {
      await api.descargar(`/entrevistas/${etapaId}/estudiantes/${f.id}/pauta-completada`, nombreSeguro(f.completada?.nombre ?? `Pauta completada ${f.codigo}.docx`));
    } catch (e) { avisar((e as Error).message, 'error'); }
  };

  const quitarCompletada = async (f: FilaPauta) => {
    if (!window.confirm(`¿Quitar la pauta completada de ${f.nombre}? Se borra el archivo guardado.`)) return;
    try {
      await api.del(`/entrevistas/${etapaId}/estudiantes/${f.id}/pauta-completada`);
      avisar('Pauta completada quitada.');
      await refetch();
      qc.invalidateQueries({ queryKey: ['avance'] });
    } catch (e) { avisar((e as Error).message, 'error'); }
  };

  const bajarLista = async () => {
    const ids = lista.map((f) => f.id);
    if (!ids.length) return;
    setBajando('todas');
    try {
      const partes: string[][] = [];
      for (let i = 0; i < ids.length; i += MAXIMO_POR_ZIP) partes.push(ids.slice(i, i + MAXIMO_POR_ZIP));
      for (let i = 0; i < partes.length; i++) {
        const sufijo = partes.length > 1 ? ` (${i + 1} de ${partes.length})` : '';
        await api.descargar(`/entrevistas/${etapaId}/pautas?ids=${partes[i].join(',')}`, nombreSeguro(`Pautas de entrevista - ${etapaNombre}${sufijo}.zip`));
      }
      onBajadas(ids.map(clave));
      avisar(`${ids.length} ${ids.length === 1 ? 'pauta descargada' : 'pautas descargadas'}.` +
        (conFaltantes ? ` ${conFaltantes} con datos faltantes: esas partes quedaron en blanco.` : ''));
    } catch (e) { avisar((e as Error).message, 'error'); }
    finally { setBajando(null); }
  };

  return (
    <Modal titulo={`Descargar Word · ${etapaNombre}`} onCerrar={onCerrar} ancho="max-w-5xl"
      pie={<>
        <span className="mr-auto text-xs text-gray-500">
          {conFaltantes > 0 ? `${conFaltantes} de las ${lista.length} de la lista tienen datos faltantes; se descargan igual, con esas partes en blanco.` : ''}
        </span>
        <button className="btn-secundario" onClick={onCerrar}>Cerrar</button>
        <button className="btn-word" disabled={!lista.length || bajando !== null} onClick={bajarLista}>
          {bajando === 'todas' ? 'Preparando…' : hayFiltros ? `⬇ Descargar las ${lista.length} de la lista` : `⬇ Descargar todas (${lista.length})`}
        </button>
      </>}>
      <p className="mb-3 text-sm text-gray-600">
        Cada pauta se rellena con lo que el sistema ya tiene del estudiante. Si falta un dato (por ejemplo, aún no tiene
        entrevista agendada), esa parte queda en blanco y el Word se descarga igual.
        {!soloLectura && ' Después de la entrevista, sube aquí el mismo Word ya rellenado: queda guardado en el estudiante para que la dirección lo revise.'}
      </p>
      <input ref={entrada} type="file" hidden accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(e) => { const a = e.target.files?.[0]; e.target.value = ''; if (a && destino.current) subirCompletada(destino.current, a); }} />

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <input className="input lg:col-span-2" placeholder="Buscar por nombre, código o liceo…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select className="input" value={liceo} onChange={(e) => setLiceo(e.target.value)} aria-label="Liceo">
          <option value="">Todos los liceos</option>
          {liceos.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className="input" value={datos} onChange={(e) => setDatos(e.target.value as Datos)} aria-label="Datos">
          <option value="todos">Todos</option>
          <option value="faltan">Con datos faltantes</option>
          <option value="completos">Con todos los datos</option>
          <option value="sin-fecha">Sin entrevista agendada</option>
        </select>
        <select className="input" value={orden} onChange={(e) => setOrden(e.target.value as Orden)} aria-label="Orden">
          <option value="fecha">Orden: fecha de entrevista</option>
          <option value="ranking">Orden: ranking</option>
          <option value="liceo">Orden: liceo</option>
          <option value="nombre">Orden: apellido</option>
        </select>
        <input className="input" type="number" min={1} placeholder="Solo ranking 1 al N°…" value={rankingHasta} onChange={(e) => setRankingHasta(e.target.value)} aria-label="Ranking hasta"
          title="Muestra solo a quienes quedaron entre los primeros N del ranking de la preselección. Ej.: 20 = los 20 primeros. Quien no tiene ranking no aparece." />
        {hayFiltros && (
          <button className="btn-secundario" onClick={() => { setBusca(''); setLiceo(''); setDatos('todos'); setRankingHasta(''); }}>Quitar filtros</button>
        )}
      </div>

      {isLoading ? <Cargando /> : error ? <ErrorCarga error={error} /> : !todos.length ? (
        <Vacio>No hay estudiantes en esta etapa.</Vacio>
      ) : !lista.length ? (
        <Vacio>Ningún estudiante coincide con los filtros.</Vacio>
      ) : (
        <div className="max-h-[50vh] overflow-y-auto rounded-md border border-gray-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Estudiante</th>
                <th className="px-3 py-2 font-medium">Liceo</th>
                <th className="px-3 py-2 text-center font-medium">Ranking</th>
                <th className="px-3 py-2 font-medium">Entrevista</th>
                <th className="px-3 py-2 font-medium">Datos</th>
                <th className="px-3 py-2 font-medium">Pauta completada</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.map((f) => {
                const yaBajada = bajadas.has(clave(f.id));
                return (
                  <tr key={f.id} className="align-top">
                    <td className="px-3 py-2"><div className="font-medium">{f.nombre}</div><div className="text-xs text-gray-500">{f.codigo}</div></td>
                    <td className="px-3 py-2 text-xs text-gray-600">{f.liceo}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{f.ranking ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-xs">{f.fecha_hora ? fecha(f.fecha_hora) : <span className="italic text-gray-400">Sin agendar</span>}</td>
                    <td className="px-3 py-2">
                      {f.faltan.length === 0
                        ? <span className="text-xs text-green-700">Completa</span>
                        : <div className="flex flex-wrap gap-1">{f.faltan.map((x) => <span key={x} className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">{x}</span>)}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {f.completada ? (
                        <div className="space-y-1">
                          <div className="text-green-700">✓ Subida · {fecha(f.completada.subido_en)}</div>
                          <div className="flex flex-wrap gap-1">
                            <button className="btn-secundario btn-chico" onClick={() => bajarCompletada(f)}>Ver / descargar</button>
                            {!soloLectura && <button className="btn-secundario btn-chico" disabled={subiendo !== null} onClick={() => elegirArchivo(f)}>{subiendo === f.id ? 'Subiendo…' : 'Reemplazar'}</button>}
                            {!soloLectura && <button className="btn-peligro btn-chico" disabled={subiendo !== null} onClick={() => quitarCompletada(f)}>Quitar</button>}
                          </div>
                        </div>
                      ) : soloLectura ? <span className="italic text-gray-400">Sin subir</span> : (
                        <button className="btn-secundario btn-chico" disabled={subiendo !== null} onClick={() => elegirArchivo(f)}>
                          {subiendo === f.id ? 'Subiendo…' : '⬆ Subir completada'}
                        </button>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {yaBajada && <span className="mr-2 text-xs text-green-700">✓ Descargada</span>}
                      <button className="btn-word btn-chico" disabled={bajando !== null} onClick={() => bajarUna(f)}>
                        {bajando === f.id ? 'Preparando…' : yaBajada ? 'Descargar de nuevo' : 'Descargar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-500">Mostrando {lista.length} de {todos.length} estudiantes.</p>
    </Modal>
  );
}