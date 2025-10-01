DELIMITER $$

CREATE PROCEDURE generar_notificacion_por_cita(IN p_id_cita BIGINT)
BEGIN
  DECLARE v_id_paciente        BIGINT;
  DECLARE v_id_clinica         BIGINT;
  DECLARE v_id_super_clinica   BIGINT;
  DECLARE v_fecha_cita         DATE;
  DECLARE v_hora_inicio        TIME;
  DECLARE v_hora_fin           TIME;
  DECLARE v_id_estado_cita     INT;
  DECLARE v_id_tratamiento     BIGINT;
  DECLARE v_id_medico          BIGINT;
  DECLARE v_id_espacio         BIGINT;

  DECLARE v_nombre_paciente    VARCHAR(100);
  DECLARE v_apellido_paciente  VARCHAR(100);
  DECLARE v_nombre_tratamiento VARCHAR(255);
  DECLARE v_nombre_medico      VARCHAR(255);
  DECLARE v_nombre_clinica     VARCHAR(255);
  DECLARE v_nombre_espacio     VARCHAR(255);

  DECLARE v_mensaje            TEXT;
  DECLARE v_fecha_envio        DATE;
  DECLARE v_hora_envio         TIME;
  DECLARE v_estado             VARCHAR(20);
  DECLARE v_creado_el          DATETIME;
  DECLARE v_dia_semana         VARCHAR(20);
  DECLARE v_ts_envio           DATETIME;
  DECLARE v_payload            JSON;

  SELECT id_paciente,
         id_clinica,
         id_super_clinica,
         fecha_cita,
         hora_inicio,
         hora_fin,
         id_estado_cita,
         id_tratamiento,
         id_medico,
         id_espacio
    INTO v_id_paciente,
         v_id_clinica,
         v_id_super_clinica,
         v_fecha_cita,
         v_hora_inicio,
         v_hora_fin,
         v_id_estado_cita,
         v_id_tratamiento,
         v_id_medico,
         v_id_espacio
    FROM citas
   WHERE id_cita = p_id_cita;

  SET v_creado_el = CURRENT_TIMESTAMP;

  IF v_id_paciente IS NOT NULL
     AND v_fecha_cita IS NOT NULL
     AND v_hora_inicio IS NOT NULL THEN

    SELECT nombre, apellido
      INTO v_nombre_paciente, v_apellido_paciente
      FROM pacientes
     WHERE id_paciente = v_id_paciente
     LIMIT 1;

    SELECT nombre_tratamiento
      INTO v_nombre_tratamiento
      FROM tratamientos
     WHERE id_tratamiento = v_id_tratamiento
     LIMIT 1;

    SELECT nombre_medico
      INTO v_nombre_medico
      FROM medicos
     WHERE id_medico = v_id_medico
     LIMIT 1;

    SELECT nombre_clinica
      INTO v_nombre_clinica
      FROM clinicas
     WHERE id_clinica = v_id_clinica
     LIMIT 1;

    IF v_id_espacio IS NOT NULL THEN
      SELECT nombre INTO v_nombre_espacio FROM espacios WHERE id_espacio = v_id_espacio LIMIT 1;
    ELSE
      SET v_nombre_espacio = NULL;
    END IF;

    IF v_id_clinica = 64 AND DAYOFWEEK(v_fecha_cita) = 2 THEN
      SET v_fecha_envio = DATE(v_fecha_cita - INTERVAL 3 DAY);
      SET v_hora_envio  = v_hora_inicio;
    ELSE
      SET v_ts_envio    = TIMESTAMP(v_fecha_cita, v_hora_inicio) - INTERVAL 24 HOUR;
      SET v_fecha_envio = DATE(v_ts_envio);
      SET v_hora_envio  = TIME(v_ts_envio);
    END IF;

    IF v_id_estado_cita IN (1,7,8,9) THEN
      SET v_estado = CASE
        WHEN DATEDIFF(v_fecha_cita, CURDATE()) = 1 THEN 'cancelado'
        WHEN DATEDIFF(v_fecha_cita, CURDATE()) > 1 THEN 'pendiente'
        ELSE 'cancelado'
      END;
    ELSE
      SET v_estado = 'cancelado';
    END IF;

    CASE DAYOFWEEK(v_fecha_cita)
      WHEN 1 THEN SET v_dia_semana = 'DOMINGO';
      WHEN 2 THEN SET v_dia_semana = 'LUNES';
      WHEN 3 THEN SET v_dia_semana = 'MARTES';
      WHEN 4 THEN SET v_dia_semana = 'MIÉRCOLES';
      WHEN 5 THEN SET v_dia_semana = 'JUEVES';
      WHEN 6 THEN SET v_dia_semana = 'VIERNES';
      WHEN 7 THEN SET v_dia_semana = 'SÁBADO';
    END CASE;

    SET v_mensaje = '';

    IF v_id_clinica = 66 THEN
      SET v_mensaje = CONCAT(
        '* * * * * * * * * * * * * * * * *', '\n',
        'RECORDATORIO', '\n', '\n',
        '*Rogamos CONFIRME esta cita. RESPONDER MEDIANTE ESTE WHATSAPP*', '\n', '\n',
        '*Clínicas Love Madrid le recuerda su cita del ',
        DATE_FORMAT(v_fecha_cita, '%d/%m/%Y'), ' a las ',
        TIME_FORMAT(v_hora_inicio, '%H:%i'), ' horas*', '\n', '\n',
        'Calle Edgar Neville 16', '\n', '\n',
        '*Si no puede acudir, por favor, comuníquelo. RESPONDER MEDIANTE ESTE WHATSAPP*', '\n', '\n',
        '919 99 35 15 - 649 63 81 98', '\n', '\n',
        'Gracias', '\n', '\n',
        'Horario laboral:', '\n',
        'Lunes a viernes: 10:00 a 20:00', '\n',
        'Sabados, Domingos y festivos: No disponible.', '\n', '\n',
        'Muchas gracias', '\n', '\n',
        '* * * * * * * * * * * * * * * * *'
      );
    ELSEIF v_id_clinica = 67 THEN
      SET v_mensaje = CONCAT(
        '* * * * * * * * * * * * * * *', '\n',
        'RECORDATORIO', '\n', '\n',
        'Rogamos CONFIRME esta cita. RESPONDER MEDIANTE ESTE WHATSAPP', '\n', '\n',
        'Clínicas Love Barcelona le recuerda su cita del ',
        DATE_FORMAT(v_fecha_cita, '%d/%m/%Y'), ' a las ',
        TIME_FORMAT(v_hora_inicio, '%H:%i'), ' horas', '\n', '\n',
        'C/ DIPUTACIÓ 327', '\n', '\n',
        'Si no puede acudir, por favor, comuníquelo. RESPONDER MEDIANTE ESTE WHATSAPP', '\n', '\n',
        '681 31 81 61', '\n', '\n',
        'Gracias', '\n', '\n',
        'Horario laboral:', '\n',
        'Lunes a jueves: 11:00 a 20:00', '\n',
        'Viernes: 10 a 19', '\n',
        'Sabados, Domingos y festivos: No disponible.', '\n', '\n',
        'Muchas gracias', '\n', '\n',
        '* * * * * * * * * * * * * * *'
      );
    ELSEIF v_id_clinica = 62 THEN
      SET v_mensaje = CONCAT(
        '¡Hola! Te contactamos desde la Clínica PODOSOL para recordarte tu cita de ',
        IFNULL(v_nombre_tratamiento, 'tu tratamiento agendado'), ' el día ',
        DATE_FORMAT(v_fecha_cita, '%d/%m/%Y'), ' a las ',
        TIME_FORMAT(v_hora_inicio, '%H:%i'), '.', '\n', '\n',
        '*Es importante que tengas en cuenta que solo se realizan pagos en efectivo o Bizum. No se admite el pago con ningún tipo de tarjeta. Gracias por tu comprensión.*', '\n', '\n',
        'Te esperamos en PODOSOL. Calle Ánimas, 9, Local, 28802 Alcalá de Henares, Madrid. ',
        'Puedes confiar en que recibirás el mejor tratamiento, respaldado por años de experiencia y las técnicas más avanzadas.', '\n', '\n',
        '*Brindamos 15 minutos de cortesía. Si llegas después de ese tiempo, ten en cuenta que es posible que no podamos atenderte inmediatamente.*', '\n', '\n',
        '¡Muchas gracias!'
      );
    ELSEIF v_id_clinica = 64 THEN
      SET v_mensaje = CONCAT(
        'Estimado/a ', v_nombre_paciente, ' ', v_apellido_paciente, ',', '\n', '\n',
        'Le recordamos su cita el próximo ', LOWER(v_dia_semana), ' ',
        DATE_FORMAT(v_fecha_cita, '%d/%m/%Y'), ' a las ',
        TIME_FORMAT(v_hora_inicio, '%H:%i'),
        ' h en nuestra clínica de Málaga, para la realización de ',
        IFNULL(v_nombre_tratamiento, 'el tratamiento agendado'), '.', '\n', '\n',
        'Dirección: Calle Trinidad Grund 23, 29001 Málaga', '\n',
        'Puede consultar más información sobre nuestros servicios en www.clinicapoyatos.com', '\n',
        'También disponemos de clínica en Marbella, por si le resultara más conveniente.', '\n', '\n',
        'Le rogamos que, por favor, confirme su asistencia respondiendo a este mensaje.', '\n',
        'Si no pudiera acudir, le agradeceríamos que nos avisara con antelación para poder ofrecer su cita a otro paciente que lo necesite.', '\n', '\n',
        'Muchas gracias por su confianza.', '\n',
        'Clínica Poyatos'
      );
    ELSEIF v_id_clinica = 58 THEN
      SET v_mensaje = CONCAT(
        'Hola ', v_nombre_paciente, ',', '\n',
        'Te recuerdo tu cita de mañana a las ',
        TIME_FORMAT(v_hora_inicio, '%H:%i'),
        ' en Clínica Lorents', '\n', '\n',
        'Av. Francisco Jiménez Ruiz, 9, 30007 El Puntal, Murcia', '\n', '\n',
        '¿Me puedes confirmar si podrás acudir?', '\n', '\n',
        'Muchas gracias'
      );
    ELSEIF v_id_clinica = 37 THEN
      SET v_mensaje = CONCAT(
        '¡Hola ', v_nombre_paciente, '!', '\n', '\n',
        'Le recordamos su cita del ', LOWER(v_dia_semana), ' ',
        DATE_FORMAT(v_fecha_cita, '%d/%m/%Y'),
        ' para el tratamiento de ',
        IFNULL(v_nombre_tratamiento, 'su tratamiento agendado'), '.', '\n', '\n',
        'Por favor, confirme su asistencia respondiendo a este mensaje.', '\n',
        '¡Gracias por confiar en nosotros!'
      );
    END IF;

    SET v_payload = JSON_OBJECT(
      'patient_firstname', v_nombre_paciente,
      'patient_lastname', v_apellido_paciente,
      'clinic_name', v_nombre_clinica,
      'visit_week_day_name', v_dia_semana,
      'medic_full_name', v_nombre_medico,
      'treatment_name', v_nombre_tratamiento,
      'visit_date', DATE_FORMAT(v_fecha_cita, '%d/%m'),
      'visit_init_time', TIME_FORMAT(v_hora_inicio, '%H:%i'),
      'visit_end_time', TIME_FORMAT(v_hora_fin, '%H:%i'),
      'visit_space_name', v_nombre_espacio
    );

    -- Validar si ya existe notificación para el mismo paciente y fecha
    IF NOT EXISTS (
      SELECT 1
        FROM notificaciones
       WHERE id_entidad_destino = v_id_paciente
         AND estado IN ('pendiente')
         AND entidad_destino = 'paciente'
         AND tipo_notificacion = 'recordatorio_cita'
         AND fecha_envio_programada = v_fecha_envio
    ) THEN

      INSERT INTO notificaciones (
        tipo_notificacion,
        id_entidad_destino,
        entidad_destino,
        mensaje,
        payload,
        fecha_envio_programada,
        hora_envio_programada,
        entidad_desencadenadora,
        id_entidad_desencadenadora,
        id_clinica,
        id_super_clinica,
        estado,
        creado_el
      ) VALUES (
        'recordatorio_cita',
        v_id_paciente,
        'paciente',
        v_mensaje,
        v_payload,
        v_fecha_envio,
        v_hora_envio,
        'cita',
        p_id_cita,
        v_id_clinica,
        v_id_super_clinica,
        v_estado,
        v_creado_el
      );

    END IF;

  ELSE
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Datos insuficientes para crear la notificación de cita';
  END IF;
END$$

DELIMITER ;