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
# Use persistent disk path on Render if available, else local data/
_render_disk = os.environ.get("RENDER_DISK_PATH", "")
if _render_disk and os.path.isdir(_render_disk):
    DATA_DIR = os.path.join(_render_disk, "data")
else:
    DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)
USERS_FILE = os.path.join(DATA_DIR, "users.json")
ACTIVITY_LOG = os.path.join(DATA_DIR, "activity_log.jsonl")
CFO_CONTACTS_FILE = os.path.join(DATA_DIR, "cfo_contacts.json")
FLAGGED_COMPANIES_FILE = os.path.join(DATA_DIR, "flagged_companies.json")
CELLS_FILE = os.path.join(DATA_DIR, "cells.json")

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
    """Load CFO contacts from JSON file."""
    if not os.path.exists(CFO_CONTACTS_FILE):
        return {}
    with open(CFO_CONTACTS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_cfo_contacts(contacts):
    """Save CFO contacts to JSON file."""
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CFO_CONTACTS_FILE, "w", encoding="utf-8") as f:
        json.dump(contacts, f, indent=2, ensure_ascii=False)

def load_flagged_companies():
    """Load flagged companies from JSON file."""
    if not os.path.exists(FLAGGED_COMPANIES_FILE):
        return {}
    with open(FLAGGED_COMPANIES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_flagged_companies(flagged):
    """Save flagged companies to JSON file."""
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(FLAGGED_COMPANIES_FILE, "w", encoding="utf-8") as f:
        json.dump(flagged, f, indent=2, ensure_ascii=False)

def load_cells():
    """Load cells from JSON file. Structure: { "cell_id": { "name": "...", "created_by": "...", "created_at": "...", "companies": { "siren": { metadata } } } }"""
    if not os.path.exists(CELLS_FILE):
        return {}
    with open(CELLS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_cells(cells):
    """Save cells to JSON file."""
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CELLS_FILE, "w", encoding="utf-8") as f:
        json.dump(cells, f, indent=2, ensure_ascii=False)

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
        if self.path.startswith("/api/lusha"):
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

    def handle_find_email(self):
        """
        POST /api/find-email { "siren": "...", "company_name": "..." }
        Chain: 1) Check cached CFO → 2) Try Lusha for directors → 3) Get company email from registry
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

            # Level 1: Check cached CFO contact
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

            # Level 2: Try Lusha API for directors with CFO/CEO titles
            LUSHA_API_KEY = "939a946a-f6d8-4617-b020-6b08535ea8f3"
            headers = {"api_key": LUSHA_API_KEY, "Accept": "application/json"}

            # Try to get company data from French registry to find director names
            try:
                api_url = f"https://recherche-entreprises.api.gouv.fr/search?q={siren}&per_page=1"
                req = urllib.request.Request(api_url, headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    api_data = json.loads(resp.read().decode("utf-8"))
                    results = api_data.get("results", [])
                    if results:
                        dirigeants = results[0].get("dirigeants", [])
                        # Try directors with financial/CEO roles first
                        cfo_keywords = ["financ", "cfo", "trésor", "tresor", "comptab", "daf",
                                       "directeur général", "directeur general", "président",
                                       "president", "ceo", "chief executive"]
                        priority_dirs = []
                        other_dirs = []
                        for d in dirigeants:
                            if d.get("type_dirigeant") != "personne physique":
                                continue
                            qualite = (d.get("qualite") or "").lower()
                            name_parts = d.get("prenoms", "").split(" ")
                            first = name_parts[0] if name_parts else ""
                            last = (d.get("nom") or "").strip()
                            if not first or not last:
                                continue
                            if any(kw in qualite for kw in cfo_keywords):
                                priority_dirs.append((first, last, d.get("qualite", "")))
                            else:
                                other_dirs.append((first, last, d.get("qualite", "")))

                        # Try Lusha for priority directors (CFO/CEO), then others (max 3 total)
                        for first, last, title in (priority_dirs + other_dirs)[:3]:
                            try:
                                # Clean name: remove parenthetical notes from nom field
                                clean_last = re.sub(r'\s*\(.*?\)\s*', '', last).strip()
                                lusha_url = f"https://api.lusha.com/v2/person?firstName={urllib.parse.quote(first)}&lastName={urllib.parse.quote(clean_last)}&company={urllib.parse.quote(company_name)}"
                                lusha_req = urllib.request.Request(lusha_url, headers=headers)
                                with urllib.request.urlopen(lusha_req, timeout=10, context=ssl_ctx) as lusha_resp:
                                    lusha_data = json.loads(lusha_resp.read().decode("utf-8"))
                                    emails = lusha_data.get("emailAddresses") or lusha_data.get("emails") or []
                                    if emails:
                                        email = emails[0].get("email") or emails[0].get("value") or ""
                                        if email:
                                            contact_type = "cfo" if any(kw in title.lower() for kw in ["financ", "cfo", "daf", "trésor"]) else "director"
                                            result = {
                                                "email": email,
                                                "type": contact_type,
                                                "contact_name": f"{first} {last} ({title})",
                                                "source": "lusha",
                                            }
                                            self._save_email_to_cell(siren, result)
                                            self.send_json(200, result)
                                            return
                            except Exception:
                                continue
            except Exception:
                pass

            # Level 4: Get company email from French registry
            try:
                api_url = f"https://recherche-entreprises.api.gouv.fr/search?q={siren}&per_page=1"
                req = urllib.request.Request(api_url, headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    api_data = json.loads(resp.read().decode("utf-8"))
                    results = api_data.get("results", [])
                    if results:
                        company = results[0]
                        # Check matching_etablissements for email
                        for etab in company.get("matching_etablissements", []):
                            email = etab.get("email") or etab.get("adresse_email") or ""
                            if email:
                                result = {
                                    "email": email,
                                    "type": "company",
                                    "contact_name": company.get("nom_complet", ""),
                                    "source": "registry",
                                }
                                self._save_email_to_cell(siren, result)
                                self.send_json(200, result)
                                return
                        # Check complements
                        complements = company.get("complements", {})
                        if complements.get("email"):
                            result = {
                                "email": complements["email"],
                                "type": "company",
                                "contact_name": company.get("nom_complet", ""),
                                "source": "registry",
                            }
                            self._save_email_to_cell(siren, result)
                            self.send_json(200, result)
                            return
            except Exception:
                pass

            # Nothing found
            result = {"error": "No email found", "type": "none"}
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
                    cells[cell_id]["companies"][siren] = {
                        "company_name": comp.get("company_name", ""),
                        "categorie_entreprise": comp.get("categorie_entreprise", ""),
                        "commune": comp.get("commune", ""),
                        "code_postal": comp.get("code_postal", ""),
                        "added_by": auth_user["username"],
                        "added_at": datetime.datetime.utcnow().isoformat() + "Z",
                    }
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
