import { createElement, useState, useEffect } from "react";
import htm from "htm";
import { getCells, getCellDetail, deleteCell, removeCompanyFromCell, findCompanyEmail, getDrafts, saveDraft } from "./api.js?v=18";
import { formatSiren, CATEGORY_STYLES } from "./utils.js?v=18";
import { LoadingSpinner, ErrorMessage, Badge, EmptyState } from "./components.js?v=18";

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
                className="px-3 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:text-red-700 transition-colors"
                title="Delete cell">
                Delete
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

  const [selected, setSelected] = useState({});
  const [emailResults, setEmailResults] = useState(() => {
    // Load saved email results from cell data
    const saved = {};
    companies.forEach(([siren, comp]) => {
      if (comp.email_result) saved[siren] = comp.email_result;
    });
    return saved;
  });
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState("");
  const [expandedEmail, setExpandedEmail] = useState({});
  const [showComposer, setShowComposer] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [composerSubject, setComposerSubject] = useState("");
  const [composerBody, setComposerBody] = useState("");
  const [composerImages, setComposerImages] = useState([]);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState({});

  // Load existing drafts on mount
  useEffect(() => {
    getDrafts(cellId).then(d => setDrafts(d)).catch(() => {});
  }, [cellId]);

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const allSelected = companies.length > 0 && selectedCount === companies.length;

  const toggleSelect = (siren) => {
    setSelected(prev => ({ ...prev, [siren]: !prev[siren] }));
  };
  const toggleAll = () => {
    if (allSelected) {
      setSelected({});
    } else {
      const all = {};
      companies.forEach(([siren]) => { all[siren] = true; });
      setSelected(all);
    }
  };

  const toggleEmailDetail = (siren) => {
    setExpandedEmail(prev => ({ ...prev, [siren]: !prev[siren] }));
  };

  // Handle image upload to base64
  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setComposerImages(prev => prev.concat({ name: file.name, data: ev.target.result }));
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const removeImage = (idx) => {
    setComposerImages(prev => prev.filter((_, i) => i !== idx));
  };

  // Save draft for each selected company
  const handleSaveAllDrafts = async () => {
    const selectedCompanies = companies.filter(([s]) => selected[s]);
    if (selectedCompanies.length === 0) return;
    setSavingDraft(true);
    const newSaved = {};
    for (const [siren, comp] of selectedCompanies) {
      const emailInfo = emailResults[siren];
      const toEmail = emailInfo && emailInfo.email ? emailInfo.email : "";
      try {
        await saveDraft({
          cell_id: cellId,
          siren: siren,
          company_name: comp.company_name || "",
          to_email: toEmail,
          subject: composerSubject,
          body: composerBody,
          images: composerImages.map(img => img.name),
        });
        newSaved[siren] = true;
      } catch (err) {
        newSaved[siren] = false;
      }
    }
    setDraftSaved(newSaved);
    setSavingDraft(false);
    getDrafts(cellId).then(d => setDrafts(d)).catch(() => {});
    setTimeout(() => setDraftSaved({}), 3000);
  };

  // Find ALL emails for all companies in cell
  const handleFindAllEmails = async () => {
    const allComps = companies.map(([s, c]) => ({ siren: s, ...c }));
    if (allComps.length === 0) return;
    setSearching(true);
    for (let i = 0; i < allComps.length; i++) {
      const comp = allComps[i];
      setSearchProgress((i + 1) + "/" + allComps.length + ": " + (comp.company_name || comp.siren));
      try {
        const result = await findCompanyEmail(comp.siren, comp.company_name || "");
        setEmailResults(prev => ({ ...prev, [comp.siren]: result }));
      } catch (e) {
        setEmailResults(prev => ({ ...prev, [comp.siren]: { error: e.message } }));
      }
    }
    setSearching(false);
    setSearchProgress("");
  };

  // Find emails for SELECTED companies only
  const handleFindEmails = async () => {
    const sirens = companies.filter(([s]) => selected[s]).map(([s, c]) => ({ siren: s, ...c }));
    if (sirens.length === 0) return;
    setSearching(true);
    for (let i = 0; i < sirens.length; i++) {
      const comp = sirens[i];
      setSearchProgress("Searching " + (i + 1) + "/" + sirens.length + ": " + (comp.company_name || comp.siren) + "...");
      try {
        const result = await findCompanyEmail(comp.siren, comp.company_name || "");
        setEmailResults(prev => ({ ...prev, [comp.siren]: result }));
      } catch (e) {
        setEmailResults(prev => ({ ...prev, [comp.siren]: { error: e.message } }));
      }
    }
    setSearching(false);
    setSearchProgress("");
  };

  return html`
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick=${onBack}
          className="text-blue-600 hover:text-blue-800 text-sm font-medium">
          ${"←"} Back to cells
        </button>
        <span className="text-gray-300">|</span>
        <h2 className="text-xl font-bold text-gray-900">${"📁"} ${cell.name}</h2>
        <span className="text-sm text-gray-400">(${companies.length} compan${companies.length === 1 ? "y" : "ies"})</span>
        ${companies.length > 0 && html`
          <button onClick=${() => handleFindAllEmails()}
            disabled=${searching}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 ml-auto">
            ${searching ? "🔄 " + searchProgress : "🔄 Refresh All Contacts"}
          </button>
        `}
      </div>

      ${html`
        <div className=${"mb-4 flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 transition-all " + (selectedCount > 0 ? "bg-blue-50 border border-blue-200" : "bg-gray-50 border border-gray-200 opacity-50")}>
          <span className=${"text-sm font-medium " + (selectedCount > 0 ? "text-blue-800" : "text-gray-400")}>${selectedCount > 0 ? selectedCount + " selected" : "Select companies"}</span>
          <button onClick=${handleFindEmails}
            disabled=${searching || selectedCount === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-md hover:bg-emerald-700 transition-colors disabled:opacity-50">
            ${searching ? "🔄 " + searchProgress : "📧 Find Email"}
          </button>
          <button onClick=${() => setShowComposer(!showComposer)}
            disabled=${selectedCount === 0}
            className=${"inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50 " + (showComposer ? "bg-purple-700 text-white" : "bg-purple-600 text-white hover:bg-purple-700")}>
            ${"✉️"} Compose Email
          </button>
        </div>
      `}

      ${showComposer && selectedCount > 0 && html`
        <div className="mb-4 bg-white rounded-lg shadow-md border border-purple-200 overflow-hidden">
          <div className="bg-purple-50 px-4 py-3 border-b border-purple-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-purple-800">${"✉️"} Compose Email for ${selectedCount} compan${selectedCount === 1 ? "y" : "ies"}</h3>
            <button onClick=${() => setShowComposer(false)} className="text-gray-400 hover:text-gray-600 text-lg font-bold">${"×"}</button>
          </div>
          <div className="p-4 space-y-3">
            <div className="text-xs text-gray-500 mb-2">
              To: ${companies.filter(([s]) => selected[s]).map(([s, c]) => {
                const ei = emailResults[s];
                const email = ei && ei.email ? ei.email : "no email";
                return (c.company_name || s) + " <" + email + ">";
              }).join(", ")}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
              <input type="text" value=${composerSubject}
                onInput=${(e) => setComposerSubject(e.target.value)}
                placeholder="Email subject..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
              <textarea value=${composerBody}
                onInput=${(e) => setComposerBody(e.target.value)}
                placeholder="Write your email message here..."
                rows="8"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none resize-y" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Attach Images</label>
              <input type="file" accept="image/*" multiple onChange=${handleImageUpload}
                className="text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100" />
              ${composerImages.length > 0 && html`
                <div className="flex flex-wrap gap-2 mt-2">
                  ${composerImages.map((img, idx) => html`
                    <div key=${idx} className="relative group">
                      <img src=${img.data} alt=${img.name} className="h-16 w-16 object-cover rounded border border-gray-200" />
                      <button onClick=${() => removeImage(idx)}
                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center hover:bg-red-600">${"×"}</button>
                      <span className="block text-[9px] text-gray-400 truncate w-16 mt-0.5">${img.name}</span>
                    </div>
                  `)}
                </div>
              `}
            </div>
            <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
              <button onClick=${handleSaveAllDrafts}
                disabled=${savingDraft || !composerSubject.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-md hover:bg-purple-700 transition-colors disabled:opacity-50">
                ${savingDraft ? "Saving..." : "💾 Save Draft for All Selected"}
              </button>
              ${Object.keys(draftSaved).length > 0 && html`
                <span className="text-sm text-green-600 font-medium">${"✓"} Drafts saved!</span>
              `}
            </div>
          </div>
        </div>
      `}

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
                <th className="py-3 px-2 w-10">
                  <input type="checkbox" checked=${allSelected}
                    onChange=${toggleAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                </th>
                <th className="py-3 px-3">Company</th>
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
                const emailInfo = emailResults[siren];
                const hasDraft = drafts[cellId + "_" + siren];
                return html`
                  <tr key=${siren}
                    className=${"border-b border-gray-100 hover:bg-blue-50 transition-colors " + (i % 2 === 0 ? "bg-white" : "bg-gray-50")}>
                    <td className="py-3 px-2 text-center">
                      <input type="checkbox" checked=${!!selected[siren]}
                        onChange=${() => toggleSelect(siren)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <a href=${"#/company/" + siren}
                          className="font-medium text-blue-700 hover:underline"
                          onClick=${(e) => { e.preventDefault(); onNavigate("company", siren); }}>
                          ${comp.company_name || siren}
                        </a>
                        ${emailInfo && !emailInfo.error && html`
                          <span className=${"inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full " +
                            (emailInfo.type === "cfo" ? "bg-emerald-100 text-emerald-800 border border-emerald-300" :
                             emailInfo.type === "director" ? "bg-blue-100 text-blue-800 border border-blue-300" :
                             emailInfo.type === "company_guess" ? "bg-amber-100 text-amber-800 border border-amber-300" :
                             "bg-gray-100 text-gray-700 border border-gray-300")}>
                            ${"📧"} ${emailInfo.type === "cfo" ? "CFO" : emailInfo.type === "director" ? "Director" : "EMAILS"}
                          </span>
                        `}
                        ${emailInfo && emailInfo.error && html`
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-50 text-red-600 border border-red-200">
                            ${"⚠"} Not found
                          </span>
                        `}
                        ${hasDraft && html`
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-purple-100 text-purple-800 border border-purple-300">
                            ${"📝"} Draft
                          </span>
                        `}
                      </div>

                      ${emailInfo && emailInfo.director && html`
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200">
                            ${"👤"} ${emailInfo.director.name}
                            <span className="text-sky-500">— ${emailInfo.director.title}</span>
                          </span>
                        </div>
                      `}
                      ${emailInfo && emailInfo.email && html`
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <a href=${"mailto:" + emailInfo.email}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
                            ${"📧"} ${emailInfo.email}
                          </a>
                          <span className="text-gray-400">(${emailInfo.source || ""})</span>
                        </div>
                      `}
                      ${emailInfo && emailInfo.all_emails && emailInfo.all_emails.length > 1 && html`
                        <div className="mt-0.5 flex flex-wrap gap-1 text-xs">
                          ${emailInfo.all_emails.slice(1, 3).map(e => html`
                            <span key=${e} className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200">
                              ${e}
                            </span>
                          `)}
                        </div>
                      `}

                      ${comp.first_contact && html`
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200">
                            ${"👤"} ${comp.first_contact.first_name} ${comp.first_contact.last_name}
                            ${comp.first_contact.role ? html` <span className="text-sky-500">— ${comp.first_contact.role}</span>` : ""}
                          </span>
                          ${comp.first_contact.email && html`
                            <a href=${"mailto:" + comp.first_contact.email}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
                              ${"📧"} ${comp.first_contact.email}
                            </a>
                          `}
                          ${comp.first_contact.phone && html`
                            <a href=${"tel:" + comp.first_contact.phone}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 font-mono">
                              ${"📱"} ${comp.first_contact.phone}
                            </a>
                          `}
                        </div>
                      `}

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
