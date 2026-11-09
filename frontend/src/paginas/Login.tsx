import { FormEvent, ReactNode, useState } from 'react';
import { api } from '../api';
import { useSesion } from '../sesion';

/** Marco común de las pantallas sin sesión (login, olvidé mi contraseña, enlace de acceso). */
export function PantallaAcceso({ children, onEnviar }: { children: ReactNode; onEnviar?: (e: FormEvent) => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onEnviar ?? ((e) => e.preventDefault())} className="tarjeta w-full max-w-sm p-6 shadow-sm" noValidate>
        <img src="/logo-fcg.png" alt="Fundación Carmen Goudie" className="mx-auto mb-3 w-64" />
        <h1 className="sr-only">Beca Carmen Goudie</h1>
        {children}
      </form>
    </div>
  );
}

export function Login() {
  const { entrar } = useSesion();
  const [modo, setModo] = useState<'entrar' | 'olvide' | 'enviado'>('entrar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cambiarModo = (m: typeof modo) => { setModo(m); setError(''); setPassword(''); };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (modo === 'olvide') {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Ingresa un correo válido.'); return; }
    } else if (!email.trim() || !password) { setError('Ingresa tu correo y contraseña.'); return; }
    setEnviando(true);
    setError('');
    try {
      if (modo === 'olvide') {
        await api.post('/auth/olvide', { email: email.trim() });
        setModo('enviado');
      } else {
        await entrar(email.trim(), password);
      }
    } catch (err) { setError((err as Error).message); }
    finally { setEnviando(false); }
  };

  if (modo === 'enviado') {
    return (
      <PantallaAcceso>
        <h2 className="subtitulo mb-2 text-center">Revisa tu correo</h2>
        <p className="text-sm text-gray-600">
          Si <strong>{email.trim()}</strong> tiene una cuenta, te llegará un enlace para elegir una nueva contraseña.
          El enlace vence en 1 hora.
        </p>
        <p className="mt-3 text-xs text-gray-400">Si no aparece en unos minutos, revisa la carpeta de spam.</p>
        <button type="button" className="btn-secundario mt-5 w-full py-2" onClick={() => cambiarModo('entrar')}>Volver a iniciar sesión</button>
      </PantallaAcceso>
    );
  }

  const olvide = modo === 'olvide';
  return (
    <PantallaAcceso onEnviar={enviar}>
      <p className="mb-5 text-center text-sm text-gray-500">
        {olvide ? 'Te enviaremos un enlace para elegir una nueva contraseña.' : 'Sistema de gestión de postulaciones'}
      </p>
      <label className="label" htmlFor="email">Correo</label>
      <input id="email" type="email" autoComplete="username" className="input mb-3" value={email}
        onChange={(e) => { setEmail(e.target.value); setError(''); }} autoFocus />
      {!olvide && (
        <>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="pass">Contraseña</label>
            <button type="button" className="text-xs text-gray-500 hover:text-gray-900 hover:underline" onClick={() => cambiarModo('olvide')}>
              ¿Olvidaste tu contraseña?
            </button>
          </div>
          <input id="pass" type="password" autoComplete="current-password" className="input" value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }} />
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      <button className="btn-primario mt-5 w-full py-2" disabled={enviando}>
        {olvide ? (enviando ? 'Enviando…' : 'Enviar enlace') : (enviando ? 'Entrando…' : 'Entrar')}
      </button>
      {olvide && (
        <button type="button" className="mt-3 w-full text-center text-xs text-gray-500 hover:text-gray-900 hover:underline" onClick={() => cambiarModo('entrar')}>
          Volver a iniciar sesión
        </button>
      )}
    </PantallaAcceso>
  );
}
