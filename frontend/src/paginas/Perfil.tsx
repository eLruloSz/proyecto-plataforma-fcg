import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, EstadoLogoFirma, RespuestaSesion } from '../api';
import { useSesion } from '../sesion';
import { useAviso } from '../ui';

export function Perfil() {
  const { usuario, refrescar, usarToken } = useSesion();
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
    mutationFn: () => api.post<RespuestaSesion>('/auth/yo/password', { actual: pw.actual, nueva: pw.nueva }),
    // Cambiar la clave cierra las demás sesiones; esta sigue con el token nuevo.
    onSuccess: async (r) => {
      await usarToken(r.token);
      setPw({ actual: '', nueva: '', repetir: '' });
      avisar('Contraseña actualizada. Se cerraron tus sesiones en otros equipos.');
    },
    onError: (e: Error) => setErrorPw(e.message),
  });

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="titulo">Mi perfil</h1>
        <p className="text-sm text-gray-500">{usuario?.email} · {usuario?.rol === 'LECTOR' ? 'Solo lectura' : 'Equipo'}</p>
      </div>
      <div className="tarjeta space-y-3 p-5">
        <div><label className="label" htmlFor="nom">Nombre</label><input id="nom" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div>
          <label className="label" htmlFor="firma">Firma de los correos</label>
          <textarea id="firma" rows={5} className="input" value={firma} onChange={(e) => setFirma(e.target.value)} />
          <p className="mt-1 text-xs text-gray-400">Se inserta donde una plantilla diga {'{{firma}}'}. Debajo va el logo de los correos.</p>
        </div>
        <button className="btn-primario" disabled={guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button>
      </div>
      <LogoCorreos puedeEditar={usuario?.rol !== 'LECTOR'} />
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

/** Logo que va al final de todos los correos (uno para todo el equipo). */
function LogoCorreos({ puedeEditar }: { puedeEditar: boolean }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const { data: estado } = useQuery({ queryKey: ['logo-firma'], queryFn: () => api.get<EstadoLogoFirma>('/comunicacion/logo-firma') });
  const { data: imagen } = useQuery({
    queryKey: ['logo-firma', 'imagen', estado?.modo, estado?.actualizadoEn],
    enabled: !!estado && estado.modo !== 'NINGUNO',
    queryFn: () => api.blob('/comunicacion/logo-firma/imagen'),
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!imagen) { setUrl(null); return; }
    const u = URL.createObjectURL(imagen);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [imagen]);

  const listo = (mensaje: string) => (e: EstadoLogoFirma) => { qc.setQueryData(['logo-firma'], e); avisar(mensaje); };
  const error = (e: Error) => avisar(e.message, 'error');
  const subir = useMutation({ mutationFn: (f: File) => api.subir<EstadoLogoFirma>('/comunicacion/logo-firma', f), onSuccess: listo('Logo actualizado'), onError: error });
  const quitar = useMutation({ mutationFn: () => api.del<EstadoLogoFirma>('/comunicacion/logo-firma'), onSuccess: listo('Los correos saldrán sin logo'), onError: error });
  const restaurar = useMutation({ mutationFn: () => api.post<EstadoLogoFirma>('/comunicacion/logo-firma/predeterminado'), onSuccess: listo('Se usa el logo de la fundación'), onError: error });
  const ocupado = subir.isPending || quitar.isPending || restaurar.isPending;

  return (
    <div className="tarjeta space-y-3 p-5">
      <div>
        <h2 className="subtitulo">Logo de los correos</h2>
        <p className="text-sm text-gray-500">Va al final de todos los correos, debajo de la firma. Es el mismo para todo el equipo.</p>
      </div>
      <div className="flex min-h-[90px] items-center justify-center rounded-md border border-dashed border-gray-200 bg-white p-4">
        {estado?.modo === 'NINGUNO'
          ? <span className="text-sm text-gray-400">Los correos salen sin logo.</span>
          : url ? <img src={url} alt="Logo de los correos" className="h-auto w-[240px]" /> : <span className="text-sm text-gray-400">Cargando…</span>}
      </div>
      {estado && (
        <p className="text-xs text-gray-400">
          {estado.modo === 'PREDETERMINADO' ? 'Logo de la fundación (incluido en el sistema).'
            : estado.modo === 'PERSONALIZADO' ? `Logo subido: ${estado.nombre}.` : 'Sin logo.'}
        </p>
      )}
      {puedeEditar && (
        <div className="flex flex-wrap gap-2">
          <label className={`btn-secundario cursor-pointer ${ocupado ? 'pointer-events-none opacity-50' : ''}`}>
            {subir.isPending ? 'Subiendo…' : 'Subir otro logo'}
            <input type="file" accept="image/png,image/jpeg" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) subir.mutate(f); e.target.value = ''; }} />
          </label>
          {estado?.modo !== 'PREDETERMINADO' && (
            <button className="btn-secundario" disabled={ocupado} onClick={() => restaurar.mutate()}>Usar el logo de la fundación</button>
          )}
          {estado?.modo !== 'NINGUNO' && (
            <button className="btn-secundario" disabled={ocupado} onClick={() => quitar.mutate()}>Enviar sin logo</button>
          )}
        </div>
      )}
      {puedeEditar && <p className="text-xs text-gray-400">PNG o JPG de hasta 1 MB. Se muestra a 240 px de ancho; para que se vea nítido, súbelo de unos 480 px.</p>}
    </div>
  );
}
