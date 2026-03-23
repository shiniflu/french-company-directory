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

# ── API Keys ─────────────────────────────────────────
LUSHA_API_KEY = "939a946a-f6d8-4617-b020-6b08535ea8f3"
KASPR_API_KEY = "905c7fd6a35148ddbdf066a4ca1e5e82"

PORT = int(os.environ.get("PORT", 8080))
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
ACTIVITY_LOG = os.path.join(DATA_DIR, "activity_log.jsonl")
CFO_CONTACTS_FILE = os.path.join(DATA_DIR, "cfo_contacts.json")
FLAGGED_COMPANIES_FILE = os.path.join(DATA_DIR, "flagged_companies.json")

# Allow unverified SSL for proxied requests (some corporate networks)
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

# ── In-memory token store ────────────────────────────
# { token_string: { "username": "...", "role": "...", "created_at": "..." } }
TOKENS = {}
tokens_lock = threading.Lock()

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
        elif self.path == "/api/auth/me":
            self.handle_auth_me()
        elif self.path == "/api/admin/users":
            self.handle_admin_list_users()
        elif self.path.startswith("/api/admin/stats"):
            self.handle_admin_stats()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/kaspr":
            self.handle_kaspr()
        elif self.path.startswith("/api/cfo/"):
            self.handle_cfo_save()
        elif self.path.startswith("/api/flagged/"):
            self.handle_flagged_add()
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
            req.add_header("Authorization", KASPR_API_KEY)
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
