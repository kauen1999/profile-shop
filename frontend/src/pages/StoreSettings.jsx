import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { getMyStore, updateStore } from '../api';
import { WordmarkLink } from '../components/WordmarkLink';
import '../Landing.css';

// Mirrors src/routes/stores.js's slugify — cosmetic only, the backend is the
// source of truth and this preview may go stale the instant someone else
// takes the same slug. Used just so the field doesn't feel disconnected from
// what will actually be saved.
function slugifyPreview(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const CONTACT_FIELDS = ['whatsapp', 'discord', 'telegram'];

export function StoreSettings() {
  const navigate = useNavigate();

  // loading | ready | redirecting — "redirecting" covers both the
  // no-session and no-store cases, where we navigate away and render
  // nothing meaningful in the meantime.
  const [pageStatus, setPageStatus] = useState('loading');

  const [storeId, setStoreId] = useState(null);
  const [initialValues, setInitialValues] = useState(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [gameNickname, setGameNickname] = useState('');
  const [description, setDescription] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [discord, setDiscord] = useState('');
  const [telegram, setTelegram] = useState('');

  // idle | saving | saved | error
  const [saveStatus, setSaveStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  // { field, message } — set only for the 409 cases the backend can
  // attribute to one specific input (slug itself, or a contact field).
  const [fieldError, setFieldError] = useState(null);

  const idTokenRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setPageStatus('redirecting');
        navigate('/login', { replace: true });
        return;
      }

      try {
        const idToken = await firebaseUser.getIdToken();
        idTokenRef.current = idToken;
        const { store } = await getMyStore(idToken);

        if (!store) {
          setPageStatus('redirecting');
          navigate('/configurar-loja', { replace: true });
          return;
        }

        setStoreId(store.id);
        const values = {
          name: store.name || '',
          slug: store.slug || '',
          gameNickname: store.gameNickname || '',
          description: store.description || '',
          whatsapp: store.whatsapp || '',
          discord: store.discord || '',
          telegram: store.telegram || '',
        };
        setInitialValues(values);
        setName(values.name);
        setSlug(values.slug);
        setGameNickname(values.gameNickname);
        setDescription(values.description);
        setWhatsapp(values.whatsapp);
        setDiscord(values.discord);
        setTelegram(values.telegram);
        setPageStatus('ready');
      } catch {
        setPageStatus('redirecting');
        navigate('/login', { replace: true });
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slugPreview = slugifyPreview(slug);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!initialValues) return;

    if (!name.trim()) {
      setSaveStatus('error');
      setFieldError(null);
      setErrorMessage('O nome da loja não pode ficar vazio.');
      return;
    }

    const current = { name, slug, gameNickname, description, whatsapp, discord, telegram };
    const payload = {};
    Object.entries(current).forEach(([key, value]) => {
      if (value.trim() !== initialValues[key].trim()) {
        payload[key] = value.trim();
      }
    });

    if (Object.keys(payload).length === 0) {
      setSaveStatus('saved');
      setErrorMessage('');
      setFieldError(null);
      return;
    }

    setSaveStatus('saving');
    setErrorMessage('');
    setFieldError(null);

    try {
      let idToken = idTokenRef.current;
      if (auth.currentUser) {
        idToken = await auth.currentUser.getIdToken();
      }
      const updated = await updateStore(idToken, payload);

      const slugChanged = payload.slug !== undefined && updated.slug !== initialValues.slug;
      if (slugChanged) {
        navigate(`/${updated.slug}`);
        return;
      }

      const values = {
        name: updated.name || '',
        slug: updated.slug || '',
        gameNickname: updated.gameNickname || '',
        description: updated.description || '',
        whatsapp: updated.whatsapp || '',
        discord: updated.discord || '',
        telegram: updated.telegram || '',
      };
      setInitialValues(values);
      setSaveStatus('saved');
    } catch (err) {
      setSaveStatus('error');
      if (err.status === 409) {
        // Contact conflicts come with `field`; a slug conflict doesn't
        // (the backend only attaches `field` for whatsapp/discord/telegram),
        // so absence of `field` here means it was the slug itself.
        const field = err.field || 'slug';
        setFieldError({ field, message: err.message });
        setErrorMessage('');
      } else if (err.status === 400) {
        setFieldError(null);
        setErrorMessage(err.message || 'Não foi possível salvar — confira os dados e tente de novo.');
      } else if (err.status === 401) {
        setFieldError(null);
        setErrorMessage('Sua sessão expirou. Volte e entre de novo.');
      } else if (err.status === 404) {
        setFieldError(null);
        setErrorMessage('Não encontramos sua loja. Configure uma antes de editar.');
      } else {
        setFieldError(null);
        setErrorMessage('Não conseguimos falar com o servidor agora. Tente de novo.');
      }
    }
  }

  function fieldErrorFor(field) {
    return fieldError?.field === field ? fieldError.message : null;
  }

  if (pageStatus !== 'ready') {
    return (
      <div className="landing landing-auth">
        <header className="landing-header">
          <WordmarkLink />
        </header>
        <div className="landing-auth-wrap">
          <div className="landing-auth-card">
            <p>Carregando...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="landing landing-auth">
      <header className="landing-header">
        <WordmarkLink />
      </header>

      <div className="landing-auth-wrap">
        <div className="landing-auth-card">
          <h1>Configurações da loja</h1>
          <p className="landing-auth-notice">
            Edite os dados da sua loja. Só o nome é obrigatório — os demais campos podem ficar em branco.
          </p>

          <form className="landing-auth-form" onSubmit={handleSubmit}>
            <label>
              Nome da loja *
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saveStatus === 'saving'}
                required
              />
            </label>

            <label>
              Endereço da loja (slug)
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                disabled={saveStatus === 'saving'}
              />
            </label>
            {slugPreview && (
              <p className="landing-auth-slug-preview">
                sua loja ficará em <strong>pokeshopping.../{slugPreview}</strong>
              </p>
            )}
            {fieldErrorFor('slug') && (
              <p className="landing-auth-field-error">{fieldErrorFor('slug')}</p>
            )}

            <label>
              Dono
              <input
                type="text"
                value={gameNickname}
                onChange={(e) => setGameNickname(e.target.value)}
                disabled={saveStatus === 'saving'}
              />
            </label>

            <label>
              Descrição da loja
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Conte um pouco sobre sua loja (opcional)"
                rows={3}
                disabled={saveStatus === 'saving'}
              />
            </label>

            <label>
              WhatsApp
              <input
                type="text"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                disabled={saveStatus === 'saving'}
              />
            </label>
            {fieldErrorFor('whatsapp') && (
              <p className="landing-auth-field-error">{fieldErrorFor('whatsapp')}</p>
            )}

            <label>
              Discord
              <input
                type="text"
                value={discord}
                onChange={(e) => setDiscord(e.target.value)}
                disabled={saveStatus === 'saving'}
              />
            </label>
            {fieldErrorFor('discord') && (
              <p className="landing-auth-field-error">{fieldErrorFor('discord')}</p>
            )}

            <label>
              Telegram
              <input
                type="text"
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                disabled={saveStatus === 'saving'}
              />
            </label>
            {fieldErrorFor('telegram') && (
              <p className="landing-auth-field-error">{fieldErrorFor('telegram')}</p>
            )}

            {saveStatus === 'error' && errorMessage && (
              <p className="landing-auth-error">{errorMessage}</p>
            )}
            {saveStatus === 'saved' && <p className="landing-auth-success">Salvo!</p>}

            <button
              type="submit"
              className="landing-btn landing-btn-primary landing-btn-lg"
              disabled={saveStatus === 'saving'}
            >
              {saveStatus === 'saving' ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </form>

          <Link to={`/${initialValues?.slug || ''}`} className="landing-auth-back">
            ← Voltar para minha loja
          </Link>
        </div>
      </div>
    </div>
  );
}
