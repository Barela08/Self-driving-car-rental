import { auth } from './firebase';

const TOKEN_STORAGE_KEY = 'elitedrive_session_token';

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage unavailability
  }
}

export async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  if (!headers.has('Authorization')) {
    const storedToken = getSessionToken();
    if (storedToken) {
      headers.set('Authorization', `Bearer ${storedToken}`);
    } else if (auth.currentUser) {
      const token = await auth.currentUser.getIdToken();
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const res = await fetch(url, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';

  if (res.status === 429) {
    const payload = contentType.includes('application/json') ? await res.json().catch(() => ({})) : {};
    if (payload?.status === 'RESOURCE_EXHAUSTED') {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
    throw new Error(payload?.error || 'Too many requests. Please wait a moment.');
  }

  if (!res.ok) {
    if (contentType.includes('application/json')) {
      const errData = await res.json();
      throw new Error(errData.error || `Request failed (${res.status})`);
    }
    throw new Error(`Unexpected server response (${res.status})`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error('Server returned an unexpected response format.');
  }

  return (await res.json()) as T;
}

export function formatINR(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}
