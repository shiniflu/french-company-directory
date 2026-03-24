import { createElement, useState, useEffect } from "react";
import htm from "htm";
import { getCells, getCellDetail, deleteCell, removeCompanyFromCell } from "./api.js?v=16";
import { formatSiren, CATEGORY_STYLES } from "./utils.js?v=12";
import { LoadingSpinner, ErrorMessage, Badge, EmptyState } from "./components.js?v=16";

const html = htm.bind(createElement);

// ── Cell List View ─────────────────────────────────
function CellListView({ cells, onSelectCell, onDeleteCell }) {
  const cellEntries = Object.entries(cells).sort((a, b) =>
    (b[1].created_at || "").localeCompare(a[1].created_at || "")
  );

  if (cellEntries.length === 0) {
    return html`<${EmptyState}
      title="No cells yet"
      message="Select companies from search results and click 'Add to Cell' to create your first cell"
    />`;
  }

  return html`
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${cellEntries.map(([id, cell]) => {
        const companyCount = Object.keys(cell.companies || {}).length;
        return html`
          <div key=${id}
            className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer p-5"
            onClick=${() => onSelectCell(id)}>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-gray-900 truncate">${"📁"} ${cell.name}</h3>
                <p className="text-sm text-gray-500 mt-1">${companyCount} compan${companyCount === 1 ? "y" : "ies"}</p>
              </div>
              <button
                onClick=${(e) => { e.stopPropagation(); onDeleteCell(id, cell.name); }}
                className="text-gray-400 hover:text-red-500 transition-colors p-1"
                title="Delete cell">
                ${"🗑️"}
              </button>
            </div>
            <div className="mt-3 text-xs text-gray-400">
              Created by <span className="font-medium text-gray-600">${cell.created_by}</span>
              ${" · "}${cell.created_at ? new Date(cell.created_at).toLocaleDateString() : ""}
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

// ── Cell Detail View ───────────────────────────────
function CellDetailView({ cellId, cell, onBack, onRemoveCompany, onNavigate }) {
  const companies = Object.entries(cell.companies || {}).sort((a, b) =>
    (b[1].added_at || "").localeCompare(a[1].added_at || "")
  );

  return html`
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick=${onBack}
          className="text-blue-600 hover:text-blue-800 text-sm font-medium">
          ${"←"} Back to cells
        </button>
        <span className="text-gray-300">|</span>
        <h2 className="text-xl font-bold text-gray-900">${"📁"} ${cell.name}</h2>
        <span className="text-sm text-gray-400">(${companies.length} compan${companies.length === 1 ? "y" : "ies"})</span>
      </div>

      ${companies.length === 0 && html`
        <${EmptyState}
          title="Empty cell"
          message="Add companies from search results using the 'Add to Cell' button"
        />
      `}

      ${companies.length > 0 && html`
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wider bg-gray-50">
                <th className="py-3 px-4">Company</th>
                <th className="py-3 px-3">SIREN</th>
                <th className="py-3 px-3 hidden sm:table-cell">Location</th>
                <th className="py-3 px-3 hidden md:table-cell">Category</th>
                <th className="py-3 px-3 hidden lg:table-cell">Added By</th>
                <th className="py-3 px-3 hidden lg:table-cell">Added</th>
                <th className="py-3 px-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              ${companies.map(([siren, comp], i) => {
                const catStyle = CATEGORY_STYLES[comp.categorie_entreprise];
                return html`
                  <tr key=${siren}
                    className=${"border-b border-gray-100 hover:bg-blue-50 transition-colors " + (i % 2 === 0 ? "bg-white" : "bg-gray-50")}>
                    <td className="py-3 px-4">
                      <a href=${"#/company/" + siren}
                        className="font-medium text-blue-700 hover:underline"
                        onClick=${(e) => { e.preventDefault(); onNavigate("company", siren); }}>
                        ${comp.company_name || siren}
                      </a>
                    </td>
                    <td className="py-3 px-3 text-gray-600 font-mono text-xs">${formatSiren(siren)}</td>
                    <td className="py-3 px-3 hidden sm:table-cell text-gray-500 text-xs">
                      ${comp.commune || ""}${comp.code_postal ? " (" + comp.code_postal + ")" : ""}
                    </td>
                    <td className="py-3 px-3 hidden md:table-cell">
                      ${catStyle
                        ? html`<${Badge} label=${catStyle.label} bg=${catStyle.bg} text=${catStyle.text} />`
                        : html`<span className="text-gray-400 text-xs">${"\u2014"}</span>`
                      }
                    </td>
                    <td className="py-3 px-3 hidden lg:table-cell text-xs text-gray-500">${comp.added_by || ""}</td>
                    <td className="py-3 px-3 hidden lg:table-cell text-xs text-gray-400">
                      ${comp.added_at ? new Date(comp.added_at).toLocaleDateString() : ""}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button onClick=${() => onRemoveCompany(siren)}
                        className="text-xs text-red-500 hover:text-red-700 hover:underline font-medium">
                        Remove
                      </button>
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

// ── Main Cells Page ────────────────────────────────
export function CellsPage({ currentUser, onNavigate }) {
  const [cells, setCells] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCellId, setSelectedCellId] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);

  const loadCells = () => {
    setLoading(true);
    getCells()
      .then(data => { setCells(data.cells || {}); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadCells(); }, []);

  const handleSelectCell = (cellId) => {
    setSelectedCellId(cellId);
    setSelectedCell(cells[cellId] || null);
    // Also fetch fresh detail
    getCellDetail(cellId)
      .then(cell => setSelectedCell(cell))
      .catch(e => setError(e.message));
  };

  const handleBack = () => {
    setSelectedCellId(null);
    setSelectedCell(null);
    loadCells(); // refresh
  };

  const handleDeleteCell = async (cellId, cellName) => {
    if (!confirm("Delete cell \"" + cellName + "\" and remove all companies from it?")) return;
    try {
      await deleteCell(cellId);
      loadCells();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleRemoveCompany = async (siren) => {
    try {
      await removeCompanyFromCell(selectedCellId, siren);
      // Refresh cell detail
      const cell = await getCellDetail(selectedCellId);
      setSelectedCell(cell);
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) return html`<${LoadingSpinner} message="Loading cells..." />`;
  if (error) return html`<${ErrorMessage} message=${error} onRetry=${loadCells} />`;

  if (selectedCellId && selectedCell) {
    return html`<${CellDetailView}
      cellId=${selectedCellId}
      cell=${selectedCell}
      onBack=${handleBack}
      onRemoveCompany=${handleRemoveCompany}
      onNavigate=${onNavigate}
    />`;
  }

  return html`
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">${"📁"} Cells</h2>
      <${CellListView}
        cells=${cells}
        onSelectCell=${handleSelectCell}
        onDeleteCell=${handleDeleteCell}
      />
    </div>
  `;
}
