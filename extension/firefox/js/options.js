import { APP_CONFIG } from './config.js';
import { healthCheck } from './api.js';
import {
  clearSavedLookups,
  getConsent,
  getDomainSharingConsent,
  getDomainSharingStatus,
  getFavorites,
  getInstallationId,
  getPreferences,
  getRecentSearches,
  savePreferences,
  setConsent,
} from './consent.js';
import { ext, openExternal, openExtensionPage } from './browser.js';

const $ = (selector) => document.querySelector(selector);

async function render() {
  const consent = await getConsent();
  const domainConsent = await getDomainSharingConsent();
  const domainStatus = await getDomainSharingStatus();
  const installationId = await getInstallationId();
  const preferences = await getPreferences();
  const favorites = await getFavorites();
  const recent = await getRecentSearches();
  $('#consent-state').textContent = consent === true ? 'Accepted — optional in-page web search is visible.' : consent === false ? 'Declined — flight lookup remains active and optional web search is hidden.' : 'Not chosen yet — the next dashboard visit will show the choice.';
  const statusLabels = {
    sent: `Last domain record sent${domainStatus?.lastDomain ? ` for ${domainStatus.lastDomain}` : ''}.`,
    queued: 'The latest domain is waiting for the backend connection.',
    not_configured: 'Enabled, but the Cloudflare Worker URL still needs to be configured.',
    ready: 'Enabled and ready to send the next active-domain change.',
    disabled: 'No active-domain records are being sent.',
  };
  const maskedId = installationId ? ` Installation ID ending ${installationId.slice(-8)}.` : '';
  $('#domain-sharing-state').textContent = domainConsent === true
    ? `Enabled — ${statusLabels[domainStatus?.state] || 'waiting for the next domain change.'}${maskedId}`
    : domainConsent === false
      ? 'Off — no active-domain records are being sent.'
      : 'Not chosen — review the disclosure before enabling.';
  $('#theme').value = preferences.theme;
  $('#saved-count').textContent = `${favorites.length} saved lookup${favorites.length === 1 ? '' : 's'} and ${recent.length} recent lookup${recent.length === 1 ? '' : 's'} are stored locally in this browser.`;
  $('#api-summary').textContent = `Configured environment: ${APP_CONFIG.environmentName}. The API key is never stored in this extension.`;
}

async function testConnection() {
  const button = $('#test-connection');
  const output = $('#connection-result');
  const original = button.textContent;
  try {
    button.disabled = true;
    button.textContent = 'Checking…';
    output.textContent = 'Checking the configured API health endpoint…';
    const data = await healthCheck();
    output.textContent = `Connected — ${data.service || 'Flight API'} · provider: ${data.provider || 'unknown'} · version: ${data.version || APP_CONFIG.buildVersion}`;
    output.className = 'settings-status settings-status--good';
  } catch (error) {
    output.textContent = error.message || 'Could not reach the configured API.';
    output.className = 'settings-status settings-status--error';
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  $('#domain-sharing-review').addEventListener('click', () => openExtensionPage('privacy-consent.html'));
  $('#domain-sharing-disable').addEventListener('click', async () => {
    await ext.runtime.sendMessage({ type: 'aerotrack:set-domain-sharing', enabled: false });
    await render();
  });
  $('#domain-sharing-retry').addEventListener('click', async () => {
    await ext.runtime.sendMessage({ type: 'aerotrack:retry-domain-sharing' });
    await render();
  });
  $('#consent-reset').addEventListener('click', async () => { try { await setConsent(null); await render(); } catch (error) { $('#consent-state').textContent = error.message || 'Unable to reset consent.'; } });
  $('#consent-accept').addEventListener('click', async () => { try { await setConsent(true); await render(); } catch (error) { $('#consent-state').textContent = error.message || 'Unable to save consent.'; } });
  $('#consent-decline').addEventListener('click', async () => { try { await setConsent(false); await render(); } catch (error) { $('#consent-state').textContent = error.message || 'Unable to save consent.'; } });
  $('#theme').addEventListener('change', async (event) => { await savePreferences({ theme: event.target.value }); document.documentElement.dataset.theme = event.target.value; });
  $('#privacy-link').addEventListener('click', async () => { if (APP_CONFIG.privacyUrl.startsWith('http')) await openExternal(APP_CONFIG.privacyUrl); });
  $('#support-link').addEventListener('click', async () => { if (APP_CONFIG.supportUrl.startsWith('http')) await openExternal(APP_CONFIG.supportUrl); });
  $('#test-connection').addEventListener('click', testConnection);
  $('#clear-local-data').addEventListener('click', async () => { await clearSavedLookups('all'); await render(); $('#saved-count').textContent = 'Saved and recent lookups were cleared from this browser.'; });
  const prefs = await getPreferences();
  document.documentElement.dataset.theme = prefs.theme;
  await render();
});
