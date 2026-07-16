import { useEffect, useRef, useState } from 'react';
import { useDebounced } from '../hooks/useDebounced';

// `meta` is only populated (`{ selected }`) when the Autocomplete is running
// in `multiple` mode — single-select callers never receive it, so existing
// custom renderOption(item) implementations that only take one argument
// keep working unchanged.
function defaultRenderOption(item, meta) {
  const showCheckbox = !!meta && typeof meta.selected === 'boolean';
  return (
    <>
      {showCheckbox && (
        <input
          type="checkbox"
          checked={meta.selected}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="autocomplete-option-checkbox"
        />
      )}
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          className="autocomplete-option-thumb"
          onError={(event) => {
            event.target.style.display = 'none';
          }}
        />
      )}
      <span>{item.name}</span>
    </>
  );
}

// Generic debounced search-and-pick input. Zero domain knowledge — the
// caller supplies fetchOptions (any async function returning an array of
// items) and decides what an "item" looks like. Reused for every picker in
// AddPokemonListing.jsx (Pokéball, Pokémon, Held Item, Mega Stone — single
// select) and, since the 2026-07-14 revision, also for Addons/Stickers
// (multi-select, via MultiSelectPicker).
//
// Single-select props (multiple=false, the default — zero change from
// before this revision):
// - value: the currently selected item (or null)
// - onChange(item): called with the picked item, or null when cleared
//   Picking an item closes the dropdown and clears the search text.
//
// Multi-select props (multiple=true):
// - selectedItems: item[] currently picked
// - onToggle(item): called to add/remove the picked item
//   Picking an item never closes the dropdown nor clears the search text —
//   the dropdown only closes via click-outside or Escape.
//
// Shared props: fetchOptions(search) => Promise<items[]>, placeholder,
// disabled, renderOption(item, meta?) — meta is only passed in multiple mode
// and looks like { selected: boolean }.
export function Autocomplete({
  fetchOptions,
  value,
  onChange,
  selectedItems,
  onToggle,
  multiple = false,
  placeholder,
  disabled,
  renderOption = defaultRenderOption,
  // Bug found 2026-07-14: fetchOptions is typically a fresh inline closure
  // created on every parent render (e.g. `(search) => api.getAddonsFor(
  // pokemon.wikiTitle, search)`), so its identity can't be used to detect
  // "the target actually changed" — it changes every render regardless.
  // When a picker's fetchOptions target depends on other state (e.g. Addons/
  // Mega Stone depend on which Pokémon is selected), the parent must pass an
  // explicit resetKey (e.g. `pokemon?.wikiPageId`) that changes exactly when
  // the target does. Changing it clears the cached options/search here, so
  // switching Pokémon can't leave the previous species' addons/mega-stone
  // list showing.
  resetKey,
}) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);
  const debouncedSearch = useDebounced(search, 300);
  // Tracks the debouncedSearch value the last successful fetch actually
  // used. Reopening the dropdown with an unchanged search term must not
  // trigger a new network request — only an actual search-text change
  // should (or, for callers whose fetchOptions closure depends on other
  // state — e.g. Addons depending on the selected Pokémon — the first open
  // after that state changes, since this ref starts at `null` and only gets
  // set once a fetch actually completes).
  const lastFetchedSearchRef = useRef(null);

  useEffect(() => {
    setOptions([]);
    lastFetchedSearchRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (!open) return undefined;
    if (lastFetchedSearchRef.current === debouncedSearch) return undefined;

    let cancelled = false;
    setLoading(true);

    Promise.resolve(fetchOptions(debouncedSearch))
      .then((items) => {
        if (cancelled) return;
        setOptions(items || []);
        lastFetchedSearchRef.current = debouncedSearch;
      })
      .catch(() => {
        if (cancelled) return;
        setOptions([]);
        lastFetchedSearchRef.current = debouncedSearch;
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, open, resetKey]);

  useEffect(() => {
    if (!open) return undefined;

    function handleClickOutside(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Escape closes the dropdown — only attached while it's actually open.
  // Harmless for single-select (it already closes on pick; this just adds
  // one more way to dismiss it without picking anything), and is the only
  // non-outside-click way to close a multi-select dropdown.
  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  function handlePick(item) {
    if (multiple) {
      onToggle(item);
      return;
    }
    onChange(item);
    setSearch('');
    setOpen(false);
  }

  function handleClear() {
    onChange(null);
    setSearch('');
  }

  return (
    <div className="autocomplete" ref={rootRef}>
      {value ? (
        <div className="autocomplete-selected">
          <span className="autocomplete-selected-content">{renderOption(value)}</span>
          {!disabled && (
            <button
              type="button"
              className="autocomplete-clear"
              onClick={handleClear}
              aria-label="Limpar seleção"
            >
              ×
            </button>
          )}
        </div>
      ) : (
        <input
          type="text"
          className="autocomplete-input"
          value={search}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
          onFocus={() => setOpen(true)}
        />
      )}

      {open && !value && (
        <div className="autocomplete-dropdown">
          {loading && <div className="autocomplete-status">Carregando...</div>}
          {!loading && options.length === 0 && (
            <div className="autocomplete-status">Nenhum resultado.</div>
          )}
          {!loading &&
            options.map((item) => {
              const selected = multiple
                ? !!selectedItems?.some((s) => s.wikiPageId === item.wikiPageId)
                : undefined;
              return (
                <button
                  type="button"
                  key={item.wikiPageId}
                  className="autocomplete-option"
                  onClick={() => handlePick(item)}
                >
                  {multiple ? renderOption(item, { selected }) : renderOption(item)}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
