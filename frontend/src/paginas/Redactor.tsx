import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, EnvioDetalle, FiltroEtapa, Grupo, GRUPOS, Invitado, Liceo, ModoCopia, Plantilla, PreviaEnvio, PROPOSITOS, SolicitudEnvio, TipoFiltroEtapa } from '../api';
import { useProceso } from '../Layout';
import { PROPOSITOS_DE_ETAPA, tipoEtapa, useEtapa } from '../etapa';
import { Caja, Etiqueta, useAviso } from '../ui';

interface Inicial {
  grupo?: Grupo;
  liceoIds?: string[];
  base?: EnvioDetalle;
  reenviar?: EnvioDetalle;
  filtroEtapa?: FiltroEtapa;
}

const TEXTO_FILTRO: Record<TipoFiltroEtapa, string> = {
  EN_ETAPA: 'los estudiantes que están en',
  FALTAN_REQUISITOS: 'los estudiantes a los que les faltan documentos en',
  PASA: 'los estudiantes que avanzan',
  NO_PASA: 'los estudiantes que no continúan después de',
};

const ESTUDIANTES = { todos: 'Todos los invitados', PENDIENTE: 'Solo los que no han respondido', CONFIRMADO: 'Solo los que aceptaron' } as const;

/** Redactar un correo → revisar a quién le llega → enviar. */
export function Redactor({ inicial, onCancelar }: { inicial: Inicial; onCancelar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const navegar = useNavigate();
  const adjuntoExterno = useSearchParams()[0].get('adjunto');
  const cuerpoRef = useRef<HTMLTextAreaElement>(null);

  const { data: plantillas } = useQuery({ queryKey: ['plantillas'], queryFn: () => api.get<Plantilla[]>('/comunicacion/plantillas') });
  const { data: liceos } = useQuery({ queryKey: ['liceos'], queryFn: () => api.get<Liceo[]>('/liceos') });
  const { data: invitados } = useQuery({ queryKey: ['invitados'], queryFn: () => api.get<Invitado[]>('/invitados') });
  const { data: sugeridosCc } = useQuery({ queryKey: ['cc-sugeridos'], queryFn: () => api.get<{ nombre: string; email: string }[]>('/comunicacion/cc-sugeridos') });
  const { data: info } = useQuery({ queryKey: ['variables'], queryFn: () => api.get<{ variables: Record<string, string>; modoSimulacion: boolean }>('/comunicacion/variables') });

  const { data: proceso } = useProceso();
  const { vista } = useEtapa();
  // Plantillas de la etapa que se está mirando primero; el resto, aparte.
  const deEtapa = vista ? PROPOSITOS_DE_ETAPA[tipoEtapa(vista)] : [];
  const plantillasEtapa = (plantillas ?? []).filter((p) => deEtapa.includes(p.proposito));
  const plantillasOtras = (plantillas ?? []).filter((p) => !deEtapa.includes(p.proposito));
  const filtro = inicial.filtroEtapa;
  const etapaFiltro = proceso?.etapas.find((e) => e.id === filtro?.etapaId);
  const origen = inicial.reenviar ?? inicial.base;
  const [grupo, setGrupo] = useState<Grupo>(filtro ? 'POSTULANTES' : origen?.grupo ?? inicial.grupo ?? 'CONTRAPARTES');
  const [liceoIds, setLiceoIds] = useState<string[]>(inicial.liceoIds ?? []);
  const [estudiantes, setEstudiantes] = useState<keyof typeof ESTUDIANTES>('todos');
  const [correosExtra, setCorreosExtra] = useState('');
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
  // Copia (CC): por defecto los demás usuarios del equipo (o la copia del correo que se reenvía).
  const [cc, setCc] = useState<string[] | null>(origen?.cc ?? null);
  const [ccOtros, setCcOtros] = useState('');
  const [ccModo, setCcModo] = useState<ModoCopia>(origen?.cc_modo ?? (inicial.grupo === 'LICEO' ? 'CADA' : 'RESUMEN'));
  useEffect(() => { if (cc === null && sugeridosCc) setCc(sugeridosCc.map((u) => u.email)); }, [sugeridosCc, cc]);
  const ccEscritos = [...new Set(ccOtros.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  const ccInvalidos = ccEscritos.filter((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  const ccFinal = [...new Set([...(cc ?? []), ...ccEscritos.filter((x) => !ccInvalidos.includes(x))])];
  const [guardandoPlantilla, setGuardandoPlantilla] = useState(false);
  const [nombrePlantilla, setNombrePlantilla] = useState('');

  // Cualquier cambio en el correo invalida la revisión.
  useEffect(() => { setPrevia(null); setError(''); }, [grupo, liceoIds, estudiantes, correosExtra, asunto, cuerpo]);

  // Directivos de la fundación: las cuentas de solo lectura van solas; aquí se pueden sumar otros correos.
  const extras = [...new Set(correosExtra.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  const extrasInvalidos = extras.filter((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));

  const aplicarPlantilla = (id: string) => {
    setPlantillaId(id);
    const p = plantillas?.find((x) => x.id === id);
    if (!p) return;
    setAsunto(p.asunto); setCuerpo(p.cuerpo); setProposito(p.proposito);
    // El archivo que viene de otra pantalla (por ejemplo, el Excel de la selección final) se conserva; los de la plantilla anterior no.
    setAdjuntos((actual) => [...actual.filter((a) => a.id === adjuntoExterno), ...p.adjuntos.map((a) => ({ id: a.id, nombre: a.nombre }))]);
    if (p.proposito === 'INFORME_DIRECTIVOS' && !filtro) setGrupo('DIRECTIVOS');
    // Invitación: si la plantilla trae el listado de estudiantes va a las contrapartes de los liceos;
    // si no, a cada estudiante.
    if (p.proposito === 'INVITACION_ESTUDIANTES' && !filtro) {
      setGrupo(/\{\{\s*(lista_)?estudiantes\s*\}\}/i.test(p.asunto + p.cuerpo) ? 'CONTRAPARTES' : 'POSTULANTES');
    }
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
    if (ccFinal.length) { s.cc = ccFinal; s.ccModo = ccModo; }
    if (inicial.reenviar) s.envioOrigenId = inicial.reenviar.id;
    else if (filtro) s.filtroEtapa = filtro;
    else if (grupo === 'LICEO') s.liceoIds = liceoIds;
    else if (grupo === 'DIRECTIVOS') s.correosExtra = extras;
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
    if (grupo === 'DIRECTIVOS' && extrasInvalidos.length) return `Revisa estos correos: ${extrasInvalidos.join(', ')}`;
    if (ccInvalidos.length) return `Revisa los correos de la copia: ${ccInvalidos.join(', ')}`;
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

      {filtro && (
        <Caja tono="azul">
          Para: <strong>{TEXTO_FILTRO[filtro.tipo]} {filtro.tipo === 'PASA' ? 'de' : ''} “{etapaFiltro?.nombre ?? 'la etapa'}”</strong>
          {filtro.soloSinAviso ? ' (solo los que aún no han sido avisados)' : ''}.
          {(filtro.tipo === 'PASA' || filtro.tipo === 'NO_PASA') && ' Al enviar, quedan marcados como avisados.'}
          {' '}En “Revisar destinatarios” ves exactamente a quién le llega.
        </Caja>
      )}

      <div className="tarjeta space-y-4 p-5">
        {/* Destinatarios */}
        {!inicial.reenviar && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="grupo">Para</label>
              <select id="grupo" className="input" value={grupo} disabled={!!filtro} onChange={(e) => setGrupo(e.target.value as Grupo)}>
                {(Object.keys(GRUPOS) as Grupo[]).map((g) => <option key={g} value={g}>{GRUPOS[g]}</option>)}
              </select>
              {grupo === 'POSTULANTES' && !filtro && (
                <select className="input mt-2" value={estudiantes} onChange={(e) => setEstudiantes(e.target.value as keyof typeof ESTUDIANTES)} aria-label="Qué estudiantes">
                  {Object.entries(ESTUDIANTES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="label" htmlFor="plantilla">Plantilla</label>
              <select id="plantilla" className="input" value={plantillaId} onChange={(e) => aplicarPlantilla(e.target.value)}>
                <option value="">Sin plantilla</option>
                {plantillasEtapa.length > 0 && (
                  <optgroup label={`Para esta etapa${vista ? ` (${vista.nombre})` : ''}`}>
                    {plantillasEtapa.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </optgroup>
                )}
                <optgroup label={plantillasEtapa.length ? 'Otras plantillas' : 'Plantillas'}>
                  {plantillasOtras.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </optgroup>
              </select>
              <label className="label mt-2" htmlFor="proposito">Tipo de correo</label>
              <select id="proposito" className="input" value={proposito} onChange={(e) => setProposito(e.target.value)}>
                {Object.entries(PROPOSITOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </div>
          </div>
        )}

        {grupo === 'DIRECTIVOS' && !inicial.reenviar && (
          <div>
            <p className="mb-2 text-xs text-gray-500">Le llega a las cuentas de <strong>solo lectura</strong> de la plataforma (las de quienes deciden la beca). Si falta alguien, agrégalo aquí.</p>
            <label className="label" htmlFor="extras">Otros correos (opcional, separados por coma o espacio)</label>
            <textarea id="extras" rows={2} className="input" value={correosExtra} placeholder="direccion@fundacion.cl, otra@fundacion.cl" onChange={(e) => setCorreosExtra(e.target.value)} />
            {extrasInvalidos.length > 0 && <span className="text-xs text-red-700">Revisa: {extrasInvalidos.join(', ')}</span>}
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

        {/* Copia (CC) */}
        <div className="rounded-md border border-gray-200 p-3">
          <span className="label">Copia (CC)</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {(sugeridosCc ?? []).map((u) => (
              <label key={u.email} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={(cc ?? []).includes(u.email)}
                  onChange={(e) => setCc((l) => (e.target.checked ? [...(l ?? []), u.email] : (l ?? []).filter((x) => x !== u.email)))} />
                {u.nombre} <span className="text-xs text-gray-400">{u.email}</span>
              </label>
            ))}
            {sugeridosCc?.length === 0 && <span className="text-xs text-gray-400">No hay otros usuarios del equipo.</span>}
          </div>
          <input className="input mt-2 py-1 text-sm" value={ccOtros} onChange={(e) => setCcOtros(e.target.value)}
            placeholder="Otros correos en copia (opcional, separados por coma)" aria-label="Otros correos en copia" />
          {ccInvalidos.length > 0 && <span className="text-xs text-red-700">Revisa: {ccInvalidos.join(', ')}</span>}
          {ccFinal.length > 0 && (
            <div className="mt-2 space-y-1 text-sm">
              <label className="flex items-start gap-2">
                <input type="radio" className="mt-1" name="cc-modo" checked={ccModo === 'RESUMEN'} onChange={() => setCcModo('RESUMEN')} />
                <span><strong>Una sola copia</strong> <span className="text-gray-500">con el texto del correo y la lista de a quién se envió (recomendado si son varios destinatarios).</span></span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" className="mt-1" name="cc-modo" checked={ccModo === 'CADA'} onChange={() => setCcModo('CADA')} />
                <span><strong>En CC de cada correo</strong> <span className="text-gray-500">como un CC normal: el destinatario ve la copia y la respuesta puede llegarles a todos{previa ? ` (${aEnviar.length} correo${aEnviar.length === 1 ? '' : 's'} = ${aEnviar.length} copia${aEnviar.length === 1 ? '' : 's'})` : ''}.</span></span>
              </label>
            </div>
          )}
        </div>

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
            <h2 className="subtitulo">
              Le llegará a {aEnviar.length} destinatario{aEnviar.length === 1 ? '' : 's'}
              {ccFinal.length > 0 && <span className="ml-2 text-sm font-normal text-gray-500">
                {ccModo === 'RESUMEN' ? `+ 1 copia a ${ccFinal.join(', ')}` : `con copia a ${ccFinal.join(', ')}`}</span>}
            </h2>
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
                  {ccFinal.length > 0 && ccModo === 'CADA' && <div className="text-xs text-gray-500">CC: {ccFinal.join(', ')}</div>}
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