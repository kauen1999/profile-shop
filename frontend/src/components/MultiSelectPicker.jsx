import { Autocomplete } from './Autocomplete';

// Generic multi-select built from Autocomplete + a "selected" chip list.
// Zero domain knowledge — the caller supplies fetchOptions/selected/onToggle
// (and optionally a custom renderOption/getLabel). Extracted from what was
// originally a Stickers-only `StickerPicker` in AddPokemonListing.jsx so the
// Addons multi-select (2026-07-14 revision) can reuse the exact same
// pattern instead of a second bespoke multi-select UI.
//
// Props:
// - fetchOptions(search) => Promise<items[]>
// - selected: item[] currently picked
// - onToggle(item): called to add (not yet selected) or remove (already
//   selected) an item — same toggle semantics the original StickerPicker had
// - placeholder, disabled
// - renderOption(item): optional custom row renderer, passed through to Autocomplete
// - getLabel(item): optional custom chip label (defaults to item.name)
// - resetKey: forwarded to Autocomplete — pass a value that changes exactly
//   when fetchOptions' target changes (e.g. the selected Pokémon's
//   wikiPageId for the Addons picker), so switching Pokémon can't leave a
//   stale species' options cached (bug found 2026-07-14).
export function MultiSelectPicker({
  fetchOptions,
  selected,
  onToggle,
  placeholder,
  disabled,
  renderOption,
  getLabel = (item) => item.name,
  resetKey,
}) {
  return (
    <div className="multi-select-picker">
      <Autocomplete
        fetchOptions={fetchOptions}
        multiple
        selectedItems={selected}
        onToggle={onToggle}
        placeholder={placeholder}
        disabled={disabled}
        renderOption={renderOption}
        resetKey={resetKey}
      />
      {selected.length > 0 && (
        <ul className="multi-select-picker-chips">
          {selected.map((item) => (
            <li key={item.wikiPageId} className="multi-select-picker-chip">
              {getLabel(item)}
              <button type="button" onClick={() => onToggle(item)} aria-label={`Remover ${getLabel(item)}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
