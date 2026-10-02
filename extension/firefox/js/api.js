import { APP_CONFIG } from './config.js';

function baseUrl(path) {
  return new URL(path, `${APP_CONFIG.apiBaseUrl.replace(/\/$/, '')}/`);
}

function errorMessage(payload, status) {
  const error = payload?.error;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object') {
    const message = [error.message, error.info, error.description]
      .find((value) => typeof value === 'string' && value.trim())?.trim();
    const codeValue = [error.code, error.type]
      .find((value) => typeof value === 'string' || typeof value === 'number');
    const code = codeValue === undefined ? '' : String(codeValue).trim();
    if (message) return code && !message.includes(code) ? `${message} (${code})` : message;
    if (code) return `Flight API rejected the request (${code}).`;
  }
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
  return `Flight API returned HTTP ${status}.`;
}

async function request(path, params = {}, { signal } = {}) {
  const url = baseUrl(path);
  for (const [key, rawValue] of Object.entries(params)) {
    const value = String(rawValue ?? '').trim();
    if (value) url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(errorMessage(payload, response.status));
  return payload;
}

export async function lookupAirports(search, options) {
  const response = await request('getAirports', { search }, options);
  return response.data ?? [];
}

export async function lookupAirlines(search, options) {
  const response = await request('getAirlines', { search }, options);
  return response.data ?? [];
}

export async function lookupFlights(params, options) {
  return request('getFlights', params, options);
}

export async function healthCheck(options) {
  return request('health', {}, options);
}
