// src/controllers/ApplicationController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { EmailService } from '../services/EmailService';

const prisma = new PrismaClient();
const emailService = new EmailService();

export class ApplicationController {
  
  // Endpoint: POST /api/applications/:id/submit-form
  static async submitForm(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { phone, rshPercentage, activities, workshopId } = req.body;

      // 1. Lógica de Filtro RSH
      let nextStatus = 'FORM_SUBMITTED';
      if (rshPercentage > 50) {
        nextStatus = 'REJECTED';
      } else if (rshPercentage > 40 && rshPercentage <= 50) {
        nextStatus = 'FORM_SUBMITTED_UNDER_REVIEW';
      }

      // 2. Actualizar Postulación
      const application = await prisma.application.update({
        where: { id },
        data: { 
          user: { update: { phone } },
          rshPercentage, 
          activities,
          workshopId,
          status: nextStatus as any 
        },
        include: { user: true }
      });

      // 3. Trazabilidad: Notificar al estudiante
      if (nextStatus === 'REJECTED') {
        await emailService.sendTemplate(application.user.email, 'REJECTION_RSH', { name: application.user.email });
      } else {
        await emailService.sendTemplate(application.user.email, 'FORM_RECEIVED', { name: application.user.email });
      }

      res.status(200).json({ success: true, application });
    } catch (error) {
      res.status(500).json({ error: 'Error procesando formulario' });
    }
  }
}

// src/controllers/CommunicationController.ts
export class CommunicationController {
  // Endpoint: POST /api/communications/bulk-invite
  static async sendBulkInvitations(req: Request, res: Response) {
    const { applicationIds, templateId } = req.body;
    
    const applications = await prisma.application.findMany({
      where: { id: { in: applicationIds } },
      include: { user: true, school: true }
    });

    // Enviar correos en paralelo limitando concurrencia
    const promises = applications.map(app => 
      emailService.sendTemplate(app.user.email, templateId, {
        schoolName: app.school.name,
        actionUrl: `https://beca.org/invite/${app.id}`
      })
    );
    
    await Promise.all(promises);
    
    // Actualizar estado a INVITED
    await prisma.application.updateMany({
      where: { id: { in: applicationIds } },
      data: { status: 'INVITED' }
    });

    res.status(200).json({ message: `${applications.length} correos enviados y estados actualizados.` });
  }
}