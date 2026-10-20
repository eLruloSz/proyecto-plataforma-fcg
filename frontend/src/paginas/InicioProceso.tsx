import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, BorradorProceso, Contacto, InicioProceso, Liceo } from '../api';
import { useSesion } from '../sesion';
import { Caja, Cargando, ErrorCarga, Etiqueta, Modal, useAviso, Vacio } from '../ui';

/** Estado del proceso anual: si hay uno activo, uno en preparación o ninguno. */
export function useInicio(habilitado = true) {
  return useQuery({ queryKey: ['inicio'], queryFn: () => api.get<InicioProceso>('/proceso/inicio'), enabled: habilitado });
}

const CLAVE_LISTA = ['liceos', 'todos'];

/**
 * Pantalla que se muestra mientras no hay un proceso activo: primero el botón
 * "Iniciar proceso", luego la revisión de liceos y la confirmación.
 */
export function PantallaInicio({ inicio }: { inicio: InicioProceso }) {
  const { usuario, salir } = useSesion();
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div>
            <div className="text-sm font-bold tracking-tight text-gray-900">Beca Carmen Goudie</div>
            <div className="text-xs text-gray-500">Sistema de gestión</div>
          </div>
          <div className="text-right text-xs">
            <div className="font-medium text-gray-800">{usuario?.nombre}</div>
            <button onClick={salir} className="text-gray-500 hover:text-gray-900">Cerrar sesión</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        {inicio.borrador ? <RevisionLiceos borrador={inicio.borrador} /> : <Bienvenida inicio={inicio} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paso 0: no hay proceso en curso
// ---------------------------------------------------------------------------
function Bienvenida({ inicio }: { inicio: InicioProceso }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const [anio, setAnio] = useState(String(inicio.anioSugerido));
  const [otroAnio, setOtroAnio] = useState(false);
  const valido = /^\d{4}$/.test(anio);
  const iniciar = useMutation({
    mutationFn: () => api.post<InicioProceso>('/proceso/borrador', { anio: Number(anio) }),
    onSuccess: (i) => { qc.setQueryData(['inicio'], i); qc.removeQueries({ queryKey: ['liceos'] }); },
    onError: (e: Error) => avisar(e.message, 'error'),
  });

  return (
    <div className="tarjeta mx-auto mt-6 max-w-xl px-8 py-10 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Fundación Carmen Goudie</p>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">Proceso de selección {valido ? anio : ''}</h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-gray-600">
        No hay un proceso en curso. Al iniciarlo vas a revisar los liceos con los que trabaja la fundación y sus contactos,
        y elegir cuáles participan este año.
      </p>

      <ol className="mx-auto mt-6 grid max-w-lg gap-2 text-left text-sm sm:grid-cols-3">
        {['Revisar liceos y contactos', 'Confirmar los que participan', 'Comienza la etapa 1'].map((t, i) => (
          <li key={t} className="flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2">
            <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">{i + 1}</span>
            <span className="text-gray-700">{t}</span>
          </li>
        ))}
      </ol>

      <button className="btn-primario mt-8 px-6 py-2.5 text-base" disabled={!valido || iniciar.isPending} onClick={() => iniciar.mutate()}>
        {iniciar.isPending ? 'Preparando…' : `Iniciar proceso ${valido ? anio : ''}`}
      </button>
      <div className="mt-3 text-xs text-gray-500">
        {otroAnio ? (
          <label className="inline-flex items-center gap-2">
            Año del proceso
            <input type="number" className="input w-24 py-1" value={anio} onChange={(e) => setAnio(e.target.value)} aria-label="Año del proceso" />
          </label>
        ) : (
          <button className="underline hover:text-gray-800" onClick={() => setOtroAnio(true)}>¿Es otro año?</button>
        )}
      </div>

      {inicio.ultimo && (
        <p className="mt-8 border-t border-gray-100 pt-4 text-xs text-gray-400">
          Último proceso: {inicio.ultimo.nombre} (cerrado). Sus etapas, cupos y requisitos se copian al nuevo.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paso 1 y 2: revisar los liceos y confirmar
// ---------------------------------------------------------------------------
function RevisionLiceos({ borrador }: { borrador: BorradorProceso }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: CLAVE_LISTA, queryFn: () => api.get<Liceo[]>('/liceos?todos=1') });
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'sin-revisar' | 'fuera'>('todos');
  const [revisando, setRevisando] = useState<Liceo | 'nuevo' | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [verInactivos, setVerInactivos] = useState(false);

  const marcar = useMutation({
    mutationFn: (v: { id: string; incluido?: boolean; revisado?: boolean }) =>
      api.put<{ incluido: boolean; revisado_en: string | null }>(`/proceso/borrador/liceos/${v.id}`, { incluido: v.incluido, revisado: v.revisado }),
    // El check cambia al tiro; si el servidor falla, se vuelve a cargar la lista.
    onMutate: (v) => {
      if (v.incluido !== undefined) qc.setQueryData<Liceo[]>(CLAVE_LISTA, (l) => l?.map((x) => (x.id === v.id ? { ...x, incluido: v.incluido! } : x)));
    },
    onSuccess: (r, v) => qc.setQueryData<Liceo[]>(CLAVE_LISTA, (l) => l?.map((x) => (x.id === v.id ? { ...x, ...r } : x))),
    onError: (e: Error) => { avisar(e.message, 'error'); qc.invalidateQueries({ queryKey: CLAVE_LISTA }); },
  });
  const reactivar = useMutation({
    mutationFn: (id: string) => api.patch<Liceo>(`/liceos/${id}`, { activo: true }),
    onSuccess: (l) => { qc.invalidateQueries({ queryKey: CLAVE_LISTA }); avisar(`${l.nombre} reactivado`); },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  const confirmar = useMutation({
    mutationFn: () => api.post<InicioProceso>('/proceso/borrador/confirmar'),
    onSuccess: (i) => {
      // Lo que estaba en caché es de antes de iniciar el proceso: se descarta.
      qc.removeQueries({ predicate: (x) => x.queryKey[0] !== 'inicio' });
      qc.setQueryData(['inicio'], i);
      navigate('/');
      avisar(`${i.activo?.nombre ?? 'Proceso'} iniciado`);
    },
    onError: (e: Error) => { avisar(e.message, 'error'); setConfirmando(false); },
  });

  const activos = useMemo(() => (data ?? []).filter((l) => l.activo), [data]);
  const lista = useMemo(() => activos.filter((l) => {
    if (q && !`${l.codigo} ${l.nombre} ${l.comuna ?? ''} ${l.contraparte?.email ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filtro === 'sin-revisar') return l.incluido && !l.revisado_en;
    if (filtro === 'fuera') return !l.incluido;
    return true;
  }), [activos, q, filtro]);

  if (isLoading) return <Cargando />;
  if (error || !data) return <ErrorCarga error={error} />;

  const inactivos = data.filter((l) => !l.activo);
  const incluidos = activos.filter((l) => l.incluido);
  const revisados = incluidos.filter((l) => l.revisado_en).length;
  const faltan = incluidos.length - revisados;
  const sinEmail = incluidos.filter((l) => !l.contraparte?.email).length;
  const codigoSugerido = String(Math.max(0, ...data.map((l) => Number(l.codigo) || 0)) + 1).padStart(2, '0');

  return (
    <div className="space-y-5 pb-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Iniciar proceso · Paso 1 de 2</p>
          <h1 className="mt-1 text-xl font-semibold text-gray-900">Revisa los liceos del proceso <CambiarAnio anio={borrador.anio} /></h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Confirma que el nombre y los contactos de cada liceo sigan vigentes. Desmarca los que no participan este año:
            siguen guardados para los próximos procesos.
          </p>
        </div>
        <button className="btn-secundario" onClick={() => setRevisando('nuevo')}>+ Agregar liceo</button>
      </div>

      <div className="tarjeta grid gap-4 p-4 sm:grid-cols-[repeat(3,auto)_1fr] sm:items-center">
        <Cifra valor={incluidos.length} texto={`de ${activos.length} liceos participan`} />
        <Cifra valor={revisados} texto="revisados" tono="text-green-700" />
        <Cifra valor={faltan} texto="por revisar" tono={faltan ? 'text-yellow-700' : 'text-gray-900'} />
        <div className="h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={revisados} aria-valuemax={incluidos.length} aria-label="Liceos revisados">
          <div className="h-full rounded-full bg-green-600 transition-all" style={{ width: `${incluidos.length ? (revisados / incluidos.length) * 100 : 0}%` }} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="input w-64" placeholder="Buscar liceo, comuna o email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar liceo" />
        <select className="input w-auto" value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} aria-label="Filtrar">
          <option value="todos">Todos ({activos.length})</option>
          <option value="sin-revisar">Sin revisar ({faltan})</option>
          <option value="fuera">No participan este año ({activos.length - incluidos.length})</option>
        </select>
      </div>

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th className="w-20">Participa</th><th>Liceo</th><th>Contraparte (encargado/a de la beca)</th><th>Director/a</th><th>Revisión</th><th />
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={6}><Vacio>No hay liceos con este filtro.</Vacio></td></tr>}
            {lista.map((l) => (
              <tr key={l.id} className={l.incluido ? '' : 'bg-gray-50/60 text-gray-400'}>
                <td className="text-center">
                  <input type="checkbox" className="h-4 w-4" checked={l.incluido}
                    onChange={() => marcar.mutate({ id: l.id, incluido: !l.incluido })} aria-label={`${l.nombre} participa este año`} />
                </td>
                <td>
                  <div className={l.incluido ? 'font-medium text-gray-900' : ''}><span className="text-gray-400">{l.codigo}.</span> {l.nombre}</div>
                  <div className="text-xs text-gray-400">{l.comuna || '—'}</div>
                </td>
                <td><CeldaContacto c={l.contraparte} apagado={!l.incluido} avisarSinEmail /></td>
                <td><CeldaContacto c={l.director} apagado={!l.incluido} /></td>
                <td>
                  {!l.incluido ? <Etiqueta>No participa este año</Etiqueta>
                    : l.revisado_en ? <Etiqueta tono="verde">✓ Revisado</Etiqueta>
                      : <Etiqueta tono="amarillo">Sin revisar</Etiqueta>}
                </td>
                <td className="text-right">
                  <button className="btn-secundario btn-chico" onClick={() => setRevisando(l)}>{l.revisado_en ? 'Ver' : 'Revisar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inactivos.length > 0 && (
        <div className="text-sm">
          <button className="text-gray-500 hover:text-gray-900" onClick={() => setVerInactivos(!verInactivos)}>
            {verInactivos ? '▾' : '▸'} Liceos desactivados ({inactivos.length})
          </button>
          {verInactivos && (
            <ul className="tarjeta mt-2 divide-y divide-gray-100">
              {inactivos.map((l) => (
                <li key={l.id} className="flex items-center justify-between px-4 py-2 text-gray-500">
                  <span><span className="text-gray-400">{l.codigo}.</span> {l.nombre} <span className="text-xs">· {l.comuna}</span></span>
                  <button className="btn-secundario btn-chico" disabled={reactivar.isPending} onClick={() => reactivar.mutate(l.id)}>Reactivar</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white/95 px-6 py-3 backdrop-blur">
        <p className="text-sm text-gray-600">
          <strong className="text-gray-900">{incluidos.length} liceos</strong> participarán en el proceso {borrador.anio}
          {faltan > 0 && <span className="text-yellow-700"> · faltan {faltan} por revisar</span>}
        </p>
        <button className="btn-primario" disabled={!incluidos.length} onClick={() => setConfirmando(true)}>
          Confirmar liceos e iniciar el proceso
        </button>
      </div>

      {revisando && (
        <FormLiceo liceo={revisando === 'nuevo' ? null : revisando} codigoSugerido={codigoSugerido} onCerrar={() => setRevisando(null)} />
      )}

      {confirmando && (
        <Modal titulo={`Paso 2 de 2 · Iniciar el proceso ${borrador.anio}`} onCerrar={() => setConfirmando(false)} ancho="max-w-lg"
          pie={<>
            <button className="btn-secundario" onClick={() => setConfirmando(false)}>Volver a la revisión</button>
            <button className="btn-primario" disabled={confirmar.isPending} onClick={() => confirmar.mutate()}>
              {confirmar.isPending ? 'Iniciando…' : `Iniciar proceso ${borrador.anio}`}
            </button>
          </>}>
          <div className="space-y-4 text-sm">
            {faltan > 0 && (
              <Caja tono="amarillo">
                {faltan} {faltan === 1 ? 'liceo no se ha revisado' : 'liceos no se han revisado'}. Puedes iniciar igual y corregir
                sus datos después en <em>Liceos y nóminas</em>.
              </Caja>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-gray-500">Proceso</dt><dd className="font-medium">{borrador.nombre}</dd>
              <dt className="text-gray-500">Participan</dt><dd className="font-medium">{incluidos.length} liceos</dd>
              {activos.length > incluidos.length && <><dt className="text-gray-500">No participan</dt><dd>{activos.length - incluidos.length} {activos.length - incluidos.length === 1 ? 'liceo' : 'liceos'} este año</dd></>}
              {sinEmail > 0 && <><dt className="text-gray-500">Sin email</dt><dd className="text-red-700">{sinEmail} contraparte{sinEmail > 1 ? 's' : ''} (no recibirán correos)</dd></>}
            </dl>
            <div>
              <div className="mb-1.5 text-gray-500">Etapas del proceso</div>
              <ol className="space-y-1">
                {borrador.etapas.map((e) => (
                  <li key={e.orden} className="flex items-baseline gap-2">
                    <span className="w-4 text-right text-xs text-gray-400">{e.orden}.</span>
                    <span>{e.nombre}</span>
                    <span className="text-xs text-gray-400">
                      {[e.cupo && `cupo ${e.cupo}`, e.requisitos > 0 && `${e.requisitos} requisitos`].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-gray-500">Al confirmar comienza la etapa 1. Las etapas se pueden ajustar después en <em>Avance por etapa</em>.</p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Cifra({ valor, texto, tono = 'text-gray-900' }: { valor: number; texto: string; tono?: string }) {
  return (
    <div className="flex items-baseline gap-1.5 pr-4">
      <span className={`text-2xl font-bold tabular-nums ${tono}`}>{valor}</span>
      <span className="text-xs text-gray-500">{texto}</span>
    </div>
  );
}

function CeldaContacto({ c, apagado, avisarSinEmail }: { c: Contacto | null; apagado: boolean; avisarSinEmail?: boolean }) {
  if (!c) return <span className={`text-xs ${avisarSinEmail && !apagado ? 'font-medium text-red-700' : 'text-gray-400'}`}>No registrado</span>;
  return (
    <div className="min-w-[180px]">
      <div className={apagado ? '' : 'text-gray-800'}>{c.nombre}{c.cargo && <span className="text-xs text-gray-400"> · {c.cargo}</span>}</div>
      {c.email
        ? <div className={`text-xs ${apagado ? '' : 'text-gray-600'}`}>{c.email}</div>
        : <div className={`text-xs ${avisarSinEmail && !apagado ? 'font-medium text-red-700' : 'text-gray-400'}`}>Sin email</div>}
    </div>
  );
}

/** Cambiar el año del proceso en preparación. */
function CambiarAnio({ anio }: { anio: number }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(String(anio));
  const guardar = useMutation({
    mutationFn: () => api.patch<InicioProceso>('/proceso/borrador', { anio: Number(valor) }),
    onSuccess: (i) => { qc.setQueryData(['inicio'], i); setEditando(false); avisar(`Proceso cambiado a ${valor}`); },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  if (!editando) {
    return (
      <span>
        {anio} <button className="ml-1 align-middle text-xs font-normal text-gray-400 underline hover:text-gray-700" onClick={() => { setValor(String(anio)); setEditando(true); }}>cambiar año</button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <input type="number" autoFocus className="input w-24 py-1 text-base" value={valor} onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && /^\d{4}$/.test(valor)) guardar.mutate(); if (e.key === 'Escape') setEditando(false); }} aria-label="Año del proceso" />
      <button className="btn-primario btn-chico" disabled={!/^\d{4}$/.test(valor) || guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button>
      <button className="btn-secundario btn-chico" onClick={() => setEditando(false)}>Cancelar</button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Revisar / agregar un liceo
// ---------------------------------------------------------------------------
type FormContacto = { nombre: string; cargo: string; email: string; telefono: string };
const deContacto = (c: Contacto | null): FormContacto =>
  ({ nombre: c?.nombre ?? '', cargo: c?.cargo ?? '', email: c?.email ?? '', telefono: c?.telefono ?? '' });
const esEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function FormLiceo({ liceo, codigoSugerido, onCerrar }: { liceo: Liceo | null; codigoSugerido: string; onCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const original = {
    codigo: liceo?.codigo ?? codigoSugerido, nombre: liceo?.nombre ?? '', comuna: liceo?.comuna ?? '',
    direccion: liceo?.direccion ?? '', telefono: liceo?.telefono ?? '',
  };
  const [datos, setDatos] = useState(original);
  const [contactos, setContactos] = useState({ contraparte: deContacto(liceo?.contraparte ?? null), director: deContacto(liceo?.director ?? null) });
  const [error, setError] = useState('');
  const [desactivando, setDesactivando] = useState(false);

  const guardar = useMutation({
    mutationFn: async () => {
      const t = (s: string) => s.trim();
      let id = liceo?.id;
      if (!id) {
        id = (await api.post<Liceo>('/liceos', {
          codigo: t(datos.codigo), nombre: t(datos.nombre),
          ...(t(datos.comuna) && { comuna: t(datos.comuna) }), ...(t(datos.direccion) && { direccion: t(datos.direccion) }),
          ...(t(datos.telefono) && { telefono: t(datos.telefono) }),
        })).id;
      } else if (JSON.stringify(datos) !== JSON.stringify(original)) {
        await api.patch(`/liceos/${id}`, { nombre: t(datos.nombre), comuna: t(datos.comuna), direccion: t(datos.direccion), telefono: t(datos.telefono) });
      }
      for (const tipo of ['contraparte', 'director'] as const) {
        const c = contactos[tipo];
        if (!t(c.nombre)) continue;
        if (JSON.stringify(c) === JSON.stringify(deContacto(liceo?.[tipo] ?? null))) continue;
        await api.put(`/liceos/${id}/${tipo}`, {
          nombre: t(c.nombre), email: t(c.email) || null,
          ...(t(c.cargo) && { cargo: t(c.cargo) }), ...(t(c.telefono) && { telefono: t(c.telefono) }),
        });
      }
      // Un liceo nuevo ya queda revisado al crearlo.
      if (liceo) await api.put(`/proceso/borrador/liceos/${id}`, { revisado: true });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['liceos'] }); avisar(liceo ? 'Liceo revisado' : 'Liceo agregado'); onCerrar(); },
    onError: (e: Error) => { setError(e.message); qc.invalidateQueries({ queryKey: ['liceos'] }); },
  });
  const desactivar = useMutation({
    mutationFn: () => api.patch(`/liceos/${liceo!.id}`, { activo: false }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['liceos'] }); avisar(`${liceo!.nombre} desactivado`); onCerrar(); },
    onError: (e: Error) => setError(e.message),
  });

  const enviar = () => {
    if (!liceo && !/^\d{2,4}$/.test(datos.codigo.trim())) return setError('El código debe ser numérico, de 2 a 4 dígitos (ej. "29").');
    if (!datos.nombre.trim()) return setError('El nombre del liceo es obligatorio.');
    for (const [tipo, etiqueta] of [['contraparte', 'la contraparte'], ['director', 'el director/a']] as const) {
      const c = contactos[tipo];
      const algo = c.cargo.trim() || c.email.trim() || c.telefono.trim();
      if (algo && !c.nombre.trim()) return setError(`Falta el nombre de ${etiqueta}.`);
      if (c.email.trim() && !esEmail(c.email.trim())) return setError(`El email de ${etiqueta} no tiene un formato válido.`);
    }
    guardar.mutate();
  };

  const campoLiceo = (k: keyof typeof datos, label: string, extra = '') => (
    <div className={extra}>
      <label className="label" htmlFor={`l-${k}`}>{label}</label>
      <input id={`l-${k}`} className="input" value={datos[k]} disabled={k === 'codigo' && !!liceo}
        onChange={(e) => { setDatos({ ...datos, [k]: e.target.value }); setError(''); }} />
    </div>
  );
  const campoContacto = (tipo: 'contraparte' | 'director', k: keyof FormContacto, label: string, tipoInput = 'text') => (
    <div>
      <label className="label" htmlFor={`${tipo}-${k}`}>{label}</label>
      <input id={`${tipo}-${k}`} type={tipoInput} className="input" value={contactos[tipo][k]}
        onChange={(e) => { setContactos({ ...contactos, [tipo]: { ...contactos[tipo], [k]: e.target.value } }); setError(''); }} />
    </div>
  );

  const pie = desactivando ? (
    <>
      <span className="mr-auto self-center text-sm text-red-800">¿Desactivar este liceo?</span>
      <button className="btn-secundario" onClick={() => setDesactivando(false)}>No, volver</button>
      <button className="btn-peligro" disabled={desactivar.isPending} onClick={() => desactivar.mutate()}>Sí, desactivar</button>
    </>
  ) : (
    <>
      {liceo && <button className="mr-auto text-sm text-red-700 hover:underline" onClick={() => setDesactivando(true)}>Desactivar liceo</button>}
      <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
      <button className="btn-primario" disabled={guardar.isPending} onClick={enviar}>
        {liceo ? (liceo.revisado_en ? 'Guardar' : 'Guardar y marcar revisado') : 'Agregar liceo'}
      </button>
    </>
  );

  return (
    <Modal titulo={liceo ? `Revisar: ${liceo.nombre}` : 'Agregar liceo'} onCerrar={onCerrar} ancho="max-w-2xl" pie={pie}>
      <div className="space-y-5">
        {desactivando && (
          <Caja tono="rojo">
            Un liceo desactivado no participa en este proceso ni aparece en los siguientes. Sus datos quedan guardados y se
            puede reactivar desde “Liceos desactivados”. Si solo no participa este año, mejor desmárcalo en la lista.
          </Caja>
        )}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Liceo</h3>
          <div className="grid gap-3 sm:grid-cols-[90px_1fr]">
            {campoLiceo('codigo', 'Código')}
            {campoLiceo('nombre', 'Nombre')}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {campoLiceo('comuna', 'Comuna')}
            {campoLiceo('direccion', 'Dirección')}
            {campoLiceo('telefono', 'Teléfono')}
          </div>
        </section>
        {(['contraparte', 'director'] as const).map((tipo) => (
          <section key={tipo}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {tipo === 'contraparte' ? 'Contraparte (encargado/a de la beca)' : 'Director/a'}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {campoContacto(tipo, 'nombre', 'Nombre')}
              {campoContacto(tipo, 'cargo', 'Cargo (ej. Orientadora, Jefa UTP)')}
              {campoContacto(tipo, 'email', 'Email', 'email')}
              {campoContacto(tipo, 'telefono', 'Teléfono')}
            </div>
            {tipo === 'contraparte' && !contactos.contraparte.email.trim() && (
              <p className="mt-1.5 text-xs text-red-700">Sin email de contraparte, el liceo no recibirá los correos del proceso.</p>
            )}
          </section>
        ))}
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}