import { Link } from 'react-router-dom';
import { WordmarkLink } from './WordmarkLink';
import '../Landing.css';

// Generic page chrome for any "create a listing" page. Reuses the same
// wordmark/back-link visual pattern already established across the
// Landing.css-based pages (Login/SetupShop/StoreSettings/StoreProfile).
// Mobile-first: single column by default, becomes a two-column layout
// (main content | preview) at the project's established min-width: 860px
// breakpoint. Zero domain knowledge — title/backTo/children/previewSlot are
// all supplied by the caller, so a future "Add Item" page can reuse this
// unmodified.
export function NewListingPageShell({ title, backTo, backLabel, children, previewSlot }) {
  return (
    <div className="landing landing-auth new-listing-page">
      <header className="landing-header">
        <WordmarkLink />
      </header>

      <div className="new-listing-wrap">
        <div className="new-listing-main">
          {title && <h1 className="new-listing-title">{title}</h1>}
          {children}
          {backTo && (
            <Link to={backTo} className="landing-auth-back new-listing-back">
              ← {backLabel || 'Voltar'}
            </Link>
          )}
        </div>

        {previewSlot && <div className="new-listing-preview">{previewSlot}</div>}
      </div>
    </div>
  );
}
