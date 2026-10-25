import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Proceso, TareasEtapa } from '../api';
import { useEtapa } from '../etapa';
import { Caja, Cargando, Modal, useAviso } from '../ui';

/**
 * Terminar la etapa en curso y pasar a la siguiente (avanza la barra de arriba).
 * Se puede terminar aunque queden cosas pendientes: se muestran como advertencia.
 */
export function TerminarEtapa({ etapaId, onCerrar, mensaje }: { etapaId: string; onCerrar: () => void; mensaje?: string }) {
  const qc = useQueryClient();
  const avisar = useAviso();
  const navegar = useNavigate();
  const { verEtapa } = useEtapa();
  // Siempre datos frescos: se abre justo después de confirmar resultados.
  const { data: t, isFetching } = useQuery({
    queryKey: ['tareas', etapaId], queryFn: () => api.get<TareasEtapa>(`/dashboard/tareas?etapaId=${etapaId}`),
    staleTime: 0, refetchOnMount: 'always',
  });

  const terminar = useMutation({
    mutationFn: () => api.post<Proceso>(`/proceso/etapas/${t!.siguiente!.id}/activar`),
    onSuccess: (p) => {
      qc.setQueryData(['proceso'], p);
      ['tareas', 'avance', 'dashboard', 'entrevistas', 'invitados'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      verEtapa(null);
      navegar('/');
      avisar(`Comenzó la etapa ${t!.siguiente!.orden}: ${t!.siguiente!.nombre}`);
      onCerrar();
    },
    onError: (e: Error) => avisar(e.message, 'error'),
  });

  if (!t || isFetching) return <Modal titulo="Terminar etapa" onCerrar={onCerrar} ancho="max-w-lg"><Cargando /></Modal>;
  const pendientes = t.tareas.filter((x) => !x.hecha);
  const r = t.resumen;

  if (!t.siguiente) {
    return (
      <Modal titulo={`Terminar ${t.etapa.nombre}`} onCerrar={onCerrar} ancho="max-w-lg"
        pie={<button className="btn-secundario" onClick={onCerrar}>Entendido</button>}>
        <p className="text-sm text-gray-700">
          Es la última etapa. Cuando esté todo listo, cierra el proceso {''}desde <em>Configurar etapas → Cerrar proceso</em>:
          los datos quedan guardados en Generaciones.
        </p>
      </Modal>
    );
  }

  return (
    <Modal titulo={`Terminar la etapa ${t.etapa.orden}: ${t.etapa.nombre}`} onCerrar={onCerrar} ancho="max-w-lg"
      pie={<>
        <button className="btn-secundario" onClick={onCerrar}>Todavía no</button>
        <button className="btn-primario" disabled={terminar.isPending} onClick={() => terminar.mutate()}>
          {terminar.isPending ? 'Pasando…' : `Pasar a ${t.siguiente.nombre}`}
        </button>
      </>}>
      <div className="space-y-3 text-sm">
        {mensaje && <p className="text-gray-700">{mensaje}</p>}
        <p className="text-gray-700">
          La etapa {t.etapa.orden} queda como terminada (verde) y comienza <strong>{t.siguiente.orden}. {t.siguiente.nombre}</strong>.
          El menú pasa a mostrar lo de la nueva etapa; esta se podrá seguir consultando con un clic en la barra de arriba.
        </p>
        {pendientes.length > 0 ? (
          <Caja tono="amarillo" titulo="Quedan cosas pendientes en esta etapa">
            <ul className="list-disc space-y-0.5 pl-5">
              {pendientes.map((x) => <li key={x.clave}>{x.titulo}: {x.detalle}</li>)}
            </ul>
            {r.pendientes_de_decidir > 0 && (
              <p className="mt-2">Los {r.pendientes_de_decidir} estudiantes sin decidir se quedan en esta etapa hasta que se decida por ellos.</p>
            )}
            <p className="mt-2">Puedes terminarla igual.</p>
          </Caja>
        ) : <Caja tono="verde">Todas las tareas de la etapa están hechas.</Caja>}
      </div>
    </Modal>
  );
}