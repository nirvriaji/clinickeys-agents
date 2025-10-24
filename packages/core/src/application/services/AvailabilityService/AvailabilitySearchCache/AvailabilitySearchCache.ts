// packages/core/src/application/services/AvailabilityService/AvailabilitySearchCache.ts

import { Logger } from "@clinickeys-agents/core/infrastructure/external";

// =============================
// Tipos públicos (ID-first)
// =============================
export interface AvailabilitySearchInputKey {
  id_clinica: number;
  tratamiento_ids: number[]; // únicos y ordenados
  medico_ids: number[];      // únicos y ordenados
  espacio_ids: number[];     // únicos y ordenados
  fechas: string[];          // YYYY-MM-DD
}

export interface AvailabilitySearchValue {
  analisis_agenda: any[]; // SlotDisponibilidad[] ya ajustados
  fetchedAtISO: string;
  ttlMs: number; // TTL sugerido por el caller; si falta se usa por defecto del cache
}

export type CacheHitMiss = "hit" | "miss" | "stale";

export interface AvailabilitySearchCacheOptions {
  ttlMs?: number;      // por defecto 5 minutos
  maxEntries?: number; // por defecto 1000
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
// Utilidades internas
// =============================
function toISODate(s: string): string {
  const v = String(s || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

function normIds(arr: number[] | undefined): number[] {
  const out = new Set<number>();
  for (const x of arr || []) {
    const n = Number(x);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return Array.from(out).sort((a, b) => a - b);
}

function normDates(arr: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const s of arr || []) {
    const d = toISODate(s);
    if (d) out.add(d);
  }
  return Array.from(out).sort();
}

function stableKeyOf(input: AvailabilitySearchInputKey): string {
  const payload = {
    c: Number(input.id_clinica) || 0,
    t: normIds(input.tratamiento_ids),
    m: normIds(input.medico_ids),
    e: normIds(input.espacio_ids),
    f: normDates(input.fechas),
  };
  return JSON.stringify(payload); // estable, sin espacios
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
    dates: string[];          // YYYY-MM-DD
    medicoIds: number[];
    espacioIds: number[];
    tratamientoIds: number[];
  };
}

// =============================
// Implementación
// =============================
export class AvailabilitySearchCache {
  private store: Map<string, Entry> = new Map();
  private order: string[] = []; // cola LRU simple
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

    // Etiquetas para invalidación
    const tags: Entry["tags"] = {
      clinicId: this.extractClinicIdFromKey(key),
      dates: this.extractStringArrayFromKey(key, "f"),
      medicoIds: this.extractNumberArrayFromKey(key, "m"),
      espacioIds: this.extractNumberArrayFromKey(key, "e"),
      tratamientoIds: this.extractNumberArrayFromKey(key, "t"),
    };

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

  /** Invalida por IDs de médicos. */
  public invalidateDoctors(clinicId: number, doctorIds: number[]): number {
    const set = new Set(normIds(doctorIds));
    if (!set.size) return 0;
    const ids = this.findKeysByPredicate(ent => ent.tags.clinicId === clinicId && ent.tags.medicoIds.some(m => set.has(m)));
    return this.deleteKeys(ids);
  }

  /** Invalida por IDs de espacios. */
  public invalidateSpaces(clinicId: number, spaceIds: number[]): number {
    const set = new Set(normIds(spaceIds));
    if (!set.size) return 0;
    const ids = this.findKeysByPredicate(ent => ent.tags.clinicId === clinicId && ent.tags.espacioIds.some(x => set.has(x)));
    return this.deleteKeys(ids);
  }

  /** Invalida por IDs de tratamientos. */
  public invalidateTreatments(clinicId: number, treatmentIds: number[]): number {
    const set = new Set(normIds(treatmentIds));
    if (!set.size) return 0;
    const ids = this.findKeysByPredicate(ent => ent.tags.clinicId === clinicId && ent.tags.tratamientoIds.some(t => set.has(t)));
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
    this.purgeExpired();
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

  // --- Extractores desde la key (evita parsear JSON en callers) ---
  private extractClinicIdFromKey(key: string): number {
    try {
      const obj = JSON.parse(key);
      return Number(obj?.c) || 0;
    } catch {
      return 0;
    }
  }

  private extractStringArrayFromKey(key: string, prop: "f"): string[] {
    try {
      const obj = JSON.parse(key);
      const arr = Array.isArray(obj?.[prop]) ? obj[prop] : [];
      return normDates(arr);
    } catch {
      return [];
    }
  }

  private extractNumberArrayFromKey(key: string, prop: "t" | "m" | "e"): number[] {
    try {
      const obj = JSON.parse(key);
      const arr = Array.isArray(obj?.[prop]) ? obj[prop] : [];
      return normIds(arr);
    } catch {
      return [];
    }
  }
}

export default AvailabilitySearchCache;