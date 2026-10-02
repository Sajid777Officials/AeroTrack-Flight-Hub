import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browsers = ['chrome', 'edge', 'firefox'];
const [workerInput, privacyInput = '', supportInput = ''] = process.argv.slice(2);

function requiredHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must be a clean HTTPS URL without credentials, query text, or a fragment.`);
  }
  return parsed;
}

function optionalHttpsUrl(value, label) {
  if (!value) return '';
  return requiredHttpsUrl(value, label).href.replace(/\/$/, '');
}

if (!workerInput) {
  throw new Error('Usage: npm run configure -- https://YOUR-WORKER.workers.dev [PRIVACY_URL] [SUPPORT_URL]');
}

const worker = requiredHttpsUrl(workerInput, 'Worker URL');
worker.pathname = worker.pathname.replace(/\/+$/, '') || '/';
if (worker.pathname !== '/') throw new Error('Worker URL must contain only its origin, without an API path.');
const workerOrigin = worker.origin;
const privacyUrl = optionalHttpsUrl(privacyInput, 'Privacy URL');
const supportUrl = optionalHttpsUrl(supportInput, 'Support URL');

for (const browser of browsers) {
  const browserRoot = path.join(projectRoot, 'extension', browser);
  const configPath = path.join(browserRoot, 'js', 'shared-config.js');
  let config = await readFile(configPath, 'utf8');
  config = config.replace(
    /const backendBaseUrl = '[^']*';/,
    `const backendBaseUrl = '${workerOrigin}';`,
  );
  if (privacyUrl) config = config.replace(/privacyUrl: '[^']*'/, `privacyUrl: '${privacyUrl}'`);
  if (supportUrl) config = config.replace(/supportUrl: '[^']*'/, `supportUrl: '${supportUrl}'`);
  await writeFile(configPath, config);

  const manifestPath = path.join(browserRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [`${workerOrigin}/*`];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`Configured Chrome, Edge, and Firefox for ${workerOrigin}`);
