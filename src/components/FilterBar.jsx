/**
 * Barra de filtros compacta sobre el mapa (colapsable en móvil).
 * Los filtros se aplican en cliente, sin nuevas peticiones a Overpass.
 */
export default function FilterBar({ filters, onChange, collapsed, onToggleCollapsed }) {
  const toggle = (key) => onChange({ ...filters, [key]: !filters[key] });
  const active =
    (filters.onlySun ? 1 : 0) + (filters.onlyTerrace ? 1 : 0) + (filters.onlyOpen ? 1 : 0);

  return (
    <div className={`filterbar ${collapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="filterbar-toggle"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
      >
        ⚙️ Filtros{active > 0 ? ` · ${active}` : ''}
      </button>
      <div className="filterbar-chips">
        <button
          type="button"
          className={`filter-chip ${filters.onlySun ? 'active' : ''}`}
          aria-pressed={filters.onlySun}
          onClick={() => toggle('onlySun')}
        >
          ☀️ Solo al sol
        </button>
        <button
          type="button"
          className={`filter-chip ${filters.onlyTerrace ? 'active' : ''}`}
          aria-pressed={filters.onlyTerrace}
          onClick={() => toggle('onlyTerrace')}
        >
          🏖️ Con terraza
        </button>
        <button
          type="button"
          className={`filter-chip ${filters.onlyOpen ? 'active' : ''}`}
          aria-pressed={filters.onlyOpen}
          onClick={() => toggle('onlyOpen')}
        >
          🕐 Abiertos ahora
        </button>
      </div>
    </div>
  );
}
