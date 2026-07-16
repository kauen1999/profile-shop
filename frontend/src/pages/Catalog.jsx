import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../hooks/useFetch';
import { useDebounced } from '../hooks/useDebounced';

const PAGE_SIZE = 60;

function hideBrokenImage(event) {
  event.target.style.display = 'none';
}

export function Catalog() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [generation, setGeneration] = useState('');
  const [regionalForm, setRegionalForm] = useState(false);
  const [hasImage, setHasImage] = useState(true);
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounced(search, 300);

  const { data: filters } = useFetch(api.getCatalogFilters, []);

  const { data, error, loading } = useFetch(
    () =>
      api.getCatalogItems({
        search: debouncedSearch,
        category,
        subcategory,
        generation,
        regionalForm: regionalForm ? 'true' : '',
        hasImage: hasImage ? 'true' : '',
        page,
        pageSize: PAGE_SIZE,
      }),
    [debouncedSearch, category, subcategory, generation, regionalForm, hasImage, page]
  );

  function resetPageAnd(setter) {
    return (value) => {
      setPage(1);
      setter(value);
    };
  }

  const hasFilters = search || category || subcategory || generation || regionalForm || !hasImage;

  function clearFilters() {
    setSearch('');
    setCategory('');
    setSubcategory('');
    setGeneration('');
    setRegionalForm(false);
    setHasImage(true);
    setPage(1);
  }

  return (
    <div className="catalog">
      <div className="catalog-controls">
        <input
          type="text"
          placeholder="Buscar por nome…"
          value={search}
          onChange={(e) => resetPageAnd(setSearch)(e.target.value)}
          className="catalog-search"
        />

        <select value={category} onChange={(e) => resetPageAnd(setCategory)(e.target.value)}>
          <option value="">Todas as categorias</option>
          {filters?.categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.value} ({c.count})
            </option>
          ))}
        </select>

        <select value={subcategory} onChange={(e) => resetPageAnd(setSubcategory)(e.target.value)}>
          <option value="">Todas as subcategorias</option>
          {filters?.subcategories.map((s) => (
            <option key={s.value} value={s.value}>
              {s.value} ({s.count})
            </option>
          ))}
        </select>

        <select value={generation} onChange={(e) => resetPageAnd(setGeneration)(e.target.value)}>
          <option value="">Todas as gerações</option>
          {filters?.generations.map((g) => (
            <option key={g.value} value={g.value}>
              Geração {g.value} ({g.count})
            </option>
          ))}
        </select>

        <label className="catalog-checkbox">
          <input
            type="checkbox"
            checked={regionalForm}
            onChange={(e) => resetPageAnd(setRegionalForm)(e.target.checked)}
          />
          Regional Forms
        </label>

        <label className="catalog-checkbox">
          <input type="checkbox" checked={hasImage} onChange={(e) => resetPageAnd(setHasImage)(e.target.checked)} />
          Só com imagem{filters?.withImageCount ? ` (${filters.withImageCount.toLocaleString('pt-BR')})` : ''}
        </label>

        {hasFilters && (
          <button type="button" className="catalog-clear" onClick={clearFilters}>
            Limpar filtros
          </button>
        )}
      </div>

      {loading && <p>Carregando...</p>}
      {error && <p className="error">Erro: {error}</p>}

      {data && (
        <>
          <p className="catalog-count">
            {data.total.toLocaleString('pt-BR')} {data.total === 1 ? 'item' : 'itens'} · página {data.page} de{' '}
            {data.totalPages}
          </p>

          {data.items.length === 0 ? (
            <p>Nenhum item encontrado com esses filtros.</p>
          ) : (
            <div className="grid">
              {data.items.map((item) => {
                const fields = item.extractedFields || {};
                return (
                  <a href={item.wikiUrl} target="_blank" rel="noreferrer" key={item.wikiPageId} className="card">
                    {item.activeListingsCount > 0 && (
                      <span className="badge badge-listings">{item.activeListingsCount} à venda</span>
                    )}
                    {item.imageUrl && (
                      <img src={item.imageUrl} alt={item.name} className="thumb" onError={hideBrokenImage} />
                    )}
                    <h3>{item.name}</h3>
                    <div className="badge-row">
                      <span className="badge badge-category">{item.category}</span>
                      {fields.generation && <span className="badge badge-muted">Gen {fields.generation}</span>}
                      {fields.regionalForm && <span className="badge badge-muted">Regional</span>}
                    </div>
                    {fields.subcategories?.length > 0 && (
                      <div className="badge-row">
                        {fields.subcategories.map((sub) => (
                          <span key={sub} className="badge badge-sub">
                            {sub}
                          </span>
                        ))}
                      </div>
                    )}
                  </a>
                );
              })}
            </div>
          )}

          <div className="pagination">
            <button type="button" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Anterior
            </button>
            <span>
              {data.page} / {data.totalPages}
            </span>
            <button type="button" disabled={data.page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Próxima →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
