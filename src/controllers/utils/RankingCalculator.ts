// src/utils/RankingCalculator.ts

export interface ApplicationData {
  nem: number;              // Promedio notas 1º y 2º medio (escala 1.0 a 7.0)
  rshPercentage: number;    // % RSH (ej: 40)
  participationScore: number; // Evaluado por el equipo (escala 1 a 10)
  isPublicSchool: boolean;
}

export class RankingCalculator {
  // Ponderaciones base 1000 puntos
  private static readonly MAX_SCORE = 1000;
  private static readonly GRADES_WEIGHT = 0.35;       // 350 pts
  private static readonly SOCIOECONOMIC_WEIGHT = 0.45; // 450 pts
  private static readonly PARTICIPATION_WEIGHT = 0.20; // 200 pts

  /**
   * Calcula el puntaje total del postulante.
   */
  static calculateTotal(app: ApplicationData): number {
    const gradesScore = this.calculateGradesScore(app.nem);
    const socioScore = this.calculateSocioEconomicScore(app.rshPercentage, app.isPublicSchool);
    const participationScore = this.calculateParticipationScore(app.participationScore);

    return Math.round(gradesScore + socioScore + participationScore);
  }

  // 35% Notas: Interpolación lineal donde NEM 4.0 = 0 pts y NEM 7.0 = 350 pts
  private static calculateGradesScore(nem: number): number {
    if (nem < 4.0) return 0;
    const maxGradesPoints = this.MAX_SCORE * this.GRADES_WEIGHT;
    return ((nem - 4.0) / 3.0) * maxGradesPoints; 
  }

  // 45% Socioeconómico: Menor RSH da más puntaje. Bonus por liceo público.
  private static calculateSocioEconomicScore(rsh: number, isPublic: boolean): number {
    const maxSocioPoints = this.MAX_SCORE * this.SOCIOECONOMIC_WEIGHT;
    
    // Si RSH > 50, en teoría ya fue filtrado, pero por seguridad retorna 0.
    if (rsh > 50) return 0;

    // Asignación de puntos por tramo (Ejemplo de directriz interna)
    let points = 0;
    if (rsh <= 40) points = maxSocioPoints * 0.8; // Base por cumplir el 40%
    else if (rsh <= 50) points = maxSocioPoints * 0.4; // Menos puntaje si está en revisión

    // Bonus por vulnerabilidad escolar (Liceo Público vs Subvencionado)
    if (isPublic) points += (maxSocioPoints * 0.2); 

    return Math.min(points, maxSocioPoints);
  }

  // 20% Participación: Escala directa.
  private static calculateParticipationScore(evaluation: number): number {
    const maxPartPoints = this.MAX_SCORE * this.PARTICIPATION_WEIGHT;
    return (evaluation / 10) * maxPartPoints;
  }
}

/* Ejemplo de uso:
const alumno = { nem: 6.5, rshPercentage: 40, participationScore: 8, isPublicSchool: true };
const puntajeFinal = RankingCalculator.calculateTotal(alumno); 
// Resultado: ~883 puntos
*/