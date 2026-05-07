// /shared/lib/countryOptions.ts

export interface CountryOption {
  value: string;
  label: string;
  code: string;
  flag: string;
}

let cachedOptions: CountryOption[] | null = null;

export async function getCountryOptions(): Promise<CountryOption[]> {
  if (cachedOptions) {
    return cachedOptions;
  }

  // Dynamic import to handle ESM module in CommonJS context
  const { default: ct } = await import('countries-and-timezones');
  
  cachedOptions = Object.values(ct.getAllCountries())
    .map((country: any) => ({
      value: country.id,
      label: country.name,
      code: country.id,
      flag: country.id
        .toUpperCase()
        .replace(/./g, (char: string) => String.fromCodePoint(127397 + char.charCodeAt(0))),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  
  return cachedOptions;
}

// Backwards compatibility for synchronous usage - will return empty array initially
// Use getCountryOptions() for proper data
export const countryOptions: CountryOption[] = [];
