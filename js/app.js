import { createElement, useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import htm from "htm";
import { Header, Footer } from "./components.js?v=7";
import { SearchPage } from "./SearchPage.js?v=7";
import { CompanyPage } from "./CompanyPage.js?v=7";
import { LoginPage } from "./LoginPage.js?v=7";
import { AdminPage } from "./AdminPage.js?v=7";
import { getUser, logout, validateSession } from "./auth.js?v=7";

const html = htm.bind(createElement);

function parseHash(hash) {
  const path = hash.replace(/^#\/?/, "");
  if (path.startsWith("company/")) {
    return { page: "company", siren: path.replace("company/", "") };
  }
  if (path === "login") {
    return { page: "login" };
  }
  if (path === "admin") {
    return { page: "admin" };
  }
  return { page: "search" };
}

function useHashRouter() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    const handler = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const navigate = useCallback((page, param) => {
    if (page === "company" && param) {
      window.location.hash = "#/company/" + param;
    } else if (page === "admin") {
      window.location.hash = "#/admin";
    } else if (page === "login") {
      window.location.hash = "#/login";
    } else {
      window.location.hash = "#/";
    }
  }, []);

  return { route, navigate };
}

function App() {
  const { route, navigate } = useHashRouter();
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const searchStateRef = useRef({
    query: "",
    filters: {},
    allResults: null,
    totalResults: 0,
    page: 1,
    sort: "",
  });

  // Validate session on mount
  useEffect(() => {
    (async () => {
      const user = await validateSession();
      if (user) {
        setCurrentUser(user);
      }
      setAuthChecked(true);
    })();
  }, []);

  // Redirect to login if not authenticated (except on login page)
  useEffect(() => {
    if (authChecked && !currentUser && route.page !== "login") {
      navigate("login");
    }
  }, [authChecked, currentUser, route.page, navigate]);

  const handleLoginSuccess = useCallback((user) => {
    setCurrentUser(user);
    navigate("search");
  }, [navigate]);

  const handleLogout = useCallback(async () => {
    await logout();
    setCurrentUser(null);
    navigate("login");
  }, [navigate]);

  // Show nothing until auth check completes
  if (!authChecked) {
    return html`
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="spinner"></div>
      </div>
    `;
  }

  // Login page (no header/footer)
  if (route.page === "login" || !currentUser) {
    return html`<${LoginPage} onLoginSuccess=${handleLoginSuccess} />`;
  }

  // Admin page (admin only)
  if (route.page === "admin") {
    if (currentUser.role !== "admin") {
      return html`
        <div className="min-h-screen flex flex-col bg-gray-50">
          <${Header} currentUser=${currentUser} onLogout=${handleLogout} onNavigate=${navigate} />
          <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
            <div className="text-center py-16">
              <p className="text-4xl mb-4">🔒</p>
              <h2 className="text-xl font-bold text-gray-700 mb-2">Access Denied</h2>
              <p className="text-gray-500">You don't have permission to view this page.</p>
              <button onClick=${() => navigate("search")}
                className="mt-4 px-4 py-2 bg-gov-blue text-white rounded-lg hover:bg-gov-blue-dark transition-colors">
                Go to Search
              </button>
            </div>
          </main>
          <${Footer} />
        </div>
      `;
    }

    return html`
      <div className="min-h-screen flex flex-col bg-gray-50">
        <${Header} currentUser=${currentUser} onLogout=${handleLogout} onNavigate=${navigate} />
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
          <${AdminPage} currentUser=${currentUser} onNavigate=${navigate} />
        </main>
        <${Footer} />
      </div>
    `;
  }

  // Main app (search / company)
  return html`
    <div className="min-h-screen flex flex-col bg-gray-50">
      <${Header} currentUser=${currentUser} onLogout=${handleLogout} onNavigate=${navigate} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        ${route.page === "company"
          ? html`<${CompanyPage} key=${route.siren} siren=${route.siren} onNavigate=${navigate} currentUser=${currentUser} />`
          : html`<${SearchPage} onNavigate=${navigate} searchStateRef=${searchStateRef} currentUser=${currentUser} />`
        }
      </main>
      <${Footer} />
    </div>
  `;
}

const root = createRoot(document.getElementById("root"));
root.render(html`<${App} />`);
