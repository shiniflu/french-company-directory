// ── Auth helper module ──────────────────────────────
// Token management, login/logout, and authenticated fetch wrapper.

const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";

/** Get stored auth token from sessionStorage */
export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

/** Store auth token */
export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

/** Clear auth token and user data */
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

/** Get stored user info { username, role } */
export function getUser() {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Store user info */
export function setUser(user) {
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Fetch wrapper that adds Authorization header.
 * Returns the response object (caller must handle .json() etc).
 */
export async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }
  return fetch(url, { ...options, headers });
}

/**
 * Login with username and password.
 * On success: stores token + user, returns user object.
 * On failure: throws Error with message.
 */
export async function login(username, password) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Login failed");
  }

  setToken(data.token);
  setUser(data.user);
  return data.user;
}

/**
 * Logout: invalidate server token, clear local storage.
 */
export async function logout() {
  const token = getToken();
  if (token) {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token },
      });
    } catch {
      // Ignore network errors during logout
    }
  }
  clearToken();
}

/**
 * Validate current session by calling /api/auth/me.
 * Returns user object if valid, null if expired/invalid.
 */
export async function validateSession() {
  const token = getToken();
  if (!token) return null;

  try {
    const response = await fetch("/api/auth/me", {
      headers: { "Authorization": "Bearer " + token },
    });
    if (!response.ok) {
      clearToken();
      return null;
    }
    const user = await response.json();
    setUser(user);
    return user;
  } catch {
    return null;
  }
}
