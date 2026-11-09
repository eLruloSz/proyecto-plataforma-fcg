import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, EstadoUsuario, Rol, ROLES, UsuarioAdmin } from '../api';
import { useSesion } from '../sesion';
import { Caja, Cargando, ErrorCarga, Etiqueta, fecha, Modal, useAviso } from '../ui';

const ESTADOS: Record<EstadoUsuario, { texto: string; tono: 'verde' | 'amarillo' | 'rojo' | 'gris' }> = {
  ACTIVO: { texto: 'Activo', tono: 'verde' },
  INVITACION_PENDIENTE: { texto: 'Invitación enviada', tono: 'amarillo' },
  INVITACION_VENCIDA: { texto: 'Invitación vencida', tono: 'rojo' },
  DESACTIVADO: { texto: 'Desactivado', tono: 'gris' },
};

/**
 * Usuarios del sistema (solo el equipo la ve). No hay registro abierto: se
 * invita por correo y la persona crea su contraseña con el enlace.
 */
export function Usuarios() {
  const { usuario } = useSesion();
  const qc = useQueryClient();
  const avisar = useAviso();
  const [invitando, setInvitando] = useState(false);
  const [desactivar, setDesactivar] = useState<UsuarioAdmin | null>(null);
  const lista = useQuery({ queryKey: ['usuarios'], queryFn: () => api.get<UsuarioAdmin[]>('/usuarios') });
  const recargar = () => qc.invalidateQueries({ queryKey: ['usuarios'] });

  const enlace = useMutation({
    mutationFn: (u: UsuarioAdmin) => api.post<{ tipo: 'INVITACION' | 'RESTABLECER'; correoEnviado: boolean }>(`/usuarios/${u.id}/enviar-enlace`),
    onSuccess: (r, u) => {
      recargar();
      if (!r.correoEnviado) return avisar('No se pudo enviar el correo. Revisa la configuración de correo e inténtalo de nuevo.', 'error');
      avisar(r.tipo === 'INVITACION' ? `Invitación reenviada a ${u.email}` : `Enlace para restablecer la contraseña enviado a ${u.email}`);
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });
  const actualizar = useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: { rol?: Rol; activo?: boolean } }) => api.patch(`/usuarios/${id}`, datos),
    onSuccess: () => { recargar(); setDesactivar(null); avisar('Usuario actualizado'); },
    onError: (e: Error) => avisar(e.message, 'error'),
  });

  if (lista.isLoading) return <Cargando />;
  if (lista.error) return <ErrorCarga error={lista.error} />;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="titulo">Usuarios</h1>
          <p className="text-sm text-gray-500">Quiénes pueden entrar al sistema. Las cuentas se crean por invitación.</p>
        </div>
        <button className="btn-primario" onClick={() => setInvitando(true)}>Invitar usuario</button>
      </div>

      <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
        {(Object.keys(ROLES) as Rol[]).map((r) => (
          <div key={r} className="rounded-md border border-gray-200 bg-white px-3 py-2">
            <span className="font-semibold text-gray-800">{ROLES[r].nombre}:</span> {ROLES[r].detalle}
          </div>
        ))}
      </div>

      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Nombre</th>
              <th className="px-4 py-2 font-medium">Rol</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2 font-medium">Último acceso</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lista.data!.map((u) => {
              const yo = u.id === usuario?.id;
              return (
                <tr key={u.id} className={u.activo ? '' : 'text-gray-400'}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{u.nombre}{yo && <span className="ml-1 text-xs font-normal text-gray-400">(tú)</span>}</div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    {yo || !u.activo ? ROLES[u.rol].nombre : (
                      <select className="input w-auto py-1 text-sm" value={u.rol} disabled={actualizar.isPending}
                        aria-label={`Rol de ${u.nombre}`}
                        onChange={(e) => actualizar.mutate({ id: u.id, datos: { rol: e.target.value as Rol } })}>
                        {(Object.keys(ROLES) as Rol[]).map((r) => <option key={r} value={r}>{ROLES[r].nombre}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Etiqueta tono={ESTADOS[u.estado].tono}>{ESTADOS[u.estado].texto}</Etiqueta>
                    {u.estado === 'INVITACION_PENDIENTE' && u.invitacion_vence && (
                      <div className="mt-0.5 text-xs text-gray-400">vence {fecha(u.invitacion_vence)}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{fecha(u.ultimo_acceso)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      {u.activo && !yo && (
                        <button className="btn-secundario btn-chico" disabled={enlace.isPending} onClick={() => enlace.mutate(u)}
                          title={u.estado === 'ACTIVO' ? 'Le llega un enlace para elegir una nueva contraseña' : 'Le llega un enlace nuevo para crear su contraseña'}>
                          {u.estado === 'ACTIVO' ? 'Restablecer contraseña' : 'Reenviar invitación'}
                        </button>
                      )}
                      {!yo && (u.activo
                        ? <button className="btn-peligro btn-chico" onClick={() => setDesactivar(u)}>Desactivar</button>
                        : <button className="btn-secundario btn-chico" disabled={actualizar.isPending}
                            onClick={() => actualizar.mutate({ id: u.id, datos: { activo: true } })}>Activar</button>)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        Tu propio rol y tu cuenta no se pueden cambiar desde aquí; tu nombre y contraseña se cambian en "Mi perfil".
      </p>

      {invitando && <ModalInvitar onCerrar={() => setInvitando(false)} onListo={recargar} />}
      {desactivar && (
        <Modal titulo="Desactivar usuario" ancho="max-w-md" onCerrar={() => setDesactivar(null)}
          pie={<>
            <button className="btn-secundario" onClick={() => setDesactivar(null)}>Cancelar</button>
            <button className="btn-peligro" disabled={actualizar.isPending}
              onClick={() => actualizar.mutate({ id: desactivar.id, datos: { activo: false } })}>Desactivar</button>
          </>}>
          <p className="text-sm text-gray-700">
            <strong>{desactivar.nombre}</strong> ({desactivar.email}) ya no podrá entrar y se cerrarán sus sesiones abiertas.
            Lo que registró en el sistema se mantiene. Puedes volver a activarlo cuando quieras.
          </p>
        </Modal>
      )}
    </div>
  );
}

function ModalInvitar({ onCerrar, onListo }: { onCerrar: () => void; onListo: () => void }) {
  const avisar = useAviso();
  const [datos, setDatos] = useState<{ nombre: string; email: string; rol: Rol }>({ nombre: '', email: '', rol: 'LECTOR' });
  const [error, setError] = useState('');
  const [sinCorreo, setSinCorreo] = useState(false);

  const invitar = useMutation({
    mutationFn: () => api.post<{ id: string; correoEnviado: boolean }>('/usuarios', { ...datos, email: datos.email.trim(), nombre: datos.nombre.trim() }),
    onSuccess: (r) => {
      onListo();
      if (!r.correoEnviado) { setSinCorreo(true); return; }
      avisar(`Invitación enviada a ${datos.email.trim()}`);
      onCerrar();
    },
    onError: (e: Error) => setError(e.message),
  });

  const enviar = () => {
    if (!datos.nombre.trim()) return setError('Ingresa el nombre.');
    if (!/^\S+@\S+\.\S+$/.test(datos.email.trim())) return setError('Ingresa un correo válido.');
    invitar.mutate();
  };

  if (sinCorreo) {
    return (
      <Modal titulo="Invitar usuario" ancho="max-w-md" onCerrar={onCerrar}
        pie={<button className="btn-primario" onClick={onCerrar}>Entendido</button>}>
        <Caja tono="amarillo" titulo="La cuenta se creó, pero no se pudo enviar el correo">
          Revisa la configuración de correo y usa "Reenviar invitación" en la lista.
        </Caja>
      </Modal>
    );
  }

  return (
    <Modal titulo="Invitar usuario" ancho="max-w-md" onCerrar={onCerrar}
      pie={<>
        <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className="btn-primario" disabled={invitar.isPending} onClick={enviar}>{invitar.isPending ? 'Enviando…' : 'Enviar invitación'}</button>
      </>}>
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="inv-nombre">Nombre</label>
          <input id="inv-nombre" className="input" value={datos.nombre} autoFocus
            onChange={(e) => { setDatos({ ...datos, nombre: e.target.value }); setError(''); }} />
        </div>
        <div>
          <label className="label" htmlFor="inv-email">Correo</label>
          <input id="inv-email" type="email" className="input" value={datos.email}
            onChange={(e) => { setDatos({ ...datos, email: e.target.value }); setError(''); }} />
        </div>
        <fieldset>
          <legend className="label">Rol</legend>
          <div className="space-y-2">
            {(Object.keys(ROLES) as Rol[]).map((r) => (
              <label key={r} className={`flex cursor-pointer gap-2 rounded-md border px-3 py-2 text-sm ${datos.rol === r ? 'border-gray-400 bg-gray-50' : 'border-gray-200'}`}>
                <input type="radio" name="rol" className="mt-0.5" checked={datos.rol === r} onChange={() => setDatos({ ...datos, rol: r })} />
                <span><span className="font-medium">{ROLES[r].nombre}</span><span className="block text-xs text-gray-500">{ROLES[r].detalle}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-gray-500">Le llegará un correo con un enlace para crear su contraseña. El enlace vence en 48 horas.</p>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
