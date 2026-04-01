#!/usr/bin/env python3
"""
Custom HTTP server with auth, Lusha & Kaspr API proxy, and activity logging.
Run: python server.py
Then open http://localhost:8080
"""

import http.server
import json
import urllib.request
import urllib.error
import urllib.parse
import os
import ssl
import hashlib
import secrets
import datetime
import threading
import re
import html as html_module

# ── API Keys ─────────────────────────────────────────
LUSHA_API_KEY = "939a946a-f6d8-4617-b020-6b08535ea8f3"
KASPR_API_KEY = "905c7fd6a35148ddbdf066a4ca1e5e82"

PORT = int(os.environ.get("PORT", 8080))
# Data directory: use RENDER_DISK_PATH if available, else /tmp/app-data on Render, else local data/
_render_disk = os.environ.get("RENDER_DISK_PATH", "")
_is_render = os.environ.get("RENDER", "")
REPO_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
if _render_disk and os.path.isdir(_render_disk):
    DATA_DIR = os.path.join(_render_disk, "data")
elif _is_render:
    # Render free tier: use /tmp which is writable (survives within same deploy)
    DATA_DIR = "/tmp/app-data"
else:
    DATA_DIR = REPO_DATA_DIR
os.makedirs(DATA_DIR, exist_ok=True)
# Copy seed data from repo to DATA_DIR if files don't exist yet
if DATA_DIR != REPO_DATA_DIR and os.path.isdir(REPO_DATA_DIR):
    import shutil
    for fname in os.listdir(REPO_DATA_DIR):
        src = os.path.join(REPO_DATA_DIR, fname)
        dst = os.path.join(DATA_DIR, fname)
        if os.path.isfile(src) and not os.path.exists(dst):
            shutil.copy2(src, dst)
            print(f"[INIT] Copied seed data: {fname}")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
ACTIVITY_LOG = os.path.join(DATA_DIR, "activity_log.jsonl")
CFO_CONTACTS_FILE = os.path.join(DATA_DIR, "cfo_contacts.json")
FLAGGED_COMPANIES_FILE = os.path.join(DATA_DIR, "flagged_companies.json")
CELLS_FILE = os.path.join(DATA_DIR, "cells.json")
DRAFTS_FILE = os.path.join(DATA_DIR, "drafts.json")

# ── GitHub-backed persistent storage ─────────────────
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO = "shiniflu/french-company-directory"
GITHUB_SYNC_FILES = ["cells.json", "flagged_companies.json", "cfo_contacts.json", "drafts.json"]

def _github_get_file(filepath):
    """Get file content and SHA from GitHub repo."""
    try:
        url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/data/{filepath}"
        req = urllib.request.Request(url, headers={
            "Authorization": f"token {GITHUB_TOKEN}",
            "Accept": "application/vnd.github.v3+json",
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            import base64
            content = base64.b64decode(data["content"]).decode("utf-8")
            return content, data["sha"]
    except Exception:
        return None, None

def _github_put_file(filepath, content, sha=None):
    """Write file content to GitHub repo."""
    if not GITHUB_TOKEN:
        return False
    try:
        import base64
        url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/data/{filepath}"
        body = {
            "message": f"Auto-save {filepath}",
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "branch": "master",
        }
        if sha:
            body["sha"] = sha
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="PUT", headers={
            "Authorization": f"token {GITHUB_TOKEN}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as e:
        # 409 = SHA conflict, 422 = validation error — caller should retry
        print(f"[GITHUB] HTTP {e.code} saving {filepath}: {e.reason}")
        return False
    except Exception as e:
        print(f"[GITHUB] Failed to save {filepath}: {e}")
        return False

_github_sync_lock = threading.Lock()

def github_sync_save(filepath, content_dict):
    """Save JSON data to local file AND sync to GitHub in background."""
    # Save locally first
    local_path = os.path.join(DATA_DIR, filepath)
    with open(local_path, "w", encoding="utf-8") as f:
        json.dump(content_dict, f, indent=2, ensure_ascii=False)
    # Sync to GitHub in background thread (with lock to avoid SHA conflicts)
    if GITHUB_TOKEN:
        def _sync():
            with _github_sync_lock:
                content_str = json.dumps(content_dict, indent=2, ensure_ascii=False)
                for attempt in range(3):
                    _, sha = _github_get_file(filepath)
                    ok = _github_put_file(filepath, content_str, sha)
                    if ok:
                        print(f"[GITHUB] Synced {filepath}")
                        return
                    import time
                    time.sleep(1)
                print(f"[GITHUB] FAILED to sync {filepath} after 3 attempts")
        threading.Thread(target=_sync, daemon=True).start()

def github_sync_load(filepath):
    """Load JSON data: try GitHub first (if token), fallback to local file."""
    local_path = os.path.join(DATA_DIR, filepath)
    # On startup, if GitHub has newer data, use it
    if GITHUB_TOKEN:
        try:
            content, _ = _github_get_file(filepath)
            if content:
                data = json.loads(content)
                # Also save locally for fast access
                with open(local_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                print(f"[GITHUB] Loaded {filepath} from GitHub")
                return data
        except Exception:
            pass
    # Fallback to local
    if os.path.exists(local_path):
        with open(local_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

# On startup: sync data from GitHub
for _sync_file in GITHUB_SYNC_FILES:
    try:
        github_sync_load(_sync_file)
    except Exception:
        pass

# Allow unverified SSL for proxied requests (some corporate networks)
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

# ── Persistent token store ────────────────────────────
# { token_string: { "username": "...", "role": "...", "created_at": "..." } }
TOKENS_FILE = os.path.join(DATA_DIR, "tokens.json")
tokens_lock = threading.Lock()

def _load_tokens():
    try:
        if os.path.exists(TOKENS_FILE):
            with open(TOKENS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}

def _save_tokens(tokens):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(TOKENS_FILE, "w", encoding="utf-8") as f:
            json.dump(tokens, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

TOKENS = _load_tokens()

# ── User management helpers ──────────────────────────

def load_users():
    """Load users from JSON file."""
    if not os.path.exists(USERS_FILE):
        return {}
    with open(USERS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_users(users):
    """Save users to JSON file."""
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2, ensure_ascii=False)

def load_cfo_contacts():
    """Load CFO contacts — from local file (GitHub-synced on startup)."""
    if not os.path.exists(CFO_CONTACTS_FILE):
        return {}
    with open(CFO_CONTACTS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_cfo_contacts(contacts):
    """Save CFO contacts locally + sync to GitHub."""
    github_sync_save("cfo_contacts.json", contacts)

def load_flagged_companies():
    """Load flagged companies — from local file (GitHub-synced on startup)."""
    if not os.path.exists(FLAGGED_COMPANIES_FILE):
        return {}
    with open(FLAGGED_COMPANIES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_flagged_companies(flagged):
    """Save flagged companies locally + sync to GitHub."""
    github_sync_save("flagged_companies.json", flagged)

def load_cells():
    """Load cells — from local file (GitHub-synced on startup)."""
    if not os.path.exists(CELLS_FILE):
        return {}
    with open(CELLS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_cells(cells):
    """Save cells locally + sync to GitHub."""
    github_sync_save("cells.json", cells)

def load_drafts():
    if not os.path.exists(DRAFTS_FILE):
        return {}
    with open(DRAFTS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_drafts(drafts):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DRAFTS_FILE, "w", encoding="utf-8") as f:
        json.dump(drafts, f, indent=2, ensure_ascii=False)
    github_sync_save("drafts.json", drafts)

def hash_password(password, salt=None):
    """Hash password with SHA-256 + salt. Returns (hash, salt)."""
    if salt is None:
        salt = secrets.token_hex(16)
    h = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return h, salt

def verify_password(password, stored_hash, salt):
    """Verify password against stored hash."""
    h, _ = hash_password(password, salt)
    return h == stored_hash

def generate_token():
    """Generate a secure random token."""
    return secrets.token_hex(32)

def init_default_admin():
    """Create default admin user if no users exist."""
    users = load_users()
    if len(users) == 0:
        pw_hash, salt = hash_password("admin123")
        users["admin"] = {
            "password_hash": pw_hash,
            "salt": salt,
            "role": "admin",
            "created_at": datetime.datetime.now().isoformat(),
            "created_by": "system",
        }
        save_users(users)
        print("Default admin user created (admin / admin123)")

# ── Activity logging ─────────────────────────────────

def log_activity(username, action, detail=""):
    """Append an activity entry to the log file."""
    entry = {
        "ts": datetime.datetime.now().isoformat(),
        "user": username,
        "action": action,
        "detail": detail,
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        with open(ACTIVITY_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass  # Don't crash on logging failure

def read_activity_log(limit=200):
    """Read activity log entries (most recent first)."""
    if not os.path.exists(ACTIVITY_LOG):
        return []
    entries = []
    try:
        with open(ACTIVITY_LOG, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    except Exception:
        pass
    entries.reverse()
    return entries[:limit]

# ── Auth helpers ─────────────────────────────────────

def get_auth_user(handler):
    """Extract and validate auth token from request. Returns user dict or None."""
    auth_header = handler.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    with tokens_lock:
        return TOKENS.get(token)


class AppHandler(http.server.SimpleHTTPRequestHandler):
    """Serves static files + proxies /api/* requests with auth."""

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def end_headers(self):
        """Add no-cache headers for JS files to prevent stale modules."""
        if self.path.endswith(".js") or self.path.endswith(".html"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def translate_path(self, path):
        """Strip query parameters before resolving file path."""
        path = path.split("?")[0].split("#")[0]
        return super().translate_path(path)

    def send_json(self, status, data):
        """Helper to send a JSON response."""
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        """Read and parse JSON request body."""
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return {}
        body = self.rfile.read(content_length)
        return json.loads(body.decode("utf-8"))

    # ── Route dispatch ────────────────────────────────

    def do_GET(self):
        if self.path == "/api/health":
            self.send_json(200, {
                "status": "ok",
                "github_sync": bool(GITHUB_TOKEN),
                "data_dir": DATA_DIR,
                "is_render": bool(os.environ.get("RENDER", "")),
            })
            return
        elif self.path.startswith("/api/search/"):
            self.handle_country_search()
        elif self.path.startswith("/api/lusha"):
            self.handle_lusha()
        elif self.path.startswith("/api/cfo/"):
            self.handle_cfo_get()
        elif self.path == "/api/flagged":
            self.handle_flagged_list()
        elif self.path == "/api/cells":
            self.handle_cells_list()
        elif self.path.startswith("/api/cells/"):
            self.handle_cell_detail()
        elif self.path == "/api/auth/me":
            self.handle_auth_me()
        elif self.path == "/api/admin/users":
            self.handle_admin_list_users()
        elif self.path.startswith("/api/admin/users/") and self.path.endswith("/stats"):
            self.handle_user_stats()
        elif self.path == "/api/admin/stats":
            self.handle_admin_stats()
        elif self.path.startswith("/api/drafts"):
            self.handle_get_drafts()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/kaspr":
            self.handle_kaspr()
        elif self.path.startswith("/api/cfo/"):
            self.handle_cfo_save()
        elif self.path == "/api/scrape-cfo":
            self.handle_scrape_cfo()
        elif self.path == "/api/find-email":
            self.handle_find_email()
        elif self.path.startswith("/api/flagged/"):
            self.handle_flagged_add()
        elif self.path == "/api/cells":
            self.handle_cell_create()
        elif self.path.startswith("/api/cells/") and self.path.endswith("/companies"):
            self.handle_cell_add_companies()
        elif self.path == "/api/auth/login":
            self.handle_auth_login()
        elif self.path == "/api/auth/logout":
            self.handle_auth_logout()
        elif self.path == "/api/admin/users":
            self.handle_admin_create_user()
        elif self.path == "/api/activity":
            self.handle_log_activity()
        elif self.path == "/api/drafts":
            self.handle_save_draft()
        else:
            self.send_error(404)

    def do_DELETE(self):
        if self.path.startswith("/api/admin/users/"):
            self.handle_admin_delete_user()
        elif self.path.startswith("/api/cfo/"):
            self.handle_cfo_delete()
        elif self.path.startswith("/api/flagged/"):
            self.handle_flagged_remove()
        elif self.path.startswith("/api/cells/") and "/companies/" in self.path:
            self.handle_cell_remove_company()
        elif self.path.startswith("/api/cells/"):
            self.handle_cell_delete()
        else:
            self.send_error(404)

    # ── Auth endpoints ────────────────────────────────

    def handle_auth_login(self):
        """POST /api/auth/login { username, password } -> { token, user }"""
        try:
            body = self.read_body()
            username = body.get("username", "").strip()
            password = body.get("password", "")

            if not username or not password:
                self.send_json(400, {"error": "Username and password are required"})
                return

            users = load_users()
            user = users.get(username)
            if not user or not verify_password(password, user["password_hash"], user["salt"]):
                self.send_json(401, {"error": "Invalid username or password"})
                return

            token = generate_token()
            with tokens_lock:
                TOKENS[token] = {
                    "username": username,
                    "role": user["role"],
                    "created_at": datetime.datetime.now().isoformat(),
                }
                _save_tokens(TOKENS)

            log_activity(username, "login")

            self.send_json(200, {
                "token": token,
                "user": {
                    "username": username,
                    "role": user["role"],
                },
            })
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def handle_auth_logout(self):
        """POST /api/auth/logout -> invalidate token"""
        auth_user = get_auth_user(self)
        if auth_user:
            auth_header = self.headers.get("Authorization", "")
            token = auth_header[7:]
            with tokens_lock:
                TOKENS.pop(token, None)
                _save_tokens(TOKENS)
            log_activity(auth_user["username"], "logout")
        self.send_json(200, {"ok": True})

    def handle_auth_me(self):
        """GET /api/auth/me -> current user info"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        self.send_json(200, {
            "username": auth_user["username"],
            "role": auth_user["role"],
        })

    # ── Admin endpoints ───────────────────────────────

    def handle_admin_list_users(self):
        """GET /api/admin/users -> list all users (admin only)"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        if auth_user["role"] != "admin":
            self.send_json(403, {"error": "Admin access required"})
            return

        users = load_users()
        user_list = []
        for uname, udata in users.items():
            user_list.append({
                "username": uname,
                "role": udata["role"],
                "created_at": udata.get("created_at", ""),
                "created_by": udata.get("created_by", ""),
            })
        self.send_json(200, {"users": user_list})

    def handle_admin_create_user(self):
        """POST /api/admin/users { username, password, role } -> create user"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        if auth_user["role"] != "admin":
            self.send_json(403, {"error": "Admin access required"})
            return

        try:
            body = self.read_body()
            username = body.get("username", "").strip().lower()
            password = body.get("password", "")
            role = body.get("role", "manager")

            if not username or not password:
                self.send_json(400, {"error": "Username and password are required"})
                return
            if len(username) < 3:
                self.send_json(400, {"error": "Username must be at least 3 characters"})
                return
            if len(password) < 4:
                self.send_json(400, {"error": "Password must be at least 4 characters"})
                return
            if role not in ("admin", "manager"):
                self.send_json(400, {"error": "Role must be 'admin' or 'manager'"})
                return

            users = load_users()
            if username in users:
                self.send_json(409, {"error": f"User '{username}' already exists"})
                return

            pw_hash, salt = hash_password(password)
            users[username] = {
                "password_hash": pw_hash,
                "salt": salt,
                "role": role,
                "created_at": datetime.datetime.now().isoformat(),
                "created_by": auth_user["username"],
            }
            save_users(users)

            log_activity(auth_user["username"], "create_user", f"{username} ({role})")

            self.send_json(201, {"ok": True, "username": username, "role": role})
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def handle_admin_delete_user(self):
        """DELETE /api/admin/users/<username> -> delete user"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        if auth_user["role"] != "admin":
            self.send_json(403, {"error": "Admin access required"})
            return

        # Extract username from path: /api/admin/users/someuser
        target = self.path.split("/api/admin/users/")[1].strip()
        target = urllib.parse.unquote(target)

        if target == auth_user["username"]:
            self.send_json(400, {"error": "Cannot delete your own account"})
            return

        users = load_users()
        if target not in users:
            self.send_json(404, {"error": f"User '{target}' not found"})
            return

        del users[target]
        save_users(users)

        # Also invalidate any active tokens for this user
        with tokens_lock:
            to_remove = [t for t, u in TOKENS.items() if u["username"] == target]
            for t in to_remove:
                del TOKENS[t]
            _save_tokens(TOKENS)

        log_activity(auth_user["username"], "delete_user", target)

        self.send_json(200, {"ok": True})

    def handle_admin_stats(self):
        """GET /api/admin/stats -> activity statistics (admin only)"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        if auth_user["role"] != "admin":
            self.send_json(403, {"error": "Admin access required"})
            return

        entries = read_activity_log(500)

        # Stars per day
        stars_by_day = {}
        lusha_by_user = {}
        kaspr_by_user = {}
        cfo_by_user = {}

        for e in entries:
            action = e.get("action", "")
            user = e.get("user", "")
            ts = e.get("ts", "")
            day = ts[:10] if len(ts) >= 10 else "unknown"

            if action == "star":
                stars_by_day[day] = stars_by_day.get(day, 0) + 1
            elif action == "lusha_lookup":
                lusha_by_user[user] = lusha_by_user.get(user, 0) + 1
            elif action == "kaspr_lookup":
                kaspr_by_user[user] = kaspr_by_user.get(user, 0) + 1
            elif action == "cfo_save":
                cfo_by_user[user] = cfo_by_user.get(user, 0) + 1

        flagged = load_flagged_companies()
        self.send_json(200, {
            "stars_by_day": stars_by_day,
            "lusha_by_user": lusha_by_user,
            "kaspr_by_user": kaspr_by_user,
            "cfo_by_user": cfo_by_user,
            "flagged_count": len(flagged),
            "recent_activity": entries[:50],
        })

    def handle_user_stats(self):
        """GET /api/admin/users/<username>/stats -> per-user activity statistics"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        if auth_user["role"] != "admin":
            self.send_json(403, {"error": "Admin access required"})
            return

        # Extract username from path
        parts = self.path.split("/")
        target_user = parts[4] if len(parts) > 4 else ""
        if not target_user:
            self.send_json(400, {"error": "Username required"})
            return

        entries = read_activity_log(5000)
        user_entries = [e for e in entries if e.get("user") == target_user]

        # Count by action type
        action_counts = {}
        by_day = {}
        for e in user_entries:
            action = e.get("action", "unknown")
            action_counts[action] = action_counts.get(action, 0) + 1
            day = e.get("ts", "")[:10]
            if day:
                by_day[day] = by_day.get(day, 0) + 1

        self.send_json(200, {
            "username": target_user,
            "total_actions": len(user_entries),
            "action_counts": action_counts,
            "activity_by_day": by_day,
            "recent_activity": user_entries[:100],
        })

    # ── CFO Contact endpoints ──────────────────────────

    def handle_cfo_get(self):
        """GET /api/cfo/<siren> -> return cached CFO contact or 404"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        siren = self.path.split("/api/cfo/")[1].split("?")[0].strip()
        contacts = load_cfo_contacts()
        if siren in contacts:
            self.send_json(200, contacts[siren])
        else:
            self.send_json(404, {"error": "No CFO contact found"})

    def handle_cfo_save(self):
        """POST /api/cfo/<siren> { firstName, lastName, title, phones, emails, linkedin, source, company_name }"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        siren = self.path.split("/api/cfo/")[1].split("?")[0].strip()
        try:
            body = self.read_body()
            first_name = body.get("firstName", "").strip()
            last_name = body.get("lastName", "").strip()
            if not first_name or not last_name:
                self.send_json(400, {"error": "firstName and lastName are required"})
                return
            contacts = load_cfo_contacts()
            contacts[siren] = {
                "firstName": first_name,
                "lastName": last_name,
                "title": body.get("title", "CFO"),
                "phones": body.get("phones", []),
                "emails": body.get("emails", []),
                "linkedin": body.get("linkedin", ""),
                "source": body.get("source", "manual"),
                "found_by": auth_user["username"],
                "found_at": datetime.datetime.now().isoformat(),
                "company_name": body.get("company_name", ""),
            }
            save_cfo_contacts(contacts)
            log_activity(auth_user["username"], "cfo_save",
                         f"{first_name} {last_name} @ {siren}")
            self.send_json(200, contacts[siren])
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def handle_cfo_delete(self):
        """DELETE /api/cfo/<siren> -> remove cached CFO (admin only)"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        if auth_user["role"] != "admin":
            self.send_json(403, {"error": "Admin access required"})
            return
        siren = self.path.split("/api/cfo/")[1].split("?")[0].strip()
        contacts = load_cfo_contacts()
        if siren in contacts:
            del contacts[siren]
            save_cfo_contacts(contacts)
            log_activity(auth_user["username"], "cfo_delete", siren)
        self.send_json(200, {"ok": True})

    # ── Find Company Email endpoint ──────────────────────

    def _extract_emails_from_html(self, html_text):
        """Extract all email addresses from HTML text."""
        # Match email patterns
        email_pattern = re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}')
        found = set(email_pattern.findall(html_text.lower()))
        # Filter out common junk
        junk = {"example.com", "domain.com", "email.com", "test.com", "sample.com",
                "sentry.io", "w3.org", "schema.org", "wixpress.com", "googleapis.com"}
        return [e for e in found if not any(j in e for j in junk)
                and not e.endswith(".png") and not e.endswith(".jpg")
                and not e.endswith(".gif") and not e.endswith(".svg")
                and len(e) < 80]

    def _guess_domains(self, company_name):
        """Generate likely domain names from company name."""
        clean = company_name.lower().strip()
        # Extract abbreviation from parentheses if present e.g. "ELECTRICITE DE FRANCE (EDF)"
        abbrev = ""
        paren_match = re.search(r'\(([^)]+)\)', clean)
        if paren_match:
            abbrev = re.sub(r'[^a-z0-9]', '', paren_match.group(1).lower())
        # Remove parenthetical
        clean = re.sub(r'\s*\(.*?\)\s*', ' ', clean).strip()
        # Remove common French legal suffixes
        for suffix in [" sa", " sas", " sarl", " eurl", " sasu", " sci",
                       " se", " snc", " scop", " sca", " gmbh", " ltd",
                       " inc", " corp", " group", " groupe", " france"]:
            if clean.endswith(suffix):
                clean = clean[:-len(suffix)].strip()
        # Build domain base: remove special chars
        base = re.sub(r'[^a-z0-9\s]', '', clean).strip()
        base_nodash = re.sub(r'\s+', '', base)
        base_dash = re.sub(r'\s+', '-', base)
        # Take first word as a short name (e.g., "bnp" from "bnp paribas")
        # Skip common French articles/prepositions
        skip_words = {"le", "la", "les", "de", "du", "des", "un", "une", "et"}
        words = [w for w in base.split() if w not in skip_words and len(w) >= 2]
        first_word = words[0] if words else ""
        # Build list of candidates, abbreviation first (most likely)
        candidates = []
        if abbrev and len(abbrev) >= 2:
            candidates.append(abbrev)
        # Try first meaningful word only if long enough (avoid "la", "le")
        if first_word and len(first_word) >= 3 and first_word != base_nodash:
            candidates.append(first_word)
        candidates.extend([base_nodash, base_dash])
        # Also try first two words joined (e.g., "laposte" from "la poste")
        all_words = base.split()
        if len(all_words) >= 2:
            two_word = all_words[0] + all_words[1]
            if two_word not in candidates:
                candidates.insert(1, two_word)  # insert early
        # Dedupe
        seen = set()
        domains = []
        for b in candidates:
            if not b or b in seen:
                continue
            seen.add(b)
            domains.extend([f"{b}.fr", f"{b}.com"])
        return domains

    def _scrape_url_for_emails(self, url, timeout=8):
        """Fetch a URL and extract emails from it."""
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "text/html,application/xhtml+xml,*/*",
                "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
            }
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
                html_text = resp.read().decode("utf-8", errors="ignore")
                return self._extract_emails_from_html(html_text)
        except Exception:
            return []

    def handle_find_email(self):
        """
        POST /api/find-email { "siren": "...", "company_name": "..." }
        Chain: 1) Cached CFO → 2) Website scraping (LCEN mentions légales) → 3) Domain pattern guessing → 4) Registry
        """
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return

        try:
            body = self.read_body()
            siren = (body.get("siren") or "").strip()
            company_name = (body.get("company_name") or "").strip()

            if not siren:
                self.send_json(400, {"error": "siren is required"})
                return

            log_activity(auth_user["username"], "find_email", f"{company_name} ({siren})")

            # ── Level 1: Check cached CFO contact ──
            cfo_contacts = load_cfo_contacts()
            if siren in cfo_contacts:
                cfo = cfo_contacts[siren]
                emails = cfo.get("emails", [])
                if emails:
                    email = emails[0].get("email") or emails[0].get("value") or (emails[0] if isinstance(emails[0], str) else "")
                    if email:
                        result = {
                            "email": email,
                            "type": "cfo",
                            "contact_name": f"{cfo.get('firstName', '')} {cfo.get('lastName', '')}".strip(),
                            "source": "cached_cfo",
                        }
                        self._save_email_to_cell(siren, result)
                        self.send_json(200, result)
                        return

            # ── Pre-fetch: Get first director from French registry ──
            first_director = None
            all_dirs = []
            try:
                api_url = f"https://recherche-entreprises.api.gouv.fr/search?q={siren}&per_page=1"
                req = urllib.request.Request(api_url, headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    api_data = json.loads(resp.read().decode("utf-8"))
                    results = api_data.get("results", [])
                    if results:
                        dirigeants = results[0].get("dirigeants", [])
                        cfo_keywords = ["financ", "cfo", "trésor", "tresor", "comptab", "daf",
                                       "directeur général", "directeur general", "président",
                                       "president", "ceo", "chief executive"]
                        for d in dirigeants:
                            if d.get("type_dirigeant") != "personne physique":
                                continue
                            qualite = (d.get("qualite") or "").lower()
                            name_parts = d.get("prenoms", "").split(" ")
                            first = name_parts[0] if name_parts else ""
                            last = re.sub(r'\s*\(.*?\)\s*', '', (d.get("nom") or "")).strip()
                            if first and last:
                                is_cfo = any(kw in qualite for kw in cfo_keywords)
                                all_dirs.append({"name": f"{first} {last}", "title": d.get("qualite", ""),
                                                 "first": first, "last": last, "is_cfo": is_cfo})
                        # Sort: CFO/CEO first
                        all_dirs.sort(key=lambda x: (0 if x["is_cfo"] else 1))
                        if all_dirs:
                            first_director = {"name": all_dirs[0]["name"], "title": all_dirs[0]["title"], "is_cfo": all_dirs[0]["is_cfo"]}
            except Exception:
                pass

            # ── Level 2: Scrape company website (LCEN - mentions légales) ──
            # By French law (LCEN), every company must publish legal info including emails
            domains = self._guess_domains(company_name)
            # Pages most likely to contain contact emails (LCEN compliance)
            lcen_paths = [
                "/mentions-legales", "/mentions_legales", "/legal",
                "/contact", "/contacts", "/nous-contacter",
                "/a-propos", "/about", "/about-us",
                "", "/fr", "/fr/contact", "/fr/mentions-legales",
            ]
            best_emails = []
            found_domain = ""
            for domain in domains[:4]:  # Try up to 4 domain guesses
                if best_emails:
                    break
                for path in lcen_paths:
                    if best_emails:
                        break
                    url = f"https://{domain}{path}"
                    page_emails = self._scrape_url_for_emails(url, timeout=6)
                    if page_emails:
                        best_emails = page_emails
                        found_domain = domain
                        break

            if best_emails:
                # Prioritize: contact@ > info@ > direction@ > finance@ > others
                priority_prefixes = ["contact", "info", "direction", "finance", "daf",
                                     "comptabilite", "accueil", "commercial", "service"]
                best_emails.sort(key=lambda e: next(
                    (i for i, p in enumerate(priority_prefixes) if e.startswith(p + "@")),
                    len(priority_prefixes)
                ))
                result = {
                    "email": best_emails[0],
                    "all_emails": best_emails[:5],
                    "type": "company",
                    "contact_name": company_name,
                    "source": f"website ({found_domain})",
                    "director": first_director,
                }
                self._save_email_to_cell(siren, result)
                self.send_json(200, result)
                return

            # ── Level 3: Try Lusha API for directors (reuse pre-fetched list) ──
            LUSHA_API_KEY = "939a946a-f6d8-4617-b020-6b08535ea8f3"
            lusha_headers = {"api_key": LUSHA_API_KEY, "Accept": "application/json"}
            for d_info in all_dirs[:2]:
                try:
                    lusha_url = f"https://api.lusha.com/v2/person?firstName={urllib.parse.quote(d_info['first'])}&lastName={urllib.parse.quote(d_info['last'])}&company={urllib.parse.quote(company_name)}"
                    lusha_req = urllib.request.Request(lusha_url, headers=lusha_headers)
                    with urllib.request.urlopen(lusha_req, timeout=10, context=ssl_ctx) as lusha_resp:
                        lusha_data = json.loads(lusha_resp.read().decode("utf-8"))
                        emails = lusha_data.get("emailAddresses") or lusha_data.get("emails") or []
                        if emails:
                            email = emails[0].get("email") or emails[0].get("value") or ""
                            if email:
                                ct = "cfo" if d_info["is_cfo"] else "director"
                                result = {"email": email, "type": ct,
                                          "contact_name": f"{d_info['name']} ({d_info['title']})", "source": "lusha",
                                          "director": first_director}
                                self._save_email_to_cell(siren, result)
                                self.send_json(200, result)
                                return
                except Exception:
                    continue

            # ── Level 4: Build email from domain pattern + director name ──
            if not found_domain and domains:
                for d in domains[:2]:
                    test_emails = self._scrape_url_for_emails(f"https://{d}", timeout=4)
                    if test_emails:
                        found_domain = d
                        result = {
                            "email": test_emails[0],
                            "all_emails": test_emails[:5],
                            "type": "company",
                            "contact_name": company_name,
                            "source": f"website ({d})",
                            "director": first_director,
                        }
                        self._save_email_to_cell(siren, result)
                        self.send_json(200, result)
                        return

            # ── Level 5: Construct generic email as last resort ──
            if domains:
                for d in domains[:2]:
                    d_clean = d.replace("www.", "")
                    generic_email = f"contact@{d_clean}"
                    result = {
                        "email": generic_email,
                        "all_emails": [generic_email, f"info@{d_clean}"],
                        "type": "company_guess",
                        "contact_name": company_name,
                        "source": "domain_pattern",
                        "director": first_director,
                    }
                    self._save_email_to_cell(siren, result)
                    self.send_json(200, result)
                    return

            # Nothing found at all
            result = {"error": "No email found", "type": "none", "director": first_director}
            self._save_email_to_cell(siren, result)
            self.send_json(200, result)

        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def _save_email_to_cell(self, siren, email_result):
        """Save email search result to any cell containing this company."""
        try:
            cells = load_cells()
            changed = False
            for cell_id, cell in cells.items():
                if siren in cell.get("companies", {}):
                    cell["companies"][siren]["email_result"] = email_result
                    changed = True
            if changed:
                save_cells(cells)
        except Exception:
            pass

    # ── Flagged Companies endpoints ─────────────────────

    def handle_flagged_list(self):
        """GET /api/flagged -> return all flagged companies (auth required)"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        flagged = load_flagged_companies()
        self.send_json(200, {"flagged": flagged})

    def handle_flagged_add(self):
        """POST /api/flagged/<siren> { company_name, ... } -> flag a company"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        siren = self.path.split("/api/flagged/")[1].split("?")[0].strip()
        try:
            body = self.read_body()
            flagged = load_flagged_companies()
            flagged[siren] = {
                "siren": siren,
                "company_name": body.get("company_name", ""),
                "flagged_by": auth_user["username"],
                "flagged_at": datetime.datetime.now().isoformat(),
                "categorie_entreprise": body.get("categorie_entreprise", ""),
                "siege_commune": body.get("siege_commune", ""),
                "siege_code_postal": body.get("siege_code_postal", ""),
            }
            save_flagged_companies(flagged)
            log_activity(auth_user["username"], "flag_company",
                         f"{body.get('company_name', '')} ({siren})")
            self.send_json(200, flagged[siren])
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def handle_flagged_remove(self):
        """DELETE /api/flagged/<siren> -> unflag a company (any user can unflag)"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        siren = self.path.split("/api/flagged/")[1].split("?")[0].strip()
        flagged = load_flagged_companies()
        company_name = ""
        if siren in flagged:
            company_name = flagged[siren].get("company_name", "")
            del flagged[siren]
            save_flagged_companies(flagged)
        log_activity(auth_user["username"], "unflag_company",
                     f"{company_name} ({siren})")
        self.send_json(200, {"ok": True})

    # ── Cells endpoints ──────────────────────────────

    def handle_cells_list(self):
        """GET /api/cells -> list all cells with company counts"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        cells = load_cells()
        # Build a reverse map: siren -> [cell_id, cell_name]
        company_cells = {}
        for cell_id, cell in cells.items():
            for siren in (cell.get("companies") or {}):
                if siren not in company_cells:
                    company_cells[siren] = []
                company_cells[siren].append({"cell_id": cell_id, "cell_name": cell.get("name", "")})
        self.send_json(200, {"cells": cells, "company_cells": company_cells})

    def handle_cell_detail(self):
        """GET /api/cells/<cell_id> -> get cell details with companies"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        cell_id = self.path.split("/api/cells/")[1].split("?")[0].strip()
        cells = load_cells()
        if cell_id not in cells:
            self.send_json(404, {"error": "Cell not found"})
            return
        self.send_json(200, {"cell": cells[cell_id]})

    def handle_cell_create(self):
        """POST /api/cells { name } -> create a new cell"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        try:
            body = self.read_body()
            name = (body.get("name") or "").strip()
            if not name:
                self.send_json(400, {"error": "Cell name is required"})
                return
            cells = load_cells()
            cell_id = secrets.token_hex(8)
            cells[cell_id] = {
                "name": name,
                "created_by": auth_user["username"],
                "created_at": datetime.datetime.utcnow().isoformat() + "Z",
                "companies": {}
            }
            save_cells(cells)
            log_activity(auth_user["username"], "create_cell", name)
            self.send_json(200, {"ok": True, "cell_id": cell_id, "cell": cells[cell_id]})
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def handle_cell_add_companies(self):
        """POST /api/cells/<cell_id>/companies { companies: [{siren, name, ...}] } -> add companies to cell"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        try:
            cell_id = self.path.split("/api/cells/")[1].split("/companies")[0].strip()
            body = self.read_body()
            companies = body.get("companies", [])
            cells = load_cells()
            if cell_id not in cells:
                self.send_json(404, {"error": "Cell not found"})
                return
            added = 0
            for comp in companies:
                siren = str(comp.get("siren", "")).strip()
                if siren:
                    company_data = {
                        "company_name": comp.get("company_name", ""),
                        "categorie_entreprise": comp.get("categorie_entreprise", ""),
                        "commune": comp.get("commune", ""),
                        "code_postal": comp.get("code_postal", ""),
                        "added_by": auth_user["username"],
                        "added_at": datetime.datetime.utcnow().isoformat() + "Z",
                    }
                    # Auto-find first director contact from French registry
                    try:
                        api_url = f"https://recherche-entreprises.api.gouv.fr/search?q={siren}&per_page=1"
                        req = urllib.request.Request(api_url, headers={"Accept": "application/json"})
                        with urllib.request.urlopen(req, timeout=8) as resp:
                            api_data = json.loads(resp.read().decode("utf-8"))
                            results = api_data.get("results", [])
                            if results:
                                dirigeants = results[0].get("dirigeants", [])
                                # Find first individual director
                                for d in dirigeants:
                                    if d.get("type_dirigeant") != "personne physique":
                                        continue
                                    prenoms = d.get("prenoms", "")
                                    nom = re.sub(r'\s*\(.*?\)\s*', '', d.get("nom", "")).strip()
                                    first = prenoms.split(" ")[0] if prenoms else ""
                                    qualite = d.get("qualite", "")
                                    if first and nom:
                                        company_data["first_contact"] = {
                                            "first_name": first,
                                            "last_name": nom,
                                            "role": qualite,
                                        }
                                        # Try Lusha for this director's email/phone
                                        try:
                                            lusha_url = f"https://api.lusha.com/v2/person?firstName={urllib.parse.quote(first)}&lastName={urllib.parse.quote(nom)}&company={urllib.parse.quote(comp.get('company_name', ''))}"
                                            lusha_req = urllib.request.Request(lusha_url, headers={"api_key": LUSHA_API_KEY, "Accept": "application/json"})
                                            with urllib.request.urlopen(lusha_req, timeout=8, context=ssl_ctx) as lusha_resp:
                                                lusha_data = json.loads(lusha_resp.read().decode("utf-8"))
                                                emails = lusha_data.get("emailAddresses") or lusha_data.get("emails") or []
                                                phones = lusha_data.get("phoneNumbers") or lusha_data.get("phones") or []
                                                if emails:
                                                    e = emails[0]
                                                    company_data["first_contact"]["email"] = e.get("email") or e.get("value") or (e if isinstance(e, str) else "")
                                                if phones:
                                                    p = phones[0]
                                                    company_data["first_contact"]["phone"] = p.get("internationalNumber") or p.get("number") or p.get("localNumber") or (p if isinstance(p, str) else "")
                                                company_data["first_contact"]["source"] = "lusha"
                                        except Exception:
                                            company_data["first_contact"]["source"] = "registry"
                                        break  # only first director
                    except Exception:
                        pass

                    cells[cell_id]["companies"][siren] = company_data
                    added += 1
            save_cells(cells)
            log_activity(auth_user["username"], "add_to_cell",
                         f"{added} companies -> {cells[cell_id]['name']}")
            self.send_json(200, {"ok": True, "added": added})
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def handle_cell_remove_company(self):
        """DELETE /api/cells/<cell_id>/companies/<siren> -> remove company from cell"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        try:
            parts = self.path.split("/api/cells/")[1]
            cell_id = parts.split("/companies/")[0].strip()
            siren = parts.split("/companies/")[1].split("?")[0].strip()
            cells = load_cells()
            if cell_id not in cells:
                self.send_json(404, {"error": "Cell not found"})
                return
            company_name = ""
            if siren in cells[cell_id]["companies"]:
                company_name = cells[cell_id]["companies"][siren].get("company_name", "")
                del cells[cell_id]["companies"][siren]
                save_cells(cells)
            log_activity(auth_user["username"], "remove_from_cell",
                         f"{company_name} ({siren}) from {cells[cell_id]['name']}")
            self.send_json(200, {"ok": True})
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    def handle_cell_delete(self):
        """DELETE /api/cells/<cell_id> -> delete entire cell"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        try:
            cell_id = self.path.split("/api/cells/")[1].split("?")[0].strip()
            cells = load_cells()
            cell_name = ""
            if cell_id in cells:
                cell_name = cells[cell_id].get("name", "")
                del cells[cell_id]
                save_cells(cells)
            log_activity(auth_user["username"], "delete_cell", cell_name)
            self.send_json(200, {"ok": True})
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    # ── Email Drafts endpoints ─────────────────────────

    def handle_get_drafts(self):
        """GET /api/drafts?cell_id=xxx -> get drafts + recently deleted"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        cell_id = params.get("cell_id", [""])[0]
        data = load_drafts()
        drafts = data.get("drafts", {})
        deleted = data.get("deleted", {})
        # Auto-clean deleted older than 7 days
        now = datetime.datetime.now(datetime.timezone.utc)
        cleaned = {}
        for k, v in deleted.items():
            deleted_at = v.get("deleted_at", "")
            try:
                dt = datetime.datetime.fromisoformat(deleted_at.replace("Z", "+00:00"))
                if (now - dt).days < 7:
                    cleaned[k] = v
            except Exception:
                pass
        if len(cleaned) != len(deleted):
            data["deleted"] = cleaned
            save_drafts(data)
            deleted = cleaned
        if cell_id:
            drafts = {k: v for k, v in drafts.items() if v.get("cell_id") == cell_id}
            deleted = {k: v for k, v in deleted.items() if v.get("cell_id") == cell_id}
        self.send_json(200, {"drafts": drafts, "deleted": deleted})

    def handle_save_draft(self):
        """POST /api/drafts { action, ... } -> save/delete/restore draft"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        try:
            body = self.read_body()
            action = body.get("action", "save")
            data = load_drafts()
            if "drafts" not in data:
                data["drafts"] = {}
            if "deleted" not in data:
                data["deleted"] = {}

            if action == "save":
                draft_id = body.get("draft_id") or secrets.token_hex(8)
                data["drafts"][draft_id] = {
                    "draft_id": draft_id,
                    "cell_id": body.get("cell_id", ""),
                    "subject": body.get("subject", ""),
                    "body": body.get("body", ""),
                    "images": body.get("images", []),
                    "recipients": body.get("recipients", []),
                    "saved_by": auth_user["username"],
                    "saved_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                }
                save_drafts(data)
                log_activity(auth_user["username"], "save_draft", body.get("subject", ""))
                self.send_json(200, {"ok": True, "draft_id": draft_id, "draft": data["drafts"][draft_id]})

            elif action == "delete":
                draft_id = body.get("draft_id", "")
                if draft_id in data["drafts"]:
                    draft = data["drafts"].pop(draft_id)
                    draft["deleted_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    draft["deleted_by"] = auth_user["username"]
                    data["deleted"][draft_id] = draft
                    save_drafts(data)
                    log_activity(auth_user["username"], "delete_draft", draft.get("subject", ""))
                self.send_json(200, {"ok": True})

            elif action == "restore":
                draft_id = body.get("draft_id", "")
                if draft_id in data["deleted"]:
                    draft = data["deleted"].pop(draft_id)
                    del draft["deleted_at"]
                    del draft["deleted_by"]
                    data["drafts"][draft_id] = draft
                    save_drafts(data)
                self.send_json(200, {"ok": True})

            elif action == "permanent_delete":
                draft_id = body.get("draft_id", "")
                if draft_id in data["deleted"]:
                    del data["deleted"][draft_id]
                    save_drafts(data)
                self.send_json(200, {"ok": True})

            else:
                self.send_json(400, {"error": "Unknown action"})

        except Exception as e:
            self.send_json(500, {"error": str(e)})

    # ── Activity logging endpoint ─────────────────────

    def handle_log_activity(self):
        """POST /api/activity { action, detail } -> log user activity"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return
        try:
            body = self.read_body()
            action = body.get("action", "")
            detail = body.get("detail", "")
            if action:
                log_activity(auth_user["username"], action, detail)
            self.send_json(200, {"ok": True})
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    # ── Multi-Country Company Search ─────────────────

    def handle_country_search(self):
        """GET /api/search/<country>?q=...&page=1&per_page=10"""
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return

        parts = self.path.split("?")[0].split("/")
        country = parts[3] if len(parts) > 3 else ""
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        q = params.get("q", [""])[0]
        page = int(params.get("page", ["1"])[0])
        per_page = int(params.get("per_page", ["10"])[0])

        try:
            if country == "pl":
                krs_num = q.strip().replace(" ", "")
                is_krs = krs_num.isdigit() and len(krs_num) <= 10

                # If NOT a KRS number, scrape the web search
                if not is_krs:
                    # Poland doesn't have a free name search API
                    # Try multiple KRS numbers for well-known companies matching the query
                    well_known = {
                        "orlen": [("0000028860", "ORLEN S.A."), ("0000925498", "ORLEN PALIWA SP. Z O.O.")],
                        "pkp": [("0000019193", "PKP S.A."), ("0000036592", "PKP CARGO S.A.")],
                        "pko": [("0000026438", "PKO BANK POLSKI S.A.")],
                        "pzn": [("0000014229", "PZU S.A.")],
                        "pzu": [("0000014229", "PZU S.A.")],
                        "kghm": [("0000023302", "KGHM POLSKA MIEDZ S.A.")],
                        "lotos": [("0000106150", "GRUPA LOTOS S.A.")],
                        "allegro": [("0000635012", "ALLEGRO.EU S.A.")],
                        "biedronka": [("0000148471", "JERONIMO MARTINS POLSKA S.A.")],
                        "zabka": [("0000636700", "ZABKA POLSKA S.A.")],
                        "play": [("0000298918", "P4 SP. Z O.O. (PLAY)")],
                        "orange": [("0000010681", "ORANGE POLSKA S.A.")],
                        "mbank": [("0000025237", "MBANK S.A.")],
                        "ing": [("0000010674", "ING BANK SLASKI S.A.")],
                        "cdp": [("0000404077", "CD PROJEKT S.A.")],
                        "cd projekt": [("0000404077", "CD PROJEKT S.A.")],
                    }
                    q_lower = q.lower().strip()
                    matched_krs = []
                    for key, companies in well_known.items():
                        if key in q_lower or q_lower in key:
                            matched_krs.extend(companies)

                    results = []
                    for krs, fallback_name in matched_krs[:5]:
                        try:
                            krs_url = f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}"
                            krs_req = urllib.request.Request(krs_url, headers={"Accept": "application/json"})
                            with urllib.request.urlopen(krs_req, timeout=10) as kresp:
                                kdata = json.loads(kresp.read().decode("utf-8"))
                                odpis = kdata.get("odpis", {})
                                dane = odpis.get("dane", {}).get("dzial1", {})
                                podmiot = dane.get("danePodmiotu", {})
                                adres = dane.get("siedzibaIAdres", {}).get("adres", {})
                                naglowek = odpis.get("naglowekA", odpis.get("naglowekP", {}))
                                results.append({
                                    "nom_complet": podmiot.get("nazwa", fallback_name),
                                    "siren": naglowek.get("numerKRS", krs),
                                    "siege": {"libelle_commune": adres.get("miejscowosc", ""), "code_postal": adres.get("kodPocztowy", "")},
                                    "categorie_entreprise": podmiot.get("formaPrawna", ""),
                                    "dirigeants": [],
                                })
                        except Exception:
                            results.append({
                                "nom_complet": fallback_name, "siren": krs,
                                "siege": {"libelle_commune": "Poland", "code_postal": ""},
                                "categorie_entreprise": "", "dirigeants": [],
                            })

                    if results:
                        self.send_json(200, {"results": results, "total_results": len(results), "page": 1, "total_pages": 1})
                        return

                    # Fallback to GLEIF for Poland
                    browse_defaults_pl = {"orlen", "company", "polska", "spolka", "bank"}
                    if q.lower().strip() in browse_defaults_pl or not q.strip():
                        gleif_url = f"https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalAddress.country%5D=PL&filter%5Bentity.status%5D=ACTIVE&page%5Bsize%5D={per_page}&page%5Bnumber%5D={page}"
                    else:
                        gleif_url = f"https://api.gleif.org/api/v1/lei-records?filter%5Bfulltext%5D={urllib.parse.quote(q)}&filter%5Bentity.legalAddress.country%5D=PL&page%5Bsize%5D={per_page}&page%5Bnumber%5D={page}"
                    try:
                        greq = urllib.request.Request(gleif_url, headers={"Accept": "application/json"})
                        with urllib.request.urlopen(greq, timeout=15) as gresp:
                            gdata = json.loads(gresp.read().decode("utf-8"))
                            grecords = gdata.get("data", [])
                            results = []
                            for r in grecords:
                                attrs = r.get("attributes", {})
                                entity = attrs.get("entity", {})
                                addr = entity.get("legalAddress", {})
                                results.append({
                                    "nom_complet": entity.get("legalName", {}).get("name", ""),
                                    "siren": entity.get("registeredAs", "") or attrs.get("lei", ""),
                                    "siege": {"libelle_commune": addr.get("city", ""), "code_postal": addr.get("postalCode", "")},
                                    "categorie_entreprise": entity.get("legalForm", {}).get("id", "") if entity.get("legalForm") else "",
                                    "dirigeants": [],
                                    "etat_administratif": "A",
                                })
                            total = gdata.get("meta", {}).get("pagination", {}).get("total", len(results))
                            total_pages = gdata.get("meta", {}).get("pagination", {}).get("lastPage", 1)
                            self.send_json(200, {"results": results, "total_results": total, "page": page, "total_pages": total_pages})
                            return
                    except Exception:
                        pass

                    self.send_json(200, {
                        "results": [], "total_results": 0, "page": 1, "total_pages": 0,
                        "note": f"No results for '{q}'. Try a KRS number or search at:",
                        "search_url": f"https://prs.ms.gov.pl/krs/wyszukiwanie?t:nazwaPodmiotu={urllib.parse.quote(q)}",
                    })
                    return

                # KRS number lookup
                krs_num = krs_num.zfill(10)
                url = f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs_num}"
                req = urllib.request.Request(url, headers={"Accept": "application/json"})
                try:
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                        results = []
                        odpis = data.get("odpis", {})
                        dane = odpis.get("dane", {})
                        dzial1 = dane.get("dzial1", {})
                        podmiot = dzial1.get("danePodmiotu", {})
                        siedziba = dzial1.get("siedzibaIAdres", {})
                        adres = siedziba.get("adres", {})
                        naglowek = odpis.get("naglowekA", odpis.get("naglowekP", {}))

                        # Extract directors from dzial2
                        dirigeants = []
                        dzial2 = dane.get("dzial2", {})
                        for key in ["organReprezentacji", "wspolnicy", "prokurenci"]:
                            organ = dzial2.get(key, {})
                            if isinstance(organ, dict):
                                sklad = organ.get("sklad", [])
                                for person in sklad:
                                    if isinstance(person, dict):
                                        fn = person.get("imiona", "")
                                        ln = person.get("nazwisko", "")
                                        func = person.get("funkcjaWOrganie", "")
                                        if fn and ln:
                                            dirigeants.append({
                                                "type_dirigeant": "personne physique",
                                                "prenoms": fn, "nom": ln,
                                                "qualite": func,
                                            })

                        nazwa = podmiot.get("nazwa", naglowek.get("nazwa", q))
                        results.append({
                            "nom_complet": nazwa,
                            "siren": naglowek.get("numerKRS", krs_num),
                            "siege": {
                                "libelle_commune": adres.get("miejscowosc", ""),
                                "code_postal": adres.get("kodPocztowy", ""),
                            },
                            "categorie_entreprise": podmiot.get("formaPrawna", ""),
                            "dirigeants": dirigeants,
                            "identifiers": {
                                "krs": naglowek.get("numerKRS", ""),
                                "regon": podmiot.get("identyfikatory", {}).get("regon", ""),
                                "nip": podmiot.get("identyfikatory", {}).get("nip", ""),
                            },
                        })
                        self.send_json(200, {"results": results, "total_results": 1, "page": 1, "total_pages": 1})
                except urllib.error.HTTPError as e:
                    self.send_json(200, {
                        "results": [], "total_results": 0, "page": 1, "total_pages": 0,
                        "note": "Poland KRS: Enter a KRS number (e.g. 0000019193). Name search is not supported by this API. You can find KRS numbers at https://prs.ms.gov.pl/",
                        "search_url": f"https://prs.ms.gov.pl/krs/wyszukiwanie?t:nazwaPodmiotu={urllib.parse.quote(q)}",
                    })

            elif country == "ee":
                # Estonia - ariregister.rik.ee API (free, real company data)
                ee_q = q.strip() if q.strip() else "tallinn"
                ee_url = f"https://ariregister.rik.ee/est/api/autocomplete?q={urllib.parse.quote(ee_q)}&lang=eng"
                req = urllib.request.Request(ee_url, headers={
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                })
                try:
                    with urllib.request.urlopen(req, timeout=15, context=ssl_ctx) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                        records = data.get("data", [])
                        results = []
                        for r in records:
                            results.append({
                                "nom_complet": r.get("name", ""),
                                "siren": str(r.get("reg_code", "")),
                                "siege": {
                                    "libelle_commune": r.get("legal_address", ""),
                                    "code_postal": r.get("zip_code", ""),
                                },
                                "categorie_entreprise": r.get("legal_form", ""),
                                "dirigeants": [],
                                "etat_administratif": "A" if r.get("status") == "R" else "C",
                                "url": r.get("url", ""),
                            })
                        self.send_json(200, {"results": results, "total_results": len(results), "page": 1, "total_pages": 1})
                        return
                except Exception:
                    pass
                # Fallback to GLEIF for Estonia
                gleif_url = f"https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalAddress.country%5D=EE&filter%5Bentity.status%5D=ACTIVE&page%5Bsize%5D={per_page}&page%5Bnumber%5D={page}"
                if ee_q and ee_q != "tallinn":
                    gleif_url = f"https://api.gleif.org/api/v1/lei-records?filter%5Bfulltext%5D={urllib.parse.quote(ee_q)}&filter%5Bentity.legalAddress.country%5D=EE&page%5Bsize%5D={per_page}&page%5Bnumber%5D={page}"
                try:
                    greq = urllib.request.Request(gleif_url, headers={"Accept": "application/json"})
                    with urllib.request.urlopen(greq, timeout=15) as gresp:
                        gdata = json.loads(gresp.read().decode("utf-8"))
                        results = []
                        for r in gdata.get("data", []):
                            attrs = r.get("attributes", {})
                            entity = attrs.get("entity", {})
                            addr = entity.get("legalAddress", {})
                            results.append({
                                "nom_complet": entity.get("legalName", {}).get("name", ""),
                                "siren": entity.get("registeredAs", "") or attrs.get("lei", ""),
                                "siege": {"libelle_commune": addr.get("city", ""), "code_postal": addr.get("postalCode", "")},
                                "categorie_entreprise": "",
                                "dirigeants": [],
                                "etat_administratif": "A",
                            })
                        total = gdata.get("meta", {}).get("pagination", {}).get("total", len(results))
                        total_pages = gdata.get("meta", {}).get("pagination", {}).get("lastPage", 1)
                        self.send_json(200, {"results": results, "total_results": total, "page": page, "total_pages": total_pages})
                except Exception as e:
                    self.send_json(200, {"results": [], "total_results": 0, "note": f"Estonia search error: {str(e)}"})

            elif country == "no":
                # Norway BRREG API - free, no key needed, includes directors!
                # If query is all digits, do direct org number lookup
                if q.strip() and q.strip().isdigit():
                    try:
                        direct_url = f"https://data.brreg.no/enhetsregisteret/api/enheter/{q.strip()}"
                        dreq = urllib.request.Request(direct_url, headers={"Accept": "application/json"})
                        with urllib.request.urlopen(dreq, timeout=10) as dresp:
                            c = json.loads(dresp.read().decode("utf-8"))
                            org_num = str(c.get("organisasjonsnummer", ""))
                            addr = c.get("forretningsadresse", c.get("postadresse", {}))
                            nace = c.get("naeringskode1", {})
                            directors = []
                            try:
                                rurl = f"https://data.brreg.no/enhetsregisteret/api/enheter/{org_num}/roller"
                                rreq = urllib.request.Request(rurl, headers={"Accept": "application/json"})
                                with urllib.request.urlopen(rreq, timeout=8) as rresp:
                                    rdata = json.loads(rresp.read().decode("utf-8"))
                                    for rg in rdata.get("rollegrupper", []):
                                        for r in rg.get("roller", []):
                                            p = r.get("person", {})
                                            n = p.get("navn", {})
                                            if n.get("fornavn") or n.get("etternavn"):
                                                directors.append({"nom": n.get("etternavn", ""), "prenoms": n.get("fornavn", ""), "qualite": r.get("type", {}).get("beskrivelse", ""), "type_dirigeant": "personne physique"})
                            except Exception:
                                pass
                            result = {
                                "nom_complet": c.get("navn", ""),
                                "siren": org_num,
                                "siege": {"libelle_commune": addr.get("kommune", addr.get("poststed", "")), "code_postal": addr.get("postnummer", ""), "adresse": " ".join(addr.get("adresse", []))},
                                "categorie_entreprise": c.get("organisasjonsform", {}).get("beskrivelse", ""),
                                "activite_principale": nace.get("kode", ""),
                                "activite_description": nace.get("beskrivelse", ""),
                                "dirigeants": directors,
                                "nombre_etablissements": c.get("antallAnsatte", ""),
                                "etat_administratif": "A",
                                "date_creation": c.get("registreringsdatoEnhetsregisteret", ""),
                                "website": c.get("hjemmeside", ""),
                            }
                            self.send_json(200, {"results": [result], "total_results": 1, "page": 1, "total_pages": 1})
                            return
                    except Exception:
                        pass
                if q.strip():
                    brreg_url = f"https://data.brreg.no/enhetsregisteret/api/enheter?navn={urllib.parse.quote(q)}&size={per_page}&page={page-1}"
                else:
                    # Browse newest companies
                    brreg_url = f"https://data.brreg.no/enhetsregisteret/api/enheter?size={per_page}&page={page-1}&sort=registreringsdatoEnhetsregisteret,desc"
                req = urllib.request.Request(brreg_url, headers={"Accept": "application/json"})
                try:
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                        enheter = data.get("_embedded", {}).get("enheter", [])
                        pagination = data.get("page", {})
                        total = pagination.get("totalElements", len(enheter))
                        total_pages = pagination.get("totalPages", 1)
                        results = []
                        for c in enheter:
                            addr = c.get("forretningsadresse", c.get("postadresse", {}))
                            nace = c.get("naeringskode1", {})
                            org_num = str(c.get("organisasjonsnummer", ""))

                            # Fetch directors (roles) for each company
                            directors = []
                            try:
                                roles_url = f"https://data.brreg.no/enhetsregisteret/api/enheter/{org_num}/roller"
                                roles_req = urllib.request.Request(roles_url, headers={"Accept": "application/json"})
                                with urllib.request.urlopen(roles_req, timeout=8) as roles_resp:
                                    roles_data = json.loads(roles_resp.read().decode("utf-8"))
                                    for rg in roles_data.get("rollegrupper", []):
                                        for r in rg.get("roller", []):
                                            person = r.get("person", {})
                                            navn = person.get("navn", {})
                                            first = navn.get("fornavn", "")
                                            last = navn.get("etternavn", "")
                                            role_name = r.get("type", {}).get("beskrivelse", "")
                                            dob = person.get("fodselsdato", "")
                                            if first or last:
                                                directors.append({
                                                    "nom": last,
                                                    "prenoms": first,
                                                    "qualite": role_name,
                                                    "type_dirigeant": "personne physique",
                                                    "date_of_birth": dob,
                                                })
                            except Exception:
                                pass

                            results.append({
                                "nom_complet": c.get("navn", ""),
                                "siren": org_num,
                                "siege": {
                                    "libelle_commune": addr.get("kommune", addr.get("poststed", "")),
                                    "code_postal": addr.get("postnummer", ""),
                                    "adresse": " ".join(addr.get("adresse", [])),
                                },
                                "categorie_entreprise": c.get("organisasjonsform", {}).get("beskrivelse", ""),
                                "activite_principale": nace.get("kode", ""),
                                "activite_description": nace.get("beskrivelse", ""),
                                "dirigeants": directors,
                                "nombre_etablissements": c.get("antallAnsatte", ""),
                                "etat_administratif": "A",
                                "date_creation": c.get("registreringsdatoEnhetsregisteret", ""),
                                "website": c.get("hjemmeside", ""),
                            })

                        self.send_json(200, {"results": results, "total_results": total, "page": page, "total_pages": total_pages})
                except Exception as e:
                    self.send_json(200, {"results": [], "total_results": 0, "note": f"Norway BRREG error: {str(e)}"})

            elif country == "dk":
                # Denmark - GLEIF for search + cvrapi.dk for detail enrichment
                if q.strip():
                    gleif_url = f"https://api.gleif.org/api/v1/lei-records?filter%5Bfulltext%5D={urllib.parse.quote(q)}&filter%5Bentity.legalAddress.country%5D=DK&page%5Bsize%5D={per_page}&page%5Bnumber%5D={page}"
                else:
                    gleif_url = f"https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalAddress.country%5D=DK&filter%5Bentity.status%5D=ACTIVE&page%5Bsize%5D={per_page}&page%5Bnumber%5D={page}"
                req = urllib.request.Request(gleif_url, headers={"Accept": "application/json"})
                try:
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                        records = data.get("data", [])
                        results = []
                        for r in records:
                            attrs = r.get("attributes", {})
                            entity = attrs.get("entity", {})
                            addr = entity.get("legalAddress", {})
                            legal_name = entity.get("legalName", {}).get("name", "")
                            reg_num = entity.get("registeredAs", "") or attrs.get("lei", "")

                            # Try cvrapi.dk for extra detail (phone, industry)
                            phone = ""
                            industry = ""
                            company_type = ""
                            try:
                                cvr_url = f"https://cvrapi.dk/api?search={urllib.parse.quote(legal_name)}&country=dk"
                                cvr_req = urllib.request.Request(cvr_url, headers={"User-Agent": "CompanyDir", "Accept": "application/json"})
                                with urllib.request.urlopen(cvr_req, timeout=5) as cvr_resp:
                                    cvr_data = json.loads(cvr_resp.read().decode("utf-8"))
                                    if isinstance(cvr_data, dict):
                                        phone = cvr_data.get("phone", "") or ""
                                        industry = cvr_data.get("industrydesc", "") or ""
                                        company_type = cvr_data.get("companydesc", "") or ""
                                        if cvr_data.get("vat"):
                                            reg_num = str(cvr_data["vat"])
                            except Exception:
                                pass

                            results.append({
                                "nom_complet": legal_name,
                                "siren": reg_num,
                                "siege": {"libelle_commune": addr.get("city", ""), "code_postal": addr.get("postalCode", "")},
                                "categorie_entreprise": company_type or (entity.get("legalForm", {}).get("id", "") if entity.get("legalForm") else ""),
                                "activite_description": industry,
                                "dirigeants": [],
                                "etat_administratif": "A" if entity.get("status") == "ACTIVE" else "C",
                                "phone": phone,
                            })
                        pagination = data.get("meta", {}).get("pagination", {})
                        total = pagination.get("total", len(results))
                        total_pages = pagination.get("lastPage", max(1, total // per_page))
                        self.send_json(200, {"results": results, "total_results": total, "page": page, "total_pages": total_pages})
                except Exception as e:
                    self.send_json(200, {"results": [], "total_results": 0, "note": f"Denmark search error: {str(e)}"})

            elif country == "fi":
                # Finland PRH API - free, 814K companies
                if q.strip():
                    fi_url = f"https://avoindata.prh.fi/opendata-ytj-api/v3/companies?name={urllib.parse.quote(q)}&totalResults=true&maxResults={per_page}&resultsFrom={(page-1)*per_page}"
                else:
                    fi_url = f"https://avoindata.prh.fi/opendata-ytj-api/v3/companies?totalResults=true&maxResults={per_page}&resultsFrom={(page-1)*per_page}"
                req = urllib.request.Request(fi_url, headers={"Accept": "application/json"})
                try:
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                        companies_list = data.get("companies", data.get("results", []))
                        total = data.get("totalResults", len(companies_list))
                        results = []
                        for c in companies_list:
                            bid = c.get("businessId", {})
                            names = c.get("names", [])
                            name = names[0].get("name", "") if names else ""
                            addrs = c.get("addresses", [])
                            addr = addrs[0] if addrs else {}
                            bl = c.get("mainBusinessLine", {})
                            descs = bl.get("descriptions", [])
                            activity = ""
                            for d_item in descs:
                                if d_item.get("languageCode") == "3":  # English
                                    activity = d_item.get("description", "")
                                    break
                            if not activity and descs:
                                activity = descs[0].get("description", "")
                            results.append({
                                "nom_complet": name,
                                "siren": bid.get("value", "") if isinstance(bid, dict) else str(bid),
                                "siege": {
                                    "libelle_commune": addr.get("city", ""),
                                    "code_postal": addr.get("postCode", ""),
                                },
                                "categorie_entreprise": c.get("companyForm", ""),
                                "activite_description": activity,
                                "dirigeants": [],
                                "etat_administratif": "A",
                                "date_creation": bid.get("registrationDate", "") if isinstance(bid, dict) else "",
                            })
                        self.send_json(200, {"results": results, "total_results": total, "page": page, "total_pages": max(1, total // per_page)})
                except Exception as e:
                    self.send_json(200, {"results": [], "total_results": 0, "note": f"Finland error: {str(e)}"})

            elif country in ("us", "gb", "ua", "lt", "lv", "sk", "be", "ie"):
                # GLEIF API - free global company search (Legal Entity Identifier)
                country_codes = {"us": "US", "gb": "GB", "ua": "UA", "lt": "LT", "lv": "LV", "sk": "SK", "be": "BE", "ie": "IE"}
                cc = country_codes.get(country, "")
                # If query is generic/default, browse all companies in that country
                browse_defaults = {"bank", "company", "inc", "limited", "vodafone", "naftogaz", "maxima", "llc", "ltd"}
                if q.lower().strip() in browse_defaults or not q.strip():
                    gleif_url = f"https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalAddress.country%5D={cc}&filter%5Bentity.status%5D=ACTIVE&page%5Bsize%5D={per_page}&page%5Bnumber%5D={page}"
                else:
                    gleif_url = f"https://api.gleif.org/api/v1/lei-records?filter%5Bfulltext%5D={urllib.parse.quote(q)}&filter%5Bentity.legalAddress.country%5D={cc}&page%5Bsize%5D={per_page}&page%5Bnumber%5D={page}"
                req = urllib.request.Request(gleif_url, headers={"Accept": "application/json"})
                try:
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                        records = data.get("data", [])
                        results = []
                        for r in records:
                            attrs = r.get("attributes", {})
                            entity = attrs.get("entity", {})
                            legal_name = entity.get("legalName", {}).get("name", "")
                            addr = entity.get("legalAddress", {})
                            reg_num = entity.get("registeredAs", "") or attrs.get("lei", "")
                            status = entity.get("status", "ACTIVE")
                            cat = entity.get("legalForm", {}).get("id", "") if entity.get("legalForm") else ""
                            results.append({
                                "nom_complet": legal_name,
                                "siren": reg_num,
                                "siege": {
                                    "libelle_commune": addr.get("city", ""),
                                    "code_postal": addr.get("postalCode", ""),
                                },
                                "categorie_entreprise": cat,
                                "dirigeants": [],
                                "etat_administratif": "A" if status == "ACTIVE" else "C",
                                "lei": attrs.get("lei", ""),
                            })
                        pagination = data.get("meta", {}).get("pagination", {})
                        total = pagination.get("total", len(results))
                        total_pages = pagination.get("lastPage", max(1, total // per_page))
                        self.send_json(200, {"results": results, "total_results": total, "page": page, "total_pages": total_pages})
                except Exception as e:
                    self.send_json(200, {"results": [], "total_results": 0, "page": 1, "total_pages": 0, "note": f"GLEIF search error: {str(e)}"})

            else:
                self.send_json(400, {"error": f"Unknown country: {country}"})

        except Exception as e:
            self.send_json(500, {"error": str(e)})

    # ── Lusha Proxy ──────────────────────────────────

    def handle_lusha(self):
        """
        Proxy GET /api/lusha?firstName=X&lastName=Y&companyName=Z
        to Lusha Person API V2. Requires auth.
        """
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return

        try:
            parsed = urllib.parse.urlparse(self.path)
            query = parsed.query
            query_params = urllib.parse.parse_qs(query)

            # Log the lookup
            first_name = query_params.get("firstName", [""])[0]
            last_name = query_params.get("lastName", [""])[0]
            company = query_params.get("companyName", [""])[0]
            log_activity(auth_user["username"], "lusha_lookup",
                         f"{first_name} {last_name} @ {company}")

            url = f"https://api.lusha.com/v2/person?{query}"
            req = urllib.request.Request(url, method="GET")
            req.add_header("api_key", LUSHA_API_KEY)
            req.add_header("Accept", "application/json")
            req.add_header("User-Agent", "CompanySearch/1.0")

            resp = urllib.request.urlopen(req, timeout=15, context=ssl_ctx)
            data = json.loads(resp.read().decode("utf-8"))

            self.send_json(200, data)

        except urllib.error.HTTPError as e:
            try:
                error_body = json.loads(e.read().decode("utf-8"))
            except Exception:
                error_body = {"message": str(e)}
            self.send_json(e.code, {
                "error": f"Lusha API error ({e.code})",
                "details": error_body
            })

        except Exception as e:
            self.send_json(500, {"error": str(e)})

    # ── Kaspr Proxy ──────────────────────────────────

    def handle_kaspr(self):
        """
        Proxy POST /api/kaspr  { name, id }
        to Kaspr LinkedIn enrichment API. Requires auth.
        """
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else b""

            # Log the lookup
            try:
                body_data = json.loads(body.decode("utf-8")) if body else {}
                log_activity(auth_user["username"], "kaspr_lookup",
                             body_data.get("name", ""))
            except Exception:
                pass

            url = "https://api.developers.kaspr.io/profile/linkedin"
            req = urllib.request.Request(url, data=body, method="POST")
            req.add_header("Authorization", f"Bearer {KASPR_API_KEY}")
            req.add_header("Content-Type", "application/json")
            req.add_header("Accept", "application/json")
            req.add_header("User-Agent", "CompanySearch/1.0")

            resp = urllib.request.urlopen(req, timeout=15, context=ssl_ctx)
            data = json.loads(resp.read().decode("utf-8"))

            self.send_json(200, data)

        except urllib.error.HTTPError as e:
            try:
                error_body = json.loads(e.read().decode("utf-8"))
            except Exception:
                error_body = {"message": str(e)}
            self.send_json(e.code, {
                "error": f"Kaspr API error ({e.code})",
                "details": error_body
            })

        except Exception as e:
            self.send_json(500, {"error": str(e)})


    # ── Website CFO Scraper ─────────────────────────────

    def handle_scrape_cfo(self):
        """
        POST /api/scrape-cfo  { "website": "https://example.com", "company_name": "Example" }
        Scrapes a company website to find CFO / finance director names.
        """
        auth_user = get_auth_user(self)
        if not auth_user:
            self.send_json(401, {"error": "Not authenticated"})
            return

        try:
            body = self.read_body()
            website = (body.get("website") or "").strip()
            company_name = (body.get("company_name") or "").strip()

            # Auto-guess domain from company name if no URL provided
            if not website and company_name:
                # Clean company name for domain guessing
                clean = company_name.lower().strip()
                # Remove common French legal suffixes
                for suffix in [" sa", " sas", " sarl", " eurl", " sasu", " sci",
                               " se", " snc", " scop", " sca", " gmbh", " ltd",
                               " inc", " corp", " group", " groupe", " france"]:
                    if clean.endswith(suffix):
                        clean = clean[:-len(suffix)].strip()
                # Remove special chars, keep only alphanumeric
                clean = re.sub(r'[^a-z0-9]', '', clean)
                if clean:
                    website = f"https://www.{clean}.fr"

            if not website:
                self.send_json(400, {"error": "Could not determine website URL. Please provide one."})
                return

            # Normalize URL
            if not website.startswith("http"):
                website = "https://" + website

            log_activity(auth_user["username"], "scrape_cfo", f"{company_name} ({website})")

            # CFO-related keywords to search for (French + English)
            CFO_KEYWORDS = [
                "directeur financier", "directrice financière", "directrice financiere",
                "chief financial officer", "cfo",
                "responsable financier", "responsable financière",
                "directeur administratif et financier", "daf",
                "finance director", "head of finance",
                "trésorier", "tresorier", "treasurer",
                "directeur de la comptabilité", "directeur comptable",
            ]

            # French name pattern: capitalized words (handles accented chars)
            # Matches patterns like "Jean Dupont", "Marie-Claire Lefèvre", "Jean-Pierre DE LA FONTAINE"
            NAME_PATTERN = re.compile(
                r'([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:-[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+)?'
                r'(?:\s+(?:de|du|des|le|la|les|von|van|di|da|el|al)\s+)?'
                r'\s+[A-ZÀ-ÖØ-Ý][A-ZÀ-Öa-zà-öø-ÿ\'-]+(?:\s+[A-ZÀ-ÖØ-Ý][A-ZÀ-Öa-zà-öø-ÿ\'-]+)?)'
            )

            found_contacts = []
            pages_to_try = []

            # Build base URLs — try .fr and .com variants
            bases = [website.rstrip("/")]
            # If auto-guessed, also try .com variant
            if website.endswith(".fr"):
                bases.append(website[:-3].rstrip("/") + ".com")
            elif website.endswith(".com"):
                bases.append(website[:-4].rstrip("/") + ".fr")

            # Common pages where executives are listed
            suffixes = [
                "", "/about", "/about-us", "/a-propos", "/qui-sommes-nous",
                "/team", "/equipe", "/notre-equipe", "/our-team",
                "/management", "/direction", "/governance", "/gouvernance",
                "/leadership", "/mentions-legales", "/legal",
                "/contact", "/contacts", "/nous-contacter",
            ]
            for base in bases:
                for suffix in suffixes:
                    pages_to_try.append(base + suffix)

            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
            }

            seen_names = set()

            for page_url in pages_to_try:
                if len(found_contacts) >= 5:
                    break
                try:
                    req = urllib.request.Request(page_url, headers=headers, method="GET")
                    resp = urllib.request.urlopen(req, timeout=8, context=ssl_ctx)
                    raw_html = resp.read().decode("utf-8", errors="replace")

                    # Strip HTML tags but keep text structure
                    text = re.sub(r'<script[^>]*>.*?</script>', ' ', raw_html, flags=re.DOTALL | re.IGNORECASE)
                    text = re.sub(r'<style[^>]*>.*?</style>', ' ', text, flags=re.DOTALL | re.IGNORECASE)
                    text = re.sub(r'<[^>]+>', ' ', text)
                    text = html_module.unescape(text)
                    text = re.sub(r'\s+', ' ', text)

                    text_lower = text.lower()

                    for kw in CFO_KEYWORDS:
                        # Find all occurrences of this keyword
                        start = 0
                        while True:
                            idx = text_lower.find(kw, start)
                            if idx == -1:
                                break
                            start = idx + len(kw)

                            # Extract a window of text around the keyword (200 chars before and after)
                            window_start = max(0, idx - 200)
                            window_end = min(len(text), idx + len(kw) + 200)
                            window = text[window_start:window_end]

                            # Look for names in this window
                            names = NAME_PATTERN.findall(window)
                            for name in names:
                                name = name.strip()
                                if len(name) < 4 or name.lower() in seen_names:
                                    continue
                                # Filter out common non-name words
                                skip_words = {"the", "our", "les", "nos", "des", "par", "sur", "avec",
                                              "pour", "dans", "qui", "est", "sont", "ont", "cette",
                                              "son", "ses", "leur", "nous", "vous", "ils", "elle",
                                              "depuis", "entre", "plus", "aussi", "ainsi", "comme"}
                                parts = name.split()
                                if any(p.lower() in skip_words for p in parts):
                                    continue
                                if len(parts) < 2:
                                    continue

                                seen_names.add(name.lower())
                                first_name = parts[0]
                                last_name = " ".join(parts[1:])

                                found_contacts.append({
                                    "first_name": first_name,
                                    "last_name": last_name,
                                    "full_name": name,
                                    "title": kw.title(),
                                    "source_url": page_url,
                                    "keyword_matched": kw,
                                })

                                if len(found_contacts) >= 5:
                                    break
                            if len(found_contacts) >= 5:
                                break
                        if len(found_contacts) >= 5:
                            break

                except Exception:
                    # Page doesn't exist or can't be fetched — skip
                    continue

            self.send_json(200, {
                "contacts": found_contacts,
                "pages_scanned": len(pages_to_try),
                "company_name": company_name,
                "website": website,
            })

        except Exception as e:
            self.send_json(500, {"error": str(e)})


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    # Ensure data directory and default admin
    os.makedirs(DATA_DIR, exist_ok=True)
    init_default_admin()

    class ThreadingHTTPServer(http.server.ThreadingHTTPServer):
        daemon_threads = True

    server = ThreadingHTTPServer(("0.0.0.0", PORT), AppHandler)
    print(f"=== Company Search Server ===")
    print(f"http://localhost:{PORT}")
    print(f"Lusha & Kaspr API proxy enabled")
    print(f"Auth system active")
    print(f"Press Ctrl+C to stop\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()
