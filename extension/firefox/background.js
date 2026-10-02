if (typeof importScripts === 'function') {
  importScripts('js/shared-config.js');
}

const ext = globalThis.browser ?? globalThis.chrome;
const config = globalThis.AEROTRACK_CONFIG || {};

const KEYS = Object.freeze({
  consent: 'aerotrackDomainSharingConsent',
  consentAt: 'aerotrackDomainSharingConsentAt',
  consentVersion: 'aerotrackDomainSharingConsentVersion',
  installationId: 'aerotrackInstallationId',
  lastObservedDomain: 'aerotrackLastObservedDomain',
  pendingDomain: 'aerotrackPendingDomain',
  status: 'aerotrackDomainSharingStatus',
});

const CONSENT_VERSION = '1';
const RETRY_ALARM = 'aerotrack-domain-retry';
const PLACEHOLDER = 'REPLACE-WITH-CLOUDFLARE-SUBDOMAIN';

function configuredEndpoint() {
  return typeof config.activityApiUrl === 'string'
    && config.activityApiUrl.startsWith('https://')
    && !config.activityApiUrl.includes(PLACEHOLDER);
}

function fallbackUuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

async function storageGet(defaults) {
  return ext.storage.local.get(defaults);
}

async function storageSet(values) {
  return ext.storage.local.set(values);
}

async function storageRemove(keys) {
  return ext.storage.local.remove(keys);
}

async function ensureInstallationId() {
  const stored = await storageGet({ [KEYS.installationId]: '' });
  if (stored[KEYS.installationId]) return stored[KEYS.installationId];
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : fallbackUuid();
  await storageSet({ [KEYS.installationId]: id });
  return id;
}

async function consentEnabled() {
  const stored = await storageGet({ [KEYS.consent]: null });
  return stored[KEYS.consent] === true;
}

function hostnameFromTab(tab) {
  if (!tab || tab.incognito || typeof tab.url !== 'string') return '';
  try {
    const parsed = new URL(tab.url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

async function setStatus(state, detail = {}) {
  await storageSet({
    [KEYS.status]: {
      state,
      updatedAt: new Date().toISOString(),
      ...detail,
    },
  });
}

async function sendDomain(domain) {
  if (!configuredEndpoint()) {
    await storageSet({ [KEYS.pendingDomain]: { domain, queuedAt: new Date().toISOString() } });
    await setStatus('not_configured');
    return false;
  }

  const installationId = await ensureInstallationId();
  const response = await fetch(config.activityApiUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      installationId,
      domain,
      consentVersion: CONSENT_VERSION,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message || `Activity API returned HTTP ${response.status}.`);
  }

  await storageRemove(KEYS.pendingDomain);
  await setStatus('sent', { lastDomain: domain });
  return true;
}

async function queueLatestDomain(domain, error) {
  await storageSet({
    [KEYS.pendingDomain]: {
      domain,
      queuedAt: new Date().toISOString(),
    },
  });
  await setStatus('queued', { error: String(error?.message || 'Temporarily offline').slice(0, 180) });
}

async function observeDomain(domain) {
  if (!domain || !await consentEnabled()) return;

  const stored = await storageGet({ [KEYS.lastObservedDomain]: '' });
  if (stored[KEYS.lastObservedDomain] === domain) return;

  await storageSet({ [KEYS.lastObservedDomain]: domain });
  try {
    await sendDomain(domain);
  } catch (error) {
    await queueLatestDomain(domain, error);
  }
}

async function observeTab(tab) {
  if (!tab?.active) return;
  const domain = hostnameFromTab(tab);
  if (domain) await observeDomain(domain);
}

async function observeTabById(tabId) {
  try {
    await observeTab(await ext.tabs.get(tabId));
  } catch {
    // The tab may have closed before the async lookup completed.
  }
}

async function observeCurrentTab(windowId) {
  const query = { active: true };
  if (Number.isInteger(windowId)) query.windowId = windowId;
  else query.lastFocusedWindow = true;
  const tabs = await ext.tabs.query(query);
  if (tabs[0]) await observeTab(tabs[0]);
}

async function retryPendingDomain() {
  if (!await consentEnabled()) return;
  const stored = await storageGet({ [KEYS.pendingDomain]: null });
  const domain = stored[KEYS.pendingDomain]?.domain;
  if (!domain) return;
  try {
    await sendDomain(domain);
  } catch (error) {
    await queueLatestDomain(domain, error);
  }
}

async function ensureRetryAlarm() {
  const existing = await ext.alarms.get(RETRY_ALARM);
  if (!existing) await ext.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
}

async function configureUninstallFeedback() {
  const url = config.uninstallFeedbackUrl || '';
  if (!url.startsWith('https://') || typeof ext.runtime.setUninstallURL !== 'function') return;
  try {
    await ext.runtime.setUninstallURL(url);
  } catch (error) {
    console.warn('Unable to set uninstall feedback URL.', error);
  }
}

async function openConsentIfNeeded(details) {
  const stored = await storageGet({ [KEYS.consent]: null });
  const missingChoice = stored[KEYS.consent] !== true && stored[KEYS.consent] !== false;
  const collectingUpdate = details.reason === 'update' && String(details.previousVersion || '').startsWith('0.3.');
  if (details.reason === 'install' || missingChoice || collectingUpdate) {
    await ext.tabs.create({ url: ext.runtime.getURL('privacy-consent.html') });
  }
}

async function applyConsent(value) {
  if (value === true) {
    await storageSet({
      [KEYS.consent]: true,
      [KEYS.consentAt]: new Date().toISOString(),
      [KEYS.consentVersion]: CONSENT_VERSION,
    });
    await setStatus(configuredEndpoint() ? 'ready' : 'not_configured');
    await observeCurrentTab();
    await retryPendingDomain();
    return;
  }

  await storageSet({ [KEYS.consent]: false });
  await storageRemove([KEYS.pendingDomain, KEYS.lastObservedDomain]);
  await setStatus('disabled');
}

ext.tabs.onActivated.addListener((activeInfo) => {
  void observeTabById(activeInfo.tabId);
});

ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && typeof changeInfo.url === 'string') void observeTabById(tabId);
});

if (ext.windows?.onFocusChanged) {
  ext.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== ext.windows.WINDOW_ID_NONE) void observeCurrentTab(windowId);
  });
}

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) void retryPendingDomain();
});

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'aerotrack:set-domain-sharing') {
    applyConsent(message.enabled === true)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'aerotrack:retry-domain-sharing') {
    retryPendingDomain()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

ext.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await configureUninstallFeedback();
    await ensureInstallationId();
    await ensureRetryAlarm();
    await openConsentIfNeeded(details);
    if (await consentEnabled()) await observeCurrentTab();
  })();
});

ext.runtime.onStartup?.addListener(() => {
  void (async () => {
    await configureUninstallFeedback();
    await ensureRetryAlarm();
    if (await consentEnabled()) {
      await observeCurrentTab();
      await retryPendingDomain();
    }
  })();
});
