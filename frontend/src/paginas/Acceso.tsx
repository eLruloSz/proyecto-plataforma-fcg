import { FormEvent, useEffect, useState } from 'react';
import { api, RespuestaSesion } from '../api';
import { useSesion } from '../sesion';
import { PantallaAcceso } from './Login';

/** Lee el token del fragmento de la URL (#t=...). */
function leerToken(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get('t') ?? '';
}

/**
 * Pantalla del enlace que llega por correo: invitación (crear contraseña) o
 * "¿Olvidaste tu contraseña?" (elegir una nueva). Al terminar, deja la sesión
 * iniciada y va al Inicio.
 */
export function Acceso() {
  const { usarToken } = useSesion();
  const [token] = useState(leerToken);
  const [info, setInfo] = useState<{ tipo: 'INVITACION' | 'RESTABLECER'; email: string; nombre: string } | null>(null);
  const [errorEnlace, setErrorEnlace] = useState('');
  const [nombre, setNombre] = useState('');
  const [pw, setPw] = useState({ nueva: '', repetir: '' });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    // El token no queda en el historial ni a la vista.
    window.history.replaceState(null, '', '/acceso');
    if (!token) { setErrorEnlace('El enlace está incompleto. Ábrelo de nuevo desde el correo.'); return; }
    api.post<NonNullable<typeof info>>('/auth/enlace/ver', { token })
      .then((r) => { setInfo(r); setNombre(r.nombre); })
      .catch((e: Error) => setErrorEnlace(e.message));
  }, [token]);

  const irAlInicio = () => window.location.replace('/');

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.nueva.length < 10) return setError('La contraseña debe tener al menos 10 caracteres.');
    if (pw.nueva !== pw.repetir) return setError('Las contraseñas no coinciden.');
    setEnviando(true);
    setError('');
    try {
      const r = await api.post<RespuestaSesion>('/auth/enlace/usar', {
        token, password: pw.nueva, ...(info?.tipo === 'INVITACION' && nombre.trim() ? { nombre: nombre.trim() } : {}),
      });
      await usarToken(r.token);
      irAlInicio();
    } catch (err) {
      setError((err as Error).message);
      setEnviando(false);
    }
  };

  if (errorEnlace) {
    return (
      <PantallaAcceso>
        <h2 className="subtitulo mb-2 text-center">No se pudo usar el enlace</h2>
        <p className="text-sm text-gray-600" role="alert">{errorEnlace}</p>
        <p className="mt-3 text-xs text-gray-500">
          Si era una invitación, pide a la fundación que te la reenvíe. Si querías restablecer tu contraseña, pide un enlace nuevo
          con "¿Olvidaste tu contraseña?".
        </p>
        <button type="button" className="btn-secundario mt-5 w-full py-2" onClick={irAlInicio}>Ir a iniciar sesión</button>
      </PantallaAcceso>
    );
  }
  if (!info) return <PantallaAcceso><p className="py-6 text-center text-sm text-gray-400">Revisando el enlace…</p></PantallaAcceso>;

  const invitacion = info.tipo === 'INVITACION';
  return (
    <PantallaAcceso onEnviar={enviar}>
      <h2 className="subtitulo mb-1 text-center">{invitacion ? 'Crea tu contraseña' : 'Elige una nueva contraseña'}</h2>
      <p className="mb-5 text-center text-sm text-gray-500">{info.email}</p>
      {invitacion && (
        <div className="mb-3">
          <label className="label" htmlFor="nombre">Tu nombre</label>
          <input id="nombre" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" />
        </div>
      )}
      {/* Campo oculto para que el gestor de contraseñas asocie la clave al correo. */}
      <input type="email" autoComplete="username" value={info.email} readOnly hidden />
      <label className="label" htmlFor="nueva">Contraseña (mínimo 10 caracteres)</label>
      <input id="nueva" type="password" autoComplete="new-password" className="input mb-3" value={pw.nueva} autoFocus
        onChange={(e) => { setPw({ ...pw, nueva: e.target.value }); setError(''); }} />
      <label className="label" htmlFor="repetir">Repetir contraseña</label>
      <input id="repetir" type="password" autoComplete="new-password" className="input" value={pw.repetir}
        onChange={(e) => { setPw({ ...pw, repetir: e.target.value }); setError(''); }} />
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      <button className="btn-primario mt-5 w-full py-2" disabled={enviando}>
        {enviando ? 'Guardando…' : invitacion ? 'Crear contraseña y entrar' : 'Guardar y entrar'}
      </button>
    </PantallaAcceso>
  );
}
