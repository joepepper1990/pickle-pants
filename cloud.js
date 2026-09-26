const SUPABASE_URL = "https://yelftutoqckeewhgjmyt.supabase.co";
const SUPABASE_KEY = "sb_publishable_CMidrK8UPI4ErxhXlF6F2g_8ITa2vrE";
const SESSION_KEY = "picklePants.cloudSession.v1";

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}

function saveSession(session) {
  if (!session) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function request(path, options = {}, authenticated = false) {
  const headers = new Headers(options.headers || {});
  headers.set("apikey", SUPABASE_KEY);
  headers.set("Content-Type", "application/json");

  if (authenticated) {
    const session = await getValidSession();
    if (!session?.access_token) throw new Error("Sign in to use cloud sync.");
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }

  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  const text = await response.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

function normaliseSession(data, email = "") {
  if (!data?.access_token) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600) - 30,
    user: data.user || null,
    email: data.user?.email || email || ""
  };
}

export function cloudStatus() {
  const session = loadSession();
  return {
    signedIn: Boolean(session?.access_token && session?.refresh_token),
    email: session?.email || session?.user?.email || "",
    userId: session?.user?.id || ""
  };
}

export async function captureAuthRedirect() {
  if (!location.hash.includes("access_token=")) return false;
  const params = new URLSearchParams(location.hash.slice(1));
  const session = normaliseSession({
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
    expires_in: params.get("expires_in")
  });
  if (!session) return false;
  try {
    const user = await request("/auth/v1/user", {
      method: "GET",
      headers: { Authorization: `Bearer ${session.access_token}` }
    }, false);
    session.user = user;
    session.email = user?.email || "";
  } catch {}
  saveSession(session);
  history.replaceState(null, "", location.pathname + location.search);
  return true;
}

export async function signUp(email, password) {
  const data = await request("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  const session = normaliseSession(data, email);
  if (session) saveSession(session);
  return {
    signedIn: Boolean(session),
    needsConfirmation: !session,
    email: data?.user?.email || email
  };
}

export async function signIn(email, password) {
  const data = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  const session = normaliseSession(data, email);
  if (!session) throw new Error("Sign in did not return a session.");
  saveSession(session);
  return session;
}

export async function signOut() {
  const session = loadSession();
  try {
    if (session?.access_token) {
      await request("/auth/v1/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` }
      }, false);
    }
  } finally {
    saveSession(null);
  }
}

export async function getValidSession() {
  const session = loadSession();
  if (!session?.access_token || !session?.refresh_token) return null;
  if (Number(session.expires_at || 0) > Math.floor(Date.now() / 1000)) return session;

  try {
    const data = await request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const refreshed = normaliseSession(data, session.email);
    if (!refreshed) throw new Error("Session refresh failed.");
    saveSession(refreshed);
    return refreshed;
  } catch (error) {
    saveSession(null);
    throw error;
  }
}

export async function pushCloudState(payload, schemaVersion, appVersion) {
  const session = await getValidSession();
  if (!session?.user?.id) throw new Error("Sign in to use cloud sync.");
  const now = new Date().toISOString();

  await request("/rest/v1/app_state?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: session.user.id,
      payload,
      schema_version: Number(schemaVersion) || 6,
      app_version: appVersion || "6.1.0",
      client_updated_at: now
    })
  }, true);

  return now;
}

export async function pullCloudState() {
  const session = await getValidSession();
  if (!session?.user?.id) throw new Error("Sign in to use cloud sync.");

  const rows = await request(
    `/rest/v1/app_state?select=payload,schema_version,app_version,client_updated_at,updated_at&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`,
    { method: "GET" },
    true
  );

  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
