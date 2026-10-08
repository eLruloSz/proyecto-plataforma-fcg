import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, EnvioDetalle, Grupo, GRUPOS, Invitado, Liceo, Plantilla, PreviaEnvio, PROPOSITOS, SolicitudEnvio } from '../api';
import { Caja, Etiqueta, useAviso } from '../ui';

interface Inicial {
  grupo?: Grupo;
  liceoIds?: string[];
  base?: EnvioDetalle;
  reenviar?: EnvioDetalle;
}

const ESTUDIANTES = { todos: 'Todos los invitados', PENDIENTE: 'Solo los que no han respondido', CONFIRMADO: 'Solo los que aceptaron' } as const;

/** Redactar un correo → revisar a quién le llega → enviar. */
export function Redactor({ inicial, onCancelar }: { inicial: Inicial; onCancelar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const navegar = useNavigate();
  const cuerpoRef = useRef<HTMLTextAreaElement>(null);

  const { data: plantillas } = useQuery({ queryKey: ['plantillas'], queryFn: () => api.get<Plantilla[]>('/comunicacion/plantillas') });
  const { data: liceos } = useQuery({ queryKey: ['liceos'], queryFn: () => api.get<Liceo[]>('/liceos') });
  const { data: invitados } = useQuery({ queryKey: ['invitados'], queryFn: () => api.get<Invitado[]>('/invitados') });
  const { data: info } = useQuery({ queryKey: ['variables'], queryFn: () => api.get<{ variables: Record<string, string>; modoSimulacion: boolean }>('/comunicacion/variables') });

  const origen = inicial.reenviar ?? inicial.base;
  const [grupo, setGrupo] = useState<Grupo>(origen?.grupo ?? inicial.grupo ?? 'CONTRAPARTES');
  const [liceoIds, setLiceoIds] = useState<string[]>(inicial.liceoIds ?? []);
  const [estudiantes, setEstudiantes] = useState<keyof typeof ESTUDIANTES>('todos');
  const [plantillaId, setPlantillaId] = useState<string>(origen?.plantilla_id ?? '');
  const [proposito, setProposito] = useState(origen?.proposito ?? 'OTRO');
  const [asunto, setAsunto] = useState(inicial.reenviar ? `Recordatorio: ${inicial.reenviar.asunto}` : origen?.asunto ?? '');
  const [cuerpo, setCuerpo] = useState(origen?.cuerpo ?? '');
  const [adjuntos, setAdjuntos] = useState<{ id: string; nombre: string }[]>(origen?.adjuntos.map((a) => ({ id: a.id, nombre: a.nombre_original })) ?? []);
  const [buscarLiceo, setBuscarLiceo] = useState('');
  const [previa, setPrevia] = useState<PreviaEnvio | null>(null);
  const [excluir, setExcluir] = useState<Set<string>>(new Set());
  const [verEjemplo, setVerEjemplo] = useState(0);
  const [error, setError] = useState('');
  const [guardandoPlantilla, setGuardandoPlantilla] = useState(false);
  const [nombrePlantilla, setNombrePlantilla] = useState('');

  // Cualquier cambio en el correo invalida la revisión.
  useEffect(() => { setPrevia(null); setError(''); }, [grupo, liceoIds, estudiantes, asunto, cuerpo]);

  const aplicarPlantilla = (id: string) => {
    setPlantillaId(id);
    const p = plantillas?.find((x) => x.id === id);
    if (!p) return;
    setAsunto(p.asunto); setCuerpo(p.cuerpo); setProposito(p.proposito);
    setAdjuntos(p.adjuntos.map((a) => ({ id: a.id, nombre: a.nombre })));
    if (p.proposito === 'INVITACION_ESTUDIANTES') setGrupo('POSTULANTES');
  };

  const insertarVariable = (v: string) => {
    const t = cuerpoRef.current;
    const marca = `{{${v}}}`;
    if (!t) return setCuerpo((c) => c + marca);
    const [a, b] = [t.selectionStart, t.selectionEnd];
    setCuerpo(cuerpo.slice(0, a) + marca + cuerpo.slice(b));
    requestAnimationFrame(() => { t.focus(); t.setSelectionRange(a + marca.length, a + marca.length); });
  };

  const solicitud = (): SolicitudEnvio => {
    const s: SolicitudEnvio = { grupo, proposito, asunto, cuerpo, adjuntoIds: adjuntos.map((a) => a.id) };
    if (plantillaId) s.plantillaId = plantillaId;
    if (inicial.reenviar) s.envioOrigenId = inicial.reenviar.id;
    else if (grupo === 'LICEO') s.liceoIds = liceoIds;
    else if (grupo === 'POSTULANTES' && estudiantes !== 'todos') {
      s.postulacionIds = (invitados ?? []).filter((i) => i.confirmacion === estudiantes).map((i) => i.id);
    }
    return s;
  };

  const revisar = useMutation({
    mutationFn: () => api.post<PreviaEnvio>('/comunicacion/envios/previsualizar', solicitud()),
    onSuccess: (p) => { setPrevia(p); setExcluir(new Set()); setVerEjemplo(0); },
    onError: (e: Error) => setError(e.message),
  });
  const enviar = useMutation({
    mutationFn: () => api.post<EnvioDetalle>('/comunicacion/envios', { ...solicitud(), excluir: [...excluir] }),
    onSuccess: (e) => {
      avisar(`Enviando ${e.total} correos…`);
      ['envios', 'dashboard', 'hitos'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      navegar(`/comunicacion/envios/${e.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });
  const subirAdjunto = useMutation({
    mutationFn: (f: File) => api.subir<{ id: string; nombre: string }>('/comunicacion/adjuntos', f),
    onSuccess: (a) => setAdjuntos((l) => [...l, a]),
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  const guardarPlantilla = useMutation({
    mutationFn: () => api.post<Plantilla>('/comunicacion/plantillas', { nombre: nombrePlantilla, proposito, asunto, cuerpo }),
    onSuccess: async (p) => {
      for (const a of adjuntos) {
        // los archivos ya subidos se asocian a la plantilla nueva (no se vuelven a subir)
        await api.post(`/comunicacion/plantillas/${p.id}/adjuntos-existentes`, { archivoId: a.id });
      }
      qc.invalidateQueries({ queryKey: ['plantillas'] });
      setPlantillaId(p.id); setGuardandoPlantilla(false); avisar('Plantilla guardada');
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });

  const validar = () => {
    if (!asunto.trim() || !cuerpo.trim()) return 'Escribe el asunto y el cuerpo del correo.';
    if (grupo === 'LICEO' && !inicial.reenviar && !liceoIds.length) return 'Elige al menos un liceo.';
    return '';
  };

  const liceosFiltrados = useMemo(() => (liceos ?? []).filter((l) => `${l.codigo} ${l.nombre}`.toLowerCase().includes(buscarLiceo.toLowerCase())), [liceos, buscarLiceo]);
  const aEnviar = previa ? previa.destinatarios.filter((d) => !excluir.has(d.clave)) : [];
  const ejemplo = aEnviar[Math.min(verEjemplo, aEnviar.length - 1)];

  return (
    <div className="max-w-4xl space-y-4">
      {info?.modoSimulacion && (
        <Caja tono="azul">El servidor está en <strong>modo simulación</strong>: los correos se registran pero no se envían (falta configurar SMTP).</Caja>
      )}
      {inicial.reenviar && (
        <Caja tono="amarillo">
          Recordatorio para quienes <strong>no han respondido</strong> el correo “{inicial.reenviar.asunto_visible}”. Se usan los datos de contacto actuales (si corregiste un email, se usa el nuevo).
        </Caja>
      )}

      <div className="tarjeta space-y-4 p-5">
        {/* Destinatarios */}
        {!inicial.reenviar && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="grupo">Para</label>
              <select id="grupo" className="input" value={grupo} onChange={(e) => setGrupo(e.target.value as Grupo)}>
                {(Object.keys(GRUPOS) as Grupo[]).map((g) => <option key={g} value={g}>{GRUPOS[g]}</option>)}
              </select>
              {grupo === 'POSTULANTES' && (
                <select className="input mt-2" value={estudiantes} onChange={(e) => setEstudiantes(e.target.value as keyof typeof ESTUDIANTES)} aria-label="Qué estudiantes">
                  {Object.entries(ESTUDIANTES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="label" htmlFor="plantilla">Plantilla</label>
              <select id="plantilla" className="input" value={plantillaId} onChange={(e) => aplicarPlantilla(e.target.value)}>
                <option value="">Sin plantilla</option>
                {plantillas?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <label className="label mt-2" htmlFor="proposito">Tipo de correo</label>
              <select id="proposito" className="input" value={proposito} onChange={(e) => setProposito(e.target.value)}>
                {Object.entries(PROPOSITOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </div>
          </div>
        )}

        {grupo === 'LICEO' && !inicial.reenviar && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="label mb-0">Liceos ({liceoIds.length} elegidos) — el correo va a su contraparte</span>
              <input className="input w-48 py-1 text-xs" placeholder="Buscar…" value={buscarLiceo} onChange={(e) => setBuscarLiceo(e.target.value)} aria-label="Buscar liceo" />
            </div>
            <div className="max-h-44 overflow-y-auto rounded-md border border-gray-200 p-2">
              {liceosFiltrados.map((l) => (
                <label key={l.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-gray-50">
                  <input type="checkbox" checked={liceoIds.includes(l.id)}
                    onChange={(e) => setLiceoIds((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} />
                  <span className="text-gray-400">{l.codigo}.</span> {l.nombre}
                  {!l.contraparte?.email && <span className="text-xs text-red-700">sin email</span>}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Contenido */}
        <div>
          <label className="label" htmlFor="asunto">Asunto</label>
          <input id="asunto" className="input" value={asunto} onChange={(e) => setAsunto(e.target.value)} />
        </div>
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <label className="label mb-0 mr-1" htmlFor="cuerpo">Cuerpo</label>
            <span className="text-xs text-gray-400">Insertar:</span>
            {info && Object.entries(info.variables).map(([v, desc]) => (
              <button key={v} type="button" title={desc} onClick={() => insertarVariable(v)}
                className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] text-gray-600 hover:bg-gray-100">{`{{${v}}}`}</button>
            ))}
          </div>
          <textarea id="cuerpo" ref={cuerpoRef} rows={11} className="input font-mono text-[13px] leading-relaxed" value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} />
          <p className="mt-1 text-xs text-gray-400">Cada destinatario recibe su propio correo, con las variables reemplazadas por sus datos.</p>
        </div>

        <div>
          <span className="label">Adjuntos</span>
          <div className="flex flex-wrap items-center gap-2">
            {adjuntos.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs">
                📎 {a.nombre}
                <button onClick={() => setAdjuntos((l) => l.filter((x) => x.id !== a.id))} className="ml-1 text-gray-400 hover:text-red-700" aria-label={`Quitar ${a.nombre}`}>✕</button>
              </span>
            ))}
            <label className="btn-secundario btn-chico cursor-pointer">
              {subirAdjunto.isPending ? 'Subiendo…' : '+ Adjuntar archivo'}
              <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subirAdjunto.mutate(f); e.target.value = ''; }} />
            </label>
          </div>
        </div>

        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-4">
          <div className="flex gap-2">
            <button className="btn-secundario" onClick={onCancelar}>Cancelar</button>
            {!guardandoPlantilla
              ? <button className="btn-secundario" disabled={!asunto || !cuerpo} onClick={() => { setNombrePlantilla(asunto.slice(0, 80)); setGuardandoPlantilla(true); }}>Guardar como plantilla</button>
              : <div className="flex gap-1">
                  <input className="input w-56 py-1" value={nombrePlantilla} onChange={(e) => setNombrePlantilla(e.target.value)} placeholder="Nombre de la plantilla" aria-label="Nombre de la plantilla" />
                  <button className="btn-primario" disabled={!nombrePlantilla.trim()} onClick={() => guardarPlantilla.mutate()}>Guardar</button>
                  <button className="btn-secundario" onClick={() => setGuardandoPlantilla(false)}>✕</button>
                </div>}
          </div>
          <button className="btn-primario" disabled={revisar.isPending} onClick={() => { const m = validar(); m ? setError(m) : revisar.mutate(); }}>
            {revisar.isPending ? 'Revisando…' : 'Revisar destinatarios →'}
          </button>
        </div>
      </div>

      {/* Revisión antes de enviar */}
      {previa && (
        <div className="tarjeta space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="subtitulo">Le llegará a {aEnviar.length} destinatario{aEnviar.length === 1 ? '' : 's'}</h2>
            <button className="btn-primario" disabled={!aEnviar.length || enviar.isPending} onClick={() => enviar.mutate()}>
              {enviar.isPending ? 'Enviando…' : `Enviar a ${aEnviar.length}`}
            </button>
          </div>
          {previa.advertencias.map((a) => <Caja key={a} tono="amarillo">{a}</Caja>)}

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="label">Destinatarios (desmarca para no enviarle)</div>
              <div className="max-h-80 overflow-y-auto rounded-md border border-gray-200">
                {previa.destinatarios.map((d) => (
                  <label key={d.clave} className={`flex cursor-pointer items-start gap-2 border-b border-gray-100 px-3 py-2 text-sm last:border-0 hover:bg-gray-50 ${excluir.has(d.clave) ? 'opacity-50' : ''}`}>
                    <input type="checkbox" className="mt-1" checked={!excluir.has(d.clave)}
                      onChange={() => setExcluir((s) => { const n = new Set(s); n.has(d.clave) ? n.delete(d.clave) : n.add(d.clave); return n; })} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{d.liceo}</span>
                      <span className="block truncate text-xs text-gray-500">{d.nombre}{d.cargo ? ` (${d.cargo})` : ''} · {d.email}</span>
                    </span>
                    <button type="button" className="text-xs text-gray-400 hover:text-gray-900" onClick={(e) => { e.preventDefault(); setVerEjemplo(aEnviar.findIndex((x) => x.clave === d.clave)); }}
                      disabled={excluir.has(d.clave)}>{ejemplo?.clave === d.clave ? 'viendo' : 'ver'}</button>
                  </label>
                ))}
              </div>
              {previa.excluidos.length > 0 && (
                <div className="mt-3">
                  <div className="label">No se enviará a ({previa.excluidos.length})</div>
                  <ul className="space-y-1 text-sm">
                    {previa.excluidos.map((x) => (
                      <li key={x.clave} className="flex justify-between gap-2"><span className="truncate">{x.liceo}{x.nombre && !x.nombre.startsWith('(') ? ` — ${x.nombre}` : ''}</span><Etiqueta tono="rojo">{x.motivo}</Etiqueta></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div>
              <div className="label">Así lo verá {ejemplo ? ejemplo.nombre : ''}</div>
              {ejemplo ? (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm">
                  <div className="text-xs text-gray-500">Para: {ejemplo.email}</div>
                  <div className="mb-3 font-semibold">{ejemplo.asunto}</div>
                  <div className="whitespace-pre-wrap leading-relaxed text-gray-800">{ejemplo.cuerpo}</div>
                  {adjuntos.length > 0 && <div className="mt-3 text-xs text-gray-500">📎 {adjuntos.map((a) => a.nombre).join(', ')}</div>}
                </div>
              ) : <p className="text-sm text-gray-400">No hay destinatarios.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
