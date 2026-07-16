import { api } from '../api';
import { useFetch } from '../hooks/useFetch';

function Bar({ label, count, max, extra }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="databar-row">
      <div className="databar-label">
        <span className="databar-name">{label}</span>
        <span className="databar-count">
          {count.toLocaleString('pt-BR')}
          {extra}
        </span>
      </div>
      <div className="databar-track">
        <div className="databar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function DataMap() {
  const { data: filters, error, loading } = useFetch(api.getCatalogFilters, []);
  const { data: duskStone } = useFetch(() => api.getCatalogItems({ search: 'Dusk Stone', pageSize: 1 }), []);

  if (loading) return <p>Carregando...</p>;
  if (error) return <p className="error">Erro: {error}</p>;
  if (!filters) return null;

  const totalItems = filters.categories.reduce((sum, c) => sum + c.count, 0);
  const maxCategoryCount = Math.max(...filters.categories.map((c) => c.count), 1);
  const sortedCategories = [...filters.categories].sort((a, b) => b.count - a.count);

  const maxSubcategoryCount = Math.max(...filters.subcategories.map((s) => s.count), 1);
  const sortedSubcategories = [...filters.subcategories].sort((a, b) => b.count - a.count);

  const duskExample = duskStone?.items?.[0];
  const duskSubcats = duskExample?.extractedFields?.subcategories;

  return (
    <div className="datamap">
      <p className="datamap-intro">
        <strong>Categoria</strong> é o que o item <em>é</em> (nunca de onde veio) — cada item pertence a exatamente
        uma. <strong>Subcategoria</strong> é onde o item é obtido/usado (evento, boss diário, dungeon, quest, etc.) —
        um item pode ter várias ao mesmo tempo, guardadas em <code>extractedFields.subcategories</code>.
        {duskExample && duskSubcats?.length > 0 && (
          <>
            {' '}
            Exemplo real: <strong>{duskExample.name}</strong> tem categoria <code>{duskExample.category}</code> e é
            obtido por {duskSubcats.length} sistemas diferentes ({duskSubcats.join(', ')}).
          </>
        )}
      </p>

      <div className="datamap-stats">
        <div className="datamap-stat">
          <span className="datamap-stat-value">{totalItems.toLocaleString('pt-BR')}</span>
          <span className="datamap-stat-label">itens no catálogo</span>
        </div>
        <div className="datamap-stat">
          <span className="datamap-stat-value">{filters.categories.length}</span>
          <span className="datamap-stat-label">categorias</span>
        </div>
        <div className="datamap-stat">
          <span className="datamap-stat-value">{filters.subcategories.length}</span>
          <span className="datamap-stat-label">chaves de subcategoria</span>
        </div>
      </div>

      <section className="datamap-section">
        <h2>Categorias</h2>
        <p className="muted">O que cada item é — cada item pertence a exatamente uma categoria.</p>
        {sortedCategories.map((c) => (
          <Bar
            key={c.value}
            label={c.value}
            count={c.count}
            max={maxCategoryCount}
            extra={` · ${c.withImageCount.toLocaleString('pt-BR')}/${c.count.toLocaleString('pt-BR')} com imagem`}
          />
        ))}
      </section>

      <section className="datamap-section">
        <h2>Subcategorias</h2>
        <p className="muted">
          Onde o item é obtido/usado (a fonte) — um item pode ter zero, uma ou várias subcategorias ao mesmo tempo.
        </p>
        {sortedSubcategories.map((s) => (
          <Bar key={s.value} label={s.value} count={s.count} max={maxSubcategoryCount} extra="" />
        ))}
      </section>
    </div>
  );
}
