import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { ProveedorSesion, useSesion } from './sesion';
import { ProveedorAvisos, Cargando, ErrorCarga } from './ui';
import { Layout } from './Layout';
import { Login } from './paginas/Login';
import { Dashboard } from './paginas/Dashboard';
import { Liceos } from './paginas/Liceos';
import { DetalleLiceo } from './paginas/DetalleLiceo';
import { Seguimiento } from './paginas/Seguimiento';
import { Invitados } from './paginas/Invitados';
import { Comunicacion } from './paginas/Comunicacion';
import { DetalleEnvio } from './paginas/DetalleEnvio';
import { Perfil } from './paginas/Perfil';
import { Avance } from './paginas/Avance';
import { PantallaInicio, useInicio } from './paginas/InicioProceso';

const cliente = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 } },
});

function Rutas() {
  const { usuario, cargando } = useSesion();
  const inicio = useInicio(!!usuario);
  if (cargando) return <Cargando />;
  if (!usuario) return <Login />;
  // Sin proceso activo solo se muestra la pantalla para iniciarlo.
  if (inicio.isLoading) return <Cargando />;
  if (inicio.error || !inicio.data) return <div className="p-6"><ErrorCarga error={inicio.error} /></div>;
  if (!inicio.data.activo) return <PantallaInicio inicio={inicio.data} />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="liceos" element={<Liceos />} />
        <Route path="liceos/:id" element={<DetalleLiceo />} />
        <Route path="seguimiento" element={<Seguimiento />} />
        <Route path="invitados" element={<Invitados />} />
        <Route path="comunicacion" element={<Comunicacion />} />
        <Route path="comunicacion/envios/:id" element={<DetalleEnvio />} />
        <Route path="avance" element={<Avance />} />
        <Route path="avance/:etapaId" element={<Avance />} />
        <Route path="perfil" element={<Perfil />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={cliente}>
      <BrowserRouter>
        <ProveedorAvisos>
          <ProveedorSesion>
            <Rutas />
          </ProveedorSesion>
        </ProveedorAvisos>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);