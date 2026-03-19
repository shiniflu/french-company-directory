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
            <!-- Admin link (admin only) -->
            ${currentUser.role === "admin" && html`
              <a href="#/admin"
                 className="text-sm text-blue-200 hover:text-white transition-colors"
                 style=${{ textDecoration: "none" }}>
                Admin
              </a>
            `}

            <!-- User badge -->
            <div className="flex items-center gap-2">
              <span className="text-sm text-blue-200">${currentUser.username}</span>
              <span className=${
                currentUser.role === "admin"
                  ? "bg-purple-500 text-white text-xs px-2 py-0.5 rounded-full"
                  : "bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full"
              }>
                ${currentUser.role}
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
  return html`
    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center max-w-lg mx-auto">
      <p className="text-red-600 font-medium mb-1">Error</p>
      <p className="text-red-500 text-sm mb-3">${message}</p>
      ${onRetry && html`
        <button onClick=${onRetry}
                className="px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 transition-colors">
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
