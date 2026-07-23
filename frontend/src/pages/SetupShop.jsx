import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { createStore, getMyStore } from '../api';
import { WordmarkLink } from '../components/WordmarkLink';
import { GAME_WORLDS } from '../domain/gameConstants';
import { GAME_WORLD_LABELS } from '../domain/buildItemLookText';
import '../Landing.css';

// Preview-only slugify — mirrors src/routes/stores.js's slugify (lowercase,
// strip accents via NFD, non-alphanumeric runs collapse to a hyphen, trim
// leading/trailing hyphens). This is purely cosmetic (the "sua loja ficará
// em .../assim" hint below the name field); the backend is the source of
// truth for the real slug and may append a numeric suffix on collision, or
// this preview may go stale the moment someone else took the same name — the
// submit handler always redirects to the slug the backend actually returned,
// never this local preview.
function slugifyPreview(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function SetupShop() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [gameNickname, setGameNickname] = useState('');
  const [description, setDescription] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [worlds, setWorlds] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | error
  const [errorMessage, setErrorMessage] = useState('');

  const slugPreview = useMemo(() => slugifyPreview(name), [name]);

  function toggleWorld(world) {
    setWorlds((current) =>
      current.includes(world) ? current.filter((w) => w !== world) : [...current, world]
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!name.trim()) {
      setStatus('error');
      setErrorMessage('O nome da loja é obrigatório.');
      return;
    }

    if (!auth.currentUser) {
      setStatus('error');
      setErrorMessage('Sua sessão expirou. Volte e entre de novo.');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const idToken = await auth.currentUser.getIdToken();
      const store = await createStore(idToken, {
        name: name.trim(),
        gameNickname: gameNickname.trim() || undefined,
        description: description.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
        worlds: worlds.length ? worlds : undefined,
      });
      navigate(`/${store.slug}`);
    } catch (err) {
      setStatus('error');
      if (err.status === 409) {
        // Usuário já tem loja (ex: reenviou o form duas vezes, ou voltou pra
        // essa tela por engano) — não é um erro de verdade, manda pra loja
        // dele em vez de mostrar mensagem crua.
        try {
          const idToken = await auth.currentUser.getIdToken();
          const { store } = await getMyStore(idToken);
          if (store) {
            navigate(`/${store.slug}`);
            return;
          }
        } catch {
          // se nem isso funcionar, cai pra mensagem genérica abaixo
        }
        setErrorMessage('Você já tem uma loja configurada.');
      } else if (err.status === 400) {
        setErrorMessage(
          err.message || 'Esse nome não pode ser usado — tente um nome diferente.'
        );
      } else if (err.status === 401) {
        setErrorMessage('Sua sessão expirou. Volte e entre de novo.');
      } else {
        setErrorMessage('Não conseguimos falar com o servidor agora. Tente de novo.');
      }
    }
  }

  return (
    <div className="landing landing-auth">
      <header className="landing-header">
        <WordmarkLink />
      </header>

      <div className="landing-auth-wrap">
        <div className="landing-auth-card">
          <h1>Configure sua loja</h1>
          <p className="landing-auth-notice">
            Só falta isso pra sua loja existir de verdade. Você pode mudar esses dados depois.
          </p>

          <form className="landing-auth-form" onSubmit={handleSubmit}>
            <label>
              Nome da loja *
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Loja do Ash"
                disabled={status === 'loading'}
                required
              />
            </label>

            {slugPreview && (
              <p className="landing-auth-slug-preview">
                sua loja ficará em <strong>pokeshopping.../{slugPreview}</strong>
              </p>
            )}

            <label>
              Dono
              <input
                type="text"
                value={gameNickname}
                onChange={(e) => setGameNickname(e.target.value)}
                placeholder="Como te chamam dentro do jogo"
                disabled={status === 'loading'}
              />
            </label>

            <label>
              Descrição da loja
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Conte um pouco sobre sua loja (opcional)"
                rows={3}
                disabled={status === 'loading'}
              />
            </label>

            <label>
              WhatsApp
              <input
                type="text"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="Opcional"
                disabled={status === 'loading'}
              />
            </label>

            {/* Mundo(s) — opcional na loja, mas o formulário de anúncio de
                Pokémon exige um mundo por listagem (StorePokemon.world não é
                nullable), então sem nenhum mundo cadastrado aqui o dono não
                vai conseguir anunciar Pokémon até editar isso depois nas
                configurações. */}
            <fieldset className="landing-auth-fieldset" disabled={status === 'loading'}>
              <legend>Mundo(s) da loja</legend>
              <div className="landing-auth-checkbox-grid">
                {GAME_WORLDS.map((world) => (
                  <label key={world} className="landing-auth-checkbox">
                    <input
                      type="checkbox"
                      checked={worlds.includes(world)}
                      onChange={() => toggleWorld(world)}
                    />
                    {GAME_WORLD_LABELS[world]}
                  </label>
                ))}
              </div>
            </fieldset>

            {status === 'error' && <p className="landing-auth-error">{errorMessage}</p>}

            <button
              type="submit"
              className="landing-btn landing-btn-primary landing-btn-lg"
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Criando loja...' : 'Criar minha loja'}
            </button>
          </form>

          <Link to="/" className="landing-auth-back">
            ← Voltar para a página inicial
          </Link>
        </div>
      </div>
    </div>
  );
}
