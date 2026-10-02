import { storage } from './browser.js';

export const CONSENT_KEY = 'aerotrackOptionalSearchConsent';
export const DOMAIN_SHARING_CONSENT_KEY = 'aerotrackDomainSharingConsent';
export const DOMAIN_SHARING_STATUS_KEY = 'aerotrackDomainSharingStatus';
export const INSTALLATION_ID_KEY = 'aerotrackInstallationId';
export const PREFERENCES_KEY = 'aerotrackPreferences';
export const FAVORITES_KEY = 'aerotrackSavedFlightLookups';
export const RECENT_KEY = 'aerotrackRecentFlightLookups';

function readLocal(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    if (value === null || typeof value === 'undefined') localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local preferences are non-sensitive. The extension still works if persistence is unavailable.
  }
}

async function getValue(key, fallback) {
  const local = readLocal(key, fallback);
  try {
    const values = await storage.get({ [key]: local });
    return typeof values[key] === 'undefined' ? local : values[key];
  } catch {
    return local;
  }
}

async function setValue(key, value) {
  writeLocal(key, value);
  try {
    await storage.set({ [key]: value });
  } catch {
    // localStorage already holds the value as an immediate fallback.
  }
}

function toArray(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

export async function getConsent() {
  const value = await getValue(CONSENT_KEY, null);
  return value === true || value === false ? value : null;
}

export async function setConsent(value) {
  if (![true, false, null].includes(value)) throw new TypeError('Consent must be true, false, or null.');
  await setValue(CONSENT_KEY, value);
}

export async function getDomainSharingConsent() {
  const value = await getValue(DOMAIN_SHARING_CONSENT_KEY, null);
  return value === true || value === false ? value : null;
}

export async function getDomainSharingStatus() {
  const value = await getValue(DOMAIN_SHARING_STATUS_KEY, null);
  return value && typeof value === 'object' ? value : null;
}

export async function getInstallationId() {
  const value = await getValue(INSTALLATION_ID_KEY, '');
  return typeof value === 'string' ? value : '';
}

export async function getPreferences() {
  const value = await getValue(PREFERENCES_KEY, { theme: 'system' });
  return { theme: 'system', ...(value && typeof value === 'object' ? value : {}) };
}

export async function savePreferences(next) {
  const current = await getPreferences();
  await setValue(PREFERENCES_KEY, { ...current, ...next });
}

export async function getFavorites() {
  return toArray(await getValue(FAVORITES_KEY, []));
}

export async function saveFavorites(items) {
  await setValue(FAVORITES_KEY, toArray(items).slice(0, 12));
}

export async function getRecentSearches() {
  return toArray(await getValue(RECENT_KEY, []));
}

export async function saveRecentSearches(items) {
  await setValue(RECENT_KEY, toArray(items).slice(0, 8));
}

export async function clearSavedLookups(kind = 'all') {
  if (kind === 'favorites' || kind === 'all') await setValue(FAVORITES_KEY, []);
  if (kind === 'recent' || kind === 'all') await setValue(RECENT_KEY, []);
}
