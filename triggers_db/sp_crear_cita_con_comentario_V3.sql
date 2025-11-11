DELIMITER $$

DROP PROCEDURE IF EXISTS sp_crear_cita_con_comentario_V3 $$
CREATE PROCEDURE sp_crear_cita_con_comentario_V3(
  IN p_id_paciente          BIGINT,
  IN p_id_medico            BIGINT,
  IN p_id_espacio           BIGINT,
  IN p_id_tratamiento       BIGINT,
  IN p_fecha_cita           DATE,
  IN p_hora_inicio          TIME,
  IN p_hora_fin             TIME,
  IN p_id_clinica           BIGINT,
  IN p_id_super_clinica     BIGINT,
  IN p_id_presupuesto       BIGINT,
  IN p_comentario_ia        TEXT,
  IN p_id_pack_bono         INT,      -- legacy (no se usa)
  IN p_id_bono_paciente     BIGINT,   -- bono asignado al paciente
  IN p_item_bono_paciente   BIGINT    -- nuevo: item del bono (detalle_bono_paciente.item)
)
sp_crear_cita_con_comentario_V3: BEGIN
  DECLARE v_hora_fin          TIME;
  DECLARE v_es_pack_bono      TINYINT DEFAULT 0;
  DECLARE v_id_bono_paciente  BIGINT  DEFAULT NULL;
  DECLARE v_item_bono_paciente BIGINT DEFAULT NULL;

  -- Handler genérico (seguro)
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'sp_crear_cita_con_comentario_V3: error en la ejecución.';
  END;

  START TRANSACTION;

  /* =======================
     Cálculo de hora fin
     ======================= */
  IF p_hora_fin IS NULL THEN
    SET v_hora_fin = ADDTIME(p_hora_inicio, '00:30:00');
  ELSE
    SET v_hora_fin = p_hora_fin;
  END IF;

  /* =======================
     Validación de médico
     ======================= */
  IF NOT EXISTS (
    SELECT 1 FROM medicos
    WHERE id_medico = p_id_medico
      AND id_estado_registro = 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El médico proporcionado no existe o no está activo.';
  END IF;

  /* =======================
     Validaciones de solape (médico, espacio, paciente)
     ======================= */
  IF EXISTS (
    SELECT 1 FROM citas
    WHERE id_medico = p_id_medico
      AND fecha_cita = p_fecha_cita
      AND id_clinica = p_id_clinica
      AND id_super_clinica = p_id_super_clinica
      AND id_estado_cita IN (1,4,7,8,9)
      AND (p_hora_inicio < hora_fin AND v_hora_fin > hora_inicio)
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El médico ya tiene una cita en este horario.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM citas
    WHERE id_espacio = p_id_espacio
      AND fecha_cita = p_fecha_cita
      AND id_clinica = p_id_clinica
      AND id_super_clinica = p_id_super_clinica
      AND id_estado_cita IN (1,4,7,8,9)
      AND (p_hora_inicio < hora_fin AND v_hora_fin > hora_inicio)
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El espacio ya está ocupado en este horario.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM citas
    WHERE id_paciente = p_id_paciente
      AND fecha_cita = p_fecha_cita
      AND id_clinica = p_id_clinica
      AND id_super_clinica = p_id_super_clinica
      AND id_estado_cita IN (1,4,7,8,9)
      AND (p_hora_inicio < hora_fin AND v_hora_fin > hora_inicio)
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El paciente ya tiene una cita en este horario.';
  END IF;

  /* =======================
     Validación de bono del paciente
     ======================= */
  SET v_id_bono_paciente   = NULL;
  SET v_item_bono_paciente = NULL;
  SET v_es_pack_bono       = 0;

  IF p_id_bono_paciente IS NOT NULL AND p_id_bono_paciente > 0 THEN
    -- 1. Verificar que el bono exista y pertenezca al paciente
    IF NOT EXISTS (
      SELECT 1
      FROM bonos_pacientes bp
      WHERE bp.id_bono_paciente   = p_id_bono_paciente
        AND bp.id_paciente        = p_id_paciente
        AND bp.id_clinica         = p_id_clinica
        AND bp.id_super_clinica   = p_id_super_clinica
        AND bp.id_estado_registro = 1
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'El bono del paciente no existe o no pertenece al paciente/clinica/super.';
    END IF;

    -- 2. Validar que el item/tratamiento pertenezca al bono
    IF NOT EXISTS (
      SELECT 1
      FROM detalle_bono_paciente dbp
      WHERE dbp.id_bono_paciente = p_id_bono_paciente
        AND dbp.id_tratamiento   = p_id_tratamiento
        AND dbp.item             = p_item_bono_paciente
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'El tratamiento o item indicado no pertenece al bono del paciente.';
    END IF;

    SET v_id_bono_paciente   = p_id_bono_paciente;
    SET v_item_bono_paciente = p_item_bono_paciente;
    SET v_es_pack_bono       = 1;
  END IF;

  /* =======================
     Inserción de la cita
     ======================= */
  INSERT INTO citas (
    id_paciente,
    id_medico,
    id_espacio,
    id_tratamiento,
    fecha_cita,
    hora_inicio,
    hora_fin,
    id_estado_cita,
    id_clinica,
    id_super_clinica,
    es_pack_bono,
    id_bono_paciente,
    item_bono_paciente,
    id_presupuesto,
    comentario_ia
  ) VALUES (
    p_id_paciente,
    p_id_medico,
    p_id_espacio,
    p_id_tratamiento,
    p_fecha_cita,
    p_hora_inicio,
    v_hora_fin,
    1, -- Estado 'Programado'
    p_id_clinica,
    p_id_super_clinica,
    v_es_pack_bono,
    v_id_bono_paciente,
    v_item_bono_paciente,
    p_id_presupuesto,
    p_comentario_ia
  );

  COMMIT;

  SELECT LAST_INSERT_ID() AS id_cita;
END $$

DELIMITER ;