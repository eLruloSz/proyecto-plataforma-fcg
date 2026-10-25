import { useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Etapa, Proceso } from './api';
import { useSesion } from './sesion';
import { Modal, useAviso } from './ui';
import { EtapaCtx, menuDeEtapa, useEtapa } from './etapa';

export function useProceso() {
  return useQuery({ queryKey: ['proceso'], queryFn: () => api.get<Proceso>('/proceso') });
}

const CLAVE_VISTA = 'becas_etapa_vista';
const leerVista = () => { try { return sessionStorage.getItem(CLAVE_VISTA); } catch { return null; } };
const guardarVista = (id: string | null) => {
  try { if (id) sessionStorage.setItem(CLAVE_VISTA, id); else sessionStorage.removeItem(CLAVE_VISTA); } catch { /* sin almacenamiento */ }
};

/**
 * Barra de etapas: verde = terminada, amarillo = en curso, gris = pendiente.
 * Un clic en una etapa terminada la abre para consultarla (no retrocede el
 * proceso); un clic en la etapa en curso vuelve a ella.
 */
function BarraEtapas() {
  const { data } = useProceso();
  const { vista, consultando, verEtapa } = useEtapa();
  const navegar = useNavigate();
  if (!data) return <div className="h-14" />;

  const estilo = {
    CERRADA: 'border-green-600 bg-green-50 text-green-700',
    ACTIVA: 'border-yellow-500 bg-yellow-50 text-yellow-700 ring-4 ring-yellow-100',
    PENDIENTE: 'border-gray-300 bg-gray-50 text-gray-400',
  };
  const texto = { CERRADA: 'text-green-700', ACTIVA: 'text-yellow-700 font-semibold', PENDIENTE: 'text-gray-400' };
  const ir = (e: Etapa) => {
    if (e.estado === 'PENDIENTE') return;
    verEtapa(e.estado === 'ACTIVA' ? null : e.id);
    navegar('/');
  };

  return (
    <ol className="flex items-center overflow-x-auto pb-1" aria-label="Etapas del proceso">
      {data.etapas.map((e, i) => {
        const mirando = consultando && vista?.id === e.id;
        return (
          <li key={e.id} className="flex flex-1 items-center last:flex-none">
            <button
              onClick={() => ir(e)}
              disabled={e.estado === 'PENDIENTE'}
              title={e.estado === 'PENDIENTE' ? `${e.nombre}: comienza al terminar la etapa anterior`
                : e.estado === 'CERRADA' ? `${e.nombre}: terminada (clic para consultarla)` : `${e.nombre}: etapa en curso`}
              className="group flex min-w-[96px] flex-col items-center gap-1 disabled:cursor-default"
              aria-current={e.estado === 'ACTIVA' ? 'step' : undefined}
            >
              <span className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold transition ${e.estado !== 'PENDIENTE' ? 'group-hover:scale-110' : ''} ${estilo[e.estado]} ${mirando ? 'ring-4 ring-gray-300' : ''}`}>
                {e.estado === 'CERRADA' ? '✓' : e.orden}
              </span>
              <span className={`max-w-[130px] text-center text-xs leading-tight ${texto[e.estado]} ${mirando ? 'underline underline-offset-2' : ''}`}>{e.nombre}</span>
            </button>
            {i < data.etapas.length - 1 && (
              <span className={`mx-1 mb-5 h-0.5 min-w-[16px] flex-1 ${data.etapas[i + 1].estado === 'PENDIENTE' ? 'bg-gray-200' : 'bg-green-600'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Aviso mientras se consulta una etapa que no es la que está en curso. */
function AvisoConsulta() {
  const { actual, vista, consultando, verEtapa } = useEtapa();
  const qc = useQueryClient();
  const avisar = useAviso();
  const navegar = useNavigate();
  const [reactivando, setReactivando] = useState(false);
  const reactivar = useMutation({
    mutationFn: (id: string) => api.post<Proceso>(`/proceso/etapas/${id}/activar`),
    onSuccess: (p) => {
      qc.setQueryData(['proceso'], p);
      ['tareas', 'avance', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      avisar(`La etapa en curso vuelve a ser ${vista?.nombre}`);
      setReactivando(false);
      verEtapa(null);
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  if (!consultando || !vista || !actual) return null;
  const terminada = vista.estado === 'CERRADA';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
      <span>
        Estás viendo la etapa <strong>{vista.orden}. {vista.nombre}</strong> ({terminada ? 'terminada' : 'aún no comienza'}).
        {terminada && ' Puedes consultar y corregir datos.'}
      </span>
      <div className="ml-auto flex gap-2">
        {terminada && (
          <button className="text-xs text-amber-800 underline hover:text-amber-950" onClick={() => setReactivando(true)}>Volver a activar esta etapa…</button>
        )}
        <button className="btn-secundario btn-chico" onClick={() => { verEtapa(null); navegar('/'); }}>
          Volver a la etapa en curso ({actual.orden}. {actual.nombre})
        </button>
      </div>
      {reactivando && (
        <Modal titulo="Volver a activar una etapa terminada" onCerrar={() => setReactivando(false)} ancho="max-w-md"
          pie={<>
            <button className="btn-secundario" onClick={() => setReactivando(false)}>Cancelar</button>
            <button className="btn-peligro" disabled={reactivar.isPending} onClick={() => reactivar.mutate(vista.id)}>Activar etapa {vista.orden}</button>
          </>}>
          <p className="text-sm text-gray-700">
            El proceso vuelve a <strong>{vista.nombre}</strong> y las etapas siguientes quedan como pendientes. Úsalo solo si se
            terminó la etapa por error; para corregir un dato no hace falta.
          </p>
        </Modal>
      )}
    </div>
  );
}

export function Layout() {
  const { usuario, salir } = useSesion();
  const { data: proceso } = useProceso();
  const [vistaId, setVistaId] = useState<string | null>(leerVista);

  const contexto = useMemo(() => {
    const actual = proceso?.etapas.find((e) => e.estado === 'ACTIVA') ?? proceso?.etapas[0] ?? null;
    const elegida = proceso?.etapas.find((e) => e.id === vistaId) ?? null;
    const vista = elegida ?? actual;
    return {
      actual, vista,
      consultando: !!vista && !!actual && vista.id !== actual.id,
      verEtapa: (id: string | null) => { guardarVista(id); setVistaId(id); },
    };
  }, [proceso, vistaId]);

  const { vista, consultando } = contexto;
  const enlace = ({ isActive }: { isActive: boolean }) =>
    `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-white font-semibold text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-600 hover:bg-gray-100'}`;

  return (
    <EtapaCtx.Provider value={contexto}>
      {/* Alto fijo de pantalla: solo se desplaza el contenido; el menú y la barra
          de etapas quedan quietos (y lo "sticky" de las páginas funciona). */}
      <div className="flex h-screen overflow-hidden">
        <aside className="flex w-56 flex-shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-gray-50">
          <div className="border-b border-gray-200 px-4 py-4">
            <div className="text-sm font-bold tracking-tight text-gray-900">Beca Carmen Goudie</div>
            <div className="mt-0.5 text-xs text-gray-500">{proceso?.nombre ?? 'Sistema de gestión'}</div>
          </div>
          <nav className="flex-1 p-2">
            <NavLink to="/" end className={enlace}>Inicio</NavLink>
            {vista && (
              <div className="mt-3">
                <div className={`px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide ${consultando ? 'text-amber-700' : 'text-gray-400'}`}>
                  Etapa {vista.orden} · {consultando ? 'consulta' : 'en curso'}
                </div>
                <div className="px-3 pb-1.5 text-xs leading-tight text-gray-600">{vista.nombre}</div>
                <div className="space-y-0.5">
                  {menuDeEtapa(vista).map((m) => <NavLink key={m.a} to={m.a} className={enlace}>{m.texto}</NavLink>)}
                </div>
              </div>
            )}
            <div className="mt-3 border-t border-gray-200 pt-3">
              <NavLink to="/comunicacion" className={enlace}>Comunicación</NavLink>
            </div>
          </nav>
          <div className="px-2 pb-2">
            <NavLink to="/generaciones" className={({ isActive }) => `block rounded-md px-3 py-1.5 text-xs ${isActive ? 'font-semibold text-gray-900' : 'text-gray-500 hover:bg-gray-100'}`}>
              Generaciones anteriores
            </NavLink>
          </div>
          <div className="border-t border-gray-200 p-3 text-xs">
            <NavLink to="/perfil" className="block truncate font-medium text-gray-800 hover:underline">{usuario?.nombre}</NavLink>
            <div className="truncate text-gray-500">{usuario?.email}</div>
            <button onClick={salir} className="mt-2 text-gray-500 hover:text-gray-900">Cerrar sesión</button>
          </div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="border-b border-gray-200 bg-white px-6 py-3"><BarraEtapas /></div>
          <AvisoConsulta />
          <div className="min-h-0 flex-1 overflow-y-auto p-6"><Outlet /></div>
        </main>
      </div>
    </EtapaCtx.Provider>
  );
}