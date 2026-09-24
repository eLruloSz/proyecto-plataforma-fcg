import express from 'express';
import { ApplicationController } from './controllers/ApplicationController';

const app = express();

// Esto permite que el servidor entienda la información en formato JSON que envíe el Frontend
app.use(express.json());

// Ruta de prueba para saber si el servidor está vivo
app.get('/', (req, res) => {
  res.send('¡El servidor de la Beca Carmen Goudie está funcionando perfectamente!');
});

// La ruta real de postulación que conectará con tu frontend
app.post('/api/applications/:id/submit-form', ApplicationController.submitForm);

// Encender el servidor en el puerto 3000
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo exitosamente en http://localhost:${PORT}`);
});