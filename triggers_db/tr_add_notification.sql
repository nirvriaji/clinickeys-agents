DELIMITER $$
CREATE TRIGGER tr_add_notification
AFTER INSERT ON citas
FOR EACH ROW
BEGIN
  IF NEW.id_estado_cita IN (1,7,8,9) THEN
    CALL generar_notificacion_por_cita(NEW.id_cita);
  END IF;
END$$
DELIMITER ;