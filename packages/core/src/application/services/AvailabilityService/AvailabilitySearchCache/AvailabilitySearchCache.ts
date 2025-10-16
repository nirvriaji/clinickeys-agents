/*
 * AvailabilitySearchCache
 * ---------------------------------------------
 * Cache en memoria para resultados de búsqueda de disponibilidad.
 *
 * Objetivos:
 * - Evitar repetir consultas idénticas (mismas fechas/doctor/espacio/tratamiento/clinica).
 * - TTL estricto y política LRU simple para evitar crecimiento sin control.
 * - Claves determinísticas y normalizadas (case-insensitive, arrays ordenados).
 * - Invalidation granular por clínica, por rango de fechas, y por entidades.
 * - Telemetría ligera (hits/misses, tamaño, entradas expiradas purgadas).
 *
 * NOTAS:
 * - Diseñado para funcionar dentro del ciclo de vida de una Lambda (por lo que es un cache
 *   best-effort y efímero). No persiste entre invocaciones.
 * - Totalmente independiente de capas legacy.
 */

import { Logger } from "@clinickeys-agents/core/infrastructure/external";

// =============================
// Tipos del dominio mínimo (no importar los pesados)
// =============================
export interface FechasItem { fecha: string }

export interface AvailabilitySearchInputKey {
  id_clinica: number;
  tratamientos: string[]; // nombres normalizados en la entrada (el repos ya resuelve IDs)
  medicos: string[];      // nombres
  espacios: string[];     // nombres
  fechas: FechasItem[];   // lista exacta de YYYY-MM-DD
}

export interface AvailabilitySearchValue {
  analisis_agenda: any[]; // SlotDisponibilidad[] ya ajustados
  fetchedAtISO: string;
  ttlMs: number;
}

export type CacheHitMiss = "hit" | "miss" | "stale";

// =============================
// Utilidades
// =============================
function toISODate(s: string): string {
  // Acepta YYYY-MM-DD, tolera espacios
  const v = String(s || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
  return v;
}

function normText(x: string): string { return String(x || "").trim().toLowerCase(); }

function uniqSorted(arr: string[]): string[] {
  return Array.from(new Set(arr.map(normText))).sort();
}

function stableKeyOf(input: AvailabilitySearchInputKey): string {
  const fechas = (input.fechas || [])
    .map(f => toISODate(f.fecha))
    .filter(Boolean)
    .sort();
  const payload = {
    c: input.id_clinica,
    t: uniqSorted(input.tratamientos || []),
    m: uniqSorted(input.medicos || []),
    e: uniqSorted(input.espacios || []),
    f: fechas,
  };
  // JSON estable + sin espacios para minimizar tamaño
  return JSON.stringify(payload);
}

// =============================
// Entrada almacenada con metadatos
// =============================
interface Entry {
  key: string;                // clave estable
  value: AvailabilitySearchValue;
  expiresAt: number;          // epoch ms
  lastAccess: number;         // para LRU
  tags: {
    clinicId: number;
    // ayudas para invalidación
    dates: string[];          // YYYY-MM-DD
    medicos: string[];        // normalizados
    espacios: string[];       // normalizados
    tratamientos: string[];   // normalizados
  };
}

// =============================
// Config y métricas
// =============================
export interface AvailabilitySearchCacheOptions {
  ttlMs?: number;       // por defecto 5 minutos
  maxEntries?: number;  // por defecto 1000
  logger?: typeof Logger;
}

export interface AvailabilitySearchCacheStats {
  size: number;
  capacity: number;
  ttlMs: number;
  hits: number;
  misses: number;
  stale: number;
  evicted: number;
  purgedExpired: number;
}

// =============================
// Implementación
// =============================
export class AvailabilitySearchCache {
  private store: Map<string, Entry> = new Map();
  private order: string[] = []; // cola LRU simple (keys); la más antigua al inicio
  private ttlMs: number;
  private maxEntries: number;
  private hits = 0;
  private misses = 0;
  private stale = 0;
  private evicted = 0;
  private purgedExpired = 0;
  private logger: typeof Logger;

  constructor(opts?: AvailabilitySearchCacheOptions) {
    this.ttlMs = Math.max(1000, Math.floor(opts?.ttlMs ?? 5 * 60 * 1000));
    this.maxEntries = Math.max(10, Math.floor(opts?.maxEntries ?? 1000));
    this.logger = opts?.logger || Logger;
  }

  // --------- API pública ---------

  /** Construye la key estable para un input dado. */
  public buildKey(input: AvailabilitySearchInputKey): string {
    return stableKeyOf(input);
  }

  /** Lee del cache; devuelve null si no existe o si está expirado. */
  public get(keyOrInput: string | AvailabilitySearchInputKey): AvailabilitySearchValue | null {
    const key = typeof keyOrInput === "string" ? keyOrInput : this.buildKey(keyOrInput);
    const now = Date.now();
    const ent = this.store.get(key);
    if (!ent) {
      this.misses++;
      return null;
    }
    if (ent.expiresAt <= now) {
      // marcar como stale y purgar en deferred
      this.stale++;
      this.store.delete(key);
      this.removeFromOrder(key);
      this.purgedExpired++;
      return null;
    }
    ent.lastAccess = now;
    this.touch(key);
    this.hits++;
    return ent.value;
  }

  /** Inserta/actualiza una entrada con TTL del cache (o el ttl de value si se pasa explícito). */
  public set(keyOrInput: string | AvailabilitySearchInputKey, value: AvailabilitySearchValue): void {
    const key = typeof keyOrInput === "string" ? keyOrInput : this.buildKey(keyOrInput);
    const now = Date.now();
    const ttl = Math.max(1000, value.ttlMs || this.ttlMs);

    const dates = ((value as any)?.dates || []) as string[]; // opcional, por si el caller lo agrega
    const parsedDates = dates.length
      ? dates.map(toISODate).filter(Boolean)
      : this.extractDatesFromKey(key);

    const tags = {
      clinicId: this.extractClinicIdFromKey(key),
      dates: parsedDates,
      medicos: this.extractFieldFromKey(key, "m"),
      espacios: this.extractFieldFromKey(key, "e"),
      tratamientos: this.extractFieldFromKey(key, "t"),
    } as Entry["tags"];

    const entry: Entry = {
      key,
      value: {
        analisis_agenda: Array.isArray(value.analisis_agenda) ? value.analisis_agenda : [],
        fetchedAtISO: value.fetchedAtISO || new Date().toISOString(),
        ttlMs: ttl,
      },
      expiresAt: now + ttl,
      lastAccess: now,
      tags,
    };

    this.store.set(key, entry);
    this.touch(key);
    this.enforceCapacity();
  }

  /** Obtiene si existe, si no ejecuta fetch() y almacena el resultado. */
  public async getOrSet(
    input: AvailabilitySearchInputKey,
    fetcher: () => Promise<AvailabilitySearchValue>
  ): Promise<{ value: AvailabilitySearchValue; status: CacheHitMiss }>{
    const key = this.buildKey(input);
    const cached = this.get(key);
    if (cached) return { value: cached, status: "hit" };

    const val = await fetcher();
    this.set(key, val);
    return { value: val, status: "miss" };
  }

  /** Invalida TODAS las entradas. */
  public clearAll(): void {
    this.store.clear();
    this.order = [];
  }

  /** Invalida por clínica completa. */
  public invalidateClinic(clinicId: number): number {
    const ids = this.findKeysByPredicate(e => e.tags.clinicId === clinicId);
    return this.deleteKeys(ids);
  }

  /** Invalida por rango de fechas (inclusive) dentro de una clínica. */
  public invalidateDateRange(clinicId: number, startISO: string, endISO: string): number {
    const s = toISODate(startISO); const e = toISODate(endISO);
    if (!s || !e) return 0;
    const ids = this.findKeysByPredicate(ent => {
      if (ent.tags.clinicId !== clinicId) return false;
      return ent.tags.dates.some(d => d >= s && d <= e);
    });
    return this.deleteKeys(ids);
  }

  /** Invalida por nombres de médicos (normalizados). */
  public invalidateDoctors(clinicId: number, doctors: string[]): number {
    const set = new Set(uniqSorted(doctors));
    const ids = this.findKeysByPredicate(ent => ent.tags.clinicId === clinicId && ent.tags.medicos.some(m => set.has(m)));
    return this.deleteKeys(ids);
  }

  /** Invalida por nombres de espacios (normalizados). */
  public invalidateSpaces(clinicId: number, spaces: string[]): number {
    const set = new Set(uniqSorted(spaces));
    const ids = this.findKeysByPredicate(ent => ent.tags.clinicId === clinicId && ent.tags.espacios.some(x => set.has(x)));
    return this.deleteKeys(ids);
  }

  /** Invalida por nombres de tratamientos (normalizados). */
  public invalidateTreatments(clinicId: number, treatments: string[]): number {
    const set = new Set(uniqSorted(treatments));
    const ids = this.findKeysByPredicate(ent => ent.tags.clinicId === clinicId && ent.tags.tratamientos.some(t => set.has(t)));
    return this.deleteKeys(ids);
  }

  /** Devuelve métricas del cache. */
  public stats(): AvailabilitySearchCacheStats {
    return {
      size: this.store.size,
      capacity: this.maxEntries,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      stale: this.stale,
      evicted: this.evicted,
      purgedExpired: this.purgedExpired,
    };
  }

  // --------- Internos ---------

  private enforceCapacity(): void {
    // Purga expirados primero
    this.purgeExpired();
    // Luego aplica LRU si excede
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.order[0];
      if (!oldestKey) break;
      this.remove(oldestKey);
      this.evicted++;
    }
  }

  private purgeExpired(): void {
    const now = Date.now();
    const keys = Array.from(this.store.keys());
    for (const k of keys) {
      const ent = this.store.get(k)!;
      if (ent.expiresAt <= now) {
        this.remove(k);
        this.purgedExpired++;
      }
    }
  }

  private remove(key: string): void {
    this.store.delete(key);
    this.removeFromOrder(key);
  }

  private touch(key: string): void {
    // LRU: mover al final (más reciente)
    this.removeFromOrder(key);
    this.order.push(key);
  }

  private removeFromOrder(key: string): void {
    const idx = this.order.indexOf(key);
    if (idx >= 0) this.order.splice(idx, 1);
  }

  private findKeysByPredicate(pred: (e: Entry) => boolean): string[] {
    const out: string[] = [];
    for (const [k, ent] of this.store) {
      if (pred(ent)) out.push(k);
    }
    return out;
  }

  private deleteKeys(keys: string[]): number {
    let count = 0;
    for (const k of keys) {
      if (this.store.has(k)) {
        this.remove(k);
        count++;
      }
    }
    return count;
  }

  // --- Extractores desde la key (evita parsear JSON 2 veces en callers) ---
  private extractClinicIdFromKey(key: string): number {
    try {
      const obj = JSON.parse(key);
      return Number(obj?.c) || 0;
    } catch {
      return 0;
    }
  }

  private extractDatesFromKey(key: string): string[] {
    try {
      const obj = JSON.parse(key);
      const arr = Array.isArray(obj?.f) ? obj.f : [];
      return arr.map((d: string) => toISODate(d)).filter(Boolean);
    } catch {
      return [];
    }
  }

  private extractFieldFromKey(key: string, prop: "t" | "m" | "e"): string[] {
    try {
      const obj = JSON.parse(key);
      const arr = Array.isArray(obj?.[prop]) ? obj[prop] : [];
      return arr.map(normText);
    } catch {
      return [];
    }
  }
}

export default AvailabilitySearchCache;