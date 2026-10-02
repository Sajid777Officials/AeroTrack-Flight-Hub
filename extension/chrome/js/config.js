import './shared-config.js';

const shared = globalThis.AEROTRACK_CONFIG;
const endpointConfigured = !shared.backendBaseUrl.includes('REPLACE-WITH-CLOUDFLARE-SUBDOMAIN');

export const APP_CONFIG = Object.freeze({
  ...shared,
  environmentName: endpointConfigured ? 'Cloudflare production' : 'Backend setup required',
  apiBaseUrl: `${shared.backendBaseUrl.replace(/\/$/, '')}/api`,
  endpointConfigured,
  // Optional in-page search only. It never changes browser default search settings.
  webSearchUrl: shared.webSearchUrl,
});
