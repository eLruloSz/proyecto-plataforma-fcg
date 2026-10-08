import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Contacto, Liceo, Nomina, Participacion, Previsualizacion } from '../api';
import { Caja, Cargando, Etiqueta, ErrorCarga, fecha, Modal, nota, useAviso } from '../ui';

// ---------------------------------------------------------------------------
// Contactos
// ---------------------------------------------------------------------------
function TarjetaContacto({ liceo, tipo }: { liceo: Liceo; tipo: 'contraparte' | 'director' }) {
  const c = liceo[tipo];
  const [editando, setEditando] = useState(false);
  const titulo = tipo === 'contraparte' ? 'Contraparte (encargado/a de la beca)' : 'Director/a';
  return (
    <div className="tarjeta p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-600">{titulo}</h3>
        <button className="btn-secundario btn-chico" onClick={() => setEditando(true)}>{c ? 'Editar' : 'Agregar'}</button>
      </div>
      {c ? (
        <div className="text-sm">
          <div className="font-medium text-gray-900">{c.nombre}</div>
          <div className="text-gray-500">{c.cargo || '—'}</div>
          <div className={c.email ? 'text-gray-700' : 'font-medium text-red-700'}>{c.email || 'Sin email: no recibirá correos'}</div>
          {c.telefono && <div className="text-gray-500">{c.telefono}</div>}
        </div>
      ) : <p className="text-sm text-gray-400">No registrado.</p>}
      {editando && <FormContacto liceo={liceo} tipo={tipo} actual={c} onCerrar={() => setEditando(false)} />}
    </div>
  );
}

function FormContacto({ liceo, tipo, actual, onCerrar }: { liceo: Liceo; tipo: 'contraparte' | 'director'; actual: Contacto | null; onCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const [f, setF] = useState({ nombre: actual?.nombre ?? '', cargo: actual?.cargo ?? '', email: actual?.email ?? '', telefono: actual?.telefono ?? '' });
  const [error, setError] = useState('');
  const guardar = useMutation({
    mutationFn: () => api.put<Liceo>(`/liceos/${liceo.id}/${tipo}`, { ...f, email: f.email.trim() || null }),
    onSuccess: (l) => { qc.setQueryData(['liceo', liceo.id], l); qc.invalidateQueries({ queryKey: ['liceos'] }); avisar('Contacto guardado'); onCerrar(); },
    onError: (e: Error) => setError(e.message),
  });
  const enviar = () => {
    if (!f.nombre.trim()) return setError('El nombre es obligatorio.');
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setError('El email no tiene un formato válido.');
    guardar.mutate();
  };
  const campo = (k: keyof typeof f, label: string, tipoInput = 'text') => (
    <div>
      <label className="label" htmlFor={`c-${k}`}>{label}</label>
      <input id={`c-${k}`} type={tipoInput} className="input" value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value }); setError(''); }} />
    </div>
  );
  return (
    <Modal titulo={tipo === 'contraparte' ? 'Contraparte del liceo' : 'Director/a del liceo'} onCerrar={onCerrar} ancho="max-w-lg"
      pie={<><button className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={guardar.isPending} onClick={enviar}>Guardar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {campo('nombre', 'Nombre')}
        {campo('cargo', 'Cargo (ej. Orientadora, Jefa UTP)')}
        {campo('email', 'Email', 'email')}
        {campo('telefono', 'Teléfono')}
      </div>
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Carga de la nómina (previsualizar → confirmar)
// ---------------------------------------------------------------------------
function SubirNomina({ liceo, hayNomina }: { liceo: Liceo; hayNomina: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const avisar = useAviso();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<Previsualizacion | null>(null);

  const previsualizar = useMutation({
    mutationFn: (f: File) => api.subir<Previsualizacion>(`/liceos/${liceo.id}/nomina/previsualizar`, f),
    onSuccess: setPrevia,
    onError: (e: Error) => { avisar(e.message, 'error'); setArchivo(null); },
  });
  const confirmar = useMutation({
    mutationFn: () => api.subir(`/liceos/${liceo.id}/nomina`, archivo!),
    onSuccess: () => {
      avisar(`Nómina cargada: ${previa?.totalAlumnos} alumnos`);
      ['nomina', 'liceo', 'liceos', 'dashboard', 'hitos', 'envios'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      cerrar();
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  const cerrar = () => { setPrevia(null); setArchivo(null); if (input.current) input.current.value = ''; };

  return (
    <>
      <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) { setArchivo(f); previsualizar.mutate(f); }
      }} />
      <button className={hayNomina ? 'btn-secundario' : 'btn-primario'} disabled={previsualizar.isPending} onClick={() => input.current?.click()}>
        {previsualizar.isPending ? 'Leyendo archivo…' : hayNomina ? 'Reemplazar nómina' : 'Subir nómina (Excel)'}
      </button>

      {previa && (
        <Modal titulo={`Revisar nómina — ${archivo?.name}`} onCerrar={cerrar} ancho="max-w-3xl"
          pie={<>
            <button className="btn-secundario" onClick={cerrar}>Cancelar</button>
            <button className="btn-primario" disabled={!previa.totalAlumnos || confirmar.isPending} onClick={() => confirmar.mutate()}>
              {confirmar.isPending ? 'Guardando…' : `Cargar ${previa.totalAlumnos} alumnos`}
            </button>
          </>}>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="tarjeta p-3"><div className="text-xl font-bold">{previa.totalAlumnos}</div><div className="text-xs text-gray-500">alumnos a cargar</div></div>
              <div className="tarjeta p-3"><div className="text-xl font-bold">{previa.cursos.length}</div><div className="text-xs text-gray-500">cursos</div></div>
              <div className="tarjeta p-3"><div className={`text-xl font-bold ${previa.errores.length ? 'text-red-700' : ''}`}>{previa.errores.length}</div><div className="text-xs text-gray-500">filas con error</div></div>
            </div>

            {previa.cursos.length > 0 && (
              <table className="tabla tarjeta">
                <thead><tr><th>Curso</th><th>Como venía</th><th>Especialidad</th><th className="text-right">Alumnos</th></tr></thead>
                <tbody>{previa.cursos.map((c) => (
                  <tr key={c.curso}><td className="font-medium">{c.curso}</td><td className="text-gray-500">{c.cursoOriginal}</td><td className="text-gray-500">{c.especialidad ?? '—'}</td><td className="text-right">{c.alumnos}</td></tr>
                ))}</tbody>
              </table>
            )}

            {previa.errores.length > 0 && (
              <Caja tono="rojo" titulo="Estas filas NO se cargarán (corrígelas en el Excel y vuelve a subirlo si son importantes)">
                <ul className="list-disc space-y-0.5 pl-5">
                  {previa.errores.map((e, i) => <li key={i}>{e.hoja && <strong>{e.hoja}{e.fila ? `, fila ${e.fila}` : ''}: </strong>}{e.mensaje}</li>)}
                </ul>
              </Caja>
            )}
            {previa.advertencias.length > 0 && (
              <Caja tono="amarillo" titulo="Revisar (se cargan igual)">
                <ul className="list-disc space-y-0.5 pl-5">
                  {previa.advertencias.map((e, i) => <li key={i}>{e.hoja && <strong>{e.hoja}{e.fila ? `, fila ${e.fila}` : ''}: </strong>}{e.mensaje}</li>)}
                </ul>
              </Caja>
            )}
            {!previa.errores.length && !previa.advertencias.length && <Caja tono="verde">El archivo se leyó sin problemas.</Caja>}
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Nómina por curso y selección de invitados
// ---------------------------------------------------------------------------
function SeleccionInvitados({ liceo }: { liceo: Liceo }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const [porCurso, setPorCurso] = useState(3);
  const { data, isLoading, error } = useQuery({
    queryKey: ['nomina', liceo.id, porCurso],
    queryFn: () => api.get<Nomina>(`/liceos/${liceo.id}/nomina?porCurso=${porCurso}`),
    placeholderData: (prev) => prev,
  });
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  // Al cargar (o cambiar el N), se marcan los sugeridos que aún no están invitados.
  useEffect(() => {
    if (!data) return;
    setElegidos(new Set(data.cursos.flatMap((c) => c.alumnos.filter((a) => a.sugerido && !a.codigo).map((a) => a.id))));
  }, [data]);

  const alumnosElegidos = useMemo(() => data?.cursos.flatMap((c) => c.alumnos).filter((a) => elegidos.has(a.id)) ?? [], [data, elegidos]);

  const invitar = useMutation({
    mutationFn: () => api.post<{ invitados: { codigo: string }[] }>('/invitados', { alumnoIds: [...elegidos] }),
    onSuccess: (r) => {
      avisar(`${r.invitados.length} invitados: ${r.invitados[0]?.codigo} … ${r.invitados.at(-1)?.codigo}`);
      ['nomina', 'liceo', 'liceos', 'dashboard', 'invitados', 'hitos', 'proceso'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setConfirmando(false);
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  const eliminar = useMutation({
    mutationFn: () => api.del(`/liceos/${liceo.id}/nomina`),
    onSuccess: () => { ['nomina', 'liceo', 'liceos', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); setEliminando(false); avisar('Nómina eliminada'); },
  });

  if (isLoading) return <Cargando />;
  if (error) return <ErrorCarga error={error} />;
  if (!data?.carga) {
    return (
      <div className="tarjeta flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-sm text-gray-500">Este liceo aún no tiene nómina. Sube el Excel que envió el liceo (la plantilla con una hoja por curso).</p>
        <SubirNomina liceo={liceo} hayNomina={false} />
      </div>
    );
  }

  const alternar = (id: string) => setElegidos((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const total = data.cursos.reduce((s, c) => s + c.alumnos.length, 0);
  const invitados = data.cursos.reduce((s, c) => s + c.alumnos.filter((a) => a.codigo).length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          <strong>{total}</strong> alumnos en {data.cursos.length} cursos · {data.carga.nombre_archivo} · cargada {fecha(data.carga.cargado_en)}
          {invitados > 0 && <> · <strong className="text-gray-900">{invitados} invitados</strong></>}
        </div>
        <div className="flex gap-2">
          <SubirNomina liceo={liceo} hayNomina />
          <button className="btn-peligro" onClick={() => setEliminando(true)}>Eliminar</button>
        </div>
      </div>

      <div className="tarjeta flex flex-wrap items-center gap-3 bg-gray-50 px-4 py-3 text-sm">
        <label htmlFor="porCurso">Sugerir los</label>
        <input id="porCurso" type="number" min={0} max={20} className="input w-16 py-1" value={porCurso}
          onChange={(e) => setPorCurso(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} />
        <span>primeros lugares de cada curso (los empates entran todos).</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-gray-500">{elegidos.size} seleccionados</span>
          <button className="btn-primario" disabled={!elegidos.size} onClick={() => setConfirmando(true)}>Invitar seleccionados</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.cursos.map((c) => (
          <div key={c.curso} className="tarjeta overflow-hidden">
            <div className="flex items-baseline justify-between border-b border-gray-200 px-4 py-2">
              <h3 className="font-semibold text-gray-900">{c.curso}</h3>
              <span className="text-xs text-gray-500">{c.especialidad ?? ''} · {c.alumnos.length} alumnos</span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="tabla">
                <thead><tr><th className="w-8" /><th className="w-10">#</th><th>Alumno</th><th className="text-right">1°</th><th className="text-right">2°</th><th className="text-right">Prom.</th></tr></thead>
                <tbody>
                  {c.alumnos.map((a) => (
                    <tr key={a.id} className={a.codigo ? 'bg-green-50/60' : elegidos.has(a.id) ? 'bg-yellow-50/60' : ''}>
                      <td>
                        {a.codigo ? <span title="Ya invitado">✓</span> : (
                          <input type="checkbox" checked={elegidos.has(a.id)} onChange={() => alternar(a.id)}
                            aria-label={`Seleccionar a ${a.nombres} ${a.apellido_paterno}`} />
                        )}
                      </td>
                      <td className="tabular-nums text-gray-500">{a.posicion_curso}°</td>
                      <td>
                        {a.apellido_paterno} {a.apellido_materno}, {a.nombres}
                        {a.codigo && <span className="ml-2"><Etiqueta tono="verde">{a.codigo}</Etiqueta></span>}
                      </td>
                      <td className="text-right tabular-nums text-gray-500">{nota(a.promedio_1m)}</td>
                      <td className="text-right tabular-nums text-gray-500">{nota(a.promedio_2m)}</td>
                      <td className="text-right font-semibold tabular-nums">{nota(a.promedio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {confirmando && (
        <Modal titulo={`Invitar a ${alumnosElegidos.length} estudiantes`} onCerrar={() => setConfirmando(false)} ancho="max-w-lg"
          pie={<><button className="btn-secundario" onClick={() => setConfirmando(false)}>Cancelar</button>
            <button className="btn-primario" disabled={invitar.isPending} onClick={() => invitar.mutate()}>Confirmar invitación</button></>}>
          <p className="mb-3 text-sm text-gray-600">Cada estudiante recibirá su Id (ej. <code>{liceo.codigo}.0XXa</code>) y aparecerá en la lista de Invitados. Un Id entregado no se reutiliza.</p>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {alumnosElegidos.map((a) => <li key={a.id}><span className="text-gray-400">{a.curso} · {a.posicion_curso}°</span> {a.nombres} {a.apellido_paterno} <span className="text-gray-400">({nota(a.promedio)})</span></li>)}
          </ul>
        </Modal>
      )}
      {eliminando && (
        <Modal titulo="Eliminar nómina" onCerrar={() => setEliminando(false)} ancho="max-w-md"
          pie={<><button className="btn-secundario" onClick={() => setEliminando(false)}>Cancelar</button><button className="btn-peligro" onClick={() => eliminar.mutate()}>Eliminar</button></>}>
          <p className="text-sm text-gray-700">Se borrarán los {total} alumnos de la nómina. {invitados > 0 && `Los ${invitados} invitados se mantienen con su Id.`}</p>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
export function DetalleLiceo() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const avisar = useAviso();
  const { data: liceo, isLoading, error } = useQuery({ queryKey: ['liceo', id], queryFn: () => api.get<Liceo>(`/liceos/${id}`) });
  const participacion = useMutation({
    mutationFn: (estado: Participacion) => api.put<Liceo>(`/liceos/${id}/participacion`, { estado }),
    onSuccess: (l) => { qc.setQueryData(['liceo', id], l); ['liceos', 'dashboard', 'hitos'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); avisar('Participación actualizada'); },
  });

  if (isLoading) return <Cargando />;
  if (error || !liceo) return <ErrorCarga error={error} />;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <Link to="/liceos" className="text-xs text-gray-500 hover:text-gray-900">← Liceos</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="titulo"><span className="text-gray-400">{liceo.codigo}.</span> {liceo.nombre}</h1>
            <p className="text-sm text-gray-500">{liceo.comuna}</p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="part" className="text-sm text-gray-600">Participación:</label>
            <select id="part" className="input w-auto" value={liceo.participacion}
              onChange={(e) => participacion.mutate(e.target.value as Participacion)}>
              <option value="PENDIENTE">Sin respuesta</option>
              <option value="PARTICIPA">Participa</option>
              <option value="NO_PARTICIPA">No participa</option>
            </select>
            <Link className="btn-secundario" to={`/comunicacion?liceo=${liceo.id}`}>Escribir a este liceo</Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TarjetaContacto liceo={liceo} tipo="contraparte" />
        <TarjetaContacto liceo={liceo} tipo="director" />
      </div>

      <section>
        <h2 className="subtitulo mb-3">Nómina de notas e invitados</h2>
        <SeleccionInvitados liceo={liceo} />
      </section>
    </div>
  );
}
