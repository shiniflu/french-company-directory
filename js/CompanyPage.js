import { createElement, useState, useEffect, useRef } from "react";
import htm from "htm";
import { getCompanyBySiren, enrichWithLusha, enrichWithKaspr, logActivity, getCfoContact, saveCfoContact, getFlaggedCompanies, flagCompany, unflagCompany, scrapeWebsiteForCfo, getCells, createCell, addCompaniesToCell } from "./api.js?v=16";
import { formatSiren, formatSiret, formatCurrency, formatDate, getEmployeeLabel,
         getLegalFormLabel, getNafSectionLabel, getLatestFinance,
         CATEGORY_STYLES, exportToCSV, exportToJSON, isInternationalTrade } from "./utils.js?v=12";
import { LoadingSpinner, ErrorMessage, Badge, StatusDot } from "./components.js?v=11";

const html = htm.bind(createElement);

// ── CFO keyword matching ────────────────────────────
const CFO_KEYWORDS = ["financ", "cfo", "trésor", "tresor", "comptab", "daf"];
function isCfoRole(qualite) {
  if (!qualite) return false;
  const lower = qualite.toLowerCase();
  return CFO_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Company Header ──────────────────────────────────
function CompanyHeader({ company }) {
  const catStyle = CATEGORY_STYLES[company.categorie_entreprise];
  return html`
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">${company.nom_complet}</h2>
          ${company.sigle && html`<p className="text-gray-500 text-sm">(${company.sigle})</p>`}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <span className="text-sm text-gray-500 font-mono">SIREN: ${formatSiren(company.siren)}</span>
            ${company.siege && html`
              <span className="text-sm text-gray-500 font-mono">SIRET: ${formatSiret(company.siege.siret)}</span>
            `}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <${StatusDot} active=${company.etat_administratif === "A"} />
          ${catStyle && html`<${Badge} label=${catStyle.label} bg=${catStyle.bg} text=${catStyle.text} />`}
          ${isInternationalTrade(company) && html`
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold uppercase tracking-wide rounded-full bg-amber-100 text-amber-800 border border-amber-300">${"\uD83C\uDF10"} International Trade</span>
          `}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-4 border-t border-gray-100">
        <div>
          <p className="text-xs text-gray-400 uppercase">Legal Form</p>
          <p className="text-sm text-gray-700 mt-0.5">${getLegalFormLabel(company.nature_juridique)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase">Created</p>
          <p className="text-sm text-gray-700 mt-0.5">${formatDate(company.date_creation)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase">Employees</p>
          <p className="text-sm text-gray-700 mt-0.5">${getEmployeeLabel(company.tranche_effectif_salarie)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase">Establishments</p>
          <p className="text-sm text-gray-700 mt-0.5">
            ${company.nombre_etablissements_ouverts || 0} open / ${company.nombre_etablissements || 0} total
          </p>
        </div>
      </div>

      <!-- External Links -->
      <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-gray-100">
        <span className="text-xs text-gray-400 uppercase font-semibold mr-1">Open:</span>
        <a href=${"https://annuaire-entreprises.data.gouv.fr/entreprise/" + company.siren}
           target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 rounded-full hover:bg-blue-100 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838l-3.14 1.346 4.352 1.862a1 1 0 00.788 0l7-3a1 1 0 000-1.838l-7-3.002zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z"/></svg>
          Gov Directory
        </a>
        <a href=${"https://www.societe.com/cgi-bin/search?champs=" + encodeURIComponent(company.siren)}
           target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-purple-700 bg-purple-50 rounded-full hover:bg-purple-100 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4zm3 1h6v4H7V5zm6 6H7v2h6v-2z" clipRule="evenodd"/></svg>
          Societe.com
        </a>
        <a href=${"https://www.pappers.fr/entreprise/" + company.siren}
           target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full hover:bg-emerald-100 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"/></svg>
          Pappers
        </a>
        <a href=${"https://www.google.com/search?q=" + encodeURIComponent(company.nom_complet + " " + (company.siege ? (company.siege.libelle_commune || "") : ""))}
           target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/></svg>
          Google
        </a>
        <a href=${"https://www.linkedin.com/search/results/companies/?keywords=" + encodeURIComponent(company.nom_complet)}
           target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-sky-700 bg-sky-50 rounded-full hover:bg-sky-100 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          LinkedIn
        </a>
      </div>
    </div>
  `;
}

// ── Activity Info Card ──────────────────────────────
function CompanyInfo({ company }) {
  return html`
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-4">Activity</h3>
      <dl className="space-y-3">
        <div>
          <dt className="text-xs text-gray-400">NAF / APE Code</dt>
          <dd className="text-sm text-gray-700">${company.activite_principale || "N/A"}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-400">Industry Sector</dt>
          <dd className="text-sm text-gray-700">${getNafSectionLabel(company.section_activite_principale)}</dd>
        </div>
        ${company.date_fermeture && html`
          <div>
            <dt className="text-xs text-gray-400">Closure Date</dt>
            <dd className="text-sm text-red-600">${formatDate(company.date_fermeture)}</dd>
          </div>
        `}
      </dl>
    </div>
  `;
}

// ── Siege (HQ) Card ─────────────────────────────────
function SiegeCard({ siege }) {
  if (!siege) return null;

  const address = siege.geo_adresse || siege.adresse || "Address not available";
  const hasCoords = siege.latitude && siege.longitude;
  const mapsUrl = hasCoords
    ? "https://www.google.com/maps?q=" + siege.latitude + "," + siege.longitude
    : null;

  return html`
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-4">Headquarters</h3>
      <p className="text-sm text-gray-700">${address}</p>
      <p className="text-sm text-gray-500 mt-1">
        ${siege.code_postal || ""} ${siege.libelle_commune || ""}
      </p>
      ${siege.departement && html`
        <p className="text-xs text-gray-400 mt-1">Dept. ${siege.departement} — ${siege.region || ""}</p>
      `}
      ${mapsUrl && html`
        <a href=${mapsUrl} target="_blank" rel="noopener"
           className="inline-flex items-center gap-1 mt-3 text-sm text-blue-600 hover:text-blue-800">
          View on Google Maps
        </a>
      `}
    </div>
  `;
}

// ── LinkedIn icon SVG (reusable) ────────────────────
function LinkedInIcon({ className }) {
  return html`
    <svg xmlns="http://www.w3.org/2000/svg" className=${className || "h-3.5 w-3.5"} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  `;
}

// ── Contact Info Card (Lusha result) ────────────────
function ContactInfo({ data, error, loading }) {
  if (loading) {
    return html`
      <div className="flex items-center gap-2 py-2 px-3 text-xs text-gray-500">
        <div className="spinner" style=${{ width: "0.9rem", height: "0.9rem", borderWidth: "2px" }}></div>
        Searching contact info...
      </div>
    `;
  }

  if (error) {
    return html`
      <div className="py-2 px-3 text-xs text-red-500">${error}</div>
    `;
  }

  if (!data) return null;

  const emails = data.emails || data.emailAddresses || [];
  const phones = data.phoneNumbers || data.phones || [];
  // Extract LinkedIn URL from Lusha socialNetworks or other fields
  const socialNetworks = data.socialNetworks || data.social || [];
  const linkedinUrl = data.linkedinUrl || data.linkedin_url
    || (Array.isArray(socialNetworks) ? (socialNetworks.find(s => s.type === "linkedin" || s.label === "linkedin") || {}).url : null)
    || (typeof socialNetworks === "object" && !Array.isArray(socialNetworks) ? socialNetworks.linkedin : null)
    || null;

  if (emails.length === 0 && phones.length === 0 && !linkedinUrl) {
    return html`
      <div className="py-2 px-3 text-xs text-gray-400">No contact info found</div>
    `;
  }

  return html`
    <div className="py-2 px-3 bg-blue-50 rounded-md">
      ${emails.length > 0 && html`
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          ${emails.map((e, i) => {
            const addr = e.email || e.value || e;
            const conf = e.confidence || e.emailConfidence || "";
            const etype = e.type || e.emailType || "";
            return html`
              <span key=${"e" + i} className="inline-flex items-center gap-1 text-xs text-gray-700">
                <span className="text-blue-500">@</span>
                <a href=${"mailto:" + addr} className="text-blue-600 hover:underline">${addr}</a>
                ${etype && html`<span className="text-gray-400">(${etype})</span>`}
                ${conf && html`<span className=${"text-xs px-1 rounded " + (conf === "high" ? "bg-green-100 text-green-600" : "bg-yellow-100 text-yellow-600")}>${conf}</span>`}
              </span>
            `;
          })}
        </div>
      `}
      ${phones.length > 0 && html`
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
          ${phones.map((p, i) => {
            const num = p.number || p.internationalNumber || p.localNumber || p;
            const ptype = p.type || p.phoneType || "";
            return html`
              <span key=${"p" + i} className="inline-flex items-center gap-1 text-xs text-gray-700">
                <span className="text-green-500">T</span>
                <a href=${"tel:" + num} className="text-gray-800 hover:underline font-mono">${num}</a>
                ${ptype && html`<span className="text-gray-400">(${ptype})</span>`}
              </span>
            `;
          })}
        </div>
      `}
      ${linkedinUrl && html`
        <div className="flex items-center gap-1 mt-1">
          <a href=${linkedinUrl} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1 text-xs text-sky-700 hover:text-sky-900 hover:underline font-medium">
            <${LinkedInIcon} className="h-3 w-3" />
            LinkedIn Profile
          </a>
        </div>
      `}
    </div>
  `;
}

// ── Contact Cache (localStorage, per-user) ──────────

function getContactCacheKey(username) {
  return username ? "lusha_contact_cache_" + username : "lusha_contact_cache";
}

function getContactCache(username) {
  try { return JSON.parse(localStorage.getItem(getContactCacheKey(username)) || "{}"); }
  catch { return {}; }
}

function getCacheKey(firstName, lastName, company) {
  return [firstName, lastName, company].join("|").toLowerCase();
}

function getCachedContact(firstName, lastName, company, username) {
  const cache = getContactCache(username);
  return cache[getCacheKey(firstName, lastName, company)] || null;
}

function saveCachedContact(firstName, lastName, company, result, username) {
  const cache = getContactCache(username);
  cache[getCacheKey(firstName, lastName, company)] = {
    data: result,
    cachedAt: new Date().toISOString(),
  };
  try { localStorage.setItem(getContactCacheKey(username), JSON.stringify(cache)); }
  catch { /* storage full, ignore */ }
}

// ── Directors List ──────────────────────────────────
function DirectorsList({ dirigeants, companyName, username }) {
  const [showAll, setShowAll] = useState(false);
  const [enrichment, setEnrichment] = useState({});

  if (!dirigeants || dirigeants.length === 0) {
    return html`
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-4">Directors</h3>
        <p className="text-sm text-gray-400">No directors listed</p>
      </div>
    `;
  }

  // On mount, load any cached results for these directors
  useEffect(() => {
    const cached = {};
    dirigeants.forEach((d, i) => {
      if (d.type_dirigeant !== "personne physique") return;
      const firstName = (d.prenoms || "").split(" ")[0];
      const lastName = (d.nom || "").replace(/\s*\(.*?\)\s*/g, "").trim();
      if (!firstName || !lastName) return;
      const entry = getCachedContact(firstName, lastName, companyName || "", username);
      if (entry) {
        cached[i] = { loading: false, data: entry.data, error: null, fromCache: true };
      }
    });
    if (Object.keys(cached).length > 0) {
      setEnrichment(prev => ({ ...prev, ...cached }));
    }
  }, [dirigeants, companyName, username]);

  const handleEnrich = (index, director, forceRefresh) => {
    const firstName = (director.prenoms || "").split(" ")[0];
    // Strip maiden name in parentheses, e.g. "LANGE (CASTILLON)" -> "LANGE"
    const lastName = (director.nom || "").replace(/\s*\(.*?\)\s*/g, "").trim();
    if (!firstName || !lastName) return;

    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      const entry = getCachedContact(firstName, lastName, companyName || "", username);
      if (entry) {
        setEnrichment(prev => ({ ...prev, [index]: { loading: false, data: entry.data, error: null, fromCache: true } }));
        return;
      }
    }

    setEnrichment(prev => ({ ...prev, [index]: { loading: true, data: null, error: null } }));

    enrichWithLusha(firstName, lastName, companyName || "")
      .then(data => {
        // Save to cache (even null = "no data" so we don't re-spend credits)
        saveCachedContact(firstName, lastName, companyName || "", data, username);
        setEnrichment(prev => ({ ...prev, [index]: { loading: false, data, error: null } }));
      })
      .catch(err => {
        setEnrichment(prev => ({ ...prev, [index]: { loading: false, data: null, error: err.message } }));
      });
  };

  const handleKasprEnrich = async (index, director) => {
    const firstName = (director.prenoms || "").split(" ")[0];
    const lastName = (director.nom || "").replace(/\s*\(.*?\)\s*/g, "").trim();
    if (!firstName || !lastName) return;
    const fullName = firstName + " " + lastName;

    setEnrichment(prev => ({ ...prev, [index]: { ...prev[index], kasprLoading: true, kasprError: null } }));

    try {
      // If Lusha already found a LinkedIn URL, use it; otherwise construct a search-based one
      const existing = enrichment[index];
      let linkedin = "";
      if (existing && existing.data) {
        const sn = existing.data.socialNetworks || existing.data.social || [];
        linkedin = existing.data.linkedinUrl || existing.data.linkedin_url
          || (Array.isArray(sn) ? ((sn.find(s => s.type === "linkedin" || s.label === "linkedin")) || {}).url : null)
          || (typeof sn === "object" && !Array.isArray(sn) ? sn.linkedin : null)
          || "";
      }
      if (!linkedin) {
        // Use a LinkedIn search URL as fallback
        linkedin = "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(fullName + " " + (companyName || ""));
      }

      const kasprData = await enrichWithKaspr(fullName, linkedin);

      // Merge Kaspr data with existing data
      const prevData = (existing && existing.data) || {};
      const prevEmails = prevData.emails || prevData.emailAddresses || [];
      const prevPhones = prevData.phoneNumbers || prevData.phones || [];

      const kasprEmails = kasprData.emails || kasprData.emailAddresses || [];
      const kasprPhones = kasprData.phoneNumbers || kasprData.phones || [];

      const merged = {
        ...prevData,
        emails: prevEmails.length > 0 ? prevEmails : kasprEmails,
        phoneNumbers: [...prevPhones, ...kasprPhones],
        source: prevData.source ? prevData.source + "+kaspr" : "kaspr",
      };

      // If Kaspr returned a LinkedIn URL and we didn't have one
      if (!merged.linkedinUrl && kasprData.linkedinUrl) {
        merged.linkedinUrl = kasprData.linkedinUrl;
      }

      saveCachedContact(firstName, lastName, companyName || "", merged, username);
      setEnrichment(prev => ({ ...prev, [index]: { loading: false, kasprLoading: false, data: merged, error: null } }));
    } catch (err) {
      setEnrichment(prev => ({ ...prev, [index]: { ...prev[index], kasprLoading: false, kasprError: err.message } }));
    }
  };

  const displayed = showAll ? dirigeants : dirigeants.slice(0, 8);

  return html`
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-4">
        Directors (${dirigeants.length})
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-400 uppercase">
              <th className="pb-2 pr-3">Name</th>
              <th className="pb-2 pr-3">Role</th>
              <th className="pb-2 pr-3 hidden sm:table-cell">Type</th>
              <th className="pb-2 pr-3">Contact</th>
            </tr>
          </thead>
          <tbody>
            ${displayed.map((d, i) => {
              const isPerson = d.type_dirigeant === "personne physique";
              const enrichState = enrichment[i];
              const hasResult = enrichState && (enrichState.data || enrichState.error);
              // Build LinkedIn search URL for the person
              const directorName = isPerson ? ((d.prenoms || "").split(" ")[0] + " " + (d.nom || "").replace(/\s*\(.*?\)\s*/g, "").trim()).trim() : "";
              const linkedinSearchUrl = isPerson && directorName
                ? "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(directorName + " " + (companyName || ""))
                : null;
              // Check if Lusha returned a direct LinkedIn URL
              const lushaLinkedin = enrichState && enrichState.data
                ? (enrichState.data.linkedinUrl || enrichState.data.linkedin_url
                  || (Array.isArray(enrichState.data.socialNetworks) ? ((enrichState.data.socialNetworks.find(s => s.type === "linkedin" || s.label === "linkedin")) || {}).url : null)
                  || (enrichState.data.socialNetworks && !Array.isArray(enrichState.data.socialNetworks) ? enrichState.data.socialNetworks.linkedin : null)
                  || null)
                : null;
              return html`
                <tr key=${i} className="border-b border-gray-50 align-top">
                  <td className="py-2 pr-3 text-gray-700">
                    <div className="flex items-center gap-2">
                      <span>
                        ${isPerson
                          ? ((d.prenoms || "") + " " + (d.nom || "")).trim()
                          : (d.denomination || "N/A")
                        }
                        ${isPerson && d.annee_de_naissance
                          ? html` <span className="text-xs text-gray-400">(${d.annee_de_naissance})</span>`
                          : null
                        }
                      </span>
                      ${lushaLinkedin && html`
                        <a href=${lushaLinkedin} target="_blank" rel="noopener noreferrer"
                           className="inline-flex items-center text-sky-600 hover:text-sky-800" title="View LinkedIn Profile">
                          <${LinkedInIcon} className="h-4 w-4" />
                        </a>
                      `}
                      ${!lushaLinkedin && linkedinSearchUrl && html`
                        <a href=${linkedinSearchUrl} target="_blank" rel="noopener noreferrer"
                           className="inline-flex items-center text-gray-400 hover:text-sky-600 transition-colors" title="Search on LinkedIn">
                          <${LinkedInIcon} className="h-3.5 w-3.5" />
                        </a>
                      `}
                    </div>
                    ${enrichState && html`
                      <div className="mt-1">
                        <${ContactInfo} loading=${enrichState.loading} data=${enrichState.data} error=${enrichState.error} />
                      </div>
                    `}
                  </td>
                  <td className="py-2 pr-3 text-gray-500 text-xs">${d.qualite || "N/A"}</td>
                  <td className="py-2 pr-3 hidden sm:table-cell">
                    ${isPerson
                      ? html`<${Badge} label="Individual" bg="bg-green-50" text="text-green-700" />`
                      : html`<${Badge} label="Legal Entity" bg="bg-yellow-50" text="text-yellow-700" />`
                    }
                  </td>
                  <td className="py-2 pr-3">
                    ${isPerson && !hasResult && html`
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick=${() => handleEnrich(i, d, false)}
                          disabled=${enrichState && enrichState.loading}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors disabled:opacity-50"
                          title="Find email & phone via Lusha"
                        >
                          <span>@</span> Lusha
                        </button>
                        <button
                          onClick=${() => handleKasprEnrich(i, d)}
                          disabled=${enrichState && (enrichState.loading || enrichState.kasprLoading)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-600 bg-purple-50 rounded hover:bg-purple-100 transition-colors disabled:opacity-50"
                          title="Find email & phone via Kaspr"
                        >
                          <span>K</span> Kaspr
                        </button>
                      </div>
                    `}
                    ${isPerson && hasResult && !enrichState.loading && html`
                      <div className="flex items-center gap-2">
                        ${enrichState.fromCache && html`<span className="text-xs text-gray-300" title="Loaded from cache — no credit spent">cached</span>`}
                        <button
                          onClick=${() => handleEnrich(i, d, true)}
                          className="text-xs text-gray-400 hover:text-blue-500"
                          title="Refresh from Lusha (will spend a credit)"
                        >Refresh</button>
                        ${!(enrichState.kasprLoading) && html`
                          <button
                            onClick=${() => handleKasprEnrich(i, d)}
                            disabled=${enrichState.kasprLoading}
                            className="text-xs text-purple-400 hover:text-purple-600"
                            title="Search via Kaspr (will spend a credit)"
                          >Kaspr</button>
                        `}
                        ${enrichState.kasprLoading && html`
                          <span className="text-xs text-purple-400">Kaspr...</span>
                        `}
                      </div>
                      ${enrichState.kasprError && html`
                        <div className="text-xs text-red-400 mt-0.5">${enrichState.kasprError}</div>
                      `}
                    `}
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
      ${dirigeants.length > 8 && !showAll && html`
        <button onClick=${() => setShowAll(true)}
                className="mt-3 text-sm text-blue-600 hover:text-blue-800">
          Show all directors (${dirigeants.length})
        </button>
      `}
    </div>
  `;
}

// ── CFO Section (server-cached) ─────────────────────
function CfoSection({ siren, companyName, dirigeants, username }) {
  const [cfoData, setCfoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searchStatus, setSearchStatus] = useState("");
  const [error, setError] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [manualFirst, setManualFirst] = useState("");
  const [manualLast, setManualLast] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeResults, setScrapeResults] = useState(null);

  // On mount: check server cache
  useEffect(() => {
    let cancelled = false;
    getCfoContact(siren)
      .then(data => { if (!cancelled) setCfoData(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [siren]);

  // Find directors with CFO-like roles
  const cfoDirectors = (dirigeants || []).filter(d =>
    d.type_dirigeant === "personne physique" && isCfoRole(d.qualite)
  );

  // Core: enrich via Lusha → optionally Kaspr → save server-side
  const enrichAndSave = async (firstName, lastName, title) => {
    setSearching(true);
    setError(null);
    setSearchStatus("Searching via Lusha...");
    try {
      let lushaData = null;
      try {
        lushaData = await enrichWithLusha(firstName, lastName, companyName || "");
      } catch (e) { /* Lusha failed, continue */ }

      let phones = [];
      let emails = [];
      let linkedin = "";
      let source = "lusha";

      if (lushaData) {
        emails = lushaData.emails || lushaData.emailAddresses || [];
        phones = lushaData.phoneNumbers || lushaData.phones || [];
        const sn = lushaData.socialNetworks || lushaData.social || [];
        linkedin = lushaData.linkedinUrl || lushaData.linkedin_url
          || (Array.isArray(sn) ? ((sn.find(s => s.type === "linkedin" || s.label === "linkedin")) || {}).url : null)
          || (typeof sn === "object" && !Array.isArray(sn) ? sn.linkedin : null)
          || "";
      }

      // If LinkedIn found but no mobile → try Kaspr
      const hasMobile = phones.some(p => {
        const pt = (p.type || p.phoneType || "").toLowerCase();
        return pt.includes("mobile") || pt.includes("cell");
      });
      if (linkedin && !hasMobile) {
        setSearchStatus("Searching via Kaspr for mobile...");
        try {
          const kasprData = await enrichWithKaspr(firstName + " " + lastName, linkedin);
          if (kasprData) {
            const kp = kasprData.phoneNumbers || kasprData.phones || [];
            if (kp.length > 0) { phones = [...phones, ...kp]; source = "lusha+kaspr"; }
            if (emails.length === 0) { emails = kasprData.emails || kasprData.emailAddresses || []; }
          }
        } catch (e) { /* Kaspr failed, proceed with Lusha data */ }
      }

      // Save to server
      setSearchStatus("Saving CFO contact...");
      const saved = await saveCfoContact(siren, {
        firstName, lastName, title: title || "CFO",
        phones, emails, linkedin, source,
        company_name: companyName || "",
      });
      setCfoData(saved);
      setShowManual(false);
      logActivity("cfo_found", siren + " " + firstName + " " + lastName);
    } catch (e) {
      setError("Search failed: " + e.message);
    } finally {
      setSearching(false);
      setSearchStatus("");
    }
  };

  // Auto-search: try first CFO-like director
  const handleAutoSearch = async () => {
    for (const d of cfoDirectors) {
      const firstName = (d.prenoms || "").split(" ")[0];
      const lastName = (d.nom || "").replace(/\s*\(.*?\)\s*/g, "").trim();
      if (firstName && lastName) { await enrichAndSave(firstName, lastName, d.qualite); return; }
    }
  };

  const handleManualSearch = () => {
    if (!manualFirst.trim() || !manualLast.trim()) return;
    enrichAndSave(manualFirst.trim(), manualLast.trim(), "CFO");
  };

  // Website scraping for CFO — server auto-guesses URL from company name
  const handleScrapeWebsite = async () => {
    setScraping(true);
    setError(null);
    setScrapeResults(null);
    try {
      // Send company name to server — it will guess domains automatically
      const result = await scrapeWebsiteForCfo("", companyName || "");
      if (result.contacts && result.contacts.length > 0) {
        setScrapeResults(result.contacts);
      } else {
        setScrapeResults([]);
        setError("No CFO/finance contacts found on website. Try LinkedIn search or enter the name manually.");
      }
    } catch (e) {
      setError("Website scan failed: " + e.message);
    } finally {
      setScraping(false);
    }
  };

  // Use a scraped contact → enrich via Lusha/Kaspr
  const handleUseScrapeResult = (contact) => {
    setScrapeResults(null);
    enrichAndSave(contact.first_name, contact.last_name, contact.title);
  };

  const linkedinSearchUrl = "https://www.linkedin.com/search/results/people/?keywords="
    + encodeURIComponent("CFO " + (companyName || ""));

  if (loading) {
    return html`
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-3">💰 CFO Contact</h3>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="spinner" style=${{ width: "0.9rem", height: "0.9rem", borderWidth: "2px" }}></div>
          Checking for saved CFO...
        </div>
      </div>
    `;
  }

  return html`
    <div className="bg-white rounded-lg shadow-sm border border-emerald-200 p-5">
      <h3 className="text-sm font-semibold text-emerald-800 uppercase tracking-wide mb-4">💰 CFO Contact</h3>

      ${cfoData && html`
        <div className="bg-emerald-50 rounded-md p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-gray-900 text-lg">${cfoData.firstName} ${cfoData.lastName}</p>
              <p className="text-xs text-gray-500 mt-0.5">${cfoData.title || "CFO"}</p>
            </div>
            <div className="text-right text-xs text-gray-400">
              <p>Found by <span className="font-medium text-gray-600">${cfoData.found_by}</span></p>
              <p>${cfoData.found_at ? new Date(cfoData.found_at).toLocaleDateString() : ""}</p>
              <p className="text-emerald-600 font-semibold mt-1">✓ Free (cached)</p>
            </div>
          </div>
          ${cfoData.phones && cfoData.phones.length > 0 && html`
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
              ${cfoData.phones.map((p, i) => {
                const num = p.number || p.internationalNumber || p.localNumber || p;
                const pt = p.type || p.phoneType || "";
                return html`
                  <span key=${"p" + i} className="inline-flex items-center gap-1.5 text-sm">
                    <span className="text-green-600 font-bold">📱</span>
                    <a href=${"tel:" + num} className="text-gray-800 hover:underline font-mono font-medium">${num}</a>
                    ${pt && html`<span className="text-gray-400 text-xs">(${pt})</span>`}
                  </span>
                `;
              })}
            </div>
          `}
          ${cfoData.emails && cfoData.emails.length > 0 && html`
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              ${cfoData.emails.map((e, i) => {
                const addr = e.email || e.value || e;
                return html`
                  <span key=${"e" + i} className="inline-flex items-center gap-1 text-sm">
                    <span className="text-blue-500">@</span>
                    <a href=${"mailto:" + addr} className="text-blue-600 hover:underline">${addr}</a>
                  </span>
                `;
              })}
            </div>
          `}
          ${cfoData.linkedin && html`
            <div className="mt-2">
              <a href=${cfoData.linkedin} target="_blank" rel="noopener noreferrer"
                 className="inline-flex items-center gap-1.5 text-sm text-sky-700 hover:text-sky-900 hover:underline font-medium">
                <${LinkedInIcon} className="h-4 w-4" />
                LinkedIn Profile
              </a>
            </div>
          `}
        </div>
      `}

      ${!cfoData && !searching && html`
        <div className="space-y-3">
          ${cfoDirectors.length > 0 && html`
            <div className="bg-blue-50 rounded-md p-3">
              <p className="text-xs text-blue-600 mb-2">
                Found ${cfoDirectors.length} director(s) with finance-related roles:
              </p>
              <ul className="text-sm text-gray-700 space-y-1 mb-3">
                ${cfoDirectors.map((d, i) => html`
                  <li key=${i} className="flex items-center gap-2">
                    <span className="font-medium">${(d.prenoms || "").split(" ")[0]} ${(d.nom || "").replace(/\s*\(.*?\)\s*/g, "").trim()}</span>
                    <span className="text-xs text-gray-400">— ${d.qualite}</span>
                  </li>
                `)}
              </ul>
              <button onClick=${handleAutoSearch}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-md hover:bg-emerald-700 transition-colors">
                🔍 Find CFO Contact
              </button>
            </div>
          `}

          <div className="flex flex-wrap items-center gap-3 ${cfoDirectors.length === 0 ? '' : 'pt-1'}">
            <button onClick=${() => handleScrapeWebsite()}
              disabled=${scraping}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-full hover:bg-amber-100 transition-colors border border-amber-200 disabled:opacity-50">
              ${scraping ? html`<div className="spinner" style=${{ width: "0.7rem", height: "0.7rem", borderWidth: "2px" }}></div>` : "\uD83C\uDF10"}
              ${scraping ? "Scanning website..." : "Scan Company Website"}
            </button>
            <a href=${linkedinSearchUrl} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-sky-700 bg-sky-50 rounded-full hover:bg-sky-100 transition-colors">
              <${LinkedInIcon} className="h-3.5 w-3.5" />
              Search CFO on LinkedIn
            </a>
            <button onClick=${() => setShowManual(!showManual)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
              ✏️ Enter name manually
            </button>
          </div>

          ${scrapeResults && scrapeResults.length > 0 && html`
            <div className="bg-amber-50 rounded-md p-4 border border-amber-200 mt-2">
              <p className="text-xs text-amber-700 mb-2 font-semibold">
                ${"🌐"} Found ${scrapeResults.length} potential CFO contact(s) on website:
              </p>
              <ul className="space-y-2">
                ${scrapeResults.map((c, i) => html`
                  <li key=${i} className="flex items-center justify-between bg-white rounded-md p-2 border border-amber-100">
                    <div>
                      <span className="font-semibold text-sm text-gray-900">${c.full_name}</span>
                      <span className="text-xs text-gray-500 ml-2">— ${c.title}</span>
                      <span className="block text-[10px] text-gray-400 mt-0.5">Found near "${c.keyword_matched}" on ${c.source_url.replace(/https?:\/\//, "").split("/").slice(0, 2).join("/")}</span>
                    </div>
                    <button onClick=${() => handleUseScrapeResult(c)}
                      className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-md hover:bg-emerald-700 transition-colors whitespace-nowrap">
                      ${"📱"} Get Phone & Email
                    </button>
                  </li>
                `)}
              </ul>
            </div>
          `}

          ${scrapeResults && scrapeResults.length === 0 && !error && html`
            <div className="bg-gray-50 rounded-md p-3 border border-gray-200 mt-2">
              <p className="text-xs text-gray-500">
                No CFO contacts found on the website. Try LinkedIn search or enter the name manually.
              </p>
            </div>
          `}

          ${showManual && html`
            <div className="bg-gray-50 rounded-md p-4 border border-gray-200">
              <p className="text-xs text-gray-500 mb-3">
                Enter the CFO's name (found from LinkedIn). The system will search Lusha/Kaspr for their contact info and save it for all users.
              </p>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[120px]">
                  <label className="block text-xs text-gray-500 mb-1">First Name</label>
                  <input type="text" value=${manualFirst} onInput=${(e) => setManualFirst(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    placeholder="Jean" />
                </div>
                <div className="flex-1 min-w-[120px]">
                  <label className="block text-xs text-gray-500 mb-1">Last Name</label>
                  <input type="text" value=${manualLast} onInput=${(e) => setManualLast(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    placeholder="Dupont" />
                </div>
                <button onClick=${handleManualSearch}
                  disabled=${!manualFirst.trim() || !manualLast.trim()}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-md hover:bg-emerald-700 transition-colors disabled:opacity-50">
                  Search & Save
                </button>
              </div>
            </div>
          `}
        </div>
      `}

      ${searching && html`
        <div className="flex items-center gap-2 py-3 text-sm text-gray-500">
          <div className="spinner" style=${{ width: "0.9rem", height: "0.9rem", borderWidth: "2px" }}></div>
          ${searchStatus || "Searching..."}
        </div>
      `}

      ${error && html`
        <div className="mt-3 py-2 px-3 text-xs text-red-500 bg-red-50 rounded-md">${error}</div>
      `}
    </div>
  `;
}

// ── Finances Card ───────────────────────────────────
function FinancesCard({ finances }) {
  if (!finances || typeof finances !== "object" || Object.keys(finances).length === 0) {
    return html`
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-4">Financial Data</h3>
        <p className="text-sm text-gray-400">No financial data available</p>
      </div>
    `;
  }

  const years = Object.keys(finances).sort().reverse();

  return html`
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-4">Financial Data</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-400 uppercase">
              <th className="pb-2 pr-4">Year</th>
              <th className="pb-2 pr-4">Revenue</th>
              <th className="pb-2">Net Income</th>
            </tr>
          </thead>
          <tbody>
            ${years.map(year => {
              const f = finances[year];
              const netClass = f.resultat_net != null
                ? (f.resultat_net >= 0 ? "text-green-600" : "text-red-600")
                : "text-gray-400";
              return html`
                <tr key=${year} className="border-b border-gray-50">
                  <td className="py-2 pr-4 font-medium text-gray-700">${year}</td>
                  <td className="py-2 pr-4 text-gray-600">${f.ca != null ? formatCurrency(f.ca) : "—"}</td>
                  <td className=${netClass + " py-2"}>
                    ${f.resultat_net != null ? formatCurrency(f.resultat_net) : "—"}
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Complements Badges ──────────────────────────────
function ComplementsBadges({ complements }) {
  if (!complements) return null;

  const labels = {
    est_association: "Association",
    est_entrepreneur_individuel: "Sole Proprietor",
    est_ess: "Social Economy (ESS)",
    est_service_public: "Public Service",
    est_societe_mission: "Mission-driven Company",
    est_qualiopi: "Qualiopi Certified",
    est_rge: "RGE Certified",
    est_bio: "Organic Certified",
    est_organisme_formation: "Training Organization",
    est_siae: "Social Inclusion (SIAE)",
  };

  const active = Object.entries(labels)
    .filter(([key]) => complements[key] === true)
    .map(([, label]) => label);

  if (active.length === 0) return null;

  return html`
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-4">Labels & Certifications</h3>
      <div className="flex flex-wrap gap-2">
        ${active.map(label => html`
          <${Badge} key=${label} label=${label} bg="bg-indigo-50" text="text-indigo-700" />
        `)}
      </div>
    </div>
  `;
}

// ── Company Page (main export) ──────────────────────
export function CompanyPage({ siren, onNavigate, currentUser }) {
  const username = currentUser ? currentUser.username : "";
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [starred, setStarred] = useState(false);
  const [starLoading, setStarLoading] = useState(false);
  const [showCellMenu, setShowCellMenu] = useState(false);
  const [cellsList, setCellsList] = useState({});
  const [companyCellNames, setCompanyCellNames] = useState([]);
  const [cellMenuMode, setCellMenuMode] = useState("choose");
  const [newCellName, setNewCellName] = useState("");
  const abortRef = useRef(null);

  // Check if company is starred + load cells
  useEffect(() => {
    getFlaggedCompanies()
      .then(flagged => { setStarred(!!flagged[siren]); })
      .catch(() => {});
    getCells()
      .then(data => {
        setCellsList(data.cells || {});
        const cc = (data.company_cells || {})[siren] || [];
        setCompanyCellNames(cc.map(c => c.cell_name));
      })
      .catch(() => {});
  }, [siren]);

  const handleToggleStar = async () => {
    if (starLoading || !company) return;
    setStarLoading(true);
    try {
      if (starred) {
        await unflagCompany(siren);
        logActivity("unstar", siren);
        setStarred(false);
      } else {
        await flagCompany(siren, {
          company_name: company.nom_complet || "",
          categorie_entreprise: company.categorie_entreprise || "",
          siege_commune: company.siege ? (company.siege.libelle_commune || "") : "",
          siege_code_postal: company.siege ? (company.siege.code_postal || "") : "",
        });
        logActivity("star", siren);
        setStarred(true);
      }
    } catch (err) {
      console.error("Star toggle failed:", err);
    } finally {
      setStarLoading(false);
    }
  };

  const handleAddToCell = async (cellId) => {
    if (!company) return;
    const comp = [{
      siren: company.siren,
      company_name: company.nom_complet || "",
      categorie_entreprise: company.categorie_entreprise || "",
      commune: company.siege ? (company.siege.libelle_commune || "") : "",
      code_postal: company.siege ? (company.siege.code_postal || "") : "",
    }];
    try {
      await addCompaniesToCell(cellId, comp);
      const data = await getCells();
      setCellsList(data.cells || {});
      const cc = (data.company_cells || {})[siren] || [];
      setCompanyCellNames(cc.map(c => c.cell_name));
      setShowCellMenu(false);
    } catch (err) { console.error("Add to cell failed:", err); }
  };

  const handleCreateCellAndAdd = async () => {
    if (!newCellName.trim() || !company) return;
    try {
      const result = await createCell(newCellName.trim());
      setNewCellName("");
      setCellMenuMode("choose");
      await handleAddToCell(result.cell_id);
    } catch (err) { console.error("Create cell failed:", err); }
  };

  const fetchCompany = () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    getCompanyBySiren(siren, controller.signal)
      .then(data => {
        if (!data) {
          setError("No company found with this SIREN.");
        } else {
          setCompany(data);
        }
      })
      .catch(err => {
        if (err.name === "AbortError") return;
        setError(err.message || "An error occurred");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchCompany();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [siren]);

  return html`
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick=${() => onNavigate("search")}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to search
        </button>

        ${!loading && company && html`
          <div className="flex items-center gap-2">
            <button
              onClick=${handleToggleStar}
              disabled=${starLoading}
              className=${"inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border rounded-md transition-colors " + (starred ? "bg-yellow-50 border-yellow-300 text-yellow-700 hover:bg-yellow-100" : "border-gray-300 bg-white hover:bg-gray-50 text-gray-700")}
              title=${starred ? "Remove star" : "Mark as contacted"}
            >
              ${starred ? "\u2605 Contacted" : "\u2606 Mark contacted"}
            </button>
            <div className="relative">
              <button
                onClick=${() => { setShowCellMenu(!showCellMenu); setCellMenuMode("choose"); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-purple-300 rounded-md bg-purple-50 hover:bg-purple-100 text-purple-700 transition-colors"
              >
                ${"📁"} Add to Cell
              </button>
              ${showCellMenu && html`
                <div className="absolute top-full right-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden"
                     onClick=${(e) => e.stopPropagation()}>
                  <div className="p-2 border-b border-gray-100 flex gap-2">
                    <button onClick=${() => setCellMenuMode("choose")}
                      className=${"flex-1 px-2 py-1 text-xs font-medium rounded " + (cellMenuMode === "choose" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
                      Existing
                    </button>
                    <button onClick=${() => setCellMenuMode("create")}
                      className=${"flex-1 px-2 py-1 text-xs font-medium rounded " + (cellMenuMode === "create" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
                      + New
                    </button>
                  </div>
                  ${cellMenuMode === "choose" && html`
                    <div className="max-h-40 overflow-y-auto">
                      ${Object.keys(cellsList).length === 0 && html`
                        <p className="text-xs text-gray-400 p-3 text-center">No cells yet.</p>
                      `}
                      ${Object.entries(cellsList).map(([id, cell]) => html`
                        <button key=${id} onClick=${() => handleAddToCell(id)}
                          className="w-full text-left px-3 py-2 hover:bg-purple-50 border-b border-gray-50 text-sm">
                          ${"📁"} ${cell.name}
                        </button>
                      `)}
                    </div>
                  `}
                  ${cellMenuMode === "create" && html`
                    <div className="p-3">
                      <input type="text" value=${newCellName}
                        onInput=${(e) => setNewCellName(e.target.value)}
                        onKeyDown=${(e) => { if (e.key === "Enter") handleCreateCellAndAdd(); }}
                        placeholder="Cell name"
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-purple-500 outline-none mb-2" />
                      <button onClick=${handleCreateCellAndAdd}
                        disabled=${!newCellName.trim()}
                        className="w-full px-2 py-1.5 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50">
                        Create & Add
                      </button>
                    </div>
                  `}
                </div>
              `}
            </div>
            ${companyCellNames.length > 0 && html`
              <div className="flex flex-wrap gap-1">
                ${companyCellNames.map(name => html`
                  <span key=${name} className="inline-flex items-center gap-0.5 px-2 py-0.5 text-xs font-medium rounded bg-purple-100 text-purple-700 border border-purple-200">
                    ${"📁"} ${name}
                  </span>
                `)}
              </div>
            `}
            <button
              onClick=${() => { exportToCSV(company); logActivity("export", company.siren + " CSV"); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-gray-700 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              CSV
            </button>
            <button
              onClick=${() => { exportToJSON(company); logActivity("export", company.siren + " JSON"); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-gray-700 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              JSON
            </button>
            <button
              onClick=${() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-gray-700 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" />
              </svg>
              Print
            </button>
          </div>
        `}
      </div>

      ${loading && html`<${LoadingSpinner} message="Loading company data..." />`}
      ${error && html`<${ErrorMessage} message=${error} onRetry=${fetchCompany} />`}

      ${!loading && company && html`
        <div>
          <${CompanyHeader} company=${company} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <${CompanyInfo} company=${company} />
            <${SiegeCard} siege=${company.siege} />
          </div>

          <div className="mt-6">
            <${DirectorsList} dirigeants=${company.dirigeants} companyName=${company.nom_complet} username=${username} />
          </div>

          <div className="mt-6">
            <${CfoSection} siren=${company.siren} companyName=${company.nom_complet} dirigeants=${company.dirigeants} username=${username} />
          </div>

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <${FinancesCard} finances=${company.finances} />
            <${ComplementsBadges} complements=${company.complements} />
          </div>
        </div>
      `}
    </div>
  `;
}
