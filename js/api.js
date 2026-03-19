import { getToken } from "./auth.js?v=7";

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

export { ApiError };
