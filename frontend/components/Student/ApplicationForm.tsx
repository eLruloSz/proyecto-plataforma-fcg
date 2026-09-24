// components/Student/ApplicationForm.tsx
import { useForm } from 'react-hook-form';

export default function ApplicationForm({ applicationId, availableWorkshops }: { applicationId: string, availableWorkshops: any[] }) {
  const { register, handleSubmit } = useForm();

 const onSubmit = async (data: any) => {
    await fetch(`/api/applications/${applicationId}/submit-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    // Redirigir a pantalla de éxito/trazabilidad
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl mx-auto p-8 border rounded shadow-sm">
      <h3 className="text-xl font-bold mb-6">Paso 1: Completa tu Postulación</h3>
      
      <div className="mb-4">
        <label className="block mb-1 font-semibold">Teléfono de Contacto (WhatsApp)</label>
        <input {...register("phone")} type="tel" className="w-full border p-2 rounded" required />
      </div>

      <div className="mb-4">
        <label className="block mb-1 font-semibold">Porcentaje Registro Social de Hogares (%)</label>
        <input {...register("rshPercentage")} type="number" max="100" min="0" className="w-full border p-2 rounded" required />
        <span className="text-sm text-gray-500">Postulantes sobre 50% quedarán fuera del proceso automáticamente.</span>
      </div>

      <div className="mb-6">
        <label className="block mb-1 font-semibold">Selecciona fecha para el Taller Online</label>
        <select {...register("workshopId")} className="w-full border p-2 rounded" required>
          {availableWorkshops.map(w => (
            <option key={w.id} value={w.id}>{w.date} - {w.title}</option>
          ))}
        </select>
      </div>

      <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded font-bold">
        Enviar Postulación
      </button>
    </form>
  );
}