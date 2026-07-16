import { useEffect } from 'react';

// Generic overlay + centered panel — the first modal in this app (checked:
// no modal/dialog component existed anywhere in frontend/src before this).
// Zero domain knowledge, same spirit as FabSpeedDial/Autocomplete/
// LookPreviewCard — the caller supplies `title`/`children`, this only owns
// open/close mechanics (Escape key, click on the overlay) and the visual
// shell. View-only by design: no built-in form/submit affordance.
export function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
