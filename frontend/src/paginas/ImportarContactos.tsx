import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, CampoFormulario, FilaFormulario, Invitado, PreviaFormulario } from '../api';
import { Caja, Etiqueta, Modal, useAviso } from '../ui';

const NOMBRES_CAMPO: Record<CampoFormulario, string> = {
  nombre: 'Nombre completo', apellido1: 'Apellido paterno (si va aparte)', apellido2: 'Apellido materno (si va aparte)',
  rut: 'RUT', liceo: 'Liceo', email: 'Email', telefono: 'Teléfono',
};
const CAMPOS = Object.keys(NOMBRES_CAMPO) as CampoFormulario[];

type Uso = 'nuevo' | 'anterior';
interface Decision {
  incluir: boolean;
  invitadoId: string;
  email: Uso | 'sugerido';
  telefono: Uso;
  rut: Uso;
}

/**
 * Decisión por defecto: lo del formulario reemplaza lo anterior (y el email mal
 * escrito se corrige). Un teléfono que no parece celular no pisa uno que ya estaba.
 */
function decisionInicial(f: FilaFormulario): Decision {
  const telefonoDudoso = !!f.limpio.telefono && !f.limpio.telefono.startsWith('+56');
  return {
    incluir: f.calce === 'CALZA' && !f.repetida,
    invitadoId: f.invitado?.id ?? '',
    email: f.sugerenciaEmail ? 'sugerido' : 'nuevo',
    telefono: telefonoDudoso && f.invitado?.telefono ? 'anterior' : 'nuevo',
    rut: 'nuevo',
  };
}

/**
 * Subir el Excel de respuestas del formulario de Microsoft Forms, revisar a qué
 * invitado corresponde cada respuesta y guardar email, teléfono y RUT.
 */
export function ImportarContactos({ invitados, onCerrar }: { invitados: Invitado[]; onCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const input = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<PreviaFormulario | null>(null);
  const [decisiones, setDecisiones] = useState<Record<number, Decision>>({});
  const [verColumnas, setVerColumnas] = useState(false);
  const [filtro, setFiltro] = useState<'todas' | 'revisar' | 'sin-calce'>('todas');

  const leer = useMutation({
    mutationFn: (v: { archivo: File; mapeo?: Record<string, number | null> }) => {
      const f = new FormData();
      f.append('archivo', v.archivo);
      if (v.mapeo) f.append('mapeo', JSON.stringify(v.mapeo));
      return api.enviarFormulario<PreviaFormulario>('/invitados/importar-contactos/previsualizar', f);
    },
    onSuccess: (p) => {
      setPrevia(p);
      setDecisiones(Object.fromEntries(p.filas.map((f) => [f.fila, decisionInicial(f)])));
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });

  const porId = useMemo(() => new Map(invitados.map((i) => [i.id, i])), [invitados]);
  const filas = previa?.filas ?? [];
  const revisar = (f: FilaFormulario) => f.calce === 'AMBIGUO' || f.avisos.length > 0;

  // Lo que se va a guardar, según las decisiones de cada fila.
  const cambios = useMemo(() => filas.flatMap((f) => {
    const d = decisiones[f.fila];
    if (!d?.incluir || !d.invitadoId) return [];
    const inv = porId.get(d.invitadoId);
    const c: { invitadoId: string; email?: string; telefono?: string; rut?: string } = { invitadoId: d.invitadoId };
    const email = d.email === 'sugerido' ? f.sugerenciaEmail : f.limpio.email;
    if (email && d.email !== 'anterior' && email !== inv?.email) c.email = email;
    if (f.limpio.telefono && d.telefono === 'nuevo' && f.limpio.telefono !== inv?.telefono) c.telefono = f.limpio.telefono;
    if (f.limpio.rut && d.rut === 'nuevo' && f.limpio.rut !== inv?.rut) c.rut = f.limpio.rut;
    return Object.keys(c).length > 1 ? [c] : [];
  }), [filas, decisiones, porId]);

  const repetidos = useMemo(() => {
    const vistos = new Map<string, number>();
    for (const f of filas) {
      const d = decisiones[f.fila];
      if (d?.incluir && d.invitadoId) vistos.set(d.invitadoId, (vistos.get(d.invitadoId) ?? 0) + 1);
    }
    return new Set([...vistos].filter(([, n]) => n > 1).map(([id]) => id));
  }, [filas, decisiones]);

  const guardar = useMutation({
    mutationFn: () => api.post<{ actualizados: number }>('/invitados/importar-contactos', { cambios }),
    onSuccess: (r) => {
      ['invitados', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      avisar(`Datos de contacto actualizados en ${r.actualizados} invitados`);
      onCerrar();
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });

  const cambiar = (fila: number, d: Partial<Decision>) => setDecisiones((x) => ({ ...x, [fila]: { ...x[fila], ...d } }));
  const cambiarColumna = (campo: CampoFormulario, valor: string) => {
    if (!previa || !archivo) return;
    leer.mutate({ archivo, mapeo: { ...previa.mapeo, [campo]: valor ? Number(valor) : null } });
  };

  // --- Paso 1: elegir el archivo -------------------------------------------
  if (!previa) {
    return (
      <Modal titulo="Importar respuestas del formulario" onCerrar={onCerrar} ancho="max-w-lg">
        <div className="space-y-4 text-sm text-gray-700">
          <p>
            Sube el Excel con las respuestas del formulario de <strong>Microsoft Forms</strong>. El sistema busca a qué invitado
            corresponde cada respuesta (por RUT o por liceo y nombre) y te muestra qué datos cambiarían antes de guardar.
          </p>
          <Caja tono="azul" titulo="¿Cómo descargo el Excel?">
            En Microsoft Forms abre el formulario → pestaña <em>Respuestas</em> → <em>Abrir resultados en Excel</em>. Si se abre en el
            navegador, usa <em>Archivo → Guardar como → Descargar una copia</em>. Puede venir con las respuestas de todos los liceos juntas.
          </Caja>
          <input ref={input} type="file" accept=".xlsx" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setArchivo(f); leer.mutate({ archivo: f }); } }} />
          <button className="btn-primario" disabled={leer.isPending} onClick={() => input.current?.click()}>
            {leer.isPending ? 'Leyendo archivo…' : 'Elegir Excel de respuestas'}
          </button>
        </div>
      </Modal>
    );
  }

  // --- Paso 2: revisar y guardar ---------------------------------------------
  const visibles = filas.filter((f) =>
    filtro === 'revisar' ? revisar(f) : filtro === 'sin-calce' ? f.calce === 'SIN_CALCE' : true);
  const r = previa.resumen;
  const paraRevisar = filas.filter(revisar).length;

  return (
    <Modal titulo={`Importar respuestas — ${archivo?.name ?? ''}`} onCerrar={onCerrar} ancho="max-w-6xl"
      pie={<>
        <span className="mr-auto self-center text-sm text-gray-500">
          {repetidos.size > 0
            ? <span className="text-red-700">Hay un mismo invitado elegido en dos filas: deja solo una.</span>
            : <>Se actualizarán <strong className="text-gray-900">{cambios.length}</strong> invitados.</>}
        </span>
        <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className="btn-primario" disabled={!cambios.length || repetidos.size > 0 || guardar.isPending} onClick={() => guardar.mutate()}>
          {guardar.isPending ? 'Guardando…' : `Guardar datos de ${cambios.length} invitados`}
        </button>
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Etiqueta>{r.respuestas} respuestas</Etiqueta>
          <Etiqueta tono="verde">{r.calzan} calzan con un invitado</Etiqueta>
          {paraRevisar > 0 && <Etiqueta tono="amarillo">{paraRevisar} para revisar</Etiqueta>}
          {r.sinCalce > 0 && <Etiqueta tono="rojo">{r.sinCalce} sin calce</Etiqueta>}
          {r.repetidas > 0 && <Etiqueta>{r.repetidas} repetidas (se usa la última)</Etiqueta>}
          <button className="ml-auto text-xs text-gray-500 underline hover:text-gray-900" onClick={() => setVerColumnas(!verColumnas)}>
            {verColumnas ? 'Ocultar columnas' : 'Ver columnas usadas'}
          </button>
        </div>

        {verColumnas && (
          <div className="tarjeta bg-gray-50 p-3">
            <p className="mb-2 text-xs text-gray-500">
              Columnas del Excel que se usan para cada dato. Ojo: las columnas “Correo electrónico” y “Nombre” que agrega Forms
              son la cuenta de quien respondió (suele decir “anonymous”), no las respuestas.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {CAMPOS.map((c) => (
                <label key={c} className="text-xs">
                  <span className="label">{NOMBRES_CAMPO[c]}</span>
                  <select className="input py-1 text-xs" value={previa.mapeo[c] ?? ''} disabled={leer.isPending}
                    onChange={(e) => cambiarColumna(c, e.target.value)}>
                    <option value="">— ninguna —</option>
                    {previa.columnas.map((col) => (
                      <option key={col.indice} value={col.indice}>{col.titulo}{col.ejemplo ? ` (ej: ${col.ejemplo.slice(0, 30)})` : ''}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}
        {!verColumnas && (!previa.mapeo.nombre || !previa.mapeo.email) && (
          <Caja tono="amarillo">
            No se encontró la columna de {!previa.mapeo.nombre ? 'nombre' : 'email'}{' '}
            (<button className="underline" onClick={() => setVerColumnas(true)}>elegirla</button>).
          </Caja>
        )}

        <div className="flex gap-1 text-sm" role="group" aria-label="Filtrar respuestas">
          {([['todas', `Todas (${filas.length})`], ['revisar', `Para revisar (${paraRevisar})`], ['sin-calce', `Sin calce (${r.sinCalce})`]] as const).map(([k, t]) => (
            <button key={k} onClick={() => setFiltro(k)} aria-pressed={filtro === k}
              className={`rounded-full border px-3 py-0.5 text-xs ${filtro === k ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>{t}</button>
          ))}
        </div>

        <div className="tarjeta max-h-[55vh] overflow-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-8" /><th>Respuesta del formulario</th><th className="min-w-[230px]">Invitado</th>
                <th>Email</th><th>Teléfono</th><th>RUT</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const d = decisiones[f.fila];
                const inv = d.invitadoId ? porId.get(d.invitadoId) : undefined;
                const duplicado = d.incluir && d.invitadoId && repetidos.has(d.invitadoId);
                return (
                  <tr key={f.fila} className={`align-top ${!d.incluir ? 'text-gray-400' : ''}`}>
                    <td className="pt-3">
                      <input type="checkbox" checked={d.incluir} disabled={!d.invitadoId}
                        onChange={() => cambiar(f.fila, { incluir: !d.incluir })} aria-label={`Importar la fila ${f.fila}`} />
                    </td>
                    <td className="min-w-[200px]">
                      <div className={d.incluir ? 'font-medium text-gray-900' : ''}>{f.respuesta.nombre ?? '(sin nombre)'}</div>
                      <div className="text-xs text-gray-400">{f.respuesta.liceo ?? 'sin liceo'} · fila {f.fila}</div>
                      {f.avisos.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs text-yellow-800">{f.avisos.map((a, i) => <li key={i}>⚠ {a}</li>)}</ul>
                      )}
                    </td>
                    <td>
                      <select className={`input py-1 text-xs ${duplicado ? 'border-red-400' : ''}`} value={d.invitadoId}
                        onChange={(e) => cambiar(f.fila, { invitadoId: e.target.value, incluir: !!e.target.value })} aria-label={`Invitado de la fila ${f.fila}`}>
                        <option value="">— No importar —</option>
                        {f.candidatos.length > 0 && (
                          <optgroup label="Posibles">
                            {f.candidatos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                          </optgroup>
                        )}
                        <optgroup label="Todos los invitados">
                          {invitados.map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.nombres} {i.apellido_paterno} {i.apellido_materno ?? ''}</option>)}
                        </optgroup>
                      </select>
                      <div className="mt-1 text-xs">
                        {f.calce === 'CALZA' && d.invitadoId === f.invitado?.id && <Etiqueta tono="verde">calza por {f.metodo === 'RUT' ? 'RUT' : 'nombre'}</Etiqueta>}
                        {f.calce === 'AMBIGUO' && !d.invitadoId && <Etiqueta tono="amarillo">{f.candidatos.length} posibles: elige uno</Etiqueta>}
                        {f.calce === 'SIN_CALCE' && !d.invitadoId && <Etiqueta tono="rojo">no está entre los invitados</Etiqueta>}
                        {f.repetida && <Etiqueta>respuesta repetida</Etiqueta>}
                        {duplicado && <span className="ml-1 text-red-700">elegido en otra fila</span>}
                      </div>
                    </td>
                    <td><CeldaDato nuevo={f.limpio.email} anterior={inv?.email ?? null} uso={d.email} sugerencia={f.sugerenciaEmail}
                      original={f.respuesta.email} onUso={(u) => cambiar(f.fila, { email: u })} /></td>
                    <td><CeldaDato nuevo={f.limpio.telefono} anterior={inv?.telefono ?? null} uso={d.telefono}
                      original={f.respuesta.telefono} onUso={(u) => cambiar(f.fila, { telefono: u as Uso })} /></td>
                    <td><CeldaDato nuevo={f.limpio.rut} anterior={inv?.rut ?? null} uso={d.rut}
                      original={f.respuesta.rut} onUso={(u) => cambiar(f.fila, { rut: u as Uso })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Un dato de contacto: lo que trae el formulario y lo que ya había. Si son
 * distintos, se elige cuál queda (por defecto, el del formulario).
 */
function CeldaDato({ nuevo, anterior, uso, sugerencia, original, onUso }: {
  nuevo: string | null; anterior: string | null; uso: Uso | 'sugerido'; sugerencia?: string | null;
  original: string | null; onUso: (u: Uso | 'sugerido') => void;
}) {
  if (!nuevo) {
    return original
      ? <div className="min-w-[150px] text-xs"><div className="text-red-700 line-through">{original}</div><div className="text-gray-400">{anterior ? `queda: ${anterior}` : 'no se carga'}</div></div>
      : <span className="text-xs text-gray-300">—</span>;
  }
  const opciones: { u: Uso | 'sugerido'; valor: string; texto: string }[] = [];
  if (sugerencia) opciones.push({ u: 'sugerido', valor: sugerencia, texto: 'corregido' });
  if (nuevo !== anterior) opciones.push({ u: 'nuevo', valor: nuevo, texto: sugerencia ? 'como lo escribió' : 'del formulario' });
  if (anterior) opciones.push({ u: 'anterior', valor: anterior, texto: nuevo === anterior ? 'sin cambios' : 'el que ya estaba' });
  if (opciones.length === 1) return <div className="min-w-[150px] text-xs text-gray-600">{opciones[0].valor}</div>;
  return (
    <div className="min-w-[170px] space-y-0.5 text-xs">
      {opciones.map((o) => (
        <label key={o.u} className="flex cursor-pointer items-start gap-1.5">
          <input type="radio" className="mt-0.5" checked={uso === o.u} onChange={() => onUso(o.u)} />
          <span><span className={uso === o.u ? 'text-gray-900' : 'text-gray-500'}>{o.valor}</span> <span className="text-gray-400">({o.texto})</span></span>
        </label>
      ))}
    </div>
  );
}