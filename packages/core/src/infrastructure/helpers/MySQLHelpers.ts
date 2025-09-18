// packages/core/src/infrastructure/helpers/MySQLHelpers.ts

import mysql, { Pool, PoolOptions } from "mysql2/promise";
import type { OkPacket } from "mysql2";

// --- Inicializador singleton del pool ---
let pool: Pool | null = null;

export function createMySQLPool(config: PoolOptions): Pool {
  if (!pool) {
    pool = mysql.createPool({
      ...config,
      dateStrings: true, // fuerza que DATETIME/DATE se devuelvan como string
    });
    (pool as any).on("connection", async (connection: any) => {
      try {
        const conn = connection.promise();
        await conn.query("SET SESSION wait_timeout=28800");
        await conn.query("SET SESSION interactive_timeout=28800");
      } catch (err) {
        console.error("[ERROR] No se pudo configurar los timeouts de la sesión:", err);
      }
    });
    (pool as any).on("error", (err: any) => {
      console.error("[ERROR] Problema en el pool de conexiones:", err);
      pool = null;
    });
  }
  return pool;
}

export function getMySQLPool(): Pool {
  if (!pool) {
    throw new Error("MySQL pool no inicializado. Usa createMySQLPool primero.");
  }
  return pool;
}

/**
 * Ejecuta una consulta SQL (SELECT) con reintentos automáticos ante timeout de cliente.
 */
export async function ejecutarConReintento<T = any>(
  consulta: string,
  parametros: any[] = [],
  reintentos = 3
): Promise<T[]> {
  const dbPool = getMySQLPool();
  for (let intento = 1; intento <= reintentos; intento++) {
    let conexion;
    try {
      conexion = await dbPool.getConnection();
      const [rows] = await conexion.execute(consulta, parametros);
      return rows as T[];
    } catch (error: any) {
      console.error(`Intento ${intento} falló:`, error);
      if (
        intento === reintentos ||
        error.code !== "ER_CLIENT_INTERACTION_TIMEOUT"
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      if (conexion) conexion.release();
    }
  }
  throw new Error("Fallo inesperado en reintentos de consulta SQL");
}

/**
 * Ejecuta una consulta SQL (INSERT/UPDATE/DELETE) con reintentos automáticos ante timeout de cliente.
 */
export async function ejecutarExecConReintento(
  consulta: string,
  parametros: any[] = [],
  reintentos = 3
): Promise<OkPacket> {
  const dbPool = getMySQLPool();
  for (let intento = 1; intento <= reintentos; intento++) {
    let conexion;
    try {
      conexion = await dbPool.getConnection();
      const [result] = await conexion.execute(consulta, parametros);
      return result as OkPacket;
    } catch (error: any) {
      console.error(`Intento ${intento} falló:`, error);
      if (
        intento === reintentos ||
        error.code !== "ER_CLIENT_INTERACTION_TIMEOUT"
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      if (conexion) conexion.release();
    }
  }
  throw new Error("Fallo inesperado en reintentos de ejecución SQL");
}

/**
 * Ejecuta una consulta SQL obteniendo una única fila (o null si no hay resultado).
 */
export async function ejecutarUnicoResultado<T = any>(
  consulta: string,
  parametros: any[] = [],
  reintentos = 3
): Promise<T | null> {
  const rows = await ejecutarConReintento<T>(consulta, parametros, reintentos);
  return rows[0] || null;
}

/**
 * Ejecuta una consulta SQL obteniendo todas las filas.
 */
export async function ejecutarTodosLosResultados<T = any>(
  consulta: string,
  parametros: any[] = [],
  reintentos = 3
): Promise<T[]> {
  const rows = await ejecutarConReintento<T>(consulta, parametros, reintentos);
  return rows || [];
}

export { Pool } from "mysql2/promise";