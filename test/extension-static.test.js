import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browsers = ['chrome', 'edge', 'firefox'];
const requiredFiles = [
  'background.js',
  'manifest.json',
  'newtab.html',
  'options.html',
  'permission-proof.html',
  'privacy-consent.html',
  'js/shared-config.js',
  'js/privacy-consent.js',
  'css/privacy-consent.css',
];

async function text(browser, relative) {
  return readFile(path.join(root, 'extension', browser, relative), 'utf8');
}

test('all three browser packages contain the required production files', async () => {
  for (const browser of browsers) {
    for (const relative of requiredFiles) {
      assert.ok((await text(browser, relative)).length > 0, `${browser}/${relative}`);
    }
  }
});

test('manifests keep the approved API permissions and production version', async () => {
  for (const browser of browsers) {
    const manifest = JSON.parse(await text(browser, 'manifest.json'));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, '0.4.0');
    assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'tabs']);
    assert.ok(manifest.host_permissions.every((origin) => origin.startsWith('https://')));
    assert.equal(JSON.stringify(manifest).includes('localhost'), false);
  }
});

test('Firefox accurately declares browsing data collection', async () => {
  const manifest = JSON.parse(await text('firefox', 'manifest.json'));
  assert.equal(Number.parseInt(manifest.browser_specific_settings.gecko.strict_min_version, 10) >= 140, true);
  assert.deepEqual(
    manifest.browser_specific_settings.gecko.data_collection_permissions.required,
    ['browsingActivity', 'personallyIdentifyingInfo'],
  );
});

test('background transmission is consent-gated and sends only approved fields', async () => {
  for (const browser of browsers) {
    const background = await text(browser, 'background.js');
    assert.match(background, /consentEnabled\(\)/);
    assert.match(background, /installationId,\s*domain,\s*consentVersion/);
    assert.doesNotMatch(background, /pageTitle|fullUrl|history\.search|cookies\./i);
    assert.match(background, /tab\.incognito/);
    assert.match(background, /\['http:', 'https:'\]/);
  }
});

test('the Aviationstack key is absent from all extension configuration', async () => {
  for (const browser of browsers) {
    const config = await text(browser, 'js/shared-config.js');
    const background = await text(browser, 'background.js');
    assert.doesNotMatch(`${config}\n${background}`, /AVIATIONSTACK_API_KEY|access_key/i);
  }
});

test('shared extension code remains identical across browsers', async () => {
  for (const relative of requiredFiles.filter((file) => file !== 'manifest.json')) {
    const [chrome, edge, firefox] = await Promise.all(browsers.map((browser) => text(browser, relative)));
    assert.equal(edge, chrome, `Edge mismatch: ${relative}`);
    assert.equal(firefox, chrome, `Firefox mismatch: ${relative}`);
  }
});
