DELIMITER $$

CREATE TRIGGER tr_put_notification
AFTER UPDATE ON citas
FOR EACH ROW
BEGIN
  DECLARE v_nombre_paciente     VARCHAR(100);
  DECLARE v_apellido_paciente   VARCHAR(100);
  DECLARE v_nombre_tratamiento  VARCHAR(255);
  DECLARE v_nombre_medico       VARCHAR(255);
  DECLARE v_nombre_clinica      VARCHAR(255);
  DECLARE v_nombre_espacio      VARCHAR(255);
  DECLARE v_mensaje             TEXT;
  DECLARE v_fecha_envio         DATE;
  DECLARE v_hora_envio          TIME;
  DECLARE v_dia_semana          VARCHAR(20);
  DECLARE v_nuevo_estado        VARCHAR(20);
  DECLARE v_ts_envio            DATETIME;
  DECLARE v_payload             JSON;

  -- Variables para hallar la cita más temprana del (paciente, fecha) NUEVOS
  DECLARE n_min_hora            TIME;
  DECLARE n_min_cita            BIGINT;
  DECLARE n_estado_pendiente    VARCHAR(20);

  -- Variables para construir mensaje/payload de la cita más temprana NUEVA
  DECLARE e_id_cita             BIGINT;
  DECLARE e_id_paciente         BIGINT;
  DECLARE e_id_clinica          BIGINT;
  DECLARE e_id_super_clinica    BIGINT;
  DECLARE e_fecha_cita          DATE;
  DECLARE e_hora_inicio         TIME;
  DECLARE e_hora_fin            TIME;
  DECLARE e_id_estado_cita      INT;
  DECLARE e_id_tratamiento      BIGINT;
  DECLARE e_id_medico           BIGINT;
  DECLARE e_id_espacio          BIGINT;

  DECLARE e_nombre_paciente     VARCHAR(100);
  DECLARE e_apellido_paciente   VARCHAR(100);
  DECLARE e_nombre_tratamiento  VARCHAR(255);
  DECLARE e_nombre_medico       VARCHAR(255);
  DECLARE e_nombre_clinica      VARCHAR(255);
  DECLARE e_nombre_espacio      VARCHAR(255);

  DECLARE e_mensaje             TEXT;
  DECLARE e_fecha_envio         DATE;
  DECLARE e_hora_envio          TIME;
  DECLARE e_dia_semana          VARCHAR(20);
  DECLARE e_ts_envio            DATETIME;
  DECLARE e_payload             JSON;
  DECLARE e_estado              VARCHAR(20);

  -- Variables para recalcular el grupo ANTIGUO si cambian paciente/fecha
  DECLARE o_min_hora            TIME;
  DECLARE o_min_cita            BIGINT;
  DECLARE o_fecha_envio         DATE;
  DECLARE o_hora_envio          TIME;

  -- Ejecutar solo si cambian campos relevantes
  IF (
       NEW.id_estado_cita <> OLD.id_estado_cita
    OR NEW.fecha_cita     <> OLD.fecha_cita
    OR NEW.hora_inicio    <> OLD.hora_inicio
    OR NEW.hora_fin       <> OLD.hora_fin
    OR NEW.id_espacio     <> OLD.id_espacio
    OR NEW.id_medico      <> OLD.id_medico
    OR NEW.id_paciente    <> OLD.id_paciente
  ) THEN

    /* ===========================================================
       1) Bloque para la CITA ACTUAL (NEW.*): construir datos base
       =========================================================== */
    IF NEW.id_paciente IS NOT NULL
       AND NEW.fecha_cita IS NOT NULL
       AND NEW.hora_inicio IS NOT NULL THEN

      SELECT nombre, apellido
        INTO v_nombre_paciente, v_apellido_paciente
        FROM pacientes
       WHERE id_paciente = NEW.id_paciente
       LIMIT 1;

      SELECT nombre_tratamiento
        INTO v_nombre_tratamiento
        FROM tratamientos
       WHERE id_tratamiento = NEW.id_tratamiento
       LIMIT 1;

      SELECT nombre_medico
        INTO v_nombre_medico
        FROM medicos
       WHERE id_medico = NEW.id_medico
       LIMIT 1;

      SELECT nombre_clinica
        INTO v_nombre_clinica
        FROM clinicas
       WHERE id_clinica = NEW.id_clinica
       LIMIT 1;

      IF NEW.id_espacio IS NOT NULL THEN
        SELECT nombre INTO v_nombre_espacio FROM espacios WHERE id_espacio = NEW.id_espacio LIMIT 1;
      ELSE
        SET v_nombre_espacio = NULL;
      END IF;

      -- Programación de envío (misma regla original)
      IF NEW.id_clinica = 64 AND DAYOFWEEK(NEW.fecha_cita) = 2 THEN
        SET v_fecha_envio = DATE(NEW.fecha_cita - INTERVAL 3 DAY);
        SET v_hora_envio  = NEW.hora_inicio;
      ELSE
        SET v_ts_envio    = TIMESTAMP(NEW.fecha_cita, NEW.hora_inicio) - INTERVAL 24 HOUR;
        SET v_fecha_envio = DATE(v_ts_envio);
        SET v_hora_envio  = TIME(v_ts_envio);
      END IF;

      CASE DAYOFWEEK(NEW.fecha_cita)
        WHEN 1 THEN SET v_dia_semana = 'DOMINGO';
        WHEN 2 THEN SET v_dia_semana = 'LUNES';
        WHEN 3 THEN SET v_dia_semana = 'MARTES';
        WHEN 4 THEN SET v_dia_semana = 'MIÉRCOLES';
        WHEN 5 THEN SET v_dia_semana = 'JUEVES';
        WHEN 6 THEN SET v_dia_semana = 'VIERNES';
        WHEN 7 THEN SET v_dia_semana = 'SÁBADO';
      END CASE;

      SET v_payload = JSON_OBJECT(
        'patient_firstname', v_nombre_paciente,
        'patient_lastname', v_apellido_paciente,
        'clinicName', v_nombre_clinica,
        'visit_week_day_name', v_dia_semana,
        'medic_full_name', v_nombre_medico,
        'treatmentName', v_nombre_tratamiento,
        'visit_date', DATE_FORMAT(NEW.fecha_cita, '%Y-%m-%d'),
        'visit_init_time', TIME_FORMAT(NEW.hora_inicio, '%H:%i:%s'),
        'visit_end_time', TIME_FORMAT(NEW.hora_fin, '%H:%i:%s'),
        'visit_space_name', v_nombre_espacio
      );

      IF NEW.id_clinica = 66 THEN
        SET v_mensaje = CONCAT(
          '* * * * * * * * * * * * * * * * *', '\n',
          'RECORDATORIO', '\n',
          '\n',
          '*Rogamos CONFIRME esta cita. RESPONDER MEDIANTE ESTE WHATSAPP*', '\n',
          '\n',
          '*Clínicas Love Madrid le recuerda su cita del ',
          DATE_FORMAT(NEW.fecha_cita, '%d/%m/%Y'), ' a las ',
          TIME_FORMAT(NEW.hora_inicio, '%H:%i'), ' horas*', '\n',
          '\n',
          'Calle Edgar Neville 16', '\n',
          '\n',
          '*Si no puede acudir, por favor, comuníquelo. RESPONDER MEDIANTE ESTE WHATSAPP*', '\n',
          '\n',
          '919 99 35 15 - 649 63 81 98', '\n',
          '\n',
          'Gracias', '\n',
          '\n',
          'Horario laboral:', '\n',
          'Lunes a viernes: 10:00 a 20:00', '\n',
          'Sabados, Domingos y festivos: No disponible.', '\n',
          '\n',
          'Muchas gracias', '\n',
          '\n',
          '* * * * * * * * * * * * * * * * *'
        );
      ELSEIF NEW.id_clinica = 67 THEN
        SET v_mensaje = CONCAT(
          '* * * * * * * * * * * * * * *', '\n',
          'RECORDATORIO', '\n',
          '\n',
          'Rogamos CONFIRME esta cita. RESPONDER MEDIANTE ESTE WHATSAPP', '\n',
          '\n',
          'Clínicas Love Barcelona le recuerda su cita del ',
          DATE_FORMAT(NEW.fecha_cita, '%d/%m/%Y'), ' a las ',
          TIME_FORMAT(NEW.hora_inicio, '%H:%i'), ' horas', '\n',
          '\n',
          'C/ DIPUTACIÓ 327', '\n',
          '\n',
          'Si no puede acudir, por favor, comuníquelo. RESPONDER MEDIANTE ESTE WHATSAPP', '\n',
          '\n',
          '681 31 81 61', '\n',
          '\n',
          'Gracias', '\n',
          '\n',
          'Horario laboral:', '\n',
          'Lunes a jueves: 11:00 a 20:00', '\n',
          'Viernes: 10 a 19', '\n',
          'Sabados, Domingos y festivos: No disponible.', '\n',
          '\n',
          'Muchas gracias', '\n',
          '\n',
          '* * * * * * * * * * * * * * *'
        );
      ELSEIF NEW.id_clinica = 62 THEN
        SET v_mensaje = CONCAT(
          '¡Hola! Te contactamos desde la Clínica PODOSOL para recordarte tu cita de ',
          IFNULL(v_nombre_tratamiento, 'tu tratamiento agendado'), ' el día ',
          DATE_FORMAT(NEW.fecha_cita, '%d/%m/%Y'), ' a las ',
          TIME_FORMAT(NEW.hora_inicio, '%H:%i'), '.', '\n',
          '\n',
          '*Es importante que tengas en cuenta que solo se realizan pagos en efectivo o Bizum. No se admite el pago con ningún tipo de tarjeta. Gracias por tu comprensión.*', '\n',
          '\n',
          'Te esperamos en PODOSOL. Calle Ánimas, 9, Local, 28802 Alcalá de Henares, Madrid. ',
          'Puedes confiar en que recibirás el mejor tratamiento, respaldado por años de experiencia y las técnicas más avanzadas.', '\n',
          '\n',
          '*Brindamos 15 minutos de cortesía. Si llegas después de ese tiempo, ten en cuenta que es posible que no podamos atenderte inmediatamente.*', '\n',
          '\n',
          '¡Muchas gracias!'
        );
      ELSEIF NEW.id_clinica = 64 THEN
        SET v_mensaje = CONCAT(
          'Estimado/a ', v_nombre_paciente, ' ', v_apellido_paciente, ',', '\n',
          '\n',
          'Le recordamos su cita el próximo ', LOWER(v_dia_semana), ' ',
          DATE_FORMAT(NEW.fecha_cita, '%d/%m/%Y'), ' a las ',
          TIME_FORMAT(NEW.hora_inicio, '%H:%i'),
          ' h en nuestra clínica de Málaga, para la realización de ',
          IFNULL(v_nombre_tratamiento, 'el tratamiento agendado'), '.', '\n',
          '\n',
          'Dirección: Calle Trinidad Grund 23, 29001 Málaga', '\n',
          'Puede consultar más información sobre nuestros servicios en www.clinicapoyatos.com', '\n',
          'También disponemos de clínica en Marbella, por si le resultara más conveniente.', '\n',
          '\n',
          'Le rogamos que, por favor, confirme su asistencia respondiendo a este mensaje.', '\n',
          'Si no pudiera acudir, le agradeceríamos que nos avisara con antelación para poder ofrecer su cita a otro paciente que lo necesite.', '\n',
          '\n',
          'Muchas gracias por su confianza.', '\n',
          'Clínica Poyatos'
        );
      ELSEIF NEW.id_clinica = 58 THEN
        SET v_mensaje = CONCAT(
          'Hola ', v_nombre_paciente, ',', '\n',
          'Te recuerdo tu cita de mañana a las ',
          TIME_FORMAT(NEW.hora_inicio, '%H:%i'),
          ' en Clínica Lorents', '\n',
          '\n',
          'Av. Francisco Jiménez Ruiz, 9, 30007 El Puntal, Murcia', '\n',
          '\n',
          '¿Me puedes confirmar si podrás acudir?', '\n',
          '\n',
          'Muchas gracias'
        );
      ELSEIF NEW.id_clinica = 37 THEN
        SET v_mensaje = CONCAT(
          '¡Hola ', v_nombre_paciente, '!', '\n',
          '\n',
          'Le recordamos su cita del ', LOWER(v_dia_semana), ' ',
          DATE_FORMAT(NEW.fecha_cita, '%d/%m/%Y'),
          ' para el tratamiento de ',
          IFNULL(v_nombre_tratamiento, 'su tratamiento agendado'), '.', '\n',
          '\n',
          'Por favor, confirme su asistencia respondiendo a este mensaje.', '\n',
          '¡Gracias por confiar en nosotros!'
        );
      ELSE
        SET v_mensaje = '';
      END IF;

      -- Estado "natural" de la cita NEW (antes de priorizar la más temprana)
      IF NEW.id_estado_cita IN (1,7,8,9) THEN
        SET v_nuevo_estado = CASE
          WHEN DATEDIFF(NEW.fecha_cita, CURDATE()) = 1 THEN 'cancelado'
          WHEN DATEDIFF(NEW.fecha_cita, CURDATE()) > 1 THEN 'pendiente'
          ELSE 'cancelado'
        END;
      ELSE
        SET v_nuevo_estado = 'cancelado';
      END IF;

      /* ===========================================================
         2) Recalcular la MÁS TEMPRANA para (NEW.id_paciente, NEW.fecha_cita)
         =========================================================== */
      SET n_min_hora = NULL;
      SET n_min_cita = NULL;

      SELECT MIN(hora_inicio)
        INTO n_min_hora
        FROM citas
       WHERE id_paciente = NEW.id_paciente
         AND fecha_cita = NEW.fecha_cita
         AND id_estado_cita IN (1,7,8,9);

      IF n_min_hora IS NOT NULL THEN
        SELECT MIN(id_cita)
          INTO n_min_cita
          FROM citas
         WHERE id_paciente = NEW.id_paciente
           AND fecha_cita = NEW.fecha_cita
           AND id_estado_cita IN (1,7,8,9)
           AND hora_inicio = n_min_hora;

        -- Cargar la cita más temprana y construir su notificación
        IF n_min_cita IS NOT NULL THEN
          SET e_id_cita = n_min_cita;

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
            INTO e_id_paciente,
                 e_id_clinica,
                 e_id_super_clinica,
                 e_fecha_cita,
                 e_hora_inicio,
                 e_hora_fin,
                 e_id_estado_cita,
                 e_id_tratamiento,
                 e_id_medico,
                 e_id_espacio
            FROM citas
           WHERE id_cita = e_id_cita;

          SELECT nombre, apellido
            INTO e_nombre_paciente, e_apellido_paciente
            FROM pacientes
           WHERE id_paciente = e_id_paciente
           LIMIT 1;

          SELECT nombre_tratamiento
            INTO e_nombre_tratamiento
            FROM tratamientos
           WHERE id_tratamiento = e_id_tratamiento
           LIMIT 1;

          SELECT nombre_medico
            INTO e_nombre_medico
            FROM medicos
           WHERE id_medico = e_id_medico
           LIMIT 1;

          SELECT nombre_clinica
            INTO e_nombre_clinica
            FROM clinicas
           WHERE id_clinica = e_id_clinica
           LIMIT 1;

          IF e_id_espacio IS NOT NULL THEN
            SELECT nombre INTO e_nombre_espacio FROM espacios WHERE id_espacio = e_id_espacio LIMIT 1;
          ELSE
            SET e_nombre_espacio = NULL;
          END IF;

          IF e_id_clinica = 64 AND DAYOFWEEK(e_fecha_cita) = 2 THEN
            SET e_fecha_envio = DATE(e_fecha_cita - INTERVAL 3 DAY);
            SET e_hora_envio  = e_hora_inicio;
          ELSE
            SET e_ts_envio    = TIMESTAMP(e_fecha_cita, e_hora_inicio) - INTERVAL 24 HOUR;
            SET e_fecha_envio = DATE(e_ts_envio);
            SET e_hora_envio  = TIME(e_ts_envio);
          END IF;

          CASE DAYOFWEEK(e_fecha_cita)
            WHEN 1 THEN SET e_dia_semana = 'DOMINGO';
            WHEN 2 THEN SET e_dia_semana = 'LUNES';
            WHEN 3 THEN SET e_dia_semana = 'MARTES';
            WHEN 4 THEN SET e_dia_semana = 'MIÉRCOLES';
            WHEN 5 THEN SET e_dia_semana = 'JUEVES';
            WHEN 6 THEN SET e_dia_semana = 'VIERNES';
            WHEN 7 THEN SET e_dia_semana = 'SÁBADO';
          END CASE;

          SET e_mensaje = '';
          IF e_id_clinica = 66 THEN
            SET e_mensaje = CONCAT(
              '* * * * * * * * * * * * * * * * *', '\n',
              'RECORDATORIO', '\n', '\n',
              '*Rogamos CONFIRME esta cita. RESPONDER MEDIANTE ESTE WHATSAPP*', '\n', '\n',
              '*Clínicas Love Madrid le recuerda su cita del ',
              DATE_FORMAT(e_fecha_cita, '%d/%m/%Y'), ' a las ',
              TIME_FORMAT(e_hora_inicio, '%H:%i'), ' horas*', '\n', '\n',
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
          ELSEIF e_id_clinica = 67 THEN
            SET e_mensaje = CONCAT(
              '* * * * * * * * * * * * * * *', '\n',
              'RECORDATORIO', '\n', '\n',
              'Rogamos CONFIRME esta cita. RESPONDER MEDIANTE ESTE WHATSAPP', '\n', '\n',
              'Clínicas Love Barcelona le recuerda su cita del ',
              DATE_FORMAT(e_fecha_cita, '%d/%m/%Y'), ' a las ',
              TIME_FORMAT(e_hora_inicio, '%H:%i'), ' horas', '\n', '\n',
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
          ELSEIF e_id_clinica = 62 THEN
            SET e_mensaje = CONCAT(
              '¡Hola! Te contactamos desde la Clínica PODOSOL para recordarte tu cita de ',
              IFNULL(e_nombre_tratamiento, 'tu tratamiento agendado'), ' el día ',
              DATE_FORMAT(e_fecha_cita, '%d/%m/%Y'), ' a las ',
              TIME_FORMAT(e_hora_inicio, '%H:%i'), '.', '\n', '\n',
              '*Es importante que tengas en cuenta que solo se realizan pagos en efectivo o Bizum. No se admite el pago con ningún tipo de tarjeta. Gracias por tu comprensión.*', '\n', '\n',
              'Te esperamos en PODOSOL. Calle Ánimas, 9, Local, 28802 Alcalá de Henares, Madrid. ',
              'Puedes confiar en que recibirás el mejor tratamiento, respaldado por años de experiencia y las técnicas más avanzadas.', '\n', '\n',
              '*Brindamos 15 minutos de cortesía. Si llegas después de ese tiempo, ten en cuenta que es posible que no podamos atenderte inmediatamente.*', '\n', '\n',
              '¡Muchas gracias!'
            );
          ELSEIF e_id_clinica = 64 THEN
            SET e_mensaje = CONCAT(
              'Estimado/a ', e_nombre_paciente, ' ', e_apellido_paciente, ',', '\n', '\n',
              'Le recordamos su cita el próximo ', LOWER(e_dia_semana), ' ',
              DATE_FORMAT(e_fecha_cita, '%d/%m/%Y'), ' a las ',
              TIME_FORMAT(e_hora_inicio, '%H:%i'),
              ' h en nuestra clínica de Málaga, para la realización de ',
              IFNULL(e_nombre_tratamiento, 'el tratamiento agendado'), '.', '\n', '\n',
              'Dirección: Calle Trinidad Grund 23, 29001 Málaga', '\n',
              'Puede consultar más información sobre nuestros servicios en www.clinicapoyatos.com', '\n',
              'También disponemos de clínica en Marbella, por si le resultara más conveniente.', '\n', '\n',
              'Le rogamos que, por favor, confirme su asistencia respondiendo a este mensaje.', '\n',
              'Si no pudiera acudir, le agradeceríamos que nos avisara con antelación para poder ofrecer su cita a otro paciente que lo necesite.', '\n', '\n',
              'Muchas gracias por su confianza.', '\n',
              'Clínica Poyatos'
            );
          ELSEIF e_id_clinica = 58 THEN
            SET e_mensaje = CONCAT(
              'Hola ', e_nombre_paciente, ',', '\n',
              'Te recuerdo tu cita de mañana a las ',
              TIME_FORMAT(e_hora_inicio, '%H:%i'),
              ' en Clínica Lorents', '\n', '\n',
              'Av. Francisco Jiménez Ruiz, 9, 30007 El Puntal, Murcia', '\n', '\n',
              '¿Me puedes confirmar si podrás acudir?', '\n', '\n',
              'Muchas gracias'
            );
          ELSEIF e_id_clinica = 37 THEN
            SET e_mensaje = CONCAT(
              '¡Hola ', e_nombre_paciente, '!', '\n', '\n',
              'Le recordamos su cita del ', LOWER(e_dia_semana), ' ',
              DATE_FORMAT(e_fecha_cita, '%d/%m/%Y'),
              ' para el tratamiento de ',
              IFNULL(e_nombre_tratamiento, 'su tratamiento agendado'), '.', '\n', '\n',
              'Por favor, confirme su asistencia respondiendo a este mensaje.', '\n',
              '¡Gracias por confiar en nosotros!'
            );
          ELSE
            SET e_mensaje = '';
          END IF;

          SET e_payload = JSON_OBJECT(
            'patient_firstname', e_nombre_paciente,
            'patient_lastname', e_apellido_paciente,
            'clinicName', e_nombre_clinica,
            'visit_week_day_name', e_dia_semana,
            'medic_full_name', e_nombre_medico,
            'treatmentName', e_nombre_tratamiento,
            'visit_date', DATE_FORMAT(e_fecha_cita, '%Y-%m-%d'),
            'visit_init_time', TIME_FORMAT(e_hora_inicio, '%H:%i:%s'),
            'visit_end_time', TIME_FORMAT(e_hora_fin, '%H:%i:%s'),
            'visit_space_name', e_nombre_espacio
          );

          IF e_id_estado_cita IN (1,7,8,9) THEN
            SET e_estado = CASE
              WHEN DATEDIFF(e_fecha_cita, CURDATE()) = 1 THEN 'cancelado'
              WHEN DATEDIFF(e_fecha_cita, CURDATE()) > 1 THEN 'pendiente'
              ELSE 'cancelado'
            END;
          ELSE
            SET e_estado = 'cancelado';
          END IF;

          -- Si la más temprana califica como pendiente, cancelar cualquier otra pendiente del mismo día
          IF e_estado = 'pendiente' THEN
            UPDATE notificaciones
               SET estado = 'cancelado',
                   actualizado_el = CURRENT_TIMESTAMP
             WHERE id_entidad_destino = e_id_paciente
               AND entidad_destino = 'paciente'
               AND tipo_notificacion = 'recordatorio_cita'
               AND fecha_envio_programada = e_fecha_envio
               AND estado = 'pendiente'
               AND (id_entidad_desencadenadora IS NULL OR id_entidad_desencadenadora <> e_id_cita);
          END IF;

          -- Upsert de la notificación de la cita más temprana
          IF EXISTS (
              SELECT 1 FROM notificaciones
               WHERE entidad_desencadenadora = 'cita'
                 AND id_entidad_desencadenadora = e_id_cita
            ) THEN
            UPDATE notificaciones
               SET tipo_notificacion       = 'recordatorio_cita',
                   id_entidad_destino      = e_id_paciente,
                   entidad_destino         = 'paciente',
                   mensaje                 = e_mensaje,
                   payload                 = e_payload,
                   fecha_envio_programada  = e_fecha_envio,
                   hora_envio_programada   = e_hora_envio,
                   id_clinica              = e_id_clinica,
                   id_super_clinica        = e_id_super_clinica,
                   estado                  = e_estado,
                   actualizado_el          = CURRENT_TIMESTAMP
             WHERE entidad_desencadenadora = 'cita'
               AND id_entidad_desencadenadora = e_id_cita;
          ELSE
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
            )
            VALUES (
              'recordatorio_cita',
              e_id_paciente,
              'paciente',
              e_mensaje,
              e_payload,
              e_fecha_envio,
              e_hora_envio,
              'cita',
              e_id_cita,
              e_id_clinica,
              e_id_super_clinica,
              e_estado,
              CURRENT_TIMESTAMP
            );
          END IF;

        END IF; -- n_min_cita
      END IF; -- n_min_hora

      /* ===========================================================
         3) Upsert/ajuste de la notificación de ESTA cita (NEW.id_cita)
            - Si no es la más temprana, va "cancelado"
            - Si es la más temprana, usa v_nuevo_estado (pendiente/cancelado según tu regla)
         =========================================================== */
      IF n_min_cita IS NOT NULL AND NEW.id_cita <> n_min_cita THEN
        SET v_nuevo_estado = 'cancelado';
      END IF;

      IF EXISTS (
        SELECT 1 FROM notificaciones
         WHERE entidad_desencadenadora = 'cita'
           AND id_entidad_desencadenadora = NEW.id_cita
      ) THEN
        UPDATE notificaciones
           SET tipo_notificacion       = 'recordatorio_cita',
               id_entidad_destino      = NEW.id_paciente,
               entidad_destino         = 'paciente',
               mensaje                 = v_mensaje,
               payload                 = v_payload,
               fecha_envio_programada  = v_fecha_envio,
               hora_envio_programada   = v_hora_envio,
               id_clinica              = NEW.id_clinica,
               id_super_clinica        = NEW.id_super_clinica,
               estado                  = v_nuevo_estado,
               actualizado_el          = CURRENT_TIMESTAMP
         WHERE entidad_desencadenadora = 'cita'
           AND id_entidad_desencadenadora = NEW.id_cita;
      ELSE
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
        )
        VALUES (
          'recordatorio_cita',
          NEW.id_paciente,
          'paciente',
          v_mensaje,
          v_payload,
          v_fecha_envio,
          v_hora_envio,
          'cita',
          NEW.id_cita,
          NEW.id_clinica,
          NEW.id_super_clinica,
          v_nuevo_estado,
          CURRENT_TIMESTAMP
        );
      END IF;

      /* ===========================================================
         4) Si la NEW pasa a 2,3,4,5,6, cancela su notificación
            (y la más temprana ya se re-evaluó arriba)
         =========================================================== */
      IF NEW.id_estado_cita IN (2,3,4,5,6) THEN
        UPDATE notificaciones
           SET estado = 'cancelado',
               actualizado_el = CURRENT_TIMESTAMP
         WHERE entidad_desencadenadora = 'cita'
           AND id_entidad_desencadenadora = NEW.id_cita
           AND estado = 'pendiente';
      END IF;

    ELSE
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Datos insuficientes para actualizar la notificación de cita';
    END IF;

    /* ===========================================================
       5) Si cambió paciente o fecha, recalcular también el grupo ANTIGUO
          (OLD.id_paciente, OLD.fecha_cita)
       =========================================================== */
    IF (NEW.id_paciente <> OLD.id_paciente) OR (NEW.fecha_cita <> OLD.fecha_cita) THEN
      SET o_min_hora = NULL;
      SET o_min_cita = NULL;
      SET o_fecha_envio = NULL;
      SET o_hora_envio  = NULL;

      SELECT MIN(hora_inicio)
        INTO o_min_hora
        FROM citas
       WHERE id_paciente = OLD.id_paciente
         AND fecha_cita = OLD.fecha_cita
         AND id_estado_cita IN (1,7,8,9);

      IF o_min_hora IS NOT NULL THEN
        SELECT MIN(id_cita)
          INTO o_min_cita
          FROM citas
         WHERE id_paciente = OLD.id_paciente
           AND fecha_cita = OLD.fecha_cita
           AND id_estado_cita IN (1,7,8,9)
           AND hora_inicio = o_min_hora;

        IF o_min_cita IS NOT NULL THEN
          -- Recalcular fecha/hora_envío para el grupo viejo usando la cita o_min_cita
          -- (necesitamos id_clinica/fecha/hora)
          SELECT
            CASE WHEN id_clinica = 64 AND DAYOFWEEK(fecha_cita) = 2
                 THEN DATE(fecha_cita - INTERVAL 3 DAY)
                 ELSE DATE(TIMESTAMP(fecha_cita, hora_inicio) - INTERVAL 24 HOUR)
            END AS f_envio,
            CASE WHEN id_clinica = 64 AND DAYOFWEEK(fecha_cita) = 2
                 THEN hora_inicio
                 ELSE TIME(TIMESTAMP(fecha_cita, hora_inicio) - INTERVAL 24 HOUR)
            END AS h_envio
            INTO o_fecha_envio, o_hora_envio
          FROM citas
          WHERE id_cita = o_min_cita;

          -- Cancelar cualquier pendiente del grupo viejo que no sea la más temprana elegible
          UPDATE notificaciones
             SET estado = 'cancelado',
                 actualizado_el = CURRENT_TIMESTAMP
           WHERE id_entidad_destino = OLD.id_paciente
             AND entidad_destino = 'paciente'
             AND tipo_notificacion = 'recordatorio_cita'
             AND fecha_envio_programada = o_fecha_envio
             AND estado = 'pendiente'
             AND (id_entidad_desencadenadora IS NULL OR id_entidad_desencadenadora <> o_min_cita);
        END IF;
      ELSE
        -- Si ya no hay citas elegibles en el grupo viejo, asegúrate de no dejar pendientes huérfanas
        -- (ponlas en cancelado)
        UPDATE notificaciones
           SET estado = 'cancelado',
               actualizado_el = CURRENT_TIMESTAMP
         WHERE id_entidad_destino = OLD.id_paciente
           AND entidad_destino = 'paciente'
           AND tipo_notificacion = 'recordatorio_cita'
           AND fecha_envio_programada = (
             -- calcular fecha_envio del OLD si se puede
             CASE
               WHEN OLD.id_clinica = 64 AND DAYOFWEEK(OLD.fecha_cita) = 2
                 THEN DATE(OLD.fecha_cita - INTERVAL 3 DAY)
               ELSE DATE(TIMESTAMP(OLD.fecha_cita, OLD.hora_inicio) - INTERVAL 24 HOUR)
             END
           )
           AND estado = 'pendiente';
      END IF;
    END IF;

  END IF; -- fin cambios relevantes
END$$

DELIMITER ;