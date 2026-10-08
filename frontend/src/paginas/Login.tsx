import { FormEvent, useState } from 'react';
import { useSesion } from '../sesion';

export function Login() {
  const { entrar } = useSesion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { setError('Ingresa tu correo y contraseña.'); return; }
    setEnviando(true);
    setError('');
    try { await entrar(email.trim(), password); }
    catch (err) { setError((err as Error).message); }
    finally { setEnviando(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <form onSubmit={enviar} className="tarjeta w-full max-w-sm p-6 shadow-sm" noValidate>
        <h1 className="text-base font-bold text-gray-900">Beca Carmen Goudie</h1>
        <p className="mb-5 text-sm text-gray-500">Sistema de gestión de postulaciones</p>
        <label className="label" htmlFor="email">Correo</label>
        <input id="email" type="email" autoComplete="username" className="input mb-3" value={email}
          onChange={(e) => { setEmail(e.target.value); setError(''); }} autoFocus />
        <label className="label" htmlFor="pass">Contraseña</label>
        <input id="pass" type="password" autoComplete="current-password" className="input" value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }} />
        {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
        <button className="btn-primario mt-5 w-full py-2" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}
