import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { useSesion } from '../sesion';
import { useAviso } from '../ui';

export function Perfil() {
  const { usuario, refrescar } = useSesion();
  const avisar = useAviso();
  const [nombre, setNombre] = useState(usuario?.nombre ?? '');
  const [firma, setFirma] = useState(usuario?.firma ?? '');
  const [pw, setPw] = useState({ actual: '', nueva: '', repetir: '' });
  const [errorPw, setErrorPw] = useState('');

  const guardar = useMutation({
    mutationFn: () => api.patch('/auth/yo', { nombre, firma }),
    onSuccess: async () => { await refrescar(); avisar('Perfil guardado'); },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  const cambiar = useMutation({
    mutationFn: () => api.post('/auth/yo/password', { actual: pw.actual, nueva: pw.nueva }),
    onSuccess: () => { setPw({ actual: '', nueva: '', repetir: '' }); avisar('Contraseña actualizada'); },
    onError: (e: Error) => setErrorPw(e.message),
  });

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="titulo">Mi perfil</h1>
      <div className="tarjeta space-y-3 p-5">
        <div><label className="label" htmlFor="nom">Nombre</label><input id="nom" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div>
          <label className="label" htmlFor="firma">Firma de los correos</label>
          <textarea id="firma" rows={5} className="input" value={firma} onChange={(e) => setFirma(e.target.value)} />
          <p className="mt-1 text-xs text-gray-400">Se inserta donde una plantilla diga {'{{firma}}'}.</p>
        </div>
        <button className="btn-primario" disabled={guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button>
      </div>
      <div className="tarjeta space-y-3 p-5">
        <h2 className="subtitulo">Cambiar contraseña</h2>
        {(['actual', 'nueva', 'repetir'] as const).map((k) => (
          <div key={k}>
            <label className="label" htmlFor={`pw-${k}`}>{{ actual: 'Contraseña actual', nueva: 'Nueva (mínimo 10 caracteres)', repetir: 'Repetir nueva' }[k]}</label>
            <input id={`pw-${k}`} type="password" className="input" value={pw[k]} onChange={(e) => { setPw({ ...pw, [k]: e.target.value }); setErrorPw(''); }} />
          </div>
        ))}
        {errorPw && <p className="text-sm text-red-700" role="alert">{errorPw}</p>}
        <button className="btn-secundario" disabled={cambiar.isPending} onClick={() => {
          if (pw.nueva.length < 10) return setErrorPw('La nueva contraseña debe tener al menos 10 caracteres.');
          if (pw.nueva !== pw.repetir) return setErrorPw('Las contraseñas nuevas no coinciden.');
          cambiar.mutate();
        }}>Cambiar contraseña</button>
      </div>
    </div>
  );
}
