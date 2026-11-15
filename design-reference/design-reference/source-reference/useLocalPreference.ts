import { useEffect, useState } from 'react';
export function useLocalPreference<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try { const stored = localStorage.getItem(`deskmash.${key}`); return stored === null ? fallback : JSON.parse(stored); }
    catch { return fallback; }
  });
  useEffect(() => { try { localStorage.setItem(`deskmash.${key}`, JSON.stringify(value)); } catch { /* Preferences remain usable in memory. */ } }, [key, value]);
  return [value, setValue] as const;
}
