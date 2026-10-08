import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { alExpirarSesion, api, guardarToken, obtenerToken } from './api';

interface Usuario { id: string; email: string; nombre: string; firma?: string | null }
interface Sesion {
  usuario: Usuario | null;
  cargando: boolean;
  entrar: (email: string, password: string) => Promise<void>;
  salir: () => void;
  refrescar: () => Promise<void>;
}

const Ctx = createContext<Sesion>(null as unknown as Sesion);
export const useSesion = () => useContext(Ctx);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

  const salir = () => { guardarToken(null); setUsuario(null); };
  const refrescar = async () => setUsuario(await api.get<Usuario>('/auth/yo'));

  useEffect(() => {
    alExpirarSesion(salir);
    if (!obtenerToken()) { setCargando(false); return; }
    refrescar().catch(salir).finally(() => setCargando(false));
  }, []);

  const entrar = async (email: string, password: string) => {
    const r = await api.post<{ token: string }>('/auth/login', { email, password });
    guardarToken(r.token);
    await refrescar();
  };

  return <Ctx.Provider value={{ usuario, cargando, entrar, salir, refrescar }}>{children}</Ctx.Provider>;
}
