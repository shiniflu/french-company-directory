import { createElement, useState, useEffect } from "react";
import htm from "htm";
import { getFlaggedCompanies, unflagCompany } from "./api.js?v=18";
import { formatSiren, CATEGORY_STYLES } from "./utils.js?v=18";
import { LoadingSpinner, ErrorMessage, Badge, EmptyState } from "./components.js?v=18";

const html = htm.bind(createElement);

export function FlaggedPage({ onNavigate, currentUser }) {
  const [flagged, setFlagged] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getFlaggedCompanies()
      .then(data => { if (!cancelled) setFlagged(data); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleRemove = async (siren) => {
    try {
      await unflagCompany(siren);
      setFlagged(prev => {
        const next = { ...prev };
        delete next[siren];
        return next;
      });
    } catch (err) {
      alert("Failed to remove: " + err.message);
    }
  };

  const entries = Object.values(flagged).sort((a, b) =>
    (b.flagged_at || "").localeCompare(a.flagged_at || "")
  );

  if (loading) return html`<${LoadingSpinner} message="Loading starred companies..." />`;
  if (error) return html`<${ErrorMessage} message=${error} />`;

  return html`
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span className="text-yellow-500">${"\u2605"}</span> Starred Companies
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            ${entries.length} compan${entries.length === 1 ? "y" : "ies"} starred by the team
          </p>
        </div>
      </div>

      ${entries.length === 0
        ? html`<${EmptyState}
            title="No starred companies"
            message="Star companies from the search results or company detail page"
          />`
        : html`
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="py-3 px-3">Company</th>
                  <th className="py-3 px-3">SIREN</th>
                  <th className="py-3 px-3 hidden sm:table-cell">Location</th>
                  <th className="py-3 px-3 hidden md:table-cell">Category</th>
                  <th className="py-3 px-3">Starred By</th>
                  <th className="py-3 px-3 hidden lg:table-cell">Starred At</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                ${entries.map((item, i) => {
                  const catStyle = CATEGORY_STYLES[item.categorie_entreprise];
                  return html`
                    <tr key=${item.siren}
                        className=${"border-b border-gray-100 hover:bg-yellow-50 transition-colors " + (i % 2 === 0 ? "bg-white" : "bg-gray-50")}>
                      <td className="py-3 px-3">
                        <a href=${"#/company/" + item.siren}
                           className="font-medium text-blue-700 hover:text-blue-900 hover:underline cursor-pointer">
                          ${item.company_name || item.siren}
                        </a>
                      </td>
                      <td className="py-3 px-3 text-gray-600 font-mono text-xs">${formatSiren(item.siren)}</td>
                      <td className="py-3 px-3 hidden sm:table-cell text-gray-600 text-xs">
                        ${item.siege_commune || ""}${item.siege_code_postal ? " (" + item.siege_code_postal + ")" : ""}
                      </td>
                      <td className="py-3 px-3 hidden md:table-cell">
                        ${catStyle
                          ? html`<${Badge} label=${catStyle.label} bg=${catStyle.bg} text=${catStyle.text} />`
                          : html`<span className="text-gray-400 text-xs">${"\u2014"}</span>`
                        }
                      </td>
                      <td className="py-3 px-3 text-gray-600 text-xs font-medium">${item.flagged_by || ""}</td>
                      <td className="py-3 px-3 hidden lg:table-cell text-gray-400 text-xs">
                        ${item.flagged_at ? new Date(item.flagged_at).toLocaleDateString() : ""}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick=${() => handleRemove(item.siren)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-yellow-700 bg-yellow-50 rounded hover:bg-yellow-100 transition-colors"
                          title="Remove star"
                        >
                          ${"\u2606"} Unstar
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
