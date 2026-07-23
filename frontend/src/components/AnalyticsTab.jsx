import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatCategoryLabel } from '../domain/formatCategoryLabel';
import { formatHdCompact } from '../domain/formatHdCompact';

// Same broken-image-hides-itself pattern used throughout this codebase (see
// StoreListingCard.jsx's hideBrokenImage) — never a broken-image icon.
function hideBrokenImage(event) {
  event.target.style.display = 'none';
}

// Visits-per-day line+area chart (2026-07-21) — plain inline SVG, no chart
// library (none exists in this project's dependencies). Single series
// (visit count over time), so per this project's dataviz conventions: one
// color, a filled area under the line, a single axis, no legend (the title
// above already names the series), hairline hover-recessive gridlines.
const CHART_COLOR = '#2e6fdb'; // same blue as WORLD_ICON_COLORS.BLUE in StoreListingCard.jsx
const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;
const CHART_PADDING_X = 8;
const CHART_PADDING_TOP = 12;
const CHART_PADDING_BOTTOM = 24;

function VisitsChart({ visitsPerDay }) {
  const points = visitsPerDay || [];
  const maxCount = Math.max(1, ...points.map((p) => p.count));
  const plotWidth = CHART_WIDTH - CHART_PADDING_X * 2;
  const plotHeight = CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  function xFor(index) {
    return CHART_PADDING_X + index * stepX;
  }

  function yFor(count) {
    return CHART_PADDING_TOP + plotHeight - (count / maxCount) * plotHeight;
  }

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.count)}`).join(' ');
  const areaPath =
    points.length > 0
      ? `${linePath} L ${xFor(points.length - 1)} ${CHART_PADDING_TOP + plotHeight} L ${xFor(0)} ${CHART_PADDING_TOP + plotHeight} Z`
      : '';

  const lastPoint = points[points.length - 1];
  const zeroY = CHART_PADDING_TOP + plotHeight;
  const maxY = CHART_PADDING_TOP;

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="analytics-chart-svg"
      role="img"
      aria-label="Visitas por dia nos últimos 30 dias"
    >
      {/* Recessive hairline gridlines — 0 and the max value only, never
          competing with the data line/area. */}
      <line x1={CHART_PADDING_X} y1={zeroY} x2={CHART_WIDTH - CHART_PADDING_X} y2={zeroY} className="analytics-chart-grid" />
      <line x1={CHART_PADDING_X} y1={maxY} x2={CHART_WIDTH - CHART_PADDING_X} y2={maxY} className="analytics-chart-grid" />

      {areaPath && <path d={areaPath} fill={CHART_COLOR} fillOpacity="0.1" stroke="none" />}
      {linePath && (
        <path d={linePath} fill="none" stroke={CHART_COLOR} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      )}

      {/* Light interactivity (2026-07-21): a transparent hoverable circle per
          point, each with a nested <title> — native browser tooltip on
          hover, no custom crosshair/tooltip component needed for this
          internal widget. */}
      {points.map((p, index) => (
        <circle key={p.date} cx={xFor(index)} cy={yFor(p.count)} r="6" fill="transparent">
          <title>{`${p.date}: ${p.count}`}</title>
        </circle>
      ))}

      {lastPoint && (
        <circle cx={xFor(points.length - 1)} cy={yFor(lastPoint.count)} r="5" fill={CHART_COLOR} stroke="#fff" strokeWidth="2">
          <title>{`${lastPoint.date}: ${lastPoint.count}`}</title>
        </circle>
      )}
    </svg>
  );
}

// Same "omit a currency side with no real value" idea already used by
// StoreListingCard.jsx's buildCompactPriceText / buildExportText.js's
// buildPriceLines — those check `!= null` because priceReal/priceHd are
// nullable columns there. Here every value from the analytics endpoint
// (estimatedRevenue, sold.revenue, and salesLog's priceReal/priceHd, which
// mirror the same nullable columns) is either a real positive price or
// 0/null — a truthy check covers both shapes and hides a "R$ 0"/"0 HD" side
// that never carries information.
function formatSplitPrice(real, hd) {
  const parts = [];
  if (real) parts.push(`R$ ${real}`);
  if (hd) parts.push(formatHdCompact(hd));
  return parts.join(' · ');
}

// Sales composition pie chart (2026-07-21 follow-up) — Pokémon vs Item
// split among sold listings, placed beside the visits trend chart per
// explicit request. Colors are a validated categorical pair (dataviz
// skill's validate_palette.js — all checks pass), not arbitrary: blue
// matches the visits chart/`WORLD_ICON_COLORS.BLUE`, red matches
// `WORLD_ICON_COLORS.RED` (both `StoreListingCard.jsx`) — reused brand
// colors, not new ones. Only 2 slices, always with a direct label (name +
// count + %) below the chart — color alone never carries the only signal.
const SALES_PIE_COLORS = { pokemon: '#2e6fdb', item: '#e5484d' };

function polarToCartesian(cx, cy, r, angleDeg) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function describePieSlice(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

function SalesPieChart({ sold }) {
  const total = sold.combined;

  if (total === 0) {
    return <p className="landing-store-empty">Nenhuma venda registrada ainda.</p>;
  }

  const cx = 80;
  const cy = 80;
  const r = 70;
  let angleCursor = 0;

  const nonZeroSlices = [
    { key: 'pokemon', label: 'Pokémon', count: sold.pokemon, color: SALES_PIE_COLORS.pokemon },
    { key: 'item', label: 'Itens', count: sold.item, color: SALES_PIE_COLORS.item },
  ].filter((slice) => slice.count > 0);

  // A single category at 100% draws a full circle (startAngle 0, endAngle
  // 360) — start and end points of describePieSlice's arc land on the same
  // spot, collapsing the path to nothing visible. Draw a plain <circle> for
  // that one-slice case instead of going through the arc path at all.
  const isFullCircle = nonZeroSlices.length === 1;

  const slices = isFullCircle
    ? [{ ...nonZeroSlices[0], percent: 100 }]
    : nonZeroSlices.map((slice) => {
        const sliceAngle = (slice.count / total) * 360;
        const path = describePieSlice(cx, cy, r, angleCursor, angleCursor + sliceAngle);
        angleCursor += sliceAngle;
        return { ...slice, path, percent: Math.round((slice.count / total) * 100) };
      });

  return (
    <div className="analytics-pie-wrap">
      <svg viewBox="0 0 160 160" className="analytics-pie-svg" role="img" aria-label="Vendas por tipo — Pokémon vs Itens">
        {slices.map((slice) =>
          isFullCircle ? (
            <circle key={slice.key} cx={cx} cy={cy} r={r} fill={slice.color} stroke="#fff" strokeWidth="2">
              <title>{`${slice.label}: ${slice.count} (${slice.percent}%)`}</title>
            </circle>
          ) : (
            <path key={slice.key} d={slice.path} fill={slice.color} stroke="#fff" strokeWidth="2">
              <title>{`${slice.label}: ${slice.count} (${slice.percent}%)`}</title>
            </path>
          )
        )}
      </svg>
      <ul className="analytics-pie-legend">
        {slices.map((slice) => (
          <li key={slice.key}>
            <span className="analytics-pie-swatch" style={{ backgroundColor: slice.color }} />
            {slice.label}: {slice.count} ({slice.percent}%)
          </li>
        ))}
      </ul>
    </div>
  );
}

const VISITS_PERIODS = [
  { key: 'today', label: 'Dia' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mês' },
];

// Single visits card, alternable between day/week/month (2026-07-21 refinement)
// — replaces the old standalone "Visitas totais" (all-time) tile. All 3
// numbers already arrive in one shot from GET /stores/me/analytics
// (`visits.today/week/month`), so switching the period is purely a local
// state change — no re-fetch, no network request on click.
function VisitsCard({ visits }) {
  const [visitsPeriod, setVisitsPeriod] = useState('today');

  return (
    <div className="analytics-stat-tile analytics-visits-card">
      <span className="analytics-stat-label">Visitas</span>
      <div className="analytics-visits-tabs">
        {VISITS_PERIODS.map((period) => (
          <button
            key={period.key}
            type="button"
            className={`store-tab analytics-visits-tab${visitsPeriod === period.key ? ' store-tab-active' : ''}`}
            onClick={() => setVisitsPeriod(period.key)}
          >
            {period.label}
          </button>
        ))}
      </div>
      <span className="analytics-stat-value">{visits[visitsPeriod]}</span>
    </div>
  );
}

// Store Analytics tab (2026-07-21) — owner-only, backend contract documented
// in CLAUDE.md's "Analytics da loja" entry (GET /stores/me/analytics).
// Fetches once on mount (refetch every time the tab remounts — StoreProfile
// only renders this component while activeTab === 'analytics', so switching
// back to it re-triggers a fresh fetch, simple and always up to date, no
// cache between openings).
export function AnalyticsTab({ idToken, onListingStatusSynced }) {
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [data, setData] = useState(null);
  // Revert-sale from the sales log (2026-07-21 follow-up) — same
  // PATCH {status:'ACTIVE'} already used by StoreProfile.jsx's
  // handleStatusChange on the Anúncios tab's listing cards (which also
  // clears soldAt server-side, see CLAUDE.md's "Analytics da loja" entry).
  // Unlike that handler, this one doesn't hand-patch derived numbers
  // locally — a reverted sale moves several different stat tiles at once
  // (sold counts, revenue, totalAdvertised, the log itself), so a full
  // refetch of the analytics payload is simpler and can't drift from the
  // backend's own aggregation. `revertingKey`/`revertError` are keyed by
  // `${kind}-${id}` (same composite key already used for each row/li) so
  // only the row actually being reverted shows its own loading/error state.
  const [revertingKey, setRevertingKey] = useState(null);
  const [revertError, setRevertError] = useState(null); // { key, message } | null

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    api
      .getStoreAnalytics(idToken)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [idToken]);

  async function handleRevertSale(entry) {
    const key = `${entry.kind}-${entry.id}`;
    setRevertError(null);
    setRevertingKey(key);
    try {
      if (entry.kind === 'ITEM') {
        await api.updateStoreItem(idToken, entry.id, { status: 'ACTIVE' });
      } else {
        await api.updateStorePokemon(idToken, entry.id, { status: 'ACTIVE' });
      }
      const result = await api.getStoreAnalytics(idToken);
      setData(result);
      // Keeps the Anúncios tab's own cached listing in sync (2026-07-21
      // follow-up) — that tab now hides SOLD listings entirely for the
      // owner (see StoreProfile.jsx's visibleListings), so without this a
      // reverted sale wouldn't reappear there until a full page reload.
      // Purely a local-state patch, no network call — the PATCH above
      // already persisted the change server-side.
      onListingStatusSynced?.(entry.kind.toLowerCase(), entry.id, 'ACTIVE');
    } catch {
      setRevertError({ key, message: 'Não foi possível reverter esta venda agora. Tente de novo.' });
    } finally {
      setRevertingKey(null);
    }
  }

  if (status === 'loading') {
    return (
      <div className="landing-auth-card analytics-tab">
        <p>Carregando...</p>
      </div>
    );
  }

  if (status === 'error' || !data) {
    return (
      <div className="landing-auth-card analytics-tab">
        <p className="landing-auth-notice">Não foi possível carregar o Analytics agora. Tente de novo em instantes.</p>
      </div>
    );
  }

  const { visits, visitsPerDay, totalAdvertised, sold, topListings, salesLog } = data;

  const estimatedRevenueText = formatSplitPrice(totalAdvertised.estimatedRevenue.real, totalAdvertised.estimatedRevenue.hd);
  const soldRevenueText = formatSplitPrice(sold.revenue.real, sold.revenue.hd);

  return (
    <div className="landing-auth-card analytics-tab">
      <div className="analytics-stats-grid">
        <VisitsCard visits={visits} />

        <div className="analytics-stat-tile">
          <span className="analytics-stat-label">Itens anunciados</span>
          <span className="analytics-stat-value">{totalAdvertised.combined}</span>
          <span className="analytics-stat-breakdown">
            {totalAdvertised.pokemon} Pokémon · {totalAdvertised.item} Itens
          </span>
          {estimatedRevenueText && <span className="analytics-stat-breakdown">Estimativa: {estimatedRevenueText}</span>}
        </div>

        <div className="analytics-stat-tile">
          <span className="analytics-stat-label">Vendidos</span>
          <span className="analytics-stat-value">{sold.combined}</span>
          <span className="analytics-stat-breakdown">
            {sold.pokemon} Pokémon · {sold.item} Itens
          </span>
          {soldRevenueText && <span className="analytics-stat-breakdown">Receita: {soldRevenueText}</span>}
        </div>
      </div>

      <div className="analytics-charts-row">
        <div className="analytics-chart-section">
          <h3 className="analytics-section-title">Visitas por dia (últimos 30 dias)</h3>
          <VisitsChart visitsPerDay={visitsPerDay} />
        </div>

        <div className="analytics-chart-section">
          <h3 className="analytics-section-title">Vendas por tipo</h3>
          <SalesPieChart sold={sold} />
        </div>
      </div>

      <div className="analytics-section">
        <h3 className="analytics-section-title">Anúncios mais acessados</h3>
        {topListings.length === 0 ? (
          <p className="landing-store-empty">Nenhum acesso a anúncio registrado ainda.</p>
        ) : (
          <ul className="analytics-top-listings">
            {topListings.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`} className="analytics-top-listing-row">
                <div className="analytics-top-listing-photo">
                  {entry.imageUrl && <img src={entry.imageUrl} alt="" onError={hideBrokenImage} />}
                </div>
                <span className="analytics-top-listing-name">{entry.name}</span>
                {entry.isHot && <span className="analytics-hot-badge">HOT</span>}
                <span className="analytics-top-listing-kind">{entry.kind === 'POKEMON' ? 'Pokémon' : 'Item'}</span>
                <span className="analytics-top-listing-views">{entry.viewCount}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="analytics-section">
        <h3 className="analytics-section-title">Vendidos por espécie</h3>
        {sold.bySpecies.length === 0 ? (
          <p className="landing-store-empty">Nenhuma venda de Pokémon ainda.</p>
        ) : (
          <ul className="analytics-breakdown-list">
            {sold.bySpecies.map((entry) => (
              <li key={entry.name}>
                <span>{entry.name}</span>
                <span>{entry.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="analytics-section">
        <h3 className="analytics-section-title">Vendidos por categoria</h3>
        {sold.byCategory.length === 0 ? (
          <p className="landing-store-empty">Nenhuma venda de item ainda.</p>
        ) : (
          <ul className="analytics-breakdown-list">
            {sold.byCategory.map((entry) => (
              <li key={entry.category}>
                <span>{formatCategoryLabel(entry.category)}</span>
                <span>{entry.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="analytics-section">
        <h3 className="analytics-section-title">Log de vendas</h3>
        {salesLog.length === 0 ? (
          <p className="landing-store-empty">Nenhuma venda registrada ainda.</p>
        ) : (
          <ul className="analytics-sales-log">
            {salesLog.map((entry) => {
              const priceText = formatSplitPrice(entry.priceReal, entry.priceHd);
              const key = `${entry.kind}-${entry.id}`;
              const isReverting = revertingKey === key;
              return (
                <li key={key} className="analytics-sales-log-row">
                  <span className="analytics-sales-log-name">{entry.name}</span>
                  {priceText && <span className="analytics-sales-log-price">{priceText}</span>}
                  <span className="analytics-sales-log-date">{new Date(entry.soldAt).toLocaleString('pt-BR')}</span>
                  <div className="analytics-sales-log-actions">
                    <button
                      type="button"
                      className="store-listing-status-btn"
                      disabled={isReverting}
                      onClick={() => handleRevertSale(entry)}
                    >
                      {isReverting ? 'Revertendo...' : 'Reverter venda'}
                    </button>
                    {revertError?.key === key && (
                      <span className="analytics-sales-log-revert-error">{revertError.message}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
