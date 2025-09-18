// packages/core/src/domain/packBono/dtos.ts

export interface PackBonoDTO {
  id_pack_bono: number;
  id_clinica: number;
  id_super_clinica: number;
  nombre: string;
  descripcion: string;
  precio: number;
}

export interface PackBonoTratamientoDTO {
  id_pack_bono_tratamientos: number;
  id_pack_bono: number;
  id_par_tratamiento: number;
  id_tratamiento: number;
  total_sesiones: number;
}

export interface PackBonoSesionDTO {
  id_pack_bono_sesion: number;
  id_pack_bono: number;
  id_paciente: number;
  // Se pueden agregar más campos si son necesarios en el futuro.
}

export interface PackBonoConUsoDTO extends PackBonoDTO {
  total_sesiones: number;
  total_sesiones_utilizadas: number;
  tratamientos: {
    id_tratamiento: number;
    total_sesiones: number;
    sesiones_usadas: number;
    citas_id: number[];
  }[];
}
