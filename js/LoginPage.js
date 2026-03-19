import { createElement, useState } from "react";
import htm from "htm";
import { login } from "./auth.js?v=8";

const html = htm.bind(createElement);

export function LoginPage({ onLoginSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const user = await login(username, password);
      onLoginSuccess(user);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return html`
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <!-- Header -->
        <div className="text-center mb-8">
          <span className="text-5xl">🏢</span>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">French Company Directory</h1>
          <p className="mt-2 text-gray-500">Sign in to access the platform</p>
        </div>

        <!-- Login card -->
        <div className="bg-white rounded-xl shadow-lg p-8">
          <form onSubmit=${handleSubmit}>
            <!-- Username -->
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                type="text"
                value=${username}
                onInput=${(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                placeholder="Enter your username"
                required
                disabled=${loading}
                autoFocus
              />
            </div>

            <!-- Password -->
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value=${password}
                onInput=${(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                placeholder="Enter your password"
                required
                disabled=${loading}
              />
            </div>

            <!-- Error message -->
            ${error && html`
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 text-sm">${error}</p>
              </div>
            `}

            <!-- Submit -->
            <button
              type="submit"
              disabled=${loading}
              className="w-full py-2.5 px-4 bg-gov-blue text-white font-medium rounded-lg hover:bg-gov-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ${loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Contact your administrator for access credentials
        </p>
      </div>
    </div>
  `;
}
