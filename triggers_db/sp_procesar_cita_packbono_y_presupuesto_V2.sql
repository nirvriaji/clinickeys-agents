DELIMITER $$

CREATE PROCEDURE sp_procesar_cita_packbono_y_presupuesto_V2 (
    IN p_id_cita   BIGINT,
    IN p_action    VARCHAR(32)  -- 'on_crear_cita' | 'on_eliminar_cita'
)
BEGIN
    DECLARE v_id_bono_paciente    BIGINT;
    DECLARE v_item_bono_paciente  BIGINT;
    DECLARE v_id_presupuesto      BIGINT;
    DECLARE v_id_tratamiento      BIGINT;
    DECLARE v_id_paciente         BIGINT;
    DECLARE v_message             VARCHAR(255);

    DECLARE v_not_found           BOOL DEFAULT FALSE;

    -- Handler para SELECT ... INTO sin filas
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_not_found = TRUE;

    -- Handler para errores de SQL: hace rollback y devuelve un mensaje de error
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SELECT 'Ha ocurrido un error durante la transacción' AS Error;
    END;

    START TRANSACTION;

    SET v_not_found = FALSE;

    -- Obtener datos de la cita
    SELECT 
        id_bono_paciente,
        item_bono_paciente,
        id_presupuesto,
        id_tratamiento, 
        id_paciente
    INTO   
        v_id_bono_paciente,
        v_item_bono_paciente,
        v_id_presupuesto,
        v_id_tratamiento, 
        v_id_paciente
    FROM citas
    WHERE id_cita = p_id_cita
    FOR UPDATE;

    IF v_not_found THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'No se encontró la cita indicada.';
    END IF;

    -- Validar que el presupuesto exista si está asociado
    IF v_id_presupuesto IS NOT NULL AND v_id_presupuesto > 0 THEN
        SET v_not_found = FALSE;
        SELECT 1 INTO v_id_presupuesto
        FROM presupuestos
        WHERE id_presupuesto = v_id_presupuesto
        LIMIT 1;

        IF v_not_found THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'El presupuesto asociado no existe.';
        END IF;
    END IF;

    -- Si no hay bono asociado, no hacer nada (solo mensaje)
    IF v_id_bono_paciente IS NULL THEN
        SET v_message = 'La cita no tiene bono asociado, no se realizó ninguna acción.';
    ELSE
        IF p_action = 'on_crear_cita' THEN
            -- Validar que existe el bono del paciente y pertenece al paciente
            SET v_not_found = FALSE;
            SELECT 1 INTO v_id_bono_paciente
            FROM bonos_pacientes
            WHERE id_bono_paciente = v_id_bono_paciente
              AND id_paciente = v_id_paciente
            LIMIT 1;

            IF v_not_found THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'No se encontró el bono del paciente.';
            END IF;

            -- Si la cita no tiene item, obtenerlo del detalle del bono para el tratamiento
            IF v_item_bono_paciente IS NULL THEN
                SET v_not_found = FALSE;
                SELECT item
                INTO v_item_bono_paciente
                FROM detalle_bono_paciente
                WHERE id_bono_paciente = v_id_bono_paciente
                  AND id_tratamiento   = v_id_tratamiento
                LIMIT 1;

                IF v_not_found OR v_item_bono_paciente IS NULL THEN
                    SIGNAL SQLSTATE '45000'
                        SET MESSAGE_TEXT = 'El tratamiento no existe en el detalle del bono.';
                END IF;
            END IF;

            -- Asignar bono e item a la cita (marca como cita de bono)
            UPDATE citas
            SET id_bono_paciente   = v_id_bono_paciente,
                item_bono_paciente = v_item_bono_paciente
            WHERE id_cita = p_id_cita;

            -- Incrementar sesiones usadas y decrementar pendientes
            UPDATE bonos_pacientes
            SET sesiones_usado     = sesiones_usado + 1,
                sesiones_pendiente = sesiones_pendiente - 1
            WHERE id_bono_paciente = v_id_bono_paciente
              AND sesiones_pendiente > 0;

            IF ROW_COUNT() = 0 THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'No hay sesiones pendientes disponibles en el bono.';
            END IF;

            SET v_message = 'Se actualizó la cita y se registró el uso de una sesión del bono.';

        ELSEIF p_action = 'on_eliminar_cita' THEN
            -- Validar que existe el bono del paciente y pertenece al paciente
            SET v_not_found = FALSE;
            SELECT 1 INTO v_id_bono_paciente
            FROM bonos_pacientes
            WHERE id_bono_paciente = v_id_bono_paciente
              AND id_paciente = v_id_paciente
            LIMIT 1;

            IF v_not_found THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'No se encontró el bono del paciente.';
            END IF;

            -- Desvincular la cita del bono (y presupuesto si aplica)
            UPDATE citas
            SET id_bono_paciente   = NULL,
                item_bono_paciente = NULL,
                id_presupuesto     = NULL
            WHERE id_cita = p_id_cita;

            -- Revertir consumo de sesión (disminuye usadas, aumenta pendientes)
            UPDATE bonos_pacientes
            SET sesiones_usado     = CASE WHEN sesiones_usado > 0 THEN sesiones_usado - 1 ELSE 0 END,
                sesiones_pendiente = sesiones_pendiente + 1
            WHERE id_bono_paciente = v_id_bono_paciente;

            SET v_message = 'Se eliminó la cita y se desvinculó del bono.';

        ELSE
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Acción no válida. Use on_crear_cita o on_eliminar_cita.';
        END IF;
    END IF;

    COMMIT;
    SELECT v_message AS Mensaje;
END$$

DELIMITER ;