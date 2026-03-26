import { getToken } from "./auth.js?v=17";

const BASE_URL = "https://recherche-entreprises.api.gouv.fr";

class ApiError extends Error {
  constructor(message, status, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function apiFetch(endpoint, params = {}, signal) {
  const url = new URL(endpoint, BASE_URL);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });

  const response = await fetch(url.toString(), { signal });

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get("Retry-After") || "2", 10);
    throw new ApiError("Trop de requetes. Veuillez patienter.", 429, retryAfter);
  }

  if (!response.ok) {
    throw new ApiError(`Erreur serveur (${response.status})`, response.status);
  }

  return response.json();
}

/**
 * Search companies
 * @param {Object} params - Search parameters
 * @param {AbortSignal} [signal] - AbortController signal
 */
export async function searchCompanies(params = {}, signal) {
  const { q, code_postal, activite_principale, section_activite_principale,
    categorie_entreprise,
    tranche_effectif_salarie, etat_administratif, ca_min, ca_max,
    page = 1, per_page = 10 } = params;

  return apiFetch("/search", {
    q,
    code_postal,
    activite_principale,
    section_activite_principale,
    categorie_entreprise,
    tranche_effectif_salarie,
    etat_administratif,
    ca_min,
    ca_max,
    page,
    per_page,
    minimal: "true",
    include: "siege,dirigeants,finances,complements",
  }, signal);
}

/**
 * Get a single company by SIREN
 * @param {string} siren - 9-digit SIREN number
 * @param {AbortSignal} [signal] - AbortController signal
 */
export async function getCompanyBySiren(siren, signal) {
  const data = await apiFetch("/search", {
    q: siren,
    per_page: 1,
    minimal: "true",
    include: "siege,dirigeants,finances,complements,matching_etablissements",
  }, signal);

  if (data.results && data.results.length > 0) {
    const company = data.results[0];
    if (company.siren === siren) {
      return company;
    }
  }
  return null;
}

// ── Contact Enrichment (Lusha) ──────────────────────

/**
 * Helper to build auth headers for internal API calls.
 */
function authHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const token = getToken();
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }
  return headers;
}

/**
 * Enrich a director's contact info via Lusha Person API V2.
 * Proxied through /api/lusha to keep API key server-side.
 * @param {string} firstName
 * @param {string} lastName
 * @param {string} companyName
 * @param {AbortSignal} [signal]
 * @returns {Promise<Object>} Lusha person data (emails, phones, etc.)
 */
export async function enrichWithLusha(firstName, lastName, companyName, signal) {
  // Convert UPPERCASE names to Title Case for better Lusha matching
  const toTitleCase = (s) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  const params = new URLSearchParams({
    firstName: toTitleCase(firstName),
    lastName: toTitleCase(lastName),
    companyName: toTitleCase(companyName),
  });
  const url = "/api/lusha?" + params.toString();
  const response = await fetch(url, {
    signal,
    headers: authHeaders(),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Lusha API error (" + response.status + ")");
  }

  // Lusha wraps the result in { contact: { data: {...}, error: {...} } }
  const contact = data.contact || data;
  if (contact.error && contact.error.name === "EMPTY_DATA") {
    return null; // no contact info found
  }
  return contact.data || data;
}

// ── Contact Enrichment (Kaspr) ──────────────────────

/**
 * Enrich a contact via Kaspr API (requires LinkedIn profile URL/ID).
 * Proxied through /api/kaspr to keep API key server-side.
 * @param {string} name - Full name
 * @param {string} linkedinId - LinkedIn profile ID or URL
 * @param {AbortSignal} [signal]
 * @returns {Promise<Object>} Kaspr enriched data
 */
export async function enrichWithKaspr(name, linkedinId, signal) {
  const response = await fetch("/api/kaspr", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name, id: linkedinId }),
    signal,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Kaspr API error (" + response.status + ")");
  }
  return data;
}

// ── CFO Contact (server-side cache) ─────────────────

/**
 * Get cached CFO contact for a company from server.
 * @param {string} siren - 9-digit SIREN
 * @param {AbortSignal} [signal]
 * @returns {Promise<Object|null>} CFO contact data or null if not found
 */
export async function getCfoContact(siren, signal) {
  const response = await fetch("/api/cfo/" + encodeURIComponent(siren), {
    signal,
    headers: authHeaders(),
  });
  if (response.status === 404) return null;
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to fetch CFO contact");
  }
  return data;
}

/**
 * Save CFO contact for a company to server.
 * @param {string} siren - 9-digit SIREN
 * @param {Object} contactData - CFO data to save
 * @param {AbortSignal} [signal]
 * @returns {Promise<Object>} Saved CFO contact
 */
export async function saveCfoContact(siren, contactData, signal) {
  const response = await fetch("/api/cfo/" + encodeURIComponent(siren), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(contactData),
    signal,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to save CFO contact");
  }
  return data;
}

// ── Flagged Companies (server-side shared) ──────────

/**
 * Get all flagged companies from server.
 * @param {AbortSignal} [signal]
 * @returns {Promise<Object>} { siren: { ... }, ... }
 */
export async function getFlaggedCompanies(signal) {
  const response = await fetch("/api/flagged", {
    signal,
    headers: authHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to fetch flagged companies");
  }
  return data.flagged || {};
}

/**
 * Flag a company (shared, server-side).
 * @param {string} siren
 * @param {Object} metadata - { company_name, categorie_entreprise, siege_commune, siege_code_postal }
 * @param {AbortSignal} [signal]
 */
export async function flagCompany(siren, metadata, signal) {
  const response = await fetch("/api/flagged/" + encodeURIComponent(siren), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(metadata),
    signal,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to flag company");
  }
  return data;
}

/**
 * Unflag a company.
 * @param {string} siren
 * @param {AbortSignal} [signal]
 */
export async function unflagCompany(siren, signal) {
  const response = await fetch("/api/flagged/" + encodeURIComponent(siren), {
    method: "DELETE",
    headers: authHeaders(),
    signal,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to unflag company");
  }
  return data;
}

// ── Website CFO Scraper ─────────────────────────────

/**
 * Scrape a company website to find CFO / finance director names.
 * @param {string} website - Company website URL
 * @param {string} companyName - Company name
 * @param {AbortSignal} [signal]
 * @returns {Promise<{contacts: Array, pages_scanned: number}>}
 */
export async function scrapeWebsiteForCfo(website, companyName, signal) {
  const response = await fetch("/api/scrape-cfo", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ website, company_name: companyName }),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Scraping failed");
  return data;
}

// ── Find Company Email ──────────────────────────────

export async function findCompanyEmail(siren, companyName, signal) {
  const response = await fetch("/api/find-email", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ siren, company_name: companyName }),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Email search failed");
  return data;
}

// ── User Stats ──────────────────────────────────────

export async function getUserStats(username, signal) {
  const response = await fetch("/api/admin/users/" + encodeURIComponent(username) + "/stats", {
    signal, headers: authHeaders(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to fetch user stats");
  return data;
}

// ── Activity Logging ────────────────────────────────

/**
 * Log a user activity (star, export, etc.) to the server.
 * Fire-and-forget — does not throw on failure.
 * @param {string} action - Action type (star, unstar, export, bulk_export)
 * @param {string} [detail] - Additional detail
 */
export async function logActivity(action, detail = "") {
  try {
    await fetch("/api/activity", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ action, detail }),
    });
  } catch {
    // Ignore logging failures
  }
}

// ── Cells (Ячейки) ─────────────────────────────────

export async function getCells(signal) {
  const response = await fetch("/api/cells", { signal, headers: authHeaders() });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to fetch cells");
  return data;
}

export async function getCellDetail(cellId, signal) {
  const response = await fetch("/api/cells/" + encodeURIComponent(cellId), { signal, headers: authHeaders() });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to fetch cell");
  return data.cell;
}

export async function createCell(name, signal) {
  const response = await fetch("/api/cells", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name }), signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to create cell");
  return data;
}

export async function addCompaniesToCell(cellId, companies, signal) {
  const response = await fetch("/api/cells/" + encodeURIComponent(cellId) + "/companies", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ companies }), signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to add companies");
  return data;
}

export async function removeCompanyFromCell(cellId, siren, signal) {
  const response = await fetch("/api/cells/" + encodeURIComponent(cellId) + "/companies/" + encodeURIComponent(siren), {
    method: "DELETE", headers: authHeaders(), signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to remove company");
  return data;
}

export async function deleteCell(cellId, signal) {
  const response = await fetch("/api/cells/" + encodeURIComponent(cellId), {
    method: "DELETE", headers: authHeaders(), signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to delete cell");
  return data;
}

export { ApiError };
