// packages/core/src/application/services/BonoService.ts

import { IBonoRepository } from "@clinickeys-agents/core/domain/bono";

export class BonoService {
  private bonoRepository: IBonoRepository;

  constructor(bonoRepository: IBonoRepository) {
    this.bonoRepository = bonoRepository;
  }

  async getBonosSesionesDetallesByPacienteId(id_paciente: number): Promise<any[]> {
    return await this.bonoRepository.getBonosSesionesDetallesByPacienteId(id_paciente);
  }

  async procesarBonoPresupuestoDeCita(action: string, appointmentId: number): Promise<any> {
    return await this.bonoRepository.procesarBonoPresupuestoDeCita(action, appointmentId);
  }
}
