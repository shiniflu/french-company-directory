import { createElement, useState, useCallback, useRef, useEffect, useMemo } from "react";
import htm from "htm";
import { searchCompanies, searchCompaniesByCountry, logActivity, getFlaggedCompanies, flagCompany, unflagCompany,
         getCells, createCell, addCompaniesToCell } from "./api.js?v=18";
import { formatSiren, formatCurrency, getEmployeeLabel, getLatestFinance,
         CATEGORY_STYLES, EMPLOYEE_FILTER_OPTIONS,
         INDUSTRY_FILTER_OPTIONS, TURNOVER_FILTER_OPTIONS,
         bulkExportToCSV, isInternationalTrade } from "./utils.js?v=18";
import { LoadingSpinner, ErrorMessage, Badge, EmptyState, COUNTRIES } from "./components.js?v=18";

const html = htm.bind(createElement);

const PAGE_SIZE = 10;
const API_PER_PAGE = 25;
const MAX_PAGES_TO_FETCH = 40; // 40 x 25 = 1000 results max
const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 1200; // delay between batches (API limit: 7 req/sec)

// ── Search Bar ──────────────────────────────────────
function SearchBar({ value, onChange, onSubmit, loading }) {
  const handleKeyDown = (e) => {
    if (e.key === "Enter") onSubmit();
  };

  return html`
    <div className="flex gap-2">
      <input
        type="text"
        value=${value}
        onInput=${(e) => onChange(e.target.value)}
        onKeyDown=${handleKeyDown}
        placeholder="Search a company (name, SIREN, director...)"
        className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <button
        onClick=${onSubmit}
        disabled=${loading}
        className="px-6 py-3 bg-gov-blue text-white rounded-lg font-medium hover:bg-gov-blue-dark transition-colors disabled:opacity-50 flex items-center gap-2"
      >
        ${loading ? html`<div className="spinner" style=${{ width: "1.2rem", height: "1.2rem", borderWidth: "2px" }}></div>` : ""}
        Search
      </button>
    </div>
  `;
}

// ── Search Filters ──────────────────────────────────
function SearchFilters({ filters, onChange, onReset }) {
  const [open, setOpen] = useState(false);

  const update = (key, val) => onChange({ ...filters, [key]: val });

  const handleTurnoverChange = (val) => {
    if (!val) {
      const next = { ...filters };
      delete next.ca_min;
      delete next.ca_max;
      next._turnover = "";
      onChange(next);
    } else {
      const parts = val.split("-");
      const next = { ...filters, _turnover: val };
      next.ca_min = parts[0] || "";
      next.ca_max = parts[1] || "";
      onChange(next);
    }
  };

  const activeCount = Object.entries(filters).filter(([k, v]) => v && !k.startsWith("_")).length;

  return html`
    <div className="mt-3">
      <button
        onClick=${() => setOpen(!open)}
        className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
      >
        <span className="text-xs">${open ? "▼" : "▶"}</span>
        ${" Advanced filters"}
        ${activeCount > 0 && html`
          <span className="ml-1 bg-blue-100 text-blue-700 text-xs font-medium px-1.5 py-0.5 rounded-full">${activeCount}</span>
        `}
      </button>

      ${open && html`
        <div className="mt-3 p-4 bg-gray-50 rounded-lg border border-gray-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

          <div className="sm:col-span-2 lg:col-span-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Industry (NAF Sector)</label>
            <select
              value=${filters.section_activite_principale || ""}
              onChange=${(e) => update("section_activite_principale", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              ${INDUSTRY_FILTER_OPTIONS.map(opt => html`
                <option key=${opt.value} value=${opt.value}>${opt.label}</option>
              `)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Revenue (Turnover)</label>
            <select
              value=${filters._turnover || ""}
              onChange=${(e) => handleTurnoverChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              ${TURNOVER_FILTER_OPTIONS.map(opt => html`
                <option key=${opt.value} value=${opt.value}>${opt.label}</option>
              `)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
            <select
              value=${filters.categorie_entreprise || ""}
              onChange=${(e) => update("categorie_entreprise", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All</option>
              <option value="PME">SME (Small/Medium)</option>
              <option value="ETI">Mid-cap</option>
              <option value="GE">Large Enterprise</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Employees</label>
            <select
              value=${filters.tranche_effectif_salarie || ""}
              onChange=${(e) => update("tranche_effectif_salarie", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              ${EMPLOYEE_FILTER_OPTIONS.map(opt => html`
                <option key=${opt.value} value=${opt.value}>${opt.label}</option>
              `)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Postal Code</label>
            <input
              type="text"
              value=${filters.code_postal || ""}
              onInput=${(e) => update("code_postal", e.target.value)}
              placeholder="e.g. 75001"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">NAF Code</label>
            <input
              type="text"
              value=${filters.activite_principale || ""}
              onInput=${(e) => update("activite_principale", e.target.value)}
              placeholder="e.g. 46.90Z, 62.01"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
            <button
              onClick=${onReset}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Reset filters
            </button>
          </div>
        </div>
      `}
    </div>
  `;
}

// ── Results Table ───────────────────────────────────
function ResultsTable({ results, onCompanyClick, onToggleStar, username, flaggedSirens, selectedSirens, onToggleSelect, onSelectAll, companyCells }) {
  const allSelected = results.length > 0 && results.every(c => selectedSirens.has(c.siren));
  return html`
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wider">
            <th className="py-3 px-2 w-8">
              <input type="checkbox" checked=${allSelected}
                onChange=${() => onSelectAll(!allSelected)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                title=${allSelected ? "Deselect all" : "Select all on this page"} />
            </th>
            <th className="py-3 px-2 w-10"></th>
            <th className="py-3 px-3">Company</th>
            <th className="py-3 px-3">SIREN</th>
            <th className="py-3 px-3 hidden sm:table-cell">Category</th>
            <th className="py-3 px-3 hidden md:table-cell">Employees</th>
            <th className="py-3 px-3 hidden lg:table-cell">Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${results.map((company, i) => {
            const finance = getLatestFinance(company.finances);
            const catStyle = CATEGORY_STYLES[company.categorie_entreprise];
            const starred = flaggedSirens && flaggedSirens[company.siren];
            const isSelected = selectedSirens.has(company.siren);
            const cellList = companyCells && companyCells[company.siren];
            return html`
              <tr key=${company.siren + "-" + i}
                  className=${"border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors " + (isSelected ? "bg-blue-50 " : (i % 2 === 0 ? "bg-white " : "bg-gray-50 "))}
                  onClick=${() => onCompanyClick(company.siren)}>
                <td className="py-3 px-2 text-center" onClick=${(e) => e.stopPropagation()}>
                  <input type="checkbox" checked=${isSelected}
                    onChange=${() => onToggleSelect(company.siren)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                </td>
                <td className="py-3 px-2 text-center">
                  <button
                    onClick=${(e) => { e.stopPropagation(); onToggleStar(company.siren, company); }}
                    className=${"text-lg hover:scale-110 transition-transform " + (starred ? "text-yellow-400" : "text-gray-300 hover:text-yellow-300")}
                    title=${starred ? "Remove star" : "Mark as contacted"}
                  >${starred ? "\u2605" : "\u2606"}</button>
                </td>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">${company.nom_complet}</span>
                    ${isInternationalTrade(company) && html`
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full bg-amber-100 text-amber-800 border border-amber-300">${"\uD83C\uDF10"} Int'l Trade</span>
                    `}
                  </div>
                  ${company.siege && html`
                    <span className="block text-xs text-gray-400 mt-0.5">
                      ${company.siege.libelle_commune || ""}${company.siege.code_postal ? " (" + company.siege.code_postal + ")" : ""}
                    </span>
                  `}
                  ${cellList && cellList.length > 0 && html`
                    <div className="flex flex-wrap gap-1 mt-1">
                      ${cellList.map(c => html`
                        <span key=${c.cell_id} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 text-purple-700 border border-purple-200">
                          ${"📁"} ${c.cell_name}
                        </span>
                      `)}
                    </div>
                  `}
                </td>
                <td className="py-3 px-3 text-gray-600 font-mono text-xs">${formatSiren(company.siren)}</td>
                <td className="py-3 px-3 hidden sm:table-cell">
                  ${catStyle
                    ? html`<${Badge} label=${catStyle.label} bg=${catStyle.bg} text=${catStyle.text} />`
                    : html`<span className="text-gray-400 text-xs">${"\u2014"}</span>`
                  }
                </td>
                <td className="py-3 px-3 hidden md:table-cell text-gray-600">${getEmployeeLabel(company.tranche_effectif_salarie)}</td>
                <td className="py-3 px-3 hidden lg:table-cell text-gray-600">
                  ${finance && finance.ca != null ? formatCurrency(finance.ca) : html`<span className="text-gray-400">${"\u2014"}</span>`}
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </div>
  `;
}

// ── Pagination ──────────────────────────────────────
function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);

  if (start > 1) { pages.push(1); if (start > 2) pages.push("..."); }
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages) { if (end < totalPages - 1) pages.push("..."); pages.push(totalPages); }

  return html`
    <div className="flex items-center justify-center gap-1 mt-6">
      <button
        onClick=${() => onPageChange(page - 1)}
        disabled=${page <= 1}
        className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
      >Prev</button>
      ${pages.map((p, i) =>
        p === "..."
          ? html`<span key=${"dots-" + i} className="px-2 text-gray-400">...</span>`
          : html`
            <button
              key=${p}
              onClick=${() => onPageChange(p)}
              className=${"px-3 py-2 text-sm border rounded-md transition-colors " + (p === page ? "bg-gov-blue text-white border-gov-blue" : "border-gray-300 hover:bg-gray-100")}
            >${p}</button>
          `
      )}
      <button
        onClick=${() => onPageChange(page + 1)}
        disabled=${page >= totalPages}
        className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
      >Next</button>
    </div>
  `;
}

// ── Sort helper ────────────────────────────────────
function sortResultsList(results, sortKey) {
  if (!sortKey || !results) return results;
  const sorted = [...results];
  switch (sortKey) {
    case "name_asc":
      sorted.sort((a, b) => (a.nom_complet || "").localeCompare(b.nom_complet || ""));
      break;
    case "name_desc":
      sorted.sort((a, b) => (b.nom_complet || "").localeCompare(a.nom_complet || ""));
      break;
    case "date_newest":
      sorted.sort((a, b) => (b.date_creation || "").localeCompare(a.date_creation || ""));
      break;
    case "date_oldest":
      sorted.sort((a, b) => (a.date_creation || "").localeCompare(b.date_creation || ""));
      break;
    case "size_desc":
      sorted.sort((a, b) => {
        const codeA = parseInt(a.tranche_effectif_salarie) || 0;
        const codeB = parseInt(b.tranche_effectif_salarie) || 0;
        return codeB - codeA;
      });
      break;
    case "turnover_desc":
      sorted.sort((a, b) => {
        const finA = getLatestFinance(a.finances);
        const finB = getLatestFinance(b.finances);
        const caA = finA && finA.ca != null ? finA.ca : -1;
        const caB = finB && finB.ca != null ? finB.ca : -1;
        return caB - caA;
      });
      break;
  }
  return sorted;
}

// ── Search Page (main export) ───────────────────────
export function SearchPage({ onNavigate, searchStateRef, currentUser, country = "fr" }) {
  const username = currentUser ? currentUser.username : "";
  const saved = searchStateRef ? searchStateRef.current : {};
  const [query, setQuery] = useState(saved.query || "");
  const [filters, setFilters] = useState(saved.filters || {});
  const [allResults, setAllResults] = useState(saved.allResults || null);
  const [totalResults, setTotalResults] = useState(saved.totalResults || 0);
  const [page, setPage] = useState(saved.page || 1);
  const [sort, setSort] = useState(saved.sort || "");
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState("");
  const [error, setError] = useState(null);
  const [flaggedSirens, setFlaggedSirens] = useState({});
  const [selectedSirens, setSelectedSirens] = useState(new Set());
  const [companyCells, setCompanyCells] = useState({});
  const [cellsList, setCellsList] = useState({});
  const [showCellMenu, setShowCellMenu] = useState(false);
  const [newCellName, setNewCellName] = useState("");
  const [cellMenuMode, setCellMenuMode] = useState("choose"); // "choose" | "create"
  const abortRef = useRef(null);

  // Load flagged companies and cells from server
  useEffect(() => {
    getFlaggedCompanies()
      .then(data => setFlaggedSirens(data))
      .catch(() => {});
    getCells()
      .then(data => {
        setCellsList(data.cells || {});
        setCompanyCells(data.company_cells || {});
      })
      .catch(() => {});
  }, []);

  // Persist search state for back-navigation
  useEffect(() => {
    if (searchStateRef) {
      searchStateRef.current = { query, filters, allResults, totalResults, page, sort };
    }
  }, [query, filters, allResults, totalResults, page, sort]);

  const hasFilters = Object.values(filters).some(v => v);

  const doSearch = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setAllResults(null);
    setLoadingProgress("Searching...");

    try {
      // Non-French countries: use proxy search
      if (country !== "fr") {
        // Use query or empty string (server returns browsable results for empty)
        const searchQuery = query.trim() || (document.querySelector('input[type="text"]') || {}).value || "";
        const data = await searchCompaniesByCountry(country, searchQuery, 1, 100, controller.signal);
        setAllResults(data.results || []);
        setTotalResults(data.total_results || 0);
        setLoadingProgress("");
        setLoading(false);
        if (data.note) {
          setError(data.note + (data.search_url ? " " + data.search_url : ""));
        }
        logActivity("search", country + ": " + searchQuery);
        return;
      }

      // Strip internal keys (prefixed with _) before sending to API
      const cleanFilters = {};
      Object.entries(filters).forEach(([k, v]) => {
        if (!k.startsWith("_") && v) cleanFilters[k] = v;
      });
      const params = { ...cleanFilters, per_page: API_PER_PAGE };
      // Always default to active companies
      if (!params.etat_administratif) params.etat_administratif = "A";
      if (query.trim()) {
        params.q = query.trim();
      }

      // Fetch first page
      const firstData = await searchCompanies({ ...params, page: 1 }, controller.signal);
      let collected = firstData.results ? [...firstData.results] : [];
      const total = firstData.total_results || 0;
      const apiTotalPages = firstData.total_pages || 1;

      // Fetch remaining pages in small batches to respect API rate limit (7 req/sec)
      if (apiTotalPages > 1) {
        const maxPages = Math.min(apiTotalPages, MAX_PAGES_TO_FETCH);
        const expectedTotal = Math.min(total, maxPages * API_PER_PAGE);
        setLoadingProgress("Loading " + collected.length + " / " + expectedTotal + " results...");

        // Wait after first request before starting batches
        await new Promise(r => setTimeout(r, 500));

        for (let batchStart = 2; batchStart <= maxPages; batchStart += BATCH_SIZE) {
          if (controller.signal.aborted) return;
          const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, maxPages);
          const promises = [];
          for (let p = batchStart; p <= batchEnd; p++) {
            promises.push(searchCompanies({ ...params, page: p }, controller.signal));
          }

          // Try the batch; if rate-limited, wait and retry once
          let batchResults;
          try {
            batchResults = await Promise.all(promises);
          } catch (batchErr) {
            if (batchErr.status === 429) {
              const wait = (batchErr.retryAfter || 3) * 1000;
              setLoadingProgress("Rate limited — waiting " + Math.ceil(wait / 1000) + "s...");
              await new Promise(r => setTimeout(r, wait));
              // Retry the same batch
              const retryPromises = [];
              for (let p = batchStart; p <= batchEnd; p++) {
                retryPromises.push(searchCompanies({ ...params, page: p }, controller.signal));
              }
              batchResults = await Promise.all(retryPromises);
            } else {
              throw batchErr;
            }
          }

          batchResults.forEach(data => {
            if (data.results) collected = collected.concat(data.results);
          });
          setLoadingProgress("Loading " + collected.length + " / " + expectedTotal + " results...");

          // Delay between batches to stay well under API rate limit
          if (batchStart + BATCH_SIZE <= maxPages) {
            await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
          }
        }
      }

      setAllResults(collected);
      setTotalResults(total);
      setPage(1);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
      setLoadingProgress("");
    }
  }, [query, filters, country]);

  const handleSearch = () => {
    doSearch();
  };

  // Client-side pagination — no API call needed
  const handlePageChange = (newPage) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleResetFilters = () => {
    setFilters({});
  };

  const handleToggleStar = async (siren, companyData) => {
    const wasStarred = !!flaggedSirens[siren];
    try {
      if (wasStarred) {
        await unflagCompany(siren);
        logActivity("unstar", siren);
        setFlaggedSirens(prev => {
          const next = { ...prev };
          delete next[siren];
          return next;
        });
      } else {
        const metadata = {
          company_name: companyData.nom_complet || "",
          categorie_entreprise: companyData.categorie_entreprise || "",
          siege_commune: companyData.siege ? (companyData.siege.libelle_commune || "") : "",
          siege_code_postal: companyData.siege ? (companyData.siege.code_postal || "") : "",
        };
        const result = await flagCompany(siren, metadata);
        logActivity("star", siren);
        setFlaggedSirens(prev => ({ ...prev, [siren]: result }));
      }
    } catch (err) {
      console.error("Star toggle failed:", err);
    }
  };

  // ── Selection handlers ────────────────────────────
  const handleToggleSelect = (siren) => {
    setSelectedSirens(prev => {
      const next = new Set(prev);
      if (next.has(siren)) next.delete(siren); else next.add(siren);
      return next;
    });
  };

  const handleSelectAll = (selectAll) => {
    if (!displayedResults) return;
    setSelectedSirens(prev => {
      const next = new Set(prev);
      displayedResults.forEach(c => {
        if (selectAll) next.add(c.siren); else next.delete(c.siren);
      });
      return next;
    });
  };

  // ── Add to cell handlers ─────────────────────────
  const handleAddToCell = async (cellId) => {
    if (selectedSirens.size === 0) return;
    const companies = (sortedResults || [])
      .filter(c => selectedSirens.has(c.siren))
      .map(c => ({
        siren: c.siren,
        company_name: c.nom_complet || "",
        categorie_entreprise: c.categorie_entreprise || "",
        commune: c.siege ? (c.siege.libelle_commune || "") : "",
        code_postal: c.siege ? (c.siege.code_postal || "") : "",
      }));
    try {
      await addCompaniesToCell(cellId, companies);
      // Refresh cells data
      const data = await getCells();
      setCellsList(data.cells || {});
      setCompanyCells(data.company_cells || {});
      setSelectedSirens(new Set());
      setShowCellMenu(false);
    } catch (err) {
      console.error("Add to cell failed:", err);
    }
  };

  const handleCreateAndAdd = async () => {
    if (!newCellName.trim() || selectedSirens.size === 0) return;
    try {
      const result = await createCell(newCellName.trim());
      setNewCellName("");
      setCellMenuMode("choose");
      await handleAddToCell(result.cell_id);
    } catch (err) {
      console.error("Create cell failed:", err);
    }
  };

  // Sort all results (memoized to avoid re-sorting on every render)
  const sortedResults = useMemo(() => {
    if (!allResults) return null;
    return sort ? sortResultsList(allResults, sort) : allResults;
  }, [allResults, sort]);

  // Client-side pagination
  const clientTotalPages = sortedResults ? Math.ceil(sortedResults.length / PAGE_SIZE) : 0;
  const displayedResults = sortedResults
    ? sortedResults.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : null;

  // Bulk export exports ALL fetched results (not just current page)
  const handleBulkExport = () => {
    const toExport = sortedResults;
    if (!toExport || toExport.length === 0) return;
    bulkExportToCSV(toExport);
    // Auto-star all exported companies
    starMultiple(toExport.map(c => c.siren), username);
    logActivity("bulk_export", toExport.length + " companies");
    setStarVersion(v => v + 1);
  };

  return html`
    <div>
      ${!allResults && !loading && !error && html`
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            ${(COUNTRIES.find(c => c.code === country) || {}).flag || ""} Search ${(COUNTRIES.find(c => c.code === country) || {}).name || "companies"}
          </h2>
          <p className="text-gray-500">Explore public data: identity, directors, financials and more</p>
        </div>
      `}

      <div className="mb-8">
        <${SearchBar}
          value=${query}
          onChange=${setQuery}
          onSubmit=${handleSearch}
          loading=${loading}
        />

        <${SearchFilters}
          filters=${filters}
          onChange=${setFilters}
          onReset=${handleResetFilters}
        />
      </div>

      ${error && html`<${ErrorMessage} message=${error} onRetry=${handleSearch} />`}

      ${loading && html`<${LoadingSpinner} message=${loadingProgress || "Searching..."} />`}

      ${!loading && allResults && html`
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <p className="text-sm text-gray-500">
              <span className="font-semibold text-gray-700">${totalResults.toLocaleString("en-US")}</span> total result${totalResults !== 1 ? "s" : ""}
              ${totalResults > allResults.length
                ? html` <span className="text-gray-400">(showing ${allResults.length.toLocaleString("en-US")})</span>`
                : ""
              }
            </p>
            <div className="flex items-center gap-3">
              <select
                value=${sort}
                onChange=${(e) => { setSort(e.target.value); setPage(1); }}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              >
                <option value="">Sort: Relevance</option>
                <option value="name_asc">Name A-Z</option>
                <option value="name_desc">Name Z-A</option>
                <option value="date_newest">Newest first</option>
                <option value="date_oldest">Oldest first</option>
                <option value="size_desc">Largest (employees)</option>
                <option value="turnover_desc">Highest turnover</option>
              </select>
              ${allResults.length > 0 && html`
                <button
                  onClick=${handleBulkExport}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-gray-700 transition-colors"
                  title=${"Export all " + allResults.length + " results to CSV and mark as contacted"}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  Export All CSV (${allResults.length})
                </button>
              `}
            </div>
          </div>

          ${displayedResults && displayedResults.length > 0
            ? html`
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <${ResultsTable}
                  results=${displayedResults}
                  onCompanyClick=${(siren) => onNavigate("company", siren)}
                  onToggleStar=${handleToggleStar}
                  username=${username}
                  flaggedSirens=${flaggedSirens}
                  selectedSirens=${selectedSirens}
                  onToggleSelect=${handleToggleSelect}
                  onSelectAll=${handleSelectAll}
                  companyCells=${companyCells}
                />
              </div>
              <${Pagination}
                page=${page}
                totalPages=${clientTotalPages}
                onPageChange=${handlePageChange}
              />
            `
            : html`<${EmptyState}
                title="No results"
                message="Try adjusting your search or filters"
              />`
          }
        </div>
      `}

      ${!loading && !allResults && !error && html`
        <${EmptyState}
          title="Start a search"
          message="Enter a company name, SIREN, or use the advanced filters"
        />
      `}

      ${selectedSirens.size > 0 && html`
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-blue-700 text-white shadow-lg border-t-2 border-blue-900"
             style=${{ padding: "12px 20px" }}>
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="bg-white text-blue-700 font-bold px-2.5 py-0.5 rounded-full text-sm">${selectedSirens.size}</span>
              <span className="text-sm font-medium">compan${selectedSirens.size === 1 ? "y" : "ies"} selected</span>
              <button onClick=${() => setSelectedSirens(new Set())}
                className="text-xs text-blue-200 hover:text-white underline ml-2">Clear selection</button>
            </div>
            <div className="relative">
              <button onClick=${() => { setShowCellMenu(!showCellMenu); setCellMenuMode("choose"); }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white text-blue-700 font-semibold text-sm rounded-lg hover:bg-blue-50 transition-colors shadow">
                ${"📁"} Add to Cell
              </button>
              ${showCellMenu && html`
                <div className="absolute bottom-full right-0 mb-2 w-72 bg-white rounded-lg shadow-2xl border border-gray-200 text-gray-800 overflow-hidden"
                     onClick=${(e) => e.stopPropagation()}>
                  <div className="p-3 border-b border-gray-100 flex gap-2">
                    <button onClick=${() => setCellMenuMode("choose")}
                      className=${"flex-1 px-3 py-1.5 text-xs font-medium rounded " + (cellMenuMode === "choose" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
                      Existing Cell
                    </button>
                    <button onClick=${() => setCellMenuMode("create")}
                      className=${"flex-1 px-3 py-1.5 text-xs font-medium rounded " + (cellMenuMode === "create" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
                      + New Cell
                    </button>
                  </div>
                  ${cellMenuMode === "choose" && html`
                    <div className="max-h-48 overflow-y-auto">
                      ${Object.keys(cellsList).length === 0 && html`
                        <p className="text-xs text-gray-400 p-3 text-center">No cells yet. Create one first.</p>
                      `}
                      ${Object.entries(cellsList).map(([id, cell]) => html`
                        <button key=${id}
                          onClick=${() => handleAddToCell(id)}
                          className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-gray-50 transition-colors flex items-center justify-between">
                          <span className="text-sm font-medium">${"📁"} ${cell.name}</span>
                          <span className="text-xs text-gray-400">${Object.keys(cell.companies || {}).length} co.</span>
                        </button>
                      `)}
                    </div>
                  `}
                  ${cellMenuMode === "create" && html`
                    <div className="p-3">
                      <input type="text" value=${newCellName}
                        onInput=${(e) => setNewCellName(e.target.value)}
                        onKeyDown=${(e) => { if (e.key === "Enter") handleCreateAndAdd(); }}
                        placeholder="Cell name (e.g. Provence Winemakers)"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none mb-2" />
                      <button onClick=${handleCreateAndAdd}
                        disabled=${!newCellName.trim()}
                        className="w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors">
                        Create & Add ${selectedSirens.size} compan${selectedSirens.size === 1 ? "y" : "ies"}
                      </button>
                    </div>
                  `}
                </div>
              `}
            </div>
          </div>
        </div>
      `}
    </div>
  `;
}
