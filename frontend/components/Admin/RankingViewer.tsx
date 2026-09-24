// components/Admin/RankingViewer.tsx
import { useState } from 'react';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import * as XLSX from 'xlsx';

export default function RankingViewer() {
  const [rows, setRows] = useState([]);
  
  const columns: GridColDef[] = [
    { field: 'id', headerName: 'ID Postulante', width: 150 },
    { field: 'name', headerName: 'Nombre', width: 200 },
    { field: 'school', headerName: 'Liceo', width: 150 },
    { field: 'rsh', headerName: 'RSH %', width: 100 },
    { field: 'gradeScore', headerName: 'Pts Notas (35%)', width: 130 },
    { field: 'totalScore', headerName: 'Puntaje Total', width: 150, editable: true },
  ];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const workbook = XLSX.read(event.target?.result, { type: 'binary' });
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      
      // Mapear datos del excel al formato del DataGrid
      const formattedData = data.map((row: any, index: number) => ({
        id: row.ID || index, // Agregado: Respaldo por si el Excel no tiene columna ID
        name: row.Nombre,
        school: row.Liceo,
        rsh: row.RSH,
        gradeScore: row.PtsNotas,
        totalScore: row.PuntajeFinal,
      }));
      setRows(formattedData as any);
    };
    reader.readAsBinaryString(file);
  };

  const saveRankingToDB = async () => {
    try {
      const response = await fetch('/api/applications/sync-ranking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json' // Agregado: Necesario para que Express lea el body
        },
        body: JSON.stringify({ rankingData: rows })
      });
      
      if(response.ok) {
        alert('Ranking sincronizado con éxito');
      } else {
        alert('Hubo un problema al sincronizar el ranking');
      }
    } catch (error) {
      console.error("Error al guardar:", error);
      alert('Error de conexión con el servidor');
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md h-full">
      <h2 className="text-2xl font-bold mb-4">Gestión de Ranking</h2>
      <div className="flex justify-between mb-4">
        <input 
          type="file" 
          accept=".xlsx, .xls" 
          onChange={handleFileUpload} 
          className="file-input" 
        />
        <button 
          onClick={saveRankingToDB} 
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Guardar Puntajes en Sistema
        </button>
      </div>
      <div style={{ height: 600, width: '100%' }}>
        <DataGrid 
          rows={rows} 
          columns={columns} 
          checkboxSelection 
          disableRowSelectionOnClick
        />
      </div>
    </div>
  );
}