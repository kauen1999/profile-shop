import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { API_URL, getMyStore } from '../api';
import '../Landing.css';

function hideBrokenImage(event) {
  event.target.style.display = 'none';
}

const HERO_SPRITES = [
  { file: '11117.png', name: 'Eevee', className: 'sprite-eevee' },
  { file: '10990.png', name: 'Charizard', className: 'sprite-charizard' },
  { file: '11624.png', name: 'Sylveon', className: 'sprite-sylveon' },
  { file: '15813.png', name: 'Mimikyu', className: 'sprite-mimikyu' },
  { file: '11405.png', name: 'Lucario', className: 'sprite-lucario' },
  { file: '11127.png', name: 'Snorlax', className: 'sprite-snorlax' },
];

const FEATURES = [
  {
    title: 'Sua loja',
    body: 'Personalize sua própria vitrine, do seu jeito. Nada de loja genérica igual à de todo mundo — o visual e a organização são seus.',
  },
  {
    title: 'Seu catálogo',
    body: 'Adicione ao seu catálogo só os Pokémon e itens que você quer vender, na quantidade e no preço que fizer sentido pra sua loja.',
  },
  {
    title: 'Sem meio de campo',
    body: 'Nada de estoque compartilhado ou fila de espera. Você negocia direto com outros treinadores, nos seus termos.',
  },
];

export function Landing() {
  // Same onAuthStateChanged + getMyStore idiom used independently on every
  // other page for auth-aware checks (see WordmarkLink.jsx, StoreProfile.jsx's
  // isOwner effect) — here it decides what the header's nav slot shows: a
  // logged-out visitor still sees "Entrar", but a logged-in one sees their
  // Google profile picture + a button straight to their storefront instead
  // (the marketing "Entrar" link makes no sense once you're already in).
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [myStore, setMyStore] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setMyStore(null);
        return;
      }
      try {
        const idToken = await user.getIdToken();
        const { store } = await getMyStore(idToken);
        setMyStore(store);
      } catch {
        setMyStore(null);
      }
    });
    return unsubscribe;
  }, []);

  return (
    <div className="landing">
      <header className="landing-header">
        <div className="landing-wordmark">
          <span className="landing-pokeball" aria-hidden="true" />
          PokeShopping
        </div>
        <nav className="landing-nav">
          {firebaseUser ? (
            <Link
              to={myStore ? `/${myStore.slug}` : '/configurar-loja'}
              className="landing-btn landing-btn-ghost landing-nav-account"
            >
              {firebaseUser.photoURL && (
                <img
                  src={firebaseUser.photoURL}
                  alt=""
                  className="landing-nav-avatar"
                  referrerPolicy="no-referrer"
                />
              )}
              Ir para minha loja
            </Link>
          ) : (
            <Link to="/login" className="landing-btn landing-btn-ghost">
              Entrar
            </Link>
          )}
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-text">
          <h1>Sua loja de Pokémon, do seu jeito.</h1>
          <p className="landing-hero-subtitle">
            PokeShopping não é um mercado único onde todo mundo joga os itens no mesmo balcão. Aqui cada treinador
            cria e administra a própria loja — você escolhe o que vende, define os preços e negocia direto com quem
            quiser comprar.
          </p>
          {!firebaseUser && (
            <div className="landing-hero-cta">
              <Link to="/login" className="landing-btn landing-btn-primary landing-btn-lg">
                Entrar com Google
              </Link>
            </div>
          )}
        </div>

        <div className="landing-hero-sprites">
          {HERO_SPRITES.map((sprite) => (
            <img
              key={sprite.file}
              src={`${API_URL}/images/${sprite.file}`}
              alt={sprite.name}
              className={`landing-sprite ${sprite.className}`}
              onError={hideBrokenImage}
            />
          ))}
        </div>
      </section>

      <section className="landing-features">
        {FEATURES.map((feature) => (
          <div className="landing-feature-card" key={feature.title}>
            <h2>{feature.title}</h2>
            <p>{feature.body}</p>
          </div>
        ))}
      </section>

      <footer className="landing-footer">
        <span className="landing-pokeball landing-pokeball-sm" aria-hidden="true" />
        <p>PokeShopping — cada treinador, sua própria loja.</p>
      </footer>
    </div>
  );
}
