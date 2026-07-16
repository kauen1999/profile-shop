import { NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { AddItemListing } from './pages/AddItemListing';
import { AddPokemonListing } from './pages/AddPokemonListing';
import { Catalog } from './pages/Catalog';
import { DataMap } from './pages/DataMap';
import { ImportListings } from './pages/ImportListings';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { SetupShop } from './pages/SetupShop';
import { StoreProfile } from './pages/StoreProfile';
import { StoreSettings } from './pages/StoreSettings';
import './App.css';

function AppLayout() {
  return (
    <div className="app">
      <header className="topbar">
        <nav>
          <NavLink to="/catalog">Catálogo</NavLink>
          <NavLink to="/mapa-de-dados">Mapa de Dados</NavLink>
        </nav>
      </header>

      <main>
        <Outlet />
      </main>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/configurar-loja" element={<SetupShop />} />
      <Route path="/configuracoes" element={<StoreSettings />} />

      <Route element={<AppLayout />}>
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/mapa-de-dados" element={<DataMap />} />
      </Route>

      {/* Precisa vir antes do catch-all dinâmico /:slug abaixo — mesmo
          raciocínio já documentado para /configurar-loja/configuracoes:
          React Router v6 prioriza paths estáticos sobre segmentos
          dinâmicos, mas o path aqui tem um segmento dinâmico próprio
          (:slug) em posição inicial, então a ordem de declaração importa
          entre esta rota e a de /:slug abaixo. */}
      <Route path="/:slug/anuncios/pokemon/novo" element={<AddPokemonListing />} />
      {/* Mesmo raciocínio da rota de Pokémon acima — precisa vir antes do
          catch-all /:slug abaixo. Rota reservada de propósito quando a rota
          de Pokémon foi criada, pra este slot encaixar sem convenção nova. */}
      <Route path="/:slug/anuncios/item/novo" element={<AddItemListing />} />
      {/* Edição (2026-07-15) — mesmo componente da criação acima; a presença
          do param :storePokemonId/:storeItemId é o que sinaliza modo de
          edição dentro do próprio componente. Mesmo raciocínio de ordem de
          rota que /novo já tem. */}
      <Route path="/:slug/anuncios/pokemon/:storePokemonId/editar" element={<AddPokemonListing />} />
      <Route path="/:slug/anuncios/item/:storeItemId/editar" element={<AddItemListing />} />
      {/* Importar Anúncios (2026-07-15) — bulk-create from pasted "look"
          text(s). Same ordering requirement as every route above: must come
          before the /:slug catch-all. */}
      <Route path="/:slug/anuncios/importar" element={<ImportListings />} />

      {/* Rota dinâmica de loja pública — precisa vir por último. React
          Router v6 já dá prioridade a paths estáticos sobre segmentos
          dinâmicos independente da ordem de declaração, mas mantemos aqui
          embaixo por clareza (evita confundir alguém lendo o arquivo). */}
      <Route path="/:slug" element={<StoreProfile />} />
    </Routes>
  );
}

export default App;
