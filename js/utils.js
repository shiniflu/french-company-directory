// Employee range codes to human-readable labels
export const EMPLOYEE_RANGES = {
  "NN": "No employees",
  "00": "0 employees",
  "01": "1-2",
  "02": "3-5",
  "03": "6-9",
  "11": "10-19",
  "12": "20-49",
  "21": "50-99",
  "22": "100-199",
  "31": "200-249",
  "32": "250-499",
  "41": "500-999",
  "42": "1,000-1,999",
  "51": "2,000-4,999",
  "52": "5,000-9,999",
  "53": "10,000+",
};

// Common legal form codes
export const LEGAL_FORMS = {
  "1000": "Sole Proprietor",
  "5499": "SARL (Ltd)",
  "5498": "EURL (Single-member Ltd)",
  "5710": "SAS (Simplified Joint-Stock)",
  "5720": "SASU (Single-member SAS)",
  "5599": "SA (Public Ltd, Board)",
  "5505": "SA (Public Ltd, Executive Board)",
  "5510": "SA (Worker Participation)",
  "5307": "SNC (General Partnership)",
  "6220": "GIE (Economic Interest Group)",
  "6540": "SCI (Property Company)",
  "6599": "Civil Company",
  "9220": "Registered Association",
  "9221": "Registered Association (Social Inclusion)",
  "9230": "Local Law Association",
  "9300": "Foundation",
  "7112": "Municipality",
  "7210": "Department",
  "7225": "Region",
  "7344": "Public Administrative Body",
  "7389": "Public Entity",
};

// NAF section codes
export const NAF_SECTIONS = {
  "A": "Agriculture, Forestry & Fishing",
  "B": "Mining & Quarrying",
  "C": "Manufacturing",
  "D": "Electricity & Gas Supply",
  "E": "Water Supply & Waste Management",
  "F": "Construction",
  "G": "Wholesale & Retail Trade",
  "H": "Transportation & Storage",
  "I": "Accommodation & Food Service",
  "J": "Information & Communication",
  "K": "Financial & Insurance Activities",
  "L": "Real Estate Activities",
  "M": "Scientific & Technical Activities",
  "N": "Administrative & Support Services",
  "O": "Public Administration",
  "P": "Education",
  "Q": "Human Health & Social Work",
  "R": "Arts, Entertainment & Recreation",
  "S": "Other Service Activities",
  "T": "Household Activities",
  "U": "Extraterritorial Activities",
};

// Category labels with colors
export const CATEGORY_STYLES = {
  "PME": { label: "SME", bg: "bg-blue-100", text: "text-blue-800" },
  "ETI": { label: "Mid-cap", bg: "bg-purple-100", text: "text-purple-800" },
  "GE":  { label: "Large",  bg: "bg-orange-100", text: "text-orange-800" },
};

// Employee range options for filter dropdown
export const EMPLOYEE_FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "NN", label: "No employees" },
  { value: "00", label: "0 employees" },
  { value: "01,02,03", label: "1-9 employees" },
  { value: "11,12", label: "10-49 employees" },
  { value: "21,22", label: "50-199 employees" },
  { value: "31,32", label: "200-499 employees" },
  { value: "41,42", label: "500-1,999 employees" },
  { value: "51,52,53", label: "2,000+ employees" },
];

// Industry (NAF section) filter options for dropdown
export const INDUSTRY_FILTER_OPTIONS = [
  { value: "", label: "All industries" },
  { value: "A", label: "A - Agriculture, Forestry & Fishing" },
  { value: "B", label: "B - Mining & Quarrying" },
  { value: "C", label: "C - Manufacturing" },
  { value: "D", label: "D - Electricity & Gas" },
  { value: "E", label: "E - Water & Waste Management" },
  { value: "F", label: "F - Construction" },
  { value: "G", label: "G - Wholesale & Retail Trade" },
  { value: "H", label: "H - Transportation & Storage" },
  { value: "I", label: "I - Accommodation & Food Service" },
  { value: "J", label: "J - Information & Communication" },
  { value: "K", label: "K - Financial & Insurance" },
  { value: "L", label: "L - Real Estate" },
  { value: "M", label: "M - Scientific & Technical" },
  { value: "N", label: "N - Administrative & Support" },
  { value: "O", label: "O - Public Administration" },
  { value: "P", label: "P - Education" },
  { value: "Q", label: "Q - Health & Social Work" },
  { value: "R", label: "R - Arts, Entertainment & Recreation" },
  { value: "S", label: "S - Other Services" },
  { value: "T", label: "T - Household Activities" },
  { value: "U", label: "U - Extraterritorial Activities" },
];

// Financial turnover preset ranges for dropdown
export const TURNOVER_FILTER_OPTIONS = [
  { value: "", label: "All revenue" },
  { value: "0-100000", label: "Under 100K EUR" },
  { value: "100000-500000", label: "100K - 500K EUR" },
  { value: "500000-1000000", label: "500K - 1M EUR" },
  { value: "1000000-10000000", label: "1M - 10M EUR" },
  { value: "10000000-50000000", label: "10M - 50M EUR" },
  { value: "50000000-100000000", label: "50M - 100M EUR" },
  { value: "100000000-1000000000", label: "100M - 1B EUR" },
  { value: "1000000000-", label: "Over 1B EUR" },
];

// Format SIREN: "380129866" -> "380 129 866"
export function formatSiren(siren) {
  if (!siren) return "";
  return siren.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

// Format SIRET: "38012986600010" -> "380 129 866 00010"
export function formatSiret(siret) {
  if (!siret) return "";
  return siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, "$1 $2 $3 $4");
}

// Format currency: 40260000 -> "40 260 000 EUR"
export function formatCurrency(amount) {
  if (amount == null) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Format date: "1991-01-01" -> "Jan 1, 1991"
export function formatDate(dateStr) {
  if (!dateStr) return "N/A";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Get employee label from code
export function getEmployeeLabel(code) {
  if (!code) return "N/A";
  return EMPLOYEE_RANGES[code] || code;
}

// Get legal form label from code
export function getLegalFormLabel(code) {
  if (!code) return "N/A";
  return LEGAL_FORMS[code] || "Code " + code;
}

// Get NAF section label
export function getNafSectionLabel(code) {
  if (!code) return "N/A";
  return NAF_SECTIONS[code] || code;
}

// Get latest finance data from finances object
export function getLatestFinance(finances) {
  if (!finances || typeof finances !== "object") return null;
  const years = Object.keys(finances).sort().reverse();
  if (years.length === 0) return null;
  return { year: years[0], ...finances[years[0]] };
}

// ── Export helpers ───────────────────────────────────

// Build a flat company data object for export
export function buildExportData(company) {
  const latestFin = getLatestFinance(company.finances);
  return {
    siren: company.siren,
    siret_hq: company.siege ? company.siege.siret : "",
    name: company.nom_complet,
    acronym: company.sigle || "",
    legal_form: getLegalFormLabel(company.nature_juridique),
    creation_date: company.date_creation || "",
    status: company.etat_administratif === "A" ? "Active" : "Closed",
    category: company.categorie_entreprise || "",
    employees: getEmployeeLabel(company.tranche_effectif_salarie),
    naf_code: company.activite_principale || "",
    industry: getNafSectionLabel(company.section_activite_principale),
    total_establishments: company.nombre_etablissements || 0,
    open_establishments: company.nombre_etablissements_ouverts || 0,
    hq_address: company.siege ? (company.siege.geo_adresse || company.siege.adresse || "") : "",
    postal_code: company.siege ? (company.siege.code_postal || "") : "",
    city: company.siege ? (company.siege.libelle_commune || "") : "",
    department: company.siege ? (company.siege.departement || "") : "",
    region: company.siege ? (company.siege.region || "") : "",
    latest_revenue: latestFin && latestFin.ca != null ? latestFin.ca : "",
    latest_net_income: latestFin && latestFin.resultat_net != null ? latestFin.resultat_net : "",
    financial_year: latestFin ? latestFin.year : "",
    directors: (company.dirigeants || []).map(d =>
      d.type_dirigeant === "personne physique"
        ? ((d.prenoms || "") + " " + (d.nom || "")).trim() + " (" + (d.qualite || "") + ")"
        : (d.denomination || "") + " (" + (d.qualite || "") + ")"
    ).join(" ; "),
  };
}

// Export company data as CSV
export function exportToCSV(company) {
  const data = buildExportData(company);
  const headers = Object.keys(data);
  const values = Object.values(data).map(v => {
    const str = String(v).replace(/"/g, '""');
    return '"' + str + '"';
  });
  const csv = headers.join(",") + "\n" + values.join(",");
  downloadFile(csv, company.siren + "_company.csv", "text/csv;charset=utf-8;");
}

// Export company data as JSON
export function exportToJSON(company) {
  const data = buildExportData(company);
  // Also include full finances and directors
  data.finances_detail = company.finances || {};
  data.directors_detail = company.dirigeants || [];
  const json = JSON.stringify(data, null, 2);
  downloadFile(json, company.siren + "_company.json", "application/json");
}

// Trigger a file download in the browser
function downloadFile(content, filename, mimeType) {
  const blob = new Blob(["\uFEFF" + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── International Trade detection ────────────────────

const TRADE_KEYWORDS = /\b(import|export|international\s+trade|logistics|wholesale|négoce|négoce international|commerce international)\b/i;

export function isInternationalTrade(company) {
  // 1. Check company name
  const name = company.nom_complet || company.nom_raison_sociale || "";
  if (TRADE_KEYWORDS.test(name)) return true;

  // 2. Check NAF/APE code — codes starting with 46 = wholesale trade
  const naf = (company.activite_principale || "").replace(/\./g, "");
  if (naf.startsWith("46")) return true;

  // Also check siege NAF if different
  const siegeNaf = (company.siege && company.siege.activite_principale || "").replace(/\./g, "");
  if (siegeNaf.startsWith("46")) return true;

  // 3. Check complements flags (if API ever adds them)
  if (company.complements) {
    if (company.complements.est_importateur || company.complements.est_exportateur) return true;
  }

  return false;
}

// ── Star / Bookmark helpers (per-user) ──────────────

function getStarredKey(username) {
  return username ? "starred_companies_" + username : "starred_companies";
}

export function getStarredSirens(username) {
  try {
    return JSON.parse(localStorage.getItem(getStarredKey(username)) || "{}");
  } catch (e) { return {}; }
}

export function isStarred(siren, username) {
  return !!getStarredSirens(username)[siren];
}

export function toggleStar(siren, username) {
  const key = getStarredKey(username);
  const starred = getStarredSirens(username);
  if (starred[siren]) {
    delete starred[siren];
  } else {
    starred[siren] = Date.now();
  }
  localStorage.setItem(key, JSON.stringify(starred));
  return !!starred[siren];
}

export function starMultiple(sirens, username) {
  const key = getStarredKey(username);
  const starred = getStarredSirens(username);
  sirens.forEach(s => {
    if (!starred[s]) starred[s] = Date.now();
  });
  localStorage.setItem(key, JSON.stringify(starred));
}

// ── Bulk export ─────────────────────────────────────

export function bulkExportToCSV(companies) {
  if (!companies || companies.length === 0) return;
  const rows = companies.map(c => buildExportData(c));
  const headers = Object.keys(rows[0]);
  const csvLines = [headers.join(",")];
  rows.forEach(row => {
    csvLines.push(Object.values(row).map(v => {
      const str = String(v).replace(/"/g, '""');
      return '"' + str + '"';
    }).join(","));
  });
  const csv = csvLines.join("\n");
  downloadFile(csv, "companies_export.csv", "text/csv;charset=utf-8;");
}
