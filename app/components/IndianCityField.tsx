'use client';

import React, { useMemo, useState } from 'react';
import { INDIAN_CITIES } from '@/lib/indian-cities';

interface IndianCityFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  className: string;
  required?: boolean;
  placeholder?: string;
}

export default function IndianCityField({
  id,
  value,
  onChange,
  className,
  required = true,
  placeholder = 'Type a city or town name',
}: IndianCityFieldProps) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const listId = `${id}-indian-cities`;
  const normalizedQuery = value.trim().toLocaleLowerCase('en-IN');
  const suggestions = useMemo(() => {
    if (!normalizedQuery) return [];
    return INDIAN_CITIES
      .filter((city) => city.toLocaleLowerCase('en-IN').includes(normalizedQuery))
      .sort((first, second) => {
        const firstStartsWithQuery = first.toLocaleLowerCase('en-IN').startsWith(normalizedQuery);
        const secondStartsWithQuery = second.toLocaleLowerCase('en-IN').startsWith(normalizedQuery);
        return Number(secondStartsWithQuery) - Number(firstStartsWithQuery) || first.localeCompare(second);
      })
      .slice(0, 15);
  }, [normalizedQuery]);

  const chooseCity = (city: string) => {
    onChange(city);
    setActiveIndex(-1);
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        required={required}
        autoComplete="off"
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isFocused && Boolean(normalizedQuery)}
        aria-controls={listId}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onChange={(event) => {
          onChange(event.target.value);
          setActiveIndex(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && suggestions.length > 0) {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % suggestions.length);
          } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
            event.preventDefault();
            setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
          } else if (event.key === 'Enter' && activeIndex >= 0 && suggestions[activeIndex]) {
            event.preventDefault();
            chooseCity(suggestions[activeIndex]);
          } else if (event.key === 'Escape') {
            setIsFocused(false);
            setActiveIndex(-1);
          }
        }}
        placeholder={placeholder}
        className={className}
      />
      {isFocused && normalizedQuery && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
        >
          {suggestions.length > 0 ? suggestions.map((city, index) => (
            <li
              id={`${listId}-option-${index}`}
              key={city}
              role="option"
              aria-selected={index === activeIndex}
            >
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseCity(city)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                  index === activeIndex ? 'bg-blue-50 text-blue-800' : 'text-slate-800 hover:bg-slate-50'
                }`}
              >
                {city}
              </button>
            </li>
          )) : (
            <li className="px-3 py-2 text-sm text-slate-500">No matching Indian city or town found.</li>
          )}
        </ul>
      )}
    </div>
  );
}
