import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { Participacion } from './api';

// --- Avisos flotantes ---------------------------------------------------------
type TipoAviso = 'ok' | 'error' | 'info';
const AvisoCtx = createContext<(msg: string, tipo?: TipoAviso) => void>(() => {});
export const useAviso = () => useContext(AvisoCtx);

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<{ id: number; msg: string; tipo: TipoAviso }[]>([]);
  const avisar = useCallback((msg: string, tipo: TipoAviso = 'ok') => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l, { id, msg, tipo }]);
    setTimeout(() => setLista((l) => l.filter((x) => x.id !== id)), tipo === 'error' ? 6000 : 3500);
  }, []);
  const colores = { ok: 'bg-green-700', error: 'bg-red-700', info: 'bg-gray-800' };
  return (
    <AvisoCtx.Provider value={avisar}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex max-w-sm flex-col gap-2" role="status" aria-live="polite">
        {lista.map((a) => (
          <div key={a.id} className={`${colores[a.tipo]} rounded-md px-4 py-2.5 text-sm text-white shadow-lg`}>{a.msg}</div>
        ))}
      </div>
    </AvisoCtx.Provider>
  );
}

// --- Modal -------------------------------------------------------------------
export function Modal({ titulo, onCerrar, children, ancho = 'max-w-2xl', pie }: {
  titulo: string; onCerrar: () => void; children: ReactNode; ancho?: string; pie?: ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-10" onMouseDown={onCerrar}>
      <div role="dialog" aria-modal="true" aria-label={titulo}
        className={`w-full ${ancho} rounded-lg bg-white text-left shadow-xl`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="subtitulo">{titulo}</h2>
          <button onClick={onCerrar} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Cerrar">✕</button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {pie && <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">{pie}</div>}
      </div>
    </div>
  );
}

// --- Etiquetas de estado -----------------------------------------------------
const TONOS = {
  verde: 'bg-green-50 text-green-800 border-green-200',
  amarillo: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  rojo: 'bg-red-50 text-red-800 border-red-200',
  gris: 'bg-gray-50 text-gray-600 border-gray-200',
  azul: 'bg-blue-50 text-blue-800 border-blue-200',
};
export function Etiqueta({ tono = 'gris', children }: { tono?: keyof typeof TONOS; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium ${TONOS[tono]}`}>{children}</span>;
}

export function EtiquetaParticipacion({ estado }: { estado: Participacion }) {
  if (estado === 'PARTICIPA') return <Etiqueta tono="verde">Participa</Etiqueta>;
  if (estado === 'NO_PARTICIPA') return <Etiqueta tono="rojo">No participa</Etiqueta>;
  return <Etiqueta tono="gris">Sin respuesta</Etiqueta>;
}

export function Punto({ color, titulo }: { color: 'verde' | 'amarillo' | 'rojo' | 'gris'; titulo?: string }) {
  const c = { verde: 'bg-green-600', amarillo: 'bg-yellow-500', rojo: 'bg-red-600', gris: 'bg-gray-300' }[color];
  return <span title={titulo} className={`inline-block h-2.5 w-2.5 rounded-full ${c}`} />;
}

// --- Estados de carga y vacíos ----------------------------------------------
export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <div className="py-10 text-center text-sm text-gray-400">{texto}</div>;
}
export function ErrorCarga({ error }: { error: unknown }) {
  return <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{(error as Error)?.message ?? 'Error al cargar.'}</div>;
}
export function Vacio({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-gray-400">{children}</div>;
}
export function Caja({ tono, titulo, children }: { tono: 'amarillo' | 'rojo' | 'azul' | 'verde'; titulo?: string; children: ReactNode }) {
  const c = { amarillo: 'border-yellow-200 bg-yellow-50 text-yellow-900', rojo: 'border-red-200 bg-red-50 text-red-900', azul: 'border-blue-200 bg-blue-50 text-blue-900', verde: 'border-green-200 bg-green-50 text-green-900' }[tono];
  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${c}`}>
      {titulo && <div className="mb-1 font-semibold">{titulo}</div>}
      {children}
    </div>
  );
}

// --- Formatos ----------------------------------------------------------------
export function fecha(iso: string | null | undefined, conHora = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-CL', conHora
    ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}
export const nota = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toFixed(2).replace('.', ','));
export const nombreCompleto = (x: { nombres: string; apellido_paterno: string; apellido_materno?: string | null }) =>
  `${x.apellido_paterno}${x.apellido_materno ? ' ' + x.apellido_materno : ''}, ${x.nombres}`;
