import assert from 'node:assert/strict';
import test from 'node:test';

import worker, {
  isValidInstallationId,
  mapAirlines,
  mapAirports,
  normalizeDomain,
} from '../src/index.js';

const installationId = '123e4567-e89b-42d3-a456-426614174000';

function mockDatabase() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async run() {
          calls.push({ sql, values: statement.values, kind: 'run' });
          return { success: true };
        },
        async all() {
          calls.push({ sql, values: statement.values, kind: 'all' });
          return { results: [] };
        },
      };
      return statement;
    },
  };
}

function env(overrides = {}) {
  return {
    DB: mockDatabase(),
    ALLOW_EXTENSION_ORIGINS: 'true',
    RETENTION_DAYS: '30',
    ADMIN_TOKEN: 'test-admin-token',
    ...overrides,
  };
}

test('normalizes domains but rejects full URLs and paths', () => {
  assert.equal(normalizeDomain('WWW.Example.COM.'), 'www.example.com');
  assert.equal(normalizeDomain('sub.example.com'), 'sub.example.com');
  assert.equal(normalizeDomain('https://example.com'), null);
  assert.equal(normalizeDomain('example.com/private'), null);
  assert.equal(normalizeDomain('example.com?secret=1'), null);
});

test('accepts a UUID installation identifier', () => {
  assert.equal(isValidInstallationId(installationId), true);
  assert.equal(isValidInstallationId('hardware-serial-number'), false);
});

test('records only the installation ID, domain, server timestamp, and consent version', async () => {
  const testEnv = env();
  const request = new Request('https://api.example.test/api/activity', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
    },
    body: JSON.stringify({
      installationId,
      domain: 'docs.example.com',
      consentVersion: '1',
      ignoredFullUrl: 'https://docs.example.com/private?token=secret',
    }),
  });

  const response = await worker.fetch(request, testEnv);
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.ok, true);
  assert.equal(testEnv.DB.calls.length, 1);
  const values = testEnv.DB.calls[0].values;
  assert.equal(values.length, 5);
  assert.equal(values[1], installationId);
  assert.equal(values[2], 'docs.example.com');
  assert.equal(values[4], '1');
  assert.equal(values.some((value) => String(value).includes('/private')), false);
});

test('rejects activity without consent evidence', async () => {
  const testEnv = env();
  const response = await worker.fetch(new Request('https://api.example.test/api/activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId, domain: 'example.com' }),
  }), testEnv);
  assert.equal(response.status, 400);
  assert.equal(testEnv.DB.calls.length, 0);
});

test('protects activity records with the admin token', async () => {
  const response = await worker.fetch(
    new Request('https://api.example.test/api/admin/activity'),
    env(),
  );
  assert.equal(response.status, 401);
});

test('serves the client-friendly admin page without embedding secrets', async () => {
  const response = await worker.fetch(new Request('https://api.example.test/admin'), env());
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /text\/html/);
  assert.match(html, /Activity records/);
  assert.match(html, /Download CSV/);
  assert.doesNotMatch(html, /test-admin-token/);
});

test('proxies flight filters while keeping the provider key out of the response', async () => {
  const originalFetch = globalThis.fetch;
  let providerUrl = '';
  globalThis.fetch = async (input) => {
    providerUrl = String(input);
    return new Response(JSON.stringify({
      pagination: { total: 1 },
      data: [{ flight_status: 'scheduled', flight: { number: '147' } }],
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const response = await worker.fetch(new Request(
      'https://api.example.test/api/getFlights?date=2026-08-11&dep_iata=DAC&arr_iata=CAN',
    ), env({ AVIATIONSTACK_API_KEY: 'provider-secret-key' }));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.length, 1);
    assert.match(providerUrl, /flight_date=2026-08-11/);
    assert.match(providerUrl, /dep_iata=DAC/);
    assert.match(providerUrl, /arr_iata=CAN/);
    assert.match(providerUrl, /access_key=provider-secret-key/);
    assert.doesNotMatch(JSON.stringify(payload), /provider-secret-key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('maps provider airport and airline records to the extension contract', () => {
  assert.deepEqual(mapAirports([{
    iata_code: 'DAC',
    icao_code: 'VGHS',
    airport_name: 'Hazrat Shahjalal International Airport',
    city_iata_code: 'DAC',
    country_name: 'Bangladesh',
  }]), [{
    iata: 'DAC',
    icao: 'VGHS',
    name: 'Hazrat Shahjalal International Airport',
    city: 'DAC',
    country: 'Bangladesh',
  }]);

  assert.deepEqual(mapAirlines([{
    iata_code: 'BG',
    icao_code: 'BBC',
    airline_name: 'Biman Bangladesh Airlines',
    country_name: 'Bangladesh',
  }]), [{
    iata: 'BG',
    icao: 'BBC',
    name: 'Biman Bangladesh Airlines',
    country: 'Bangladesh',
  }]);
});
