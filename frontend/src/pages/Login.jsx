import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { getMyStore, loginWithGoogle } from '../api';
import { WordmarkLink } from '../components/WordmarkLink';
import '../Landing.css';

// Códigos do Firebase Auth que representam o usuário desistindo do fluxo,
// não um erro de verdade — não vale mostrar mensagem assustadora pra isso.
const QUIET_ERROR_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
]);

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

export function Login() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [errorMessage, setErrorMessage] = useState('');
  const [user, setUser] = useState(null);
  // Enquanto true, esconde o botão de login — evita mostrar o formulário por
  // uma fração de segundo pra quem já tem sessão Firebase ativa (Firebase
  // persiste a sessão entre aberturas do app) e vai ser redirecionado de
  // qualquer forma.
  const [checkingSession, setCheckingSession] = useState(true);
  // true assim que o fluxo manual (clique no botão) começa — impede que o
  // listener onAuthStateChanged abaixo (que também dispara depois do
  // signInWithPopup ter sucesso) tente redirecionar em paralelo com a lógica
  // de sucesso do próprio handleGoogleSignIn, que já mostra a tela de boas-
  // vindas antes de navegar.
  const manualFlowRef = useRef(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (manualFlowRef.current) return;

      if (!firebaseUser) {
        setCheckingSession(false);
        return;
      }

      // Sessão Firebase já ativa (usuário voltando ao app) — pula o clique no
      // botão e vai direto pro destino certo, igual ao fluxo de login manual.
      try {
        const idToken = await firebaseUser.getIdToken();
        const { store } = await getMyStore(idToken);
        navigate(store ? `/${store.slug}` : '/configurar-loja', { replace: true });
      } catch {
        // Falhou a checagem (token expirado, backend fora do ar, etc) — não
        // trava a tela, deixa o usuário entrar pelo botão normalmente.
        setCheckingSession(false);
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGoogleSignIn() {
    manualFlowRef.current = true;
    setStatus('loading');
    setErrorMessage('');

    let credential;
    try {
      credential = await signInWithPopup(auth, googleProvider);
    } catch (err) {
      manualFlowRef.current = false;
      if (QUIET_ERROR_CODES.has(err.code)) {
        setStatus('idle');
        return;
      }
      if (err.code === 'auth/popup-blocked') {
        setStatus('error');
        setErrorMessage(
          'Seu navegador bloqueou o popup de login. Permita popups para este site e tente de novo.'
        );
        return;
      }
      setStatus('error');
      setErrorMessage('Não foi possível abrir o login do Google. Tente novamente.');
      return;
    }

    let idToken;
    try {
      idToken = await credential.user.getIdToken();
    } catch {
      manualFlowRef.current = false;
      setStatus('error');
      setErrorMessage('Não foi possível confirmar sua conta Google. Tente novamente.');
      return;
    }

    try {
      const backendUser = await loginWithGoogle(idToken);
      setUser(backendUser);
      setStatus('success');

      let destination = '/configurar-loja';
      try {
        const { store } = await getMyStore(idToken);
        if (store) destination = `/${store.slug}`;
      } catch {
        // Falhou a checagem de loja — segue pra /configurar-loja mesmo assim;
        // se o usuário já tiver loja, POST /stores devolve 409 e a própria
        // tela de configuração redireciona pra ela nesse caso.
      }

      setTimeout(() => navigate(destination), 1500);
    } catch (err) {
      manualFlowRef.current = false;
      setStatus('error');
      if (err.status === 401) {
        setErrorMessage('Sua sessão do Google não pôde ser validada. Tente entrar de novo.');
      } else if (err.status === 409) {
        setErrorMessage('Este email já está associado a outra conta. Fale com o suporte.');
      } else {
        setErrorMessage('Não conseguimos falar com o servidor agora. Verifique sua conexão e tente de novo.');
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
          {status === 'success' ? (
            <>
              <h1>Bem-vindo(a){user?.name ? `, ${user.name}` : ''}!</h1>
              {user?.image && (
                <img
                  src={user.image}
                  alt={user.name || 'Avatar'}
                  className="landing-auth-avatar"
                />
              )}
              <p className="landing-auth-notice">Login feito com sucesso. Redirecionando...</p>
            </>
          ) : checkingSession ? (
            <>
              <h1>Entrar</h1>
              <p className="landing-auth-notice">Verificando sessão...</p>
            </>
          ) : (
            <>
              <h1>Entrar</h1>
              <p className="landing-auth-notice">
                Entre com sua conta Google para acessar o PokeShopping. É o mesmo botão pra quem já tem conta e pra
                quem está entrando pela primeira vez.
              </p>

              <button
                type="button"
                className="landing-btn landing-btn-google landing-btn-lg"
                onClick={handleGoogleSignIn}
                disabled={status === 'loading'}
              >
                <GoogleLogo />
                {status === 'loading' ? 'Entrando...' : 'Entrar com Google'}
              </button>

              {status === 'error' && <p className="landing-auth-error">{errorMessage}</p>}
            </>
          )}

          <Link to="/" className="landing-auth-back">
            ← Voltar para a página inicial
          </Link>
        </div>
      </div>
    </div>
  );
}
