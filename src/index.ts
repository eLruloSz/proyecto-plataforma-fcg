import express from 'express';
import cors from 'cors';

import { ApplicationController } from './controllers/ApplicationController';
import { CommunicationController } from './controllers/CommunicationController';

const app = express();

app.use(cors()); 
app.use(express.json());

app.get('/', (req, res) => {
  res.send('¡El servidor está funcionando perfectamente!');
});

// Rutas de Aplicaciones
app.post('/api/applications/:id/submit-form', ApplicationController.submitForm);
app.post('/api/applications/sync-ranking', ApplicationController.syncRanking);

// Rutas de Comunicaciones
app.post('/api/communications/bulk-invite', CommunicationController.sendBulkInvitations);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo exitosamente en http://localhost:${PORT}`);
});