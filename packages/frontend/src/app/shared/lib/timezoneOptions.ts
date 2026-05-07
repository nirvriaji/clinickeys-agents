// /shared/lib/timezoneOptions.ts

import type { Option } from '@/app/shared/types/global';

/**
 * Devuelve la lista de todas las zonas horarias disponibles como Option[].
 * El label es el nombre estándar de la timezone (ej: 'America/Lima'), value igual.
 * Ordena alfabéticamente.
 */
export async function getAllTimezoneOptions(): Promise<Option[]> {
  // Dynamic import to handle ESM module in CommonJS context
  const { default: ct } = await import('countries-and-timezones');
  
  const timezones = Object.values(ct.getAllTimezones());
  return timezones
    .map((tz: any) => ({
      value: tz.name,   // Ej: 'America/Lima'
      label: tz.name,   // Ej: 'America/Lima'
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Devuelve la lista de zonas horarias de un país dado (ISO alpha-2).
 * Si el país no existe, devuelve [].
 */
export async function getTimezoneOptionsByCountry(countryCode: string): Promise<Option[]> {
  // Dynamic import to handle ESM module in CommonJS context
  const { default: ct } = await import('countries-and-timezones');
  
  const country = ct.getCountry(countryCode);
  if (!country) return [];
  return (country.timezones || [])
    .map((tzName: string) => ({ value: tzName, label: tzName }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Nota: Esta exportación ya no está disponible de forma síncrona.
// Usa getAllTimezoneOptions() con await.
export const timezoneOptions: Option[] = [];
