import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buildWhatsappLink } from '../domain/buildWhatsappLink';
import { GENDER_LABELS } from '../domain/buildPokemonLookText';
import { GAME_WORLD_LABELS } from '../domain/buildItemLookText';
import { getBoostGlowColor } from '../domain/getBoostGlowColor';
import { formatCategoryLabel } from '../domain/formatCategoryLabel';
import { isShinyPokemonName, resolveAddonLooktypeUrl } from '../domain/resolveAddonSprite';
import { Modal } from './Modal';

// Same broken-image-hides-itself pattern already used in Catalog.jsx and
// Autocomplete.jsx's thumbnails — never a broken-image icon.
function hideBrokenImage(event) {
  event.target.style.display = 'none';
}

// Small hand-drawn icons for the 3 owner action buttons — same self-contained
// spirit as StoreProfile.jsx's WhatsAppIcon/DiscordIcon/TelegramIcon (single
// <path>, no icon-library dependency added for 3 icons). Text labels move to
// `aria-label`/`title` on the button itself so the action stays accessible
// without a visible word.
function PencilIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
    </svg>
  );
}

function TrashIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M9 3a1 1 0 0 0-1 1v1H4v2h1.06l.94 12.06A2 2 0 0 0 8 21h8a2 2 0 0 0 2-1.94L18.94 7H20V5h-4V4a1 1 0 0 0-1-1H9zm0 2h6v0H9zM7.06 7h9.88l-.9 11.5a.5.5 0 0 1-.5.5H8.46a.5.5 0 0 1-.5-.5L7.06 7zM10 9v8h1.5V9H10zm2.5 0v8H14V9h-1.5z" />
    </svg>
  );
}

function EyeIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 5c-5.4 0-9.8 3.9-11 7 1.2 3.1 5.6 7 11 7s9.8-3.9 11-7c-1.2-3.1-5.6-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7.2a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4z" />
    </svg>
  );
}

function EyeOffIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M3.28 2.22 2.22 3.28l3.02 3.02C3.36 7.72 1.9 9.62 1 12c1.2 3.1 5.6 7 11 7 1.9 0 3.66-.48 5.2-1.28l3.52 3.52 1.06-1.06L3.28 2.22zM12 16.5c-.6 0-1.16-.13-1.67-.35l1.8-1.8c1.15-.16 2.06-1.07 2.22-2.22l1.8-1.8c.22.51.35 1.07.35 1.67a4.5 4.5 0 0 1-4.5 4.5zM12 5c5.4 0 9.8 3.9 11 7-.55 1.42-1.6 2.82-2.96 3.96l-1.44-1.44C19.68 13.5 20.42 12.66 20.86 12 19.66 9.53 16.13 7 12 7c-.98 0-1.92.14-2.8.4L7.6 5.8C8.99 5.29 10.46 5 12 5z" />
    </svg>
  );
}

// Compact card version of every field AddPokemonListing.jsx's form can set —
// same "omit if empty/default" principle buildPokemonLookText.js uses for
// the creation-flow preview (never show a field just because the row has
// the key, only when it actually has a real value), but flattened into a
// list of short strings for pill/badge display instead of a multi-line
// "look" block — this card is a summary, not a second LookPreviewCard.
function buildPokemonCardDetails(raw) {
  const details = [];

  if (raw.nickname) details.push(`Apelido: ${raw.nickname}`);
  if (raw.level != null) details.push(`Nível: ${raw.level}`);
  if (raw.gender) details.push(`Gênero: ${GENDER_LABELS[raw.gender] || raw.gender}`);
  if (raw.nature) details.push(`Nature: ${raw.nature}`);
  if (raw.boost) details.push(`Boost: +${raw.boost}`);
  if (raw.capturedAt) details.push(`Capturado em: ${raw.capturedAt}`);

  const heldItemName = raw.CatalogItem_StorePokemon_heldItemCatalogItemIdToCatalogItem?.name;
  if (heldItemName) details.push(`Held item: ${heldItemName}`);

  const megaStoneName = raw.CatalogItem_StorePokemon_megaStoneCatalogItemIdToCatalogItem?.name;
  if (megaStoneName) details.push(`Mega Stone: ${megaStoneName}`);

  // Addon count moved out of this plain-text list — StoreListingCard
  // renders it as its own clickable pill (opens the view-only addon modal),
  // not a static string, so it's handled directly in the component below
  // rather than here. Only the equipped addon (purely informative) stays a
  // plain pill.
  const equippedAddonName = raw.CatalogItem_StorePokemon_equippedAddonCatalogItemIdToCatalogItem?.name;
  if (equippedAddonName) details.push(`Usando: ${equippedAddonName}`);

  const stickerCount = raw.StorePokemonSticker?.length || 0;
  if (stickerCount > 0) details.push(`Stickers: ${stickerCount}`);

  if (raw.extraMoveCount > 0) details.push(`Extra Moves: +${raw.extraMoveCount}`);
  if (raw.presetSlotCount > 0) details.push(`Preset Slots: ${raw.presetSlotCount}`);

  return details;
}

// Same principle as buildPokemonCardDetails above, for items — every
// optional field AddItemListing.jsx's form can set, per its 2026-07-14
// simplification, is always available directly on the row (no template
// re-derivation needed here; the card never needs to know which template a
// field "belongs" to, only whether it's actually filled in).
function buildItemCardDetails(raw) {
  const details = [];

  const categoryLabel = formatCategoryLabel(raw.CatalogItem?.category);
  if (categoryLabel) details.push(categoryLabel);

  if (raw.quantity > 1) details.push(`Quantidade: ${raw.quantity}`);
  if (raw.serialNumber) details.push(`Número de Série: ${raw.serialNumber}`);
  if (raw.acquiredAt) details.push(`Data: ${raw.acquiredAt}`);
  if (raw.originWorld) details.push(`Mundo de Origem: ${GAME_WORLD_LABELS[raw.originWorld] || raw.originWorld}`);
  if (raw.notes) details.push(raw.notes);

  return details;
}

// One card per listing (item or Pokémon), driving StoreProfile.jsx's unified
// storefront. Strict 3-zone layout: photo (left) | info (center) | actions
// (right). `listing` is the normalized shape StoreProfile.jsx builds —
// { kind: 'item' | 'pokemon', id, name, imageUrl, priceReal, priceHd,
//   status, raw }. `raw` is the original StoreItem/StorePokemon row — read
// directly by buildPokemonCardDetails/buildItemCardDetails above for every
// optional field the respective creation form can set (never re-normalized
// a second time at the StoreProfile.jsx level).
//
// `isOwner` is passed down, never recomputed here (StoreProfile.jsx already
// owns that check). `slug` builds the Editar link. `storeWhatsapp` is the
// store's raw contact field, used only in the non-owner path to build the
// wa.me link — absent/empty means no WhatsApp button renders at all.
//
// `onStatusChange(listing, newStatus)` / `onDelete(listing)` are owned by
// StoreProfile.jsx (optimistic update + revert-on-failure) — this component
// never touches network or global state directly.
export function StoreListingCard({ listing, isOwner, slug, storeWhatsapp, onStatusChange, onDelete }) {
  const { kind, id, name, imageUrl, priceReal, priceHd, status, raw } = listing;
  const isHidden = status === 'HIDDEN';
  const isSold = status === 'SOLD';
  const [addonModalOpen, setAddonModalOpen] = useState(false);

  const editHref =
    kind === 'pokemon' ? `/${slug}/anuncios/pokemon/${id}/editar` : `/${slug}/anuncios/item/${id}/editar`;

  const whatsappLink = !isOwner ? buildWhatsappLink(storeWhatsapp, name) : null;

  const details = kind === 'pokemon' ? buildPokemonCardDetails(raw) : buildItemCardDetails(raw);

  // Addon count is its own clickable pill (opens a view-only modal listing
  // every selected addon with its sprite), not a plain-text detail — see
  // buildPokemonCardDetails above for why the equipped addon stays a plain
  // pill instead. No fetch here: `StorePokemonAddon` (with `CatalogItem`
  // nested) already comes fully loaded from `GET /stores/:slug`.
  const addonEntries = kind === 'pokemon' ? raw.StorePokemonAddon || [] : [];

  // Needed to resolve each addon's looktype sprite (the Pokémon actually
  // wearing it) below — both already come from the same base-Pokémon
  // CatalogItem relation the rest of this card already reads, no fetch.
  const basePokemonItem = raw.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem;
  const pokemonWikiTitle = basePokemonItem?.wikiTitle;
  const isShinyPokemon = isShinyPokemonName(basePokemonItem?.name);

  // Boost System aura (see getBoostGlowColor.js) — only ever applies to
  // Pokémon listings; items have no `boost` field at all.
  const boostGlowColor = kind === 'pokemon' ? getBoostGlowColor(raw.boost) : null;

  return (
    <div className={`store-listing-card${status && status !== 'ACTIVE' ? ' store-listing-card-dimmed' : ''}`}>
      <div className="store-listing-main">
        <div className="store-listing-photo">
          {imageUrl && (
            <img
              src={imageUrl}
              alt={name}
              onError={hideBrokenImage}
              className={boostGlowColor ? 'store-listing-photo-glow' : undefined}
              style={boostGlowColor ? { '--boost-glow-color': boostGlowColor } : undefined}
            />
          )}
        </div>

        <div className="store-listing-info">
          {isOwner && status && status !== 'ACTIVE' && (
            <span className={`store-listing-tag ${isSold ? 'store-listing-tag-sold' : 'store-listing-tag-hidden'}`}>
              {isSold ? 'Vendido' : 'Oculto'}
            </span>
          )}

          <h3 className="store-listing-name">{name || (kind === 'pokemon' ? 'Pokémon' : 'Item')}</h3>

          {(details.length > 0 || addonEntries.length > 0) && (
            <ul className="store-listing-details">
              {details.map((line) => (
                <li key={line} className="store-listing-detail-pill">
                  {line}
                </li>
              ))}
              {addonEntries.length > 0 && (
                <li>
                  <button
                    type="button"
                    className="store-listing-detail-pill store-listing-detail-pill-button"
                    onClick={() => setAddonModalOpen(true)}
                  >
                    Addons: {addonEntries.length}
                  </button>
                </li>
              )}
            </ul>
          )}

          {(priceReal != null || priceHd != null) && (
            <p className="store-listing-price">
              {priceReal != null && <span>R$ {priceReal}</span>}
              {priceHd != null && <span>{priceHd} HD</span>}
            </p>
          )}
        </div>
      </div>

      <div className="store-listing-actions">
        <div className="store-listing-actions-primary">
          {isOwner ? (
            <button
              type="button"
              className="landing-btn landing-btn-outline"
              onClick={() => onStatusChange(listing, isSold ? 'ACTIVE' : 'SOLD')}
            >
              {isSold ? 'Reverter venda' : 'Vendido'}
            </button>
          ) : (
            whatsappLink && (
              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="landing-btn landing-btn-primary"
              >
                Conversar no WhatsApp
              </a>
            )
          )}
        </div>

        {isOwner && (
          <div className="store-listing-actions-secondary">
            <Link to={editHref} className="store-listing-action-btn" aria-label="Editar" title="Editar">
              <PencilIcon className="store-listing-action-icon" />
            </Link>
            <button
              type="button"
              className="store-listing-action-btn store-listing-action-btn-danger"
              onClick={() => onDelete(listing)}
              aria-label="Excluir"
              title="Excluir"
            >
              <TrashIcon className="store-listing-action-icon" />
            </button>
            <button
              type="button"
              className="store-listing-action-btn"
              onClick={() => onStatusChange(listing, isHidden ? 'ACTIVE' : 'HIDDEN')}
              aria-label={isHidden ? 'Mostrar' : 'Ocultar'}
              title={isHidden ? 'Mostrar' : 'Ocultar'}
            >
              {isHidden ? (
                <EyeOffIcon className="store-listing-action-icon" />
              ) : (
                <EyeIcon className="store-listing-action-icon" />
              )}
            </button>
          </div>
        )}
      </div>

      {addonEntries.length > 0 && (
        <Modal open={addonModalOpen} onClose={() => setAddonModalOpen(false)} title={`Addons de ${name || 'Pokémon'}`}>
          <div className="addon-modal-grid">
            {addonEntries.map((entry) => {
              const spriteUrl = resolveAddonLooktypeUrl(entry.CatalogItem, pokemonWikiTitle, isShinyPokemon);
              return (
                <div key={entry.addonCatalogItemId} className="addon-modal-item">
                  <div className="store-listing-photo">
                    {spriteUrl && <img src={spriteUrl} alt={entry.CatalogItem?.name} onError={hideBrokenImage} />}
                  </div>
                  <span className="addon-modal-item-name">{entry.CatalogItem?.name}</span>
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}
