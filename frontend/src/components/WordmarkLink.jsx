import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { getMyStore } from '../api';

// Shared clickable "PokeShopping" wordmark used by every page's header
// (except Landing.jsx itself, which isn't a Link — it IS "/" already, see
// CLAUDE.md). Logged-out visitors go to "/" as before; a logged-in owner
// goes straight to their own storefront (`/${store.slug}`) instead of the
// marketing landing page. Same onAuthStateChanged + getMyStore idiom already
// used independently on every other page for ownership checks (e.g.
// StoreProfile.jsx's isOwner effect) — not a new pattern, just applied to a
// new concern here.
export function WordmarkLink({ className = 'landing-wordmark landing-wordmark-link' }) {
  const [target, setTarget] = useState('/');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setTarget('/');
        return;
      }
      try {
        const idToken = await firebaseUser.getIdToken();
        const { store } = await getMyStore(idToken);
        setTarget(store ? `/${store.slug}` : '/');
      } catch {
        setTarget('/');
      }
    });
    return unsubscribe;
  }, []);

  return (
    <Link to={target} className={className}>
      <span className="landing-pokeball" aria-hidden="true" />
      PokeShopping
    </Link>
  );
}
