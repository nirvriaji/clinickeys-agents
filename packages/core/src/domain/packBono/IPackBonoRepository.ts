// packages/core/src/domain/packBono/IPackBonoRepository.ts

import { PackBonoDTO, PackBonoTratamientoDTO, PackBonoSesionDTO } from "@clinickeys-agents/core/domain/packBono/dtos";

export interface IPackBonoRepository {
  /**
   * Obtiene todos los packs bono de una clínica.
   */
  getPackBonosByClinic(id_clinica: number): Promise<PackBonoDTO[]>;

  /**
   * Obtiene un pack bono por su ID y clínica.
   */
  getPackBonoById(id_pack_bono: number, id_clinica: number): Promise<PackBonoDTO | undefined>;

  /**
   * Obtiene todos los tratamientos asociados a un pack bono.
   */
  getPackBonoTratamientos(id_pack_bono: number): Promise<PackBonoTratamientoDTO[]>;

  /**
   * Obtiene las sesiones de pack bono de un paciente.
   */
  getPackBonosSesionesByPacienteId(id_paciente: number): Promise<PackBonoSesionDTO[]>;

  /**
   * Procesa el pack bono/presupuesto de una cita usando el stored procedure legacy.
   */
  procesarPackbonoPresupuestoDeCita(p_action: string, p_id_cita: number): Promise<any>;
}