import { Request, Response } from 'express';
import { PrismaClient, ApplicationStatus, Prisma } from '@prisma/client';
import { EmailService } from '../services/EmailService';

const prisma = new PrismaClient();
const emailService = new EmailService();

// Creamos un tipo estricto que le dice a TS que la postulación SÍ trae al usuario adjunto
type AppWithUser = Prisma.ApplicationGetPayload<{
  include: { user: true }
}>;

export class ApplicationController {
  
  static async submitForm(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { phone, rshPercentage, activities, workshopId } = req.body;

      let nextStatus: ApplicationStatus = ApplicationStatus.FORM_SUBMITTED;
      if (Number(rshPercentage) > 50) {
        nextStatus = ApplicationStatus.REJECTED;
      } 

      // Añadimos "as AppWithUser" al final de la consulta
      const application = await prisma.application.update({
        where: { id: String(id) },
        data: { 
          user: { update: { phone: String(phone) } },
          rshPercentage: Number(rshPercentage), 
          activities: (activities || []) as Prisma.InputJsonValue,
          workshopId: workshopId ? String(workshopId) : undefined,
          status: nextStatus
        },
        include: { user: true }
      }) as AppWithUser;

      if (application.status === ApplicationStatus.REJECTED) {
        await emailService.sendTemplate(application.user.email, 'REJECTION_RSH', { name: application.user.email });
      } else {
        await emailService.sendTemplate(application.user.email, 'FORM_RECEIVED', { name: application.user.email });
      }

      res.status(200).json({ success: true, application });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error procesando formulario' });
    }
  }

  static async syncRanking(req: Request, res: Response): Promise<void> {
    try {
      const { rankingData } = req.body;
      
      for (const row of rankingData) {
        await prisma.application.update({
          where: { id: String(row.id) },
          data: { 
            rankingTotal: Number(row.totalScore), 
            status: ApplicationStatus.RANKED 
          }
        });
      }

      res.status(200).json({ success: true, message: 'Ranking sincronizado correctamente' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error al sincronizar el ranking' });
    }
  }
}