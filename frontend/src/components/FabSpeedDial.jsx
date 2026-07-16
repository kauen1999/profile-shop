import { useEffect, useRef, useState } from 'react';

// Generic floating-action-button + speed-dial. Zero domain knowledge — the
// caller supplies the full list of actions (label/enabled/onClick), this
// component only renders and handles the open/closed state + click-outside.
// Reused as-is by any future "create X" flow (e.g. a future "Add Item").
//
// actions: Array<{ key: string, label: string, enabled: boolean, onClick?: () => void }>
// Disabled actions render with an "em breve" badge and no click handler.
//
// 2026-07-15 — the closed/open "+"/"−" icon and its red/blue background are
// pure CSS now (AddPokemonListing.css, keyed off `aria-expanded`, which this
// component already sets from its own `open` state) — no image props, no
// sprite. Nothing here needs to know that's a Plusle/Minun reference; this
// component only ever renders one plain icon span and toggles one
// attribute.
export function FabSpeedDial({ actions }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

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

  return (
    <div className="fab-speed-dial" ref={rootRef}>
      {open && (
        <ul className="fab-speed-dial-menu" role="menu">
          {actions.map((action) => (
            <li key={action.key}>
              <button
                type="button"
                role="menuitem"
                className="fab-speed-dial-item"
                disabled={!action.enabled}
                onClick={() => {
                  if (!action.enabled) return;
                  setOpen(false);
                  action.onClick?.();
                }}
              >
                {action.label}
                {!action.enabled && <span className="fab-speed-dial-badge">em breve</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="fab-button"
        aria-label={open ? 'Fechar menu de ações' : 'Abrir menu de ações'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="fab-button-icon" aria-hidden="true" />
      </button>
    </div>
  );
}
