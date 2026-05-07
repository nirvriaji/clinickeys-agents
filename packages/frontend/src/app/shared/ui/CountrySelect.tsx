'use client';
import React, { useMemo, useState, useEffect } from 'react';
import SelectLib, { SingleValue, StylesConfig } from 'react-select';
import CountryFlag from 'react-country-flag';
import { getCountryOptions, CountryOption as ImportedCountryOption } from '@/app/shared/lib/countryOptions';

export interface CountryOption {
  value: string;
  label: string;
  code: string;
  flag?: string;
}

interface CountrySelectProps {
  value: string;
  onChange: (value: string) => void;
}

export function CountrySelect({ value, onChange }: CountrySelectProps) {
  const [countryOptions, setCountryOptions] = useState<ImportedCountryOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getCountryOptions()
      .then(options => {
        setCountryOptions(options);
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });
  }, []);

  const selectedOption = useMemo(
    () => countryOptions.find(opt => opt.value === value) || null,
    [value, countryOptions]
  );

  const styles = useMemo<StylesConfig<CountryOption, false>>(
    () => ({
      control: base => ({
        ...base,
        cursor: 'pointer',
      }),
      option: base => ({
        ...base,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
      }),
      menu: base => ({
        ...base,
        zIndex: 999,
      }),
      singleValue: base => ({
        ...base,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }),
    }),
    []
  );

  return (
    <div className="w-full">
      <SelectLib<CountryOption, false>
        options={countryOptions}
        isSearchable
        isClearable
        isLoading={isLoading}
        placeholder="Seleccionar país…"
        styles={styles}
        value={selectedOption}
        onChange={(opt: SingleValue<CountryOption>) => onChange(opt ? opt.value : '')}
        formatOptionLabel={opt => (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CountryFlag countryCode={opt.code} svg style={{ width: 24, height: 18 }} />
            {opt.label}
            <span style={{ marginLeft: 8, color: '#aaa', fontSize: 13 }}>{opt.code}</span>
          </span>
        )}
        getOptionValue={opt => opt.value}
        noOptionsMessage={() => 'Sin resultados'}
      />
    </div>
  );
}
