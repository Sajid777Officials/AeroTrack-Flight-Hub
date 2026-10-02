import { ADMIN_HTML } from './admin.js';

const SERVICE_NAME = 'AeroTrack API';
const VERSION = '0.4.0';
const MAX_ACTIVITY_BODY_BYTES = 4096;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 365;
const PROVIDER_BASE_URL = 'https://api.aviationstack.com/v1/';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXTENSION_ORIGIN_PATTERN = /^(?:chrome|moz)-extension:\/\/[a-z0-9-]+$/i;

function parseList(value = '') {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function requestOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return '*';

  const configured = new Set(parseList(env.ALLOWED_ORIGINS));
  if (configured.has(origin)) return origin;

  if (env.ALLOW_EXTENSION_ORIGINS === 'true' && EXTENSION_ORIGIN_PATTERN.test(origin)) {
    return origin;
  }

  if (env.ENVIRONMENT === 'development' && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) {
    return origin;
  }

  return '';
}

function responseHeaders(request, env, extra = {}) {
  const origin = requestOrigin(request, env);
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  };

  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Max-Age'] = '86400';
    headers.Vary = 'Origin';
  }

  return headers;
}

function json(request, env, payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders(request, env, extraHeaders),
  });
}

function failure(request, env, status, code, message) {
  return json(request, env, { ok: false, error: { code, message } }, status);
}

function isValidInstallationId(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase().replace(/\.$/, '');
  if (!raw || raw.length > 253 || /[\s/@]/.test(raw)) return null;

  try {
    const parsed = new URL(`https://${raw}`);
    if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || parsed.pathname !== '/') {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname || hostname.length > 253 || hostname.includes(':')) return null;
    if (hostname === 'localhost') return hostname;

    const labels = hostname.split('.');
    if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
      return null;
    }
    return hostname;
  } catch {
    return null;
  }
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_ACTIVITY_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
  if (!String(request.headers.get('Content-Type') || '').toLowerCase().includes('application/json')) {
    throw new Error('UNSUPPORTED_MEDIA_TYPE');
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_ACTIVITY_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function constantTimeEqual(left = '', right = '') {
  const a = String(left);
  const b = String(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index % Math.max(a.length, 1)) || 0)
      ^ (b.charCodeAt(index % Math.max(b.length, 1)) || 0);
  }
  return mismatch === 0;
}

function hasAdminAccess(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const authorization = request.headers.get('Authorization') || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  return constantTimeEqual(supplied, env.ADMIN_TOKEN);
}

async function recordActivity(request, env) {
  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    const map = {
      BODY_TOO_LARGE: [413, 'body_too_large', 'Request body is too large.'],
      UNSUPPORTED_MEDIA_TYPE: [415, 'unsupported_media_type', 'Content-Type must be application/json.'],
      INVALID_JSON: [400, 'invalid_json', 'Request body must contain valid JSON.'],
    };
    const [status, code, message] = map[error.message] || [400, 'invalid_request', 'Invalid request.'];
    return failure(request, env, status, code, message);
  }

  if (!isValidInstallationId(body.installationId)) {
    return failure(request, env, 400, 'invalid_installation_id', 'installationId must be a valid UUID.');
  }

  const domain = normalizeDomain(body.domain);
  if (!domain) {
    return failure(request, env, 400, 'invalid_domain', 'domain must be a hostname without a URL path or query.');
  }

  if (String(body.consentVersion || '') !== '1') {
    return failure(request, env, 400, 'consent_required', 'A supported consent version is required.');
  }

  const eventId = crypto.randomUUID();
  const receivedAt = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO activity_events
        (id, installation_id, domain, received_at, consent_version)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(eventId, body.installationId, domain, receivedAt, '1')
      .run();
  } catch (error) {
    console.error('Activity database write failed.', error?.message || error);
    return failure(request, env, 503, 'database_unavailable', 'The activity service is temporarily unavailable.');
  }

  return json(request, env, { ok: true, receivedAt }, 201);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

async function recentActivity(request, env, format = 'json') {
  if (!hasAdminAccess(request, env)) {
    return failure(request, env, 401, 'unauthorized', 'A valid admin token is required.');
  }

  const url = new URL(request.url);
  const maximum = format === 'csv' ? 5000 : 500;
  const limit = boundedInteger(url.searchParams.get('limit'), 100, 1, maximum);
  const installationId = url.searchParams.get('installationId') || '';
  const requestedDomain = url.searchParams.get('domain') || '';
  const domain = requestedDomain ? normalizeDomain(requestedDomain) : '';

  if (installationId && !isValidInstallationId(installationId)) {
    return failure(request, env, 400, 'invalid_installation_id', 'installationId must be a valid UUID.');
  }
  if (requestedDomain && !domain) {
    return failure(request, env, 400, 'invalid_domain', 'domain must be a valid hostname.');
  }

  const clauses = [];
  const values = [];
  if (installationId) {
    clauses.push('installation_id = ?');
    values.push(installationId);
  }
  if (domain) {
    clauses.push('domain = ?');
    values.push(domain);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await env.DB.prepare(
    `SELECT id, installation_id AS installationId, domain, received_at AS receivedAt
       FROM activity_events
       ${where}
      ORDER BY received_at DESC
      LIMIT ?`,
  )
    .bind(...values, limit)
    .all();
  const records = result.results || [];

  if (format === 'csv') {
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = [
      ['event_id', 'installation_id', 'domain', 'received_at'],
      ...records.map((row) => [row.id, row.installationId, row.domain, row.receivedAt]),
    ];
    return new Response(rows.map((row) => row.map(escape).join(',')).join('\n'), {
      headers: responseHeaders(request, env, {
        'Content-Disposition': 'attachment; filename="aerotrack-activity.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
      }),
    });
  }

  return json(request, env, { ok: true, count: records.length, records });
}

function providerParams(searchParams, allowed) {
  const params = new URLSearchParams();
  for (const [publicName, providerName = publicName] of allowed) {
    const value = String(searchParams.get(publicName) || '').trim();
    if (value) params.set(providerName, value);
  }
  return params;
}

function currentDateForTimezoneOffset(rawOffset) {
  const offsetMinutes = Number(rawOffset);
  if (!Number.isInteger(offsetMinutes) || offsetMinutes < -840 || offsetMinutes > 840) {
    return new Date().toISOString().slice(0, 10);
  }
  return new Date(Date.now() - offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function providerErrorDetails(payload, status) {
  const providerError = payload?.error;
  if (typeof providerError === 'string' && providerError.trim()) {
    return { message: providerError.trim(), code: '' };
  }

  if (providerError && typeof providerError === 'object') {
    const message = [providerError.info, providerError.message, providerError.description]
      .find((value) => typeof value === 'string' && value.trim())?.trim();
    const codeValue = [providerError.code, providerError.type]
      .find((value) => typeof value === 'string' || typeof value === 'number');
    const code = codeValue === undefined ? '' : String(codeValue).trim();
    if (message) return { message: code && !message.includes(code) ? `${message} (${code})` : message, code };
    if (code) return { message: `Flight provider rejected the request (${code}).`, code };
  }

  const message = [payload?.message, payload?.info]
    .find((value) => typeof value === 'string' && value.trim())?.trim();
  return {
    message: message || `Flight provider request failed (HTTP ${status}).`,
    code: '',
  };
}

async function fetchProvider(endpoint, params, env, requestUrl, ttlSeconds) {
  if (!env.AVIATIONSTACK_API_KEY) {
    const error = new Error('Flight provider is not configured.');
    error.code = 'provider_not_configured';
    error.status = 503;
    throw error;
  }

  const publicCacheParams = new URLSearchParams(params);
  const cacheKey = new Request(`${new URL(requestUrl).origin}/__provider_cache/${endpoint}?${publicCacheParams}`);
  const cache = globalThis.caches?.default;
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return cached.json();

  const providerUrl = new URL(endpoint, PROVIDER_BASE_URL);
  for (const [key, value] of params) providerUrl.searchParams.set(key, value);
  providerUrl.searchParams.set('access_key', env.AVIATIONSTACK_API_KEY);

  const providerResponse = await fetch(providerUrl, {
    headers: { Accept: 'application/json' },
  });
  const responseText = await providerResponse.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }
  if (!providerResponse.ok || payload.error) {
    const details = providerErrorDetails(payload, providerResponse.status);
    const error = new Error(details.message);
    error.code = 'provider_error';
    error.providerCode = details.code;
    error.status = providerResponse.status >= 400 && providerResponse.status < 500 ? 502 : 503;
    throw error;
  }

  if (cache) {
    const cachedResponse = new Response(JSON.stringify(payload), {
      headers: {
        'Cache-Control': `public, max-age=${ttlSeconds}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
    await cache.put(cacheKey, cachedResponse);
  }
  return payload;
}

function mapAirports(items = []) {
  return items
    .filter((item) => item?.iata_code)
    .map((item) => ({
      iata: item.iata_code,
      icao: item.icao_code || '',
      name: item.airport_name || item.iata_code,
      city: item.city_iata_code || '',
      country: item.country_name || '',
    }));
}

function mapAirlines(items = []) {
  return items
    .filter((item) => item?.iata_code)
    .map((item) => ({
      iata: item.iata_code,
      icao: item.icao_code || '',
      name: item.airline_name || item.iata_code,
      country: item.country_name || '',
    }));
}

async function flightApi(request, env, route) {
  const url = new URL(request.url);
  try {
    if (route === '/api/getAirports') {
      const search = String(url.searchParams.get('search') || '').trim();
      if (search.length < 2) return json(request, env, { ok: true, data: [] });
      const params = new URLSearchParams({ search, limit: '12' });
      const payload = await fetchProvider('airports', params, env, request.url, 86400);
      return json(request, env, { ok: true, data: mapAirports(payload.data), meta: { source: 'aviationstack' } });
    }

    if (route === '/api/getAirlines') {
      const search = String(url.searchParams.get('search') || '').trim();
      if (search.length < 2) return json(request, env, { ok: true, data: [] });
      const params = new URLSearchParams({ search, limit: '12' });
      const payload = await fetchProvider('airlines', params, env, request.url, 86400);
      return json(request, env, { ok: true, data: mapAirlines(payload.data), meta: { source: 'aviationstack' } });
    }

    if (route === '/api/getFlights') {
      const params = providerParams(url.searchParams, [
        ['date', 'flight_date'],
        ['dep_iata', 'dep_iata'],
        ['arr_iata', 'arr_iata'],
        ['airline_iata', 'airline_iata'],
        ['flight_number', 'flight_number'],
      ]);
      params.set('limit', '100');
      if (!params.has('flight_date')) {
        return failure(request, env, 400, 'missing_date', 'A flight date is required.');
      }
      // Aviationstack's free tier supports real-time flights. Supplying
      // flight_date selects the historical/future feature, so omit that
      // provider filter for today's live lookup while keeping the UI date
      // mandatory and retaining paid-plan date searches for other days.
      const requestedDate = params.get('flight_date');
      const clientToday = currentDateForTimezoneOffset(url.searchParams.get('timezone_offset_minutes'));
      if (requestedDate === clientToday) {
        params.delete('flight_date');
      }
      const routeLookup = params.has('dep_iata') && params.has('arr_iata');
      const flightLookup = params.has('airline_iata') && params.has('flight_number');
      if (!routeLookup && !flightLookup) {
        return failure(request, env, 400, 'missing_flight_filter', 'Provide a route or an airline and flight number.');
      }
      const payload = await fetchProvider('flights', params, env, request.url, 60);
      return json(request, env, {
        ok: true,
        data: Array.isArray(payload.data) ? payload.data : [],
        meta: { source: 'aviationstack', pagination: payload.pagination || null },
      });
    }

    if (route === '/api/getCityByIataCode') {
      const iata = String(url.searchParams.get('iata') || url.searchParams.get('iata_code') || '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(iata)) {
        return failure(request, env, 400, 'invalid_iata', 'A three-letter IATA code is required.');
      }
      const payload = await fetchProvider('cities', new URLSearchParams({ iata_code: iata, limit: '1' }), env, request.url, 86400);
      return json(request, env, { ok: true, data: payload.data?.[0] || null, meta: { source: 'aviationstack' } });
    }
  } catch (error) {
    return failure(
      request,
      env,
      Number(error.status) || 503,
      error.code || 'provider_unavailable',
      error.message || 'Flight provider is unavailable.',
    );
  }

  return failure(request, env, 404, 'not_found', 'Endpoint not found.');
}

async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') {
    const origin = requestOrigin(request, env);
    if (!origin) return failure(request, env, 403, 'origin_not_allowed', 'Origin is not allowed.');
    return new Response(null, { status: 204, headers: responseHeaders(request, env) });
  }

  const url = new URL(request.url);
  const route = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'GET' && route === '/api/health') {
    return json(request, env, {
      ok: true,
      service: SERVICE_NAME,
      version: VERSION,
      provider: env.AVIATIONSTACK_API_KEY ? 'aviationstack' : 'not configured',
    });
  }
   if (request.method === 'GET' && route === '/privacy') {
  const privacyHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AeroTrack Flight Hub Privacy Policy</title>
  <style>
    body {
      margin: 0;
      background: #eef5fb;
      color: #10233d;
      font: 16px/1.7 Arial, sans-serif;
    }
    main {
      max-width: 850px;
      margin: 40px auto;
      padding: 40px;
      background: white;
      border-radius: 18px;
      box-shadow: 0 12px 35px rgba(16,35,61,.12);
    }
    h1, h2 { color: #075fae; }
    a { color: #075fae; }
  </style>
</head>
<body>
<main>
  <h1>AeroTrack Flight Hub Privacy Policy</h1>
  <p><strong>Effective date:</strong> August 22, 2026</p>

  <p>AeroTrack Flight Hub provides flight lookup and tracking features while keeping data collection limited and transparent.</p>

  <h2>Information processed</h2>
  <ul>
    <li>Flight-search information entered by the user, such as airport codes, flight number, and date.</li>
    <li>Settings, saved lookups, consent choices, and recent searches stored locally in the browser.</li>
    <li>If domain sharing is explicitly enabled: the active website hostname, a random installation ID, consent version, and server receipt time.</li>
  </ul>

  <h2>Information not collected</h2>
  <p>We do not collect passwords, cookies, form contents, page contents, complete URLs, URL paths, query text, personal messages, payment information, or complete browsing history.</p>

  <h2>How information is used</h2>
  <p>Information is used only to provide flight lookup, save user preferences, schedule extension maintenance, and operate the optional consent-based domain-sharing feature.</p>

  <h2>Permissions</h2>
  <ul>
    <li><strong>Storage:</strong> saves preferences, consent choices, and saved flight lookups.</li>
    <li><strong>Alarms:</strong> performs scheduled extension maintenance.</li>
    <li><strong>Tabs:</strong> reads only the active tab hostname when optional domain sharing is enabled.</li>
  </ul>

  <h2>Service providers</h2>
  <p>Cloudflare provides backend hosting and database services. Aviationstack supplies flight information. Information is shared with these providers only when required to deliver the extension's features.</p>

  <h2>Retention and security</h2>
  <p>Optional active-domain records are normally retained for up to 30 days. Administrative records are protected by authentication and access controls.</p>

  <h2>Data sharing</h2>
  <p>We do not sell user data, use it for advertising, credit decisions, or purposes unrelated to the extension's stated functionality.</p>

  <h2>User controls</h2>
  <p>Domain sharing is disabled by default. Users may enable, disable, or clear privacy settings from the extension at any time.</p>

  <h2>Contact</h2>
  <p>For privacy questions, contact: <a href="mailto:rvinin399@gmail.com">rvinin399@gmail.com</a></p>
</main>
</body>
</html>`;

  return new Response(privacyHtml, {
    headers: responseHeaders(request, env, {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    }),
  });
}
  if (request.method === 'GET' && route === '/admin') {
    return new Response(ADMIN_HTML, {
      headers: responseHeaders(request, env, {
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
        'Content-Type': 'text/html; charset=utf-8',
      }),
    });
  }

  if (request.method === 'POST' && route === '/api/activity') {
    return recordActivity(request, env);
  }

  if (request.method === 'GET' && route === '/api/admin/activity') {
    return recentActivity(request, env, 'json');
  }

  if (request.method === 'GET' && route === '/api/admin/activity.csv') {
    return recentActivity(request, env, 'csv');
  }

  if (request.method === 'GET' && [
    '/api/getAirports',
    '/api/getAirlines',
    '/api/getFlights',
    '/api/getCityByIataCode',
  ].includes(route)) {
    return flightApi(request, env, route);
  }

  return failure(request, env, 404, 'not_found', 'Endpoint not found.');
}

async function cleanupOldActivity(env) {
  const retentionDays = boundedInteger(
    env.RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
    1,
    MAX_RETENTION_DAYS,
  );
  await env.DB.prepare(
    `DELETE FROM activity_events
      WHERE received_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`,
  )
    .bind(`-${retentionDays} days`)
    .run();
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error('Unhandled Worker request failure.', error?.message || error);
      return failure(request, env, 500, 'internal_error', 'The service could not complete this request.');
    }
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupOldActivity(env));
  },
};

export {
  cleanupOldActivity,
  handleRequest,
  isValidInstallationId,
  mapAirlines,
  mapAirports,
  normalizeDomain,
};
