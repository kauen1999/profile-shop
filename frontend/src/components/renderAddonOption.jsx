import { isShinyPokemonName, resolveFlatAddonSpriteUrl } from '../domain/resolveAddonSprite';

// Shared Autocomplete renderOption factory for any Addons picker (the
// creation form's multi-select, the import-review flow's single "Usando"
// field) — shows the currently-selected Pokémon actually wearing each addon
// option (the same composite the sprite preview/storefront modal use), not
// the addon's own generic icon, so look-alike addons stay distinguishable
// before picking. `pokemonName` decides shiny vs normal (see
// isShinyPokemonName) — pass the currently-selected species' `name`.
export function makeAddonOptionRenderer(pokemonName) {
  const isShiny = isShinyPokemonName(pokemonName);

  return function renderAddonOption(item, meta) {
    const showCheckbox = !!meta && typeof meta.selected === 'boolean';
    const spriteUrl = resolveFlatAddonSpriteUrl(item, isShiny);

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
        {spriteUrl && (
          <img
            src={spriteUrl}
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
  };
}
