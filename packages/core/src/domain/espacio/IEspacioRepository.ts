// packages/core/src/domain/espacio/IEspacioRepository.ts

import { EspacioDTO, EspacioBasicDTO } from "./dtos";

export interface IEspacioRepository {
  /**
   * Obtiene un espacio por su ID.
   */
  findById(id_espacio: number): Promise<EspacioDTO | undefined>;

  /**
   * Obtiene todos los espacios de una clínica.
   */
  findByClinica(id_clinica: number): Promise<EspacioDTO[]>;

  /**
   * Obtiene todos los espacios donde un médico puede realizar un tratamiento específico en una clínica.
   */
  getEspaciosByMedicoAndTratamiento(
    id_medico: number,
    id_tratamiento: number,
    id_clinica: number
  ): Promise<EspacioBasicDTO[]>;
}
