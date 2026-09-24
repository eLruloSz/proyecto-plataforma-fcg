import { useState } from 'react';
import { useForm } from 'react-hook-form';

interface ApplicationFormProps {
  applicationId: string;
  availableWorkshops: Array<{ id: string; date: string; title: string }>;
}

export default function ApplicationForm({ applicationId, availableWorkshops }: ApplicationFormProps) {
  const { register, handleSubmit, formState: { isSubmitting } } = useForm();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<boolean>(false);

  const onSubmit = async (data: any) => {
    try {
      setErrorMessage(null);
      
      const response = await fetch(`http://localhost:3000/api/applications/${applicationId}/submit-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: data.phone,
          rshPercentage: Number(data.rshPercentage),
          workshopId: data.workshopId,
          activities: [
            { tipo: "General", nombre: "Postulación Regular", anios: 1 }
          ]
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Ocurrió un error al enviar la postulación.');
      }

      setSuccessMessage(true);
    } catch (error: any) {
      setErrorMessage(error.message);
    }
  };

  if (successMessage) {
    return (
      <div className="max-w-2xl mx-auto p-8 border rounded shadow-sm bg-green-50 text-center">
        <h3 className="text-2xl font-bold text-green-700 mb-2">¡Postulación Enviada con Éxito!</h3>
        <p className="text-gray-600">Hemos recibido tus datos correctamente y te hemos enviado un correo de confirmación.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl mx-auto p-8 border rounded shadow-sm bg-white">
      <h3 className="text-xl font-bold mb-6">Paso 1: Completa tu Postulación</h3>
      
      {errorMessage && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          {errorMessage}
        </div>
      )}

      <div className="mb-4">
        <label className="block mb-1 font-semibold">Teléfono de Contacto (WhatsApp)</label>
        <input {...register("phone")} type="tel" className="w-full border p-2 rounded" placeholder="+569..." required />
      </div>

      <div className="mb-4">
        <label className="block mb-1 font-semibold">Porcentaje Registro Social de Hogares (%)</label>
        <input {...register("rshPercentage")} type="number" max="100" min="0" className="w-full border p-2 rounded" required />
        <span className="text-sm text-gray-500">Postulantes sobre 50% quedarán fuera del proceso automáticamente.</span>
      </div>

      <div className="mb-6">
        <label className="block mb-1 font-semibold">Selecciona fecha para el Taller Online</label>
        <select {...register("workshopId")} className="w-full border p-2 rounded" required>
          <option value="">-- Selecciona un taller --</option>
          {availableWorkshops?.map(w => (
            <option key={w.id} value={w.id}>{w.date} - {w.title}</option>
          ))}
        </select>
      </div>

      <button 
        type="submit" 
        disabled={isSubmitting}
        className="w-full bg-blue-600 text-white py-3 rounded font-bold hover:bg-blue-700 disabled:bg-gray-400"
      >
        {isSubmitting ? 'Enviando...' : 'Enviar Postulación'}
      </button>
    </form>
  );
}