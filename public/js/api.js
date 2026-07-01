// Tiny client-side API + auth helper shared by every page.
const TOKEN_KEY = 'cav_token';
const USER_KEY = 'cav_user';
const NAME_KEY = 'cav_displayName';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (user?.displayName && !localStorage.getItem(NAME_KEY)) {
    localStorage.setItem(NAME_KEY, user.displayName);
  }
}
export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}
export function getDisplayName() {
  return localStorage.getItem(NAME_KEY) || getUser()?.displayName || 'Guest';
}
export function setDisplayName(name) {
  localStorage.setItem(NAME_KEY, name);
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * fetch() wrapper that attaches the bearer token and parses JSON.
 * Throws an Error (with .status) on non-2xx responses.
 * Redirects to login on 401.
 */
export async function api(pathOrUrl, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { ...headers } };

  if (body !== undefined) {
    if (raw) {
      opts.body = body; // e.g. FormData — let the browser set Content-Type
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }

  const token = getToken();
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(pathOrUrl, opts);

  if (res.status === 401) {
    clearSession();
    if (!location.pathname.endsWith('login.html')) {
      location.href = '/login.html';
    }
    throw new Error('Unauthorized');
  }

  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null);
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Redirect to login if there is no token. Returns the token if present. */
export function requireAuth() {
  const token = getToken();
  if (!token) {
    location.href = '/login.html';
    return null;
  }
  return token;
}

export function logout() {
  clearSession();
  location.href = '/login.html';
}
