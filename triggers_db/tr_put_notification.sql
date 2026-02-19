DELIMITER $$

CREATE TRIGGER tr_put_notification
AFTER UPDATE ON citas
FOR EACH ROW
main: BEGIN
  DECLARE v_id_paciente BIGINT;
  DECLARE v_id_clinica BIGINT;
  DECLARE v_id_super_clinica BIGINT;
  DECLARE v_fecha_cita DATE;
  DECLARE v_hora_inicio, v_hora_fin TIME;
  DECLARE v_id_estado_cita INT;
  DECLARE v_estado_actual_notif VARCHAR(20);
  DECLARE v_estado_final VARCHAR(20);
  DECLARE v_dummy INT;

  DECLARE v_nombre_paciente, v_apellido_paciente VARCHAR(100);
  DECLARE v_nombre_tratamiento, v_nombre_medico, v_nombre_clinica, v_nombre_espacio VARCHAR(255);
  DECLARE v_mensaje TEXT;
  DECLARE v_payload JSON;
  DECLARE v_fecha_envio DATE;
  DECLARE v_hora_envio TIME;
  DECLARE v_ts_envio DATETIME;
  DECLARE v_dia_semana VARCHAR(20);
  DECLARE v_estado VARCHAR(20);

  DECLARE v_min_hora TIME;
  DECLARE v_min_cita BIGINT;

  /* ===== Datos base ===== */
  SET v_id_paciente      = NEW.id_paciente;
  SET v_id_clinica       = NEW.id_clinica;
  SET v_id_super_clinica = NEW.id_super_clinica;
  SET v_fecha_cita       = NEW.fecha_cita;
  SET v_hora_inicio      = NEW.hora_inicio;
  SET v_hora_fin         = NEW.hora_fin;
  SET v_id_estado_cita   = NEW.id_estado_cita;

  /* ===== Estado actual (si existe) ===== */
  SET v_estado_actual_notif = NULL;
  BEGIN
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_dummy = 1;
    SELECT estado
      INTO v_estado_actual_notif
      FROM notificaciones
     WHERE entidad_desencadenadora = 'cita'
       AND id_entidad_desencadenadora = NEW.id_cita
     LIMIT 1;
  END;

  /* ===== 1. Cancelación dura por estado ===== */
  IF v_id_estado_cita IN (2,4,6) THEN
    UPDATE notificaciones
       SET estado = 'cancelado',
           actualizado_el = CURRENT_TIMESTAMP
     WHERE entidad_desencadenadora = 'cita'
       AND id_entidad_desencadenadora = NEW.id_cita
       AND estado = 'pendiente';
    LEAVE main;
  END IF;

  /* ===== Validar datos mínimos ===== */
  IF v_id_paciente IS NULL OR v_fecha_cita IS NULL OR v_hora_inicio IS NULL THEN
    LEAVE main;
  END IF;

  /* ===== Cargar datos descriptivos ===== */
  SELECT nombre, apellido INTO v_nombre_paciente, v_apellido_paciente
    FROM pacientes WHERE id_paciente = v_id_paciente LIMIT 1;

  SELECT nombre_tratamiento INTO v_nombre_tratamiento
    FROM tratamientos WHERE id_tratamiento = NEW.id_tratamiento LIMIT 1;

  SELECT nombre_medico INTO v_nombre_medico
    FROM medicos WHERE id_medico = NEW.id_medico LIMIT 1;

  SELECT nombre_clinica INTO v_nombre_clinica
    FROM clinicas WHERE id_clinica = v_id_clinica LIMIT 1;

  IF NEW.id_espacio IS NOT NULL THEN
    SELECT nombre INTO v_nombre_espacio FROM espacios WHERE id_espacio = NEW.id_espacio LIMIT 1;
  ELSE
    SET v_nombre_espacio = NULL;
  END IF;

  /* ===== Programar envío ===== */
  IF v_id_clinica IN (64, 78, 90) AND DAYOFWEEK(v_fecha_cita) = 2 THEN
    SET v_fecha_envio = DATE(v_fecha_cita - INTERVAL 3 DAY);
    SET v_hora_envio  = v_hora_inicio;
  ELSE
    SET v_ts_envio    = TIMESTAMP(v_fecha_cita, v_hora_inicio) - INTERVAL 24 HOUR;
    SET v_fecha_envio = DATE(v_ts_envio);
    SET v_hora_envio  = TIME(v_ts_envio);
  END IF;

  /* ===== Día de la semana ===== */
  CASE DAYOFWEEK(v_fecha_cita)
    WHEN 1 THEN SET v_dia_semana = 'DOMINGO';
    WHEN 2 THEN SET v_dia_semana = 'LUNES';
    WHEN 3 THEN SET v_dia_semana = 'MARTES';
    WHEN 4 THEN SET v_dia_semana = 'MIÉRCOLES';
    WHEN 5 THEN SET v_dia_semana = 'JUEVES';
    WHEN 6 THEN SET v_dia_semana = 'VIERNES';
    WHEN 7 THEN SET v_dia_semana = 'SÁBADO';
  END CASE;

  /* ===== Mensaje ===== */
  SET v_mensaje = CONCAT(
    'Le recordamos su cita el ', v_dia_semana, ' ',
    DATE_FORMAT(v_fecha_cita, '%d/%m/%Y'),
    ' a las ', TIME_FORMAT(v_hora_inicio, '%H:%i'),
    IF(v_hora_fin IS NOT NULL, CONCAT('–', TIME_FORMAT(v_hora_fin, '%H:%i')), ''),
    ' en ', IFNULL(v_nombre_clinica, 'la clínica'),
    IFNULL(CONCAT(' para ', v_nombre_tratamiento), ''), '.'
  );

  /* ===== Payload ===== */
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

  /* ===== Determinar cita más temprana ===== */
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

  /* ===== Estado ===== */
  IF NEW.id_cita = v_min_cita AND v_id_estado_cita IN (1,7,8,9) THEN
    SET v_estado = 'pendiente';
  ELSE
    SET v_estado = 'cancelado';
  END IF;

  /* ===== Ajuste por estados 3,5 ===== */
  IF v_id_estado_cita IN (3,5) THEN
    SET v_estado_final = IFNULL(v_estado_actual_notif, v_estado);
  ELSE
    SET v_estado_final = v_estado;
  END IF;

  /* ===== Cancelar duplicadas ===== */
  IF v_estado_final = 'pendiente' THEN
    UPDATE notificaciones
       SET estado = 'cancelado',
           actualizado_el = CURRENT_TIMESTAMP
     WHERE id_entidad_destino = v_id_paciente
       AND entidad_destino = 'paciente'
       AND tipo_notificacion = 'recordatorio_cita'
       AND fecha_envio_programada = v_fecha_envio
       AND estado = 'pendiente'
       AND (id_entidad_desencadenadora IS NULL 
            OR id_entidad_desencadenadora <> NEW.id_cita);
  END IF;

  /* ===== Upsert ===== */
  IF EXISTS (
    SELECT 1 FROM notificaciones
     WHERE entidad_desencadenadora = 'cita'
       AND id_entidad_desencadenadora = NEW.id_cita
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
           estado                 = v_estado_final,
           actualizado_el         = CURRENT_TIMESTAMP
     WHERE entidad_desencadenadora = 'cita'
       AND id_entidad_desencadenadora = NEW.id_cita;
  ELSE
    INSERT INTO notificaciones (
      tipo_notificacion, id_entidad_destino, entidad_destino, mensaje, payload,
      fecha_envio_programada, hora_envio_programada,
      entidad_desencadenadora, id_entidad_desencadenadora,
      id_clinica, id_super_clinica, estado, creado_el
    )
    VALUES (
      'recordatorio_cita', v_id_paciente, 'paciente', v_mensaje, v_payload,
      v_fecha_envio, v_hora_envio,
      'cita', NEW.id_cita,
      v_id_clinica, v_id_super_clinica, v_estado_final, CURRENT_TIMESTAMP
    );
  END IF;
END main$$

DELIMITER ;