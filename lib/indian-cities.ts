import indianCityLabels from '@/lib/indian-cities-data.json';

export const INDIAN_CITIES: string[] = indianCityLabels;

const canonicalCities = new Map(
  INDIAN_CITIES.map((city) => [city.toLocaleLowerCase('en-IN'), city])
);
const citiesByName = new Map<string, Set<string>>();

INDIAN_CITIES.forEach((city) => {
  const cityName = city.slice(0, city.lastIndexOf(',')).trim().toLocaleLowerCase('en-IN');
  const matches = citiesByName.get(cityName) || new Set<string>();
  matches.add(city);
  citiesByName.set(cityName, matches);
});

export function getCanonicalIndianCity(value: string): string | null {
  const normalizedValue = value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN');
  const exactMatch = canonicalCities.get(normalizedValue);
  if (exactMatch) return exactMatch;

  const namedMatches = citiesByName.get(normalizedValue);
  return namedMatches?.size === 1 ? [...namedMatches][0] : null;
}

export function matchesIndianCity(storedCity: string, selectedCity: string): boolean {
  const normalizedStored = storedCity.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN');
  const normalizedSelected = selectedCity.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN');
  if (normalizedStored === normalizedSelected) return true;

  const canonicalSelected = getCanonicalIndianCity(selectedCity);
  if (!canonicalSelected) return false;

  const selectedName = canonicalSelected.slice(0, canonicalSelected.lastIndexOf(',')).trim().toLocaleLowerCase('en-IN');
  return !normalizedStored.includes(',') && normalizedStored === selectedName;
}
