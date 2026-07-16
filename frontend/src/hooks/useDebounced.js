import { useEffect, useState } from 'react';

// Generic debounce hook — previously duplicated inline in Catalog.jsx and
// DataMap.jsx; promoted here once a 3rd consumer (Autocomplete.jsx) needed
// the exact same behavior.
export function useDebounced(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
