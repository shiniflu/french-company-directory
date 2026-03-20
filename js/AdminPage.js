import { createElement, useState, useEffect, useCallback } from "react";
import htm from "htm";
import { authFetch } from "./auth.js?v=10";

const html = htm.bind(createElement);

// ── User Management Section ──────────────────────────

function UserManagement({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create user form state
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("manager");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState({ text: "", type: "" });

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authFetch("/api/admin/users");
      if (!res.ok) throw new Error("Failed to load users");
      const data = await res.json();
      setUsers(data.users || []);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setCreateMsg({ text: "", type: "" });
    try {
      const res = await authFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create user");
      setCreateMsg({ text: `User "${newUsername}" created successfully`, type: "success" });
      setNewUsername("");
      setNewPassword("");
      setNewRole("manager");
      fetchUsers();
    } catch (e) {
      setCreateMsg({ text: e.message, type: "error" });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (username) => {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try {
      const res = await authFetch(`/api/admin/users/${encodeURIComponent(username)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete user");
      fetchUsers();
    } catch (e) {
      alert(e.message);
    }
  };

  return html`
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <span>👥</span> User Management
      </h2>

      <!-- User list -->
      ${loading ? html`<p className="text-gray-400 text-sm">Loading users...</p>` : error ? html`
        <p className="text-red-500 text-sm">${error}</p>
      ` : html`
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 font-medium text-gray-600">Username</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">Role</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">Created</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">Created By</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(u => html`
                <tr key=${u.username} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 font-medium">${u.username}</td>
                  <td className="py-2 px-3">
                    <span className=${
                      u.role === "admin"
                        ? "bg-purple-100 text-purple-700 text-xs font-medium px-2 py-0.5 rounded-full"
                        : "bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full"
                    }>
                      ${u.role}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-gray-500">
                    ${u.created_at ? new Date(u.created_at).toLocaleDateString() : "N/A"}
                  </td>
                  <td className="py-2 px-3 text-gray-500">${u.created_by || "N/A"}</td>
                  <td className="py-2 px-3 text-right">
                    ${u.username === currentUser.username
                      ? html`<span className="text-gray-400 text-xs">You</span>`
                      : html`
                        <button
                          onClick=${() => handleDelete(u.username)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium"
                        >
                          Delete
                        </button>
                      `
                    }
                  </td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      `}

      <!-- Create user form -->
      <div className="border-t border-gray-200 pt-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Create New User</h3>
        <form onSubmit=${handleCreate} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs text-gray-500 mb-1">Username</label>
            <input
              type="text"
              value=${newUsername}
              onInput=${(e) => setNewUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="username"
              required
              minLength="3"
              disabled=${creating}
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs text-gray-500 mb-1">Password</label>
            <input
              type="password"
              value=${newPassword}
              onInput=${(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="password"
              required
              minLength="4"
              disabled=${creating}
            />
          </div>
          <div className="min-w-[120px]">
            <label className="block text-xs text-gray-500 mb-1">Role</label>
            <select
              value=${newRole}
              onChange=${(e) => setNewRole(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              disabled=${creating}
            >
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled=${creating}
            className="px-4 py-2 bg-gov-blue text-white text-sm font-medium rounded-lg hover:bg-gov-blue-dark transition-colors disabled:opacity-50"
          >
            ${creating ? "Creating..." : "Create User"}
          </button>
        </form>
        ${createMsg.text && html`
          <p className=${createMsg.type === "success" ? "text-green-600 text-sm mt-2" : "text-red-600 text-sm mt-2"}>
            ${createMsg.text}
          </p>
        `}
      </div>
    </div>
  `;
}

// ── Stats Section ────────────────────────────────────

function UsageStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/admin/stats");
        if (!res.ok) throw new Error("Failed to load stats");
        const data = await res.json();
        setStats(data);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return html`<p className="text-gray-400 text-sm py-6 text-center">Loading statistics...</p>`;
  if (error) return html`<p className="text-red-500 text-sm py-6 text-center">${error}</p>`;
  if (!stats) return null;

  const starDays = Object.entries(stats.stars_by_day || {}).sort((a, b) => b[0].localeCompare(a[0]));
  const lushaUsers = Object.entries(stats.lusha_by_user || {}).sort((a, b) => b[1] - a[1]);
  const kasprUsers = Object.entries(stats.kaspr_by_user || {}).sort((a, b) => b[1] - a[1]);
  const recentActivity = stats.recent_activity || [];

  return html`
    <div className="space-y-6">
      <!-- Stars per day -->
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span>⭐</span> Stars Per Day
        </h2>
        ${starDays.length === 0
          ? html`<p className="text-gray-400 text-sm">No star activity yet</p>`
          : html`
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 font-medium text-gray-600">Date</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600">Stars</th>
                  </tr>
                </thead>
                <tbody>
                  ${starDays.slice(0, 30).map(([day, count]) => html`
                    <tr key=${day} className="border-b border-gray-100">
                      <td className="py-2 px-3">${day}</td>
                      <td className="py-2 px-3 text-right font-medium">${count}</td>
                    </tr>
                  `)}
                </tbody>
              </table>
            </div>
          `
        }
      </div>

      <!-- Lusha credits used -->
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span>📇</span> Lusha Lookups By User
        </h2>
        ${lushaUsers.length === 0
          ? html`<p className="text-gray-400 text-sm">No Lusha lookups yet</p>`
          : html`
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 font-medium text-gray-600">User</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600">Lookups</th>
                  </tr>
                </thead>
                <tbody>
                  ${lushaUsers.map(([user, count]) => html`
                    <tr key=${user} className="border-b border-gray-100">
                      <td className="py-2 px-3">${user}</td>
                      <td className="py-2 px-3 text-right font-medium">${count}</td>
                    </tr>
                  `)}
                </tbody>
              </table>
            </div>
          `
        }
      </div>

      <!-- Kaspr credits used -->
      ${kasprUsers.length > 0 && html`
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span>🔗</span> Kaspr Lookups By User
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-600">User</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">Lookups</th>
                </tr>
              </thead>
              <tbody>
                ${kasprUsers.map(([user, count]) => html`
                  <tr key=${user} className="border-b border-gray-100">
                    <td className="py-2 px-3">${user}</td>
                    <td className="py-2 px-3 text-right font-medium">${count}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
        </div>
      `}

      <!-- Recent Activity -->
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span>📋</span> Recent Activity
        </h2>
        ${recentActivity.length === 0
          ? html`<p className="text-gray-400 text-sm">No activity recorded yet</p>`
          : html`
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 font-medium text-gray-600">Time</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-600">User</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-600">Action</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-600">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  ${recentActivity.map((entry, i) => html`
                    <tr key=${i} className="border-b border-gray-100">
                      <td className="py-2 px-3 text-gray-500 whitespace-nowrap">
                        ${formatActivityTime(entry.ts)}
                      </td>
                      <td className="py-2 px-3 font-medium">${entry.user}</td>
                      <td className="py-2 px-3">
                        <span className=${getActionBadgeClass(entry.action)}>
                          ${entry.action}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-gray-500 truncate max-w-xs">${entry.detail || "-"}</td>
                    </tr>
                  `)}
                </tbody>
              </table>
            </div>
          `
        }
      </div>
    </div>
  `;
}

function formatActivityTime(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
  } catch {
    return ts;
  }
}

function getActionBadgeClass(action) {
  const base = "text-xs font-medium px-2 py-0.5 rounded-full ";
  switch (action) {
    case "login": return base + "bg-green-100 text-green-700";
    case "logout": return base + "bg-gray-100 text-gray-600";
    case "lusha_lookup": return base + "bg-blue-100 text-blue-700";
    case "kaspr_lookup": return base + "bg-indigo-100 text-indigo-700";
    case "star": return base + "bg-yellow-100 text-yellow-700";
    case "unstar": return base + "bg-yellow-50 text-yellow-600";
    case "export":
    case "bulk_export": return base + "bg-orange-100 text-orange-700";
    case "create_user": return base + "bg-purple-100 text-purple-700";
    case "delete_user": return base + "bg-red-100 text-red-700";
    case "cfo_save":
    case "cfo_found": return base + "bg-emerald-100 text-emerald-700";
    case "cfo_delete": return base + "bg-red-100 text-red-700";
    default: return base + "bg-gray-100 text-gray-600";
  }
}

// ── Main Admin Page ──────────────────────────────────

export function AdminPage({ currentUser, onNavigate }) {
  return html`
    <div className="space-y-6">
      <!-- Page header -->
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Manage users and view usage statistics</p>
        </div>
        <button
          onClick=${() => onNavigate("search")}
          className="px-4 py-2 text-sm text-gov-blue border border-gov-blue rounded-lg hover:bg-blue-50 transition-colors"
        >
          Back to Search
        </button>
      </div>

      <!-- User management -->
      <${UserManagement} currentUser=${currentUser} />

      <!-- Stats -->
      <${UsageStats} />
    </div>
  `;
}
