import { createElement } from "react";
import htm from "htm";

const html = htm.bind(createElement);

// ── Header ──────────────────────────────────────────
export function Header({ currentUser, onLogout, onNavigate }) {
  return html`
    <header className="bg-gov-blue text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <!-- Left: Logo + title -->
        <a href="#/" className="flex items-center gap-3 no-underline text-white" style=${{ textDecoration: "none", color: "white" }}>
          <span className="text-2xl">🏢</span>
          <div>
            <h1 className="text-lg font-bold leading-tight">French Company Directory</h1>
            <p className="text-xs text-blue-200">Public data on French businesses</p>
          </div>
        </a>

        <!-- Right: User info + actions -->
        ${currentUser && html`
          <div className="flex items-center gap-3">
            <!-- Starred link (all users) -->
            <a href="#/flagged"
               className="text-sm text-blue-200 hover:text-white transition-colors flex items-center gap-1"
               style=${{ textDecoration: "none" }}>
              <span className="text-xs">${"\u2605"}</span> Starred
            </a>

            <!-- Cells link (all users) -->
            <a href="#/cells"
               className="text-sm text-blue-200 hover:text-white transition-colors flex items-center gap-1"
               style=${{ textDecoration: "none" }}>
              <span className="text-xs">${"\uD83D\uDCC1"}</span> Cells
            </a>

            <!-- Admin link (admin only) -->
            ${currentUser.role === "admin" && html`
              <a href="#/admin"
                 className="text-sm text-blue-200 hover:text-white transition-colors"
                 style=${{ textDecoration: "none" }}>
                Admin
              </a>
            `}

            <!-- User badge -->
            <div className="flex items-center gap-1.5">
              <span className=${
                currentUser.role === "admin"
                  ? "bg-purple-500 text-white text-xs px-2 py-0.5 rounded-full"
                  : "bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full"
              }>
                ${currentUser.username}
              </span>
            </div>

            <!-- Logout button -->
            <button
              onClick=${onLogout}
              className="text-sm text-blue-200 hover:text-white transition-colors ml-2"
              title="Sign out"
            >
              Logout
            </button>
          </div>
        `}
      </div>
    </header>
  `;
}

// ── Footer ──────────────────────────────────────────
export function Footer() {
  return html`
    <footer className="bg-gray-800 text-gray-400 text-sm mt-auto">
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row justify-between items-center gap-2">
        <p>Data from the French Company Search API — data.gouv.fr</p>
        <a href="https://recherche-entreprises.api.gouv.fr/docs/"
           target="_blank" rel="noopener"
           className="text-blue-300 hover:text-blue-200">
          API Documentation
        </a>
      </div>
    </footer>
  `;
}

// ── Country Selector ─────────────────────────────────
export const COUNTRIES = [
  { code: "fr", flag: "\uD83C\uDDEB\uD83C\uDDF7", name: "France", active: true },
  { code: "pl", flag: "\uD83C\uDDF5\uD83C\uDDF1", name: "Poland", active: true },
  { code: "gb", flag: "\uD83C\uDDEC\uD83C\uDDE7", name: "UK", active: true },
  { code: "us", flag: "\uD83C\uDDFA\uD83C\uDDF8", name: "USA", active: true },
  { code: "ee", flag: "\uD83C\uDDEA\uD83C\uDDEA", name: "Estonia", active: true },
  { code: "lt", flag: "\uD83C\uDDF1\uD83C\uDDF9", name: "Lithuania", active: true },
  { code: "lv", flag: "\uD83C\uDDF1\uD83C\uDDFB", name: "Latvia", active: true },
  { code: "no", flag: "\uD83C\uDDF3\uD83C\uDDF4", name: "Norway", active: true },
  { code: "dk", flag: "\uD83C\uDDE9\uD83C\uDDF0", name: "Denmark", active: true },
  { code: "fi", flag: "\uD83C\uDDEB\uD83C\uDDEE", name: "Finland", active: true },
  { code: "cz", flag: "\uD83C\uDDE8\uD83C\uDDFF", name: "Czechia", active: true },
  { code: "sk", flag: "\uD83C\uDDF8\uD83C\uDDF0", name: "Slovakia", active: true },
  { code: "be", flag: "\uD83C\uDDE7\uD83C\uDDEA", name: "Belgium", active: true },
  { code: "ie", flag: "\uD83C\uDDEE\uD83C\uDDEA", name: "Ireland", active: true },
  { code: "ua", flag: "\uD83C\uDDFA\uD83C\uDDE6", name: "Ukraine", active: true },
  { code: "ae", flag: "\uD83C\uDDE6\uD83C\uDDEA", name: "UAE", active: true },
  { code: "cy", flag: "\uD83C\uDDE8\uD83C\uDDFE", name: "Cyprus", active: true },
];

export function CountrySelector({ selectedCountry, onSelectCountry }) {
  const current = COUNTRIES.find(c => c.code === selectedCountry) || COUNTRIES[0];
  return html`
    <div className="flex items-center justify-center py-2 bg-gray-100 border-b border-gray-200">
      <div className="relative inline-block">
        <select
          value=${selectedCountry}
          onChange=${(e) => onSelectCountry(e.target.value)}
          className="appearance-none pl-10 pr-8 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none cursor-pointer shadow-sm hover:border-gray-400 transition-colors min-w-[200px]"
        >
          ${COUNTRIES.filter(c => c.active).map(c => html`
            <option key=${c.code} value=${c.code}>${c.flag} ${c.name}</option>
          `)}
        </select>
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg pointer-events-none">${current.flag}</span>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-xs">${"\u25BC"}</span>
      </div>
    </div>
  `;
}

// ── Loading Spinner ─────────────────────────────────
export function LoadingSpinner({ message = "Loading..." }) {
  return html`
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="spinner"></div>
      <p className="text-gray-500 text-sm">${message}</p>
    </div>
  `;
}

// ── Error Message ───────────────────────────────────
export function ErrorMessage({ message, onRetry }) {
  // Split message by URLs and render them as clickable links
  const parts = (message || "").split(/(https?:\/\/[^\s]+)/g);
  return html`
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center max-w-lg mx-auto">
      <p className="text-amber-700 font-medium mb-1">${"ℹ️"} Info</p>
      <p className="text-amber-600 text-sm mb-3 whitespace-pre-line">
        ${parts.map((part, i) =>
          part.match(/^https?:\/\//) ?
            html`<a key=${i} href=${part} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium break-all">${part}</a>` :
            part
        )}
      </p>
      ${onRetry && html`
        <button onClick=${onRetry}
                className="px-4 py-2 bg-amber-600 text-white rounded-md text-sm hover:bg-amber-700 transition-colors">
          Retry
        </button>
      `}
    </div>
  `;
}

// ── Badge ───────────────────────────────────────────
export function Badge({ label, bg = "bg-gray-100", text = "text-gray-700" }) {
  return html`
    <span className="${bg} ${text} text-xs font-medium px-2.5 py-0.5 rounded-full">
      ${label}
    </span>
  `;
}

// ── Status Dot ──────────────────────────────────────
export function StatusDot({ active }) {
  const color = active ? "bg-green-500" : "bg-red-400";
  const label = active ? "Active" : "Closed";
  return html`
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className=${"w-2 h-2 rounded-full " + color}></span>
      ${label}
    </span>
  `;
}

// ── Empty State ─────────────────────────────────────
export function EmptyState({ title, message }) {
  return html`
    <div className="text-center py-12">
      <p className="text-gray-400 text-4xl mb-3">🔍</p>
      <p className="text-gray-600 font-medium">${title}</p>
      <p className="text-gray-400 text-sm mt-1">${message}</p>
    </div>
  `;
}
