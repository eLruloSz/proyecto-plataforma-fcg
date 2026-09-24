import ApplicationForm from './components/ApplicationForm';

function App() {
  // Datos de prueba que coinciden con lo que espera tu componente y tu backend
  const mockApplicationId = "postulacion-1"; 
  const mockWorkshops = [
    { id: "taller-1", date: "2026-10-01 15:00", title: "Taller Inducción Beca Carmen Goudie" },
    { id: "taller-2", date: "2026-10-02 10:00", title: "Taller Inducción Beca Carmen Goudie" }
  ];

  return (
    <div className="min-h-screen bg-gray-100 py-10 px-4">
      <header className="max-w-2xl mx-auto mb-8 text-center">
        <h1 className="text-3xl font-extrabold text-blue-900">Plataforma Beca Carmen Goudie</h1>
        <p className="text-gray-600 mt-2">Completa los datos de tu postulación oficial</p>
      </header>
      
      <main>
        <ApplicationForm 
          applicationId={mockApplicationId} 
          availableWorkshops={mockWorkshops} 
        />
      </main>
    </div>
  );
}

export default App;