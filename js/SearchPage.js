import { createElement, useState, useCallback, useRef, useEffect, useMemo } from "react";
import htm from "htm";
import { searchCompanies, logActivity } from "./api.js?v=10";
import { formatSiren, formatCurrency, getEmployeeLabel, getLatestFinance,
         CATEGORY_STYLES, EMPLOYEE_FILTER_OPTIONS,
         INDUSTRY_FILTER_OPTIONS, TURNOVER_FILTER_OPTIONS,
         isStarred, toggleStar, starMultiple, bulkExportToCSV } from "./utils.js?v=10";
import { LoadingSpinner, ErrorMessage, Badge, StatusDot, EmptyState } from "./components.js?v=10";

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
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select
              value=${filters.etat_administratif || ""}
              onChange=${(e) => update("etat_administratif", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All</option>
              <option value="A">Active</option>
              <option value="C">Closed</option>
            </select>
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
function ResultsTable({ results, onCompanyClick, starVersion, onToggleStar, username }) {
  return html`
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wider">
            <th className="py-3 px-2 w-10"></th>
            <th className="py-3 px-3">Company</th>
            <th className="py-3 px-3">SIREN</th>
            <th className="py-3 px-3 hidden sm:table-cell">Category</th>
            <th className="py-3 px-3 hidden md:table-cell">Employees</th>
            <th className="py-3 px-3 hidden lg:table-cell">Revenue</th>
            <th className="py-3 px-3">Status</th>
          </tr>
        </thead>
        <tbody>
          ${results.map((company, i) => {
            const finance = getLatestFinance(company.finances);
            const catStyle = CATEGORY_STYLES[company.categorie_entreprise];
            const starred = isStarred(company.siren, username);
            return html`
              <tr key=${company.siren + "-" + i}
                  className=${"border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors " + (i % 2 === 0 ? "bg-white" : "bg-gray-50")}
                  onClick=${() => onCompanyClick(company.siren)}>
                <td className="py-3 px-2 text-center">
                  <button
                    onClick=${(e) => { e.stopPropagation(); onToggleStar(company.siren); }}
                    className=${"text-lg hover:scale-110 transition-transform " + (starred ? "text-yellow-400" : "text-gray-300 hover:text-yellow-300")}
                    title=${starred ? "Remove star" : "Mark as contacted"}
                  >${starred ? "\u2605" : "\u2606"}</button>
                </td>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">${company.nom_complet}</span>
                    ${company.complements && company.complements.est_importateur && html`
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full bg-amber-100 text-amber-800 border border-amber-300">⬇ Importer</span>
                    `}
                    ${company.complements && company.complements.est_exportateur && html`
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full bg-amber-100 text-amber-800 border border-amber-300">⬆ Exporter</span>
                    `}
                  </div>
                  ${company.siege && html`
                    <span className="block text-xs text-gray-400 mt-0.5">
                      ${company.siege.libelle_commune || ""}${company.siege.code_postal ? " (" + company.siege.code_postal + ")" : ""}
                    </span>
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
                <td className="py-3 px-3">
                  <${StatusDot} active=${company.etat_administratif === "A"} />
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
export function SearchPage({ onNavigate, searchStateRef, currentUser }) {
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
  const [starVersion, setStarVersion] = useState(0);
  const abortRef = useRef(null);

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
      // Strip internal keys (prefixed with _) before sending to API
      const cleanFilters = {};
      Object.entries(filters).forEach(([k, v]) => {
        if (!k.startsWith("_") && v) cleanFilters[k] = v;
      });
      const params = { ...cleanFilters, per_page: API_PER_PAGE };
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
  }, [query, filters]);

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

  const handleToggleStar = (siren) => {
    const wasStarred = isStarred(siren, username);
    toggleStar(siren, username);
    logActivity(wasStarred ? "unstar" : "star", siren);
    setStarVersion(v => v + 1);
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
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Search French companies</h2>
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
                  starVersion=${starVersion}
                  onToggleStar=${handleToggleStar}
                  username=${username}
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
    </div>
  `;
}
