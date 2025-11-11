import { BonoSesionDetalleDTO } from "./dtos";

export interface IBonoRepository {
  getBonosSesionesDetallesByPacienteId(id_paciente: number): Promise<BonoSesionDetalleDTO[]>;

  getRecibosByPacienteId(id_paciente: number): Promise<any[]>;
  getDetalleRecibosByPacienteId(id_paciente: number): Promise<any[]>;

  // (opcional, si lo sigues usando)
  procesarBonoPresupuestoDeCita(p_action: string, p_id_cita: number): Promise<unknown>;
}