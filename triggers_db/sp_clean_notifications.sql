DELIMITER $$

CREATE PROCEDURE limpiar_notificaciones_obsoletas()
BEGIN
  DECLARE v_hoy DATE;
  SET v_hoy = CURDATE();

  /* 1️⃣ Cancelar notificaciones pendientes de citas eliminadas o ya no existentes */
  UPDATE notificaciones n
     LEFT JOIN citas c
       ON n.id_entidad_desencadenadora = c.id_cita
      AND n.entidad_desencadenadora = 'cita'
     SET n.estado = 'cancelado',
         n.actualizado_el = CURRENT_TIMESTAMP
   WHERE n.estado = 'pendiente'
     AND c.id_cita IS NULL;

  /* 2️⃣ Cancelar notificaciones de citas con estados no notificables */
  UPDATE notificaciones n
     JOIN citas c
       ON n.id_entidad_desencadenadora = c.id_cita
      AND n.entidad_desencadenadora = 'cita'
     SET n.estado = 'cancelado',
         n.actualizado_el = CURRENT_TIMESTAMP
   WHERE n.estado = 'pendiente'
     AND c.id_estado_cita NOT IN (1,7,8,9);

  /* 3️⃣ Cancelar notificaciones cuya fecha de envío ya pasó y aún están pendientes */
  UPDATE notificaciones
     SET estado = 'cancelado',
         actualizado_el = CURRENT_TIMESTAMP
   WHERE estado = 'pendiente'
     AND fecha_envio_programada < v_hoy;

END$$

DELIMITER ;
