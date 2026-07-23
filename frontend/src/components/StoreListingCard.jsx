import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { buildWhatsappLink } from '../domain/buildWhatsappLink';
import { GENDER_LABELS } from '../domain/buildPokemonLookText';
import { GAME_WORLD_LABELS } from '../domain/buildItemLookText';
import { getBoostGlowColor } from '../domain/getBoostGlowColor';
import { formatCategoryLabel } from '../domain/formatCategoryLabel';
import { formatHdCompact } from '../domain/formatHdCompact';
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

// Standard WhatsApp glyph — same brand-mark spirit as the WhatsApp/Discord/
// Telegram icons already used elsewhere in this app (StoreProfile.jsx),
// recreated here since none of those were exported for reuse.
function WhatsAppIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.79.47 3.46 1.32 4.91L2 22l5.32-1.4a9.87 9.87 0 0 0 4.72 1.2h.01c5.46 0 9.9-4.45 9.9-9.91C21.95 6.45 17.5 2 12.04 2zm5.76 14.11c-.24.68-1.4 1.3-1.93 1.38-.5.08-1.14.11-1.84-.12-.43-.14-.98-.32-1.68-.62-2.96-1.28-4.9-4.26-5.05-4.46-.15-.2-1.21-1.61-1.21-3.07 0-1.46.77-2.18 1.04-2.48.27-.3.6-.37.8-.37.2 0 .4 0 .58.01.19.01.44-.07.68.52.25.6.85 2.08.92 2.23.07.15.12.33.02.53-.1.2-.15.32-.3.5-.15.18-.31.4-.44.54-.15.15-.3.32-.13.62.17.3.76 1.26 1.64 2.04 1.13 1 2.08 1.32 2.38 1.47.3.15.48.13.66-.08.18-.2.75-.87.95-1.17.2-.3.4-.25.68-.15.28.1 1.77.84 2.08 1 .31.15.51.23.59.36.08.13.08.75-.16 1.43z" />
    </svg>
  );
}

// Globe/Earth glyph for the Mundo indicator (2026-07-18, replacing a plain
// colored dot) — stroke-based (not fill, unlike the other icons in this
// file), the standard way to draw a recognizable globe: a circle + a
// horizontal meridian + a vertical lens-shaped meridian. `currentColor`
// throughout, so the caller tints it per-world via the `color` CSS
// property (see WORLD_DOT_COLORS below) instead of a separate fill prop.
function EarthIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

// Full field list for the "ver anúncio completo" modal (2026-07-18 rewrite)
// — every field AddPokemonListing.jsx's form can set, as {label, value}
// pairs for a 2-column spec-sheet grid instead of a flat bullet line (the
// "organize melhor" ask). Same "omit if empty/default" principle as
// buildPokemonLookText.js's preview. Previously missing Pokébola and Mundo
// entirely (confirmed: neither appeared anywhere on the card or modal,
// despite both being required fields on every listing) — added here.
function buildPokemonModalFields(raw) {
  const pokeballName = raw.CatalogItem_StorePokemon_pokeballCatalogItemIdToCatalogItem?.name;
  const heldItemName = raw.CatalogItem_StorePokemon_heldItemCatalogItemIdToCatalogItem?.name;
  const megaStoneName = raw.CatalogItem_StorePokemon_megaStoneCatalogItemIdToCatalogItem?.name;
  const equippedAddonName = raw.CatalogItem_StorePokemon_equippedAddonCatalogItemIdToCatalogItem?.name;
  const stickerCount = raw.StorePokemonSticker?.length || 0;

  return [
    { label: 'Apelido', value: raw.nickname },
    { label: 'Pokébola', value: pokeballName },
    { label: 'Nível', value: raw.level },
    { label: 'Gênero', value: raw.gender && (GENDER_LABELS[raw.gender] || raw.gender) },
    { label: 'Nature', value: raw.nature },
    { label: 'Mundo', value: raw.world && (GAME_WORLD_LABELS[raw.world] || raw.world) },
    { label: 'Boost', value: raw.boost ? `+${raw.boost}` : null },
    { label: 'Capturado em', value: raw.capturedAt },
    { label: 'Held item', value: heldItemName },
    { label: 'Mega Stone', value: megaStoneName },
    { label: 'Usando (equipado)', value: equippedAddonName },
    { label: 'Extra Moves', value: raw.extraMoveCount > 0 ? `+${raw.extraMoveCount}` : null },
    { label: 'Preset Slots', value: raw.presetSlotCount > 0 ? raw.presetSlotCount : null },
    { label: 'Stickers', value: stickerCount > 0 ? stickerCount : null },
  ].filter((field) => field.value != null && field.value !== '');
}

// Same principle as buildPokemonModalFields above, for items — every
// optional field AddItemListing.jsx's form can set, per its 2026-07-14
// simplification, is always available directly on the row. `notes` is
// deliberately excluded (returned separately by the caller) — free text
// doesn't fit a label/value grid cell well.
function buildItemModalFields(raw) {
  const categoryLabel = formatCategoryLabel(raw.CatalogItem?.category);

  return [
    { label: 'Categoria', value: categoryLabel },
    { label: 'Quantidade', value: raw.quantity > 1 ? raw.quantity : null },
    { label: 'Número de Série', value: raw.serialNumber },
    { label: 'Data', value: raw.acquiredAt },
    { label: 'Mundo de Origem', value: raw.originWorld && (GAME_WORLD_LABELS[raw.originWorld] || raw.originWorld) },
  ].filter((field) => field.value != null && field.value !== '');
}

// Compact-card price: a single string (not the 2-<span> layout used inside
// the modal) so CSS ellipsis can truncate it reliably as one text node.
function buildCompactPriceText(priceReal, priceHd) {
  const parts = [];
  if (priceReal != null) parts.push(`R$ ${priceReal}`);
  if (priceHd != null) parts.push(formatHdCompact(priceHd));
  return parts.join(' · ');
}

// Second compact-card line for Pokémon (2026-07-18) — replaces the old
// full detail-pill list with a single terse stat line, game-notation style
// (e.g. "M · Bashful · lvl100 · +8 · 10 addons · 2 ext mov · 3 preset"),
// per explicit request. Only fields with a real value appear, same
// omit-if-empty principle as everywhere else in this file. `addonCount` is
// passed in rather than read off `raw` directly — the real count is
// `addonEntries.length` (the live StorePokemonAddon relation), not the
// denormalized `raw.addonCount` column. `Mundo` (world) isn't in this
// string — it renders as its own tinted-globe-icon chip between the name
// and price instead, see .store-listing-world-inline in the component
// below.
function buildPokemonCompactSummary(raw, addonCount) {
  const parts = [];

  if (raw.gender === 'macho') parts.push('M');
  else if (raw.gender === 'femea') parts.push('F');

  if (raw.nature) parts.push(raw.nature);
  if (raw.level != null) parts.push(`lvl${raw.level}`);
  if (raw.boost) parts.push(`+${raw.boost}`);
  if (addonCount > 0) parts.push(`${addonCount} addons`);
  if (raw.extraMoveCount > 0) parts.push(`${raw.extraMoveCount} ext mov`);
  if (raw.presetSlotCount > 0) parts.push(`${raw.presetSlotCount} preset`);

  return parts.join(' · ');
}

// Second compact-card line for Items (2026-07-18, follow-up request) — the
// item equivalent of buildPokemonCompactSummary above: just category now
// (Mundo de Origem moved to its own dot-marked line, see below). Items
// don't have the level/nature/boost/addon stats Pokémon have, so this line
// is much shorter — still omit-if-empty, still terse. Quantidade added
// same day, second follow-up — only shown above 1 (a lone item doesn't
// need "1×" clutter), same threshold buildItemCardDetails/
// buildItemModalFields already use.
function buildItemCompactSummary(raw) {
  const parts = [];

  const categoryLabel = formatCategoryLabel(raw.CatalogItem?.category);
  if (categoryLabel) parts.push(categoryLabel);
  if (raw.quantity > 1) parts.push(`${raw.quantity}×`);

  return parts.join(' · ');
}

// Tint color per GameWorld value (2026-07-18) — matches the world's own
// name (the enum is literally color-named), so the globe icon beside
// "Blue"/"Gold"/etc. reads as that color at a glance, not an arbitrary
// palette. Was a plain colored dot before; swapped for a tinted globe icon
// (EarthIcon above) per follow-up request the same day.
const WORLD_ICON_COLORS = {
  BLUE: '#2e6fdb',
  GREEN: '#2ea043',
  RED: '#e5484d',
  BLACK: '#1a1a1a',
  PURPLE: '#8b5cf6',
  SILVER: '#adb5bd',
  GOLD: '#d4af37',
};

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
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);

  const editHref =
    kind === 'pokemon' ? `/${slug}/anuncios/pokemon/${id}/editar` : `/${slug}/anuncios/item/${id}/editar`;

  const whatsappLink = !isOwner ? buildWhatsappLink(storeWhatsapp, name) : null;

  const modalFields = kind === 'pokemon' ? buildPokemonModalFields(raw) : buildItemModalFields(raw);

  // No fetch here: `StorePokemonAddon` (with `CatalogItem` nested) already
  // comes fully loaded from `GET /stores/:slug`.
  const addonEntries = kind === 'pokemon' ? raw.StorePokemonAddon || [] : [];

  const compactSummary =
    kind === 'pokemon' ? buildPokemonCompactSummary(raw, addonEntries.length) : buildItemCompactSummary(raw);

  // Needed to resolve each addon's looktype sprite (the Pokémon actually
  // wearing it) below — both already come from the same base-Pokémon
  // CatalogItem relation the rest of this card already reads, no fetch.
  const basePokemonItem = raw.CatalogItem_StorePokemon_pokemonCatalogItemIdToCatalogItem;
  const pokemonWikiTitle = basePokemonItem?.wikiTitle;
  const isShinyPokemon = isShinyPokemonName(basePokemonItem?.name);

  // Boost System aura (see getBoostGlowColor.js) — only ever applies to
  // Pokémon listings; items have no `boost` field at all.
  const boostGlowColor = kind === 'pokemon' ? getBoostGlowColor(raw.boost) : null;

  const displayName = name || (kind === 'pokemon' ? 'Pokémon' : 'Item');
  const compactPriceText = buildCompactPriceText(priceReal, priceHd);

  // Mundo — own line with a colored dot (2026-07-18), not folded into the
  // stat-line text like the rest of buildPokemonCompactSummary/
  // buildItemCompactSummary above. `world` (Pokémon) vs. `originWorld`
  // (Item) — different column name per kind, same StoreItem/StorePokemon
  // pattern every other per-kind field in this file already follows.
  const worldValue = kind === 'pokemon' ? raw.world : raw.originWorld;
  const worldLabel = worldValue && (GAME_WORLD_LABELS[worldValue] || worldValue);

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

          <div className="store-listing-name-row">
            <h3 className="store-listing-name">
              {/* 2026-07-18: the "+" corner button is gone — the name
                  itself is now the trigger for "ver anúncio completo". */}
              <button
                type="button"
                className="store-listing-name-btn"
                onClick={() => {
                  setDetailsModalOpen(true);
                  // Analytics view ping (2026-07-21) — only real visitors
                  // count as a "view"; the owner opening their own modal
                  // never counts. Fire-and-forget, mirrors the visit ping
                  // in StoreProfile.jsx.
                  if (!isOwner) {
                    api.recordListingView(slug, { kind: kind.toUpperCase(), listingId: id }).catch(() => {});
                  }
                }}
                aria-label={`Ver anúncio completo de ${displayName}`}
                title="Ver anúncio completo"
              >
                {displayName}
              </button>
            </h3>

            {/* Mundo sits between name and price now (2026-07-18, moved
                off its own line per explicit request) — icon sized to this
                row's font via `em`, tinted per WORLD_ICON_COLORS (globe
                icon replacing a plain dot, same day, follow-up request).
                Color set on the wrapping span (not just the icon) so the
                label text picks up the same per-world color via
                `currentColor` — icon and text now read as one unit, both
                colored, per explicit follow-up request the same day. */}
            {worldLabel && (
              <span
                className="store-listing-world-inline"
                style={{ color: WORLD_ICON_COLORS[worldValue] || 'currentColor' }}
              >
                <EarthIcon className="store-listing-world-icon" />
                {worldLabel}
              </span>
            )}

            {compactPriceText && <span className="store-listing-price-compact">{compactPriceText}</span>}
          </div>

          {compactSummary && <p className="store-listing-compact-summary">{compactSummary}</p>}
        </div>
      </div>

      {isOwner ? (
        <div className="store-listing-owner-controls">
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

          {/* Vendido/Reverter venda (2026-07-18) — sits right under the
              icon row now (was pinned to the card's bottom-right corner,
              user found that too far down/tucked in the corner). Same
              column, right-aligned, normal flow instead of position:
              absolute — moves and resizes naturally with the icon row
              above it instead of needing its own fixed offset. */}
          <button
            type="button"
            className="store-listing-status-btn"
            onClick={() => onStatusChange(listing, isSold ? 'ACTIVE' : 'SOLD')}
          >
            {isSold ? 'Reverter venda' : 'Vendido'}
          </button>
        </div>
      ) : (
        // Compact card has room for the primary CTA (2026-07-18) — back on
        // the card itself, not just inside the "ver anúncio completo"
        // modal. Same wa.me link as before, just a smaller pill here.
        // "Contato" label is icon-only below 860px (see CSS) — at narrow/
        // single-column widths the full pill left too little room for the
        // name (truncated to 1-2 chars, confirmed via screenshot); the
        // `aria-label` keeps it accessible either way.
        whatsappLink && (
          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="store-listing-contact-btn"
            aria-label="Contato"
            title="Contato"
          >
            <WhatsAppIcon className="store-listing-contact-icon" />
            <span className="store-listing-contact-label">Contato</span>
          </a>
        )
      )}

      {/* Reorganized 2026-07-18: sectioned spec-sheet grid instead of one
          flat wrapped bullet line — also now includes every field the
          respective creation form can set (Pokébola/Mundo were previously
          missing entirely, see buildPokemonModalFields above). */}
      <Modal open={detailsModalOpen} onClose={() => setDetailsModalOpen(false)} title={displayName}>
        {(priceReal != null || priceHd != null) && (
          <p className="store-listing-price">
            {priceReal != null && <span>R$ {priceReal}</span>}
            {priceHd != null && <span>{formatHdCompact(priceHd)}</span>}
          </p>
        )}

        {modalFields.length > 0 && (
          <>
            <p className="store-listing-modal-section-label">Detalhes</p>
            <div className="store-listing-modal-grid">
              {modalFields.map((field) => (
                <div key={field.label} className="store-listing-modal-field">
                  <span className="store-listing-modal-label">{field.label}</span>
                  <span className="store-listing-modal-value">{field.value}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {kind === 'item' && raw.notes && <p className="store-listing-modal-notes">{raw.notes}</p>}

        {addonEntries.length > 0 && (
          <>
            <p className="store-listing-modal-section-label">Addons</p>
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
          </>
        )}

        {/* Neither owner's Vendido nor visitor's WhatsApp CTA render here
            anymore (2026-07-18) — both moved onto the compact card itself
            (.store-listing-status-btn / .store-listing-contact-btn above),
            so this modal no longer duplicates either action. */}
      </Modal>
    </div>
  );
}
