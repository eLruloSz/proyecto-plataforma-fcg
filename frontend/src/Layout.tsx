import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Etapa, Proceso } from './api';
import { useSesion } from './sesion';
import { Modal, useAviso } from './ui';

const MENU = [
  { a: '/', texto: 'Dashboard', fin: true },
  { a: '/liceos', texto: 'Liceos y nóminas' },
  { a: '/invitados', texto: 'Invitados' },
  { a: '/comunicacion', texto: 'Comunicación' },
  { a: '/seguimiento', texto: 'Seguimiento por liceo' },
];

export function useProceso() {
  return useQuery({ queryKey: ['proceso'], queryFn: () => api.get<Proceso>('/proceso') });
}

/** Barra de etapas: verde = cerrada, amarillo = activa, gris = pendiente. */
function BarraEtapas() {
  const { data } = useProceso();
  const qc = useQueryClient();
  const avisar = useAviso();
  const [elegida, setElegida] = useState<Etapa | null>(null);
  const activar = useMutation({
    mutationFn: (id: string) => api.post<Proceso>(`/proceso/etapas/${id}/activar`),
    onSuccess: (p) => {
      qc.setQueryData(['proceso'], p);
      avisar(`Etapa activa: ${elegida?.nombre}`);
      setElegida(null);
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  if (!data) return <div className="h-14" />;

  const estilo = {
    CERRADA: 'border-green-600 bg-green-50 text-green-700',
    ACTIVA: 'border-yellow-500 bg-yellow-50 text-yellow-700 ring-4 ring-yellow-100',
    PENDIENTE: 'border-gray-300 bg-gray-50 text-gray-400',
  };
  const texto = { CERRADA: 'text-green-700', ACTIVA: 'text-yellow-700 font-semibold', PENDIENTE: 'text-gray-400' };

  return (
    <>
      <ol className="flex items-center overflow-x-auto pb-1" aria-label="Etapas del proceso">
        {data.etapas.map((e, i) => (
          <li key={e.id} className="flex flex-1 items-center last:flex-none">
            <button
              onClick={() => e.estado !== 'ACTIVA' && setElegida(e)}
              title={`${e.nombre}${e.descripcion ? ' — ' + e.descripcion : ''}`}
              className="group flex min-w-[96px] flex-col items-center gap-1"
              aria-current={e.estado === 'ACTIVA' ? 'step' : undefined}
            >
              <span className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold transition group-hover:scale-110 ${estilo[e.estado]}`}>
                {e.estado === 'CERRADA' ? '✓' : e.orden}
              </span>
              <span className={`max-w-[130px] text-center text-xs leading-tight ${texto[e.estado]}`}>{e.nombre}</span>
            </button>
            {i < data.etapas.length - 1 && (
              <span className={`mx-1 mb-5 h-0.5 min-w-[16px] flex-1 ${data.etapas[i + 1].estado === 'PENDIENTE' ? 'bg-gray-200' : 'bg-green-600'}`} />
            )}
          </li>
        ))}
      </ol>
      {elegida && (
        <Modal titulo="Cambiar la etapa activa" onCerrar={() => setElegida(null)} ancho="max-w-md"
          pie={<>
            <button className="btn-secundario" onClick={() => setElegida(null)}>Cancelar</button>
            <button className="btn-primario" disabled={activar.isPending} onClick={() => activar.mutate(elegida.id)}>
              Activar etapa {elegida.orden}
            </button>
          </>}>
          <p className="text-sm text-gray-700">
            ¿Pasar a <strong>{elegida.nombre}</strong>? Las etapas anteriores quedarán como terminadas (verde) y las siguientes como pendientes.
          </p>
          {elegida.estado === 'CERRADA' && <p className="mt-2 text-sm text-gray-500">Puedes volver atrás si activaste una etapa por error.</p>}
        </Modal>
      )}
    </>
  );
}

export function Layout() {
  const { usuario, salir } = useSesion();
  const { data: proceso } = useProceso();
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-gray-200 bg-gray-50">
        <div className="border-b border-gray-200 px-4 py-4">
          <div className="text-sm font-bold tracking-tight text-gray-900">Beca Carmen Goudie</div>
          <div className="mt-0.5 text-xs text-gray-500">{proceso?.nombre ?? 'Sistema de gestión'}</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {MENU.map((m) => (
            <NavLink key={m.a} to={m.a} end={m.fin}
              className={({ isActive }) => `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-white font-semibold text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-600 hover:bg-gray-100'}`}>
              {m.texto}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gray-200 p-3 text-xs">
          <NavLink to="/perfil" className="block truncate font-medium text-gray-800 hover:underline">{usuario?.nombre}</NavLink>
          <div className="truncate text-gray-500">{usuario?.email}</div>
          <button onClick={salir} className="mt-2 text-gray-500 hover:text-gray-900">Cerrar sesión</button>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-gray-200 bg-white px-6 py-3"><BarraEtapas /></div>
        <div className="flex-1 overflow-y-auto p-6"><Outlet /></div>
      </main>
    </div>
  );
}
