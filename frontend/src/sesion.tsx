import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { alExpirarSesion, api, guardarToken, obtenerToken, RespuestaSesion, Rol } from './api';

interface Usuario { id: string; email: string; nombre: string; firma?: string | null; rol: Rol }
interface Sesion {
  usuario: Usuario | null;
  cargando: boolean;
  /** Cuenta de solo lectura (ej. director de la fundación): ve todo, no modifica. */
  soloLectura: boolean;
  entrar: (email: string, password: string) => Promise<void>;
  /** Deja la sesión iniciada con un token recibido (al usar un enlace o cambiar la clave). */
  usarToken: (token: string) => Promise<void>;
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

  const usarToken = async (token: string) => {
    guardarToken(token);
    await refrescar();
  };
  const entrar = async (email: string, password: string) => {
    const r = await api.post<RespuestaSesion>('/auth/login', { email, password });
    await usarToken(r.token);
  };

  return (
    <Ctx.Provider value={{ usuario, cargando, soloLectura: usuario?.rol === 'LECTOR', entrar, usarToken, salir, refrescar }}>
      {children}
    </Ctx.Provider>
  );
}
