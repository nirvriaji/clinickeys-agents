DELIMITER $$

DROP PROCEDURE IF EXISTS generar_notificacion_por_cita$$
CREATE PROCEDURE generar_notificacion_por_cita(IN p_id_cita BIGINT)
BEGIN
  /* ===== Declaraciones ===== */
  DECLARE v_id_paciente, v_id_clinica, v_id_super_clinica, v_id_tratamiento,
          v_id_medico, v_id_espacio BIGINT;
  DECLARE v_fecha_cita DATE;
  DECLARE v_hora_inicio, v_hora_fin TIME;
  DECLARE v_id_estado_cita INT;

  DECLARE v_nombre_paciente, v_apellido_paciente VARCHAR(100);
  DECLARE v_nombre_tratamiento, v_nombre_medico, v_nombre_clinica, v_nombre_espacio VARCHAR(255);

  DECLARE v_mensaje TEXT;
  DECLARE v_payload JSON;
  DECLARE v_fecha_envio DATE;
  DECLARE v_hora_envio TIME;
  DECLARE v_ts_envio DATETIME;
  DECLARE v_dia_semana VARCHAR(20);
  DECLARE v_estado VARCHAR(20);
  DECLARE v_creado_el DATETIME;

  DECLARE v_min_hora TIME;
  DECLARE v_min_cita BIGINT;

  /* ===== Obtener datos de la cita ===== */
  SELECT id_paciente, id_clinica, id_super_clinica, fecha_cita, hora_inicio, hora_fin,
         id_estado_cita, id_tratamiento, id_medico, id_espacio
    INTO v_id_paciente, v_id_clinica, v_id_super_clinica, v_fecha_cita, v_hora_inicio,
         v_hora_fin, v_id_estado_cita, v_id_tratamiento, v_id_medico, v_id_espacio
    FROM citas
   WHERE id_cita = p_id_cita;

  SET v_creado_el = CURRENT_TIMESTAMP;

  /* ===== Guard clause: mínimos ===== */
  IF v_id_paciente IS NOT NULL
     AND v_fecha_cita IS NOT NULL
     AND v_hora_inicio IS NOT NULL THEN

    /* ===== 1) Datos descriptivos ===== */
    SELECT nombre, apellido INTO v_nombre_paciente, v_apellido_paciente
      FROM pacientes WHERE id_paciente = v_id_paciente LIMIT 1;

    SELECT nombre_tratamiento INTO v_nombre_tratamiento
      FROM tratamientos WHERE id_tratamiento = v_id_tratamiento LIMIT 1;

    SELECT nombre_medico INTO v_nombre_medico
      FROM medicos WHERE id_medico = v_id_medico LIMIT 1;

    SELECT nombre_clinica INTO v_nombre_clinica
      FROM clinicas WHERE id_clinica = v_id_clinica LIMIT 1;

    IF v_id_espacio IS NOT NULL THEN
      SELECT nombre INTO v_nombre_espacio FROM espacios WHERE id_espacio = v_id_espacio LIMIT 1;
    ELSE
      SET v_nombre_espacio = NULL;
    END IF;

    /* ===== 2) Programar envío ===== */
    IF v_id_clinica IN (64, 78, 90) AND DAYOFWEEK(v_fecha_cita) = 2 THEN
      SET v_fecha_envio = DATE(v_fecha_cita - INTERVAL 3 DAY);
      SET v_hora_envio  = v_hora_inicio;
    ELSE
      SET v_ts_envio    = TIMESTAMP(v_fecha_cita, v_hora_inicio) - INTERVAL 24 HOUR;
      SET v_fecha_envio = DATE(v_ts_envio);
      SET v_hora_envio  = TIME(v_ts_envio);
    END IF;

    /* ===== 3) Día semana ===== */
    CASE DAYOFWEEK(v_fecha_cita)
      WHEN 1 THEN SET v_dia_semana = 'DOMINGO';
      WHEN 2 THEN SET v_dia_semana = 'LUNES';
      WHEN 3 THEN SET v_dia_semana = 'MARTES';
      WHEN 4 THEN SET v_dia_semana = 'MIÉRCOLES';
      WHEN 5 THEN SET v_dia_semana = 'JUEVES';
      WHEN 6 THEN SET v_dia_semana = 'VIERNES';
      WHEN 7 THEN SET v_dia_semana = 'SÁBADO';
    END CASE;

    /* ===== 4) Mensaje único ===== */
    SET v_mensaje = CONCAT(
      'Le recordamos su cita el ', v_dia_semana, ' ',
      DATE_FORMAT(v_fecha_cita, '%d/%m/%Y'),
      ' a las ', TIME_FORMAT(v_hora_inicio, '%H:%i'),
      IF(v_hora_fin IS NOT NULL, CONCAT('–', TIME_FORMAT(v_hora_fin, '%H:%i')), ''),
      ' en ', IFNULL(v_nombre_clinica, 'la clínica'),
      IFNULL(CONCAT(' para ', v_nombre_tratamiento), ''), '.'
    );

    /* ===== 5) Payload ===== */
    SET v_payload = JSON_OBJECT(
      'clinicName', v_nombre_clinica,
      'treatmentName', v_nombre_tratamiento,
      'visit_date', DATE_FORMAT(v_fecha_cita, '%d/%m'),
      'visit_init_time', TIME_FORMAT(v_hora_inicio, '%H:%i:%s'),
      'visit_end_time', IFNULL(TIME_FORMAT(v_hora_fin, '%H:%i:%s'), NULL),
      'visit_space_name', v_nombre_espacio,
      'patient_firstname', v_nombre_paciente,
      'patient_lastname', v_apellido_paciente,
      'medic_full_name', v_nombre_medico,
      'visit_week_day_name', v_dia_semana
    );

    /* ===== 6) Determinar la más temprana ===== */
    SELECT MIN(hora_inicio)
      INTO v_min_hora
      FROM citas
     WHERE id_paciente = v_id_paciente
       AND fecha_cita = v_fecha_cita
       AND id_estado_cita IN (1,7,8,9);

    SELECT MIN(id_cita)
      INTO v_min_cita
      FROM citas
     WHERE id_paciente = v_id_paciente
       AND fecha_cita = v_fecha_cita
       AND id_estado_cita IN (1,7,8,9)
       AND hora_inicio = v_min_hora;

    /* ===== 7) Estado de la notificación ===== */
    IF p_id_cita = v_min_cita THEN
      IF v_id_estado_cita IN (1,7,8,9) THEN
        SET v_estado = CASE
          WHEN DATEDIFF(v_fecha_cita, CURDATE()) > 1 THEN 'pendiente'
          ELSE 'cancelado'
        END;
      ELSE
        SET v_estado = 'cancelado';
      END IF;
    ELSE
      SET v_estado = 'cancelado';
    END IF;

    /* ===== 8) Cancelar duplicadas ===== */
    IF v_estado = 'pendiente' THEN
      UPDATE notificaciones
         SET estado = 'cancelado',
             actualizado_el = CURRENT_TIMESTAMP
       WHERE id_entidad_destino = v_id_paciente
         AND entidad_destino = 'paciente'
         AND tipo_notificacion = 'recordatorio_cita'
         AND fecha_envio_programada = v_fecha_envio
         AND estado = 'pendiente'
         AND (id_entidad_desencadenadora IS NULL OR id_entidad_desencadenadora <> p_id_cita);
    END IF;

    /* ===== 9) Upsert notificación ===== */
    IF EXISTS (
      SELECT 1 FROM notificaciones
       WHERE entidad_desencadenadora = 'cita'
         AND id_entidad_desencadenadora = p_id_cita
    ) THEN
      UPDATE notificaciones
         SET tipo_notificacion      = 'recordatorio_cita',
             id_entidad_destino     = v_id_paciente,
             entidad_destino        = 'paciente',
             mensaje                = v_mensaje,
             payload                = v_payload,
             fecha_envio_programada = v_fecha_envio,
             hora_envio_programada  = v_hora_envio,
             id_clinica             = v_id_clinica,
             id_super_clinica       = v_id_super_clinica,
             estado                 = v_estado,
             actualizado_el         = CURRENT_TIMESTAMP
       WHERE entidad_desencadenadora = 'cita'
         AND id_entidad_desencadenadora = p_id_cita;
    ELSE
      INSERT INTO notificaciones (
        tipo_notificacion, id_entidad_destino, entidad_destino, mensaje, payload,
        fecha_envio_programada, hora_envio_programada, entidad_desencadenadora, id_entidad_desencadenadora,
        id_clinica, id_super_clinica, estado, creado_el
      )
      VALUES (
        'recordatorio_cita', v_id_paciente, 'paciente', v_mensaje, v_payload,
        v_fecha_envio, v_hora_envio, 'cita', p_id_cita,
        v_id_clinica, v_id_super_clinica, v_estado, v_creado_el
      );
    END IF;

  END IF; /* fin guard clause datos mínimos */

END$$

DELIMITER ;