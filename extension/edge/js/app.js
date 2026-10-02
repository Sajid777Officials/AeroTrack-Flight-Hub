import { APP_CONFIG } from './config.js';
import { lookupAirlines, lookupAirports, lookupFlights } from './api.js';
import {
  clearSavedLookups,
  getConsent,
  getDomainSharingConsent,
  getFavorites,
  getPreferences,
  getRecentSearches,
  saveFavorites,
  savePreferences,
  saveRecentSearches,
  setConsent,
} from './consent.js';
import { openExternal, openOptions } from './browser.js';
import { setupAutocomplete } from './autocomplete.js';

const $ = (selector, from = document) => from.querySelector(selector);
const $$ = (selector, from = document) => [...from.querySelectorAll(selector)];

function createElement(tag, className = '', text = null) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== null) element.textContent = String(text);
  return element;
}

const state = {
  mode: 'route',
  selected: { origin: null, destination: null, airline: null },
  results: [],
  resultMeta: null,
  sort: 'departure:asc',
  lastSearch: null,
  saved: { favorites: [], recent: [] },
};

function showMessage(message = '', type = 'info') {
  const messageBox = $('#message');
  messageBox.textContent = message;
  messageBox.className = `message ${message ? `message--${type}` : ''}`;
}

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function appDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function duration(from, to) {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';
  let minutes = Math.round((end - start) / 60000);
  if (minutes < 0) minutes += 24 * 60;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function status(statusValue = '') {
  const normalized = String(statusValue).toLowerCase();
  const labels = { active: 'En route', landed: 'Landed', scheduled: 'Scheduled', cancelled: 'Cancelled', delayed: 'Delayed' };
  return labels[normalized] ?? (normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Unknown');
}

function iataFromInput(value, selected) {
  if (selected?.iata) return selected.iata;
  const result = String(value).toUpperCase().match(/\b([A-Z]{3})\b/);
  return result?.[1] ?? '';
}

function airlineFromInput(value, selected) {
  if (selected?.iata) return selected.iata;
  const result = String(value).toUpperCase().match(/\b([A-Z0-9]{2,3})\b/);
  return result?.[1] ?? '';
}

function formatInput(item) {
  return item.city ? `${item.name} — ${item.city} (${item.iata})` : `${item.name} (${item.iata})`;
}

function sourceLabel(source) {
  const value = String(source || '').toLowerCase();
  if (value === 'mock') return 'Demo data';
  return value ? 'Live provider' : 'Flight API';
}

function searchKey(params) {
  return params.mode === 'flight'
    ? `flight:${params.airline_iata}:${params.flight_number}:${params.date}`
    : `route:${params.dep_iata}:${params.arr_iata}:${params.date}`;
}

function searchLabel(params) {
  return params.mode === 'flight'
    ? `${params.airline_iata} ${params.flight_number}`
    : `${params.dep_iata} → ${params.arr_iata}`;
}

function searchSubtitle(params) {
  return `${params.mode === 'flight' ? 'Flight number lookup' : 'Route lookup'} · ${params.date}`;
}

function searchRecord(params) {
  return {
    id: searchKey(params),
    label: searchLabel(params),
    subtitle: searchSubtitle(params),
    params: { ...params },
    createdAt: new Date().toISOString(),
  };
}

function setMode(mode) {
  state.mode = mode;
  $$('.mode-tab').forEach((tab) => {
    const selected = tab.dataset.mode === mode;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  $$('.search-form').forEach((form) => { form.hidden = form.dataset.form !== mode; });
  showMessage('');
}

function sortedResults() {
  const [key, direction] = state.sort.split(':');
  const sign = direction === 'desc' ? -1 : 1;
  const value = (flight) => {
    if (key === 'duration') return new Date(flight.arrival?.scheduled).getTime() - new Date(flight.departure?.scheduled).getTime();
    if (key === 'arrival') return new Date(flight.arrival?.scheduled).getTime();
    return new Date(flight.departure?.scheduled).getTime();
  };
  return [...state.results].sort((a, b) => (value(a) - value(b)) * sign);
}

function flightCard(flight, index) {
  const rawStatus = String(flight.flight_status || 'unknown').toLowerCase();
  const knownStatus = ['active', 'landed', 'scheduled', 'cancelled', 'delayed'].includes(rawStatus) ? rawStatus : 'unknown';
  const dep = flight.departure || {};
  const arr = flight.arrival || {};

  const card = createElement('article', 'flight-card');
  const top = createElement('div', 'flight-card__top');
  const title = createElement('div');
  title.append(
    createElement('p', 'eyebrow', flight.airline?.name || 'Airline'),
    createElement('h3', '', `${flight.airline?.iata || ''} ${flight.flight?.number || '—'}`.trim()),
  );
  top.append(title, createElement('span', `status status--${knownStatus}`, status(rawStatus)));

  const route = createElement('div', 'route-line');
  const point = (data, atEnd = false) => {
    const element = createElement('div', `route-line__point${atEnd ? ' route-line__point--end' : ''}`);
    element.append(createElement('b', '', data.iata || '—'), createElement('span', '', appDate(data.scheduled)));
    return element;
  };
  const middle = createElement('div', 'route-line__middle');
  middle.append(createElement('i'), createElement('small', '', duration(dep.scheduled, arr.scheduled)), createElement('i'));
  route.append(point(dep), middle, point(arr, true));

  const footer = createElement('footer');
  const actions = createElement('span', 'flight-card__actions');
  const copy = createElement('button', 'text-button copy-button', 'Copy');
  copy.type = 'button';
  copy.dataset.index = String(index);
  const details = createElement('button', 'secondary detail-button', 'Details');
  details.type = 'button';
  details.dataset.index = String(index);
  actions.append(copy, details);
  footer.append(createElement('span', '', `Terminal ${dep.terminal || '—'} · Gate ${dep.gate || '—'}`), actions);
  card.append(top, route, footer);
  return card;
}

function renderResults() {
  const target = $('#results');
  const results = sortedResults();
  $('#result-count').textContent = results.length ? `${results.length} match${results.length === 1 ? '' : 'es'} · ${sourceLabel(state.resultMeta?.source)}` : '';
  $('#data-mode').textContent = state.resultMeta?.source ? `Data source: ${sourceLabel(state.resultMeta.source)}` : `Environment: ${APP_CONFIG.environmentName}`;
  $('#save-current').hidden = !state.lastSearch || !results.length;
  if (!results.length) {
    const empty = createElement('div', 'empty-state');
    empty.append(
      createElement('strong', '', 'Ready when you are.'),
      createElement('span', '', 'Search by route or flight number to see schedules, terminals, gates, and status.'),
    );
    target.replaceChildren(empty);
    return;
  }
  target.replaceChildren(...results.map(flightCard));
  $$('.detail-button', target).forEach((button) => button.addEventListener('click', () => openDetails(results[Number(button.dataset.index)])));
  $$('.copy-button', target).forEach((button) => button.addEventListener('click', () => copyFlight(results[Number(button.dataset.index)], button)));
}

function openDetails(flight) {
  const dep = flight.departure || {};
  const arr = flight.arrival || {};
  $('#detail-title').textContent = `${flight.airline?.name || 'Flight'} ${flight.airline?.iata || ''}${flight.flight?.number || ''}`.trim();
  const grid = createElement('div', 'detail-grid');
  const detail = (label, value, secondary = '') => {
    const section = createElement('section');
    section.append(createElement('span', '', label), createElement('strong', '', value));
    if (secondary) section.append(createElement('small', '', secondary));
    return section;
  };
  grid.append(
    detail('Departure', dep.iata || '—', appDate(dep.scheduled)),
    detail('Arrival', arr.iata || '—', appDate(arr.scheduled)),
    detail('Status', status(flight.flight_status)),
    detail('Duration', duration(dep.scheduled, arr.scheduled)),
    detail('Departure terminal / gate', `${dep.terminal || '—'} / ${dep.gate || '—'}`),
    detail('Arrival terminal / gate', `${arr.terminal || '—'} / ${arr.gate || '—'}`),
  );
  $('#detail-content').replaceChildren(grid);
  const dialog = $('#details-dialog');
  if (!dialog.open) dialog.showModal();
  $('#details-close').focus();
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

async function copyFlight(flight, button) {
  const dep = flight.departure || {};
  const arr = flight.arrival || {};
  const text = [
    `${flight.airline?.name || 'Airline'} ${flight.airline?.iata || ''}${flight.flight?.number || ''}`.trim(),
    `${dep.iata || '—'} → ${arr.iata || '—'}`,
    `Status: ${status(flight.flight_status)}`,
    `Departure: ${appDate(dep.scheduled)} · Terminal ${dep.terminal || '—'} · Gate ${dep.gate || '—'}`,
    `Arrival: ${appDate(arr.scheduled)} · Terminal ${arr.terminal || '—'} · Gate ${arr.gate || '—'}`,
    `Duration: ${duration(dep.scheduled, arr.scheduled)}`,
  ].join('\n');
  const original = button.textContent;
  try {
    await copyToClipboard(text);
    button.textContent = 'Copied';
    showMessage('Flight details copied to your clipboard.', 'info');
  } catch {
    showMessage('Could not copy flight details. Please use the Details view instead.', 'error');
  } finally {
    window.setTimeout(() => { button.textContent = original; }, 1300);
  }
}

function selectItem(key, input, item) {
  state.selected[key] = item;
  input.value = formatInput(item);
}

function collectSearchParams(form) {
  const date = $('[name="date"]', form).value;
  const params = {
    mode: state.mode,
    date,
    timezone_offset_minutes: String(new Date().getTimezoneOffset()),
  };
  if (state.mode === 'route') {
    params.dep_iata = iataFromInput($('[name="origin"]', form).value, state.selected.origin);
    params.arr_iata = iataFromInput($('[name="destination"]', form).value, state.selected.destination);
    if (!params.dep_iata || !params.arr_iata) throw new Error('Choose valid departure and arrival airports from the suggestions, or use a three-letter IATA code.');
  } else {
    params.airline_iata = airlineFromInput($('[name="airline"]', form).value, state.selected.airline);
    params.flight_number = $('[name="flightNumber"]', form).value.trim();
    if (!params.airline_iata || !params.flight_number) throw new Error('Choose an airline and enter a flight number.');
  }
  return params;
}

async function rememberSearch(params) {
  const record = searchRecord(params);
  const recent = await getRecentSearches();
  const next = [record, ...recent.filter((item) => item.id !== record.id)].slice(0, 8);
  await saveRecentSearches(next);
}

async function refreshSavedSearches() {
  state.saved.favorites = await getFavorites();
  state.saved.recent = await getRecentSearches();
  const section = $('#saved-searches');
  const hasItems = state.saved.favorites.length || state.saved.recent.length;
  section.hidden = !hasItems;
  if (!hasItems) return;

  const renderItems = (items, listName, emptyText) => {
    const fragment = document.createDocumentFragment();
    if (!items.length) {
      fragment.append(createElement('li', 'saved-empty', emptyText));
      return fragment;
    }

    items.forEach((item, index) => {
      const listItem = createElement('li', 'saved-item');
      const copy = createElement('span');
      copy.append(createElement('strong', '', item.label), createElement('small', '', item.subtitle));
      const actions = createElement('span', 'saved-actions');
      const actionButton = (action, label) => {
        const button = createElement('button', 'text-button', label);
        button.type = 'button';
        button.dataset.savedList = listName;
        button.dataset.savedIndex = String(index);
        button.dataset.action = action;
        return button;
      };
      actions.append(actionButton('run', 'Use'));
      if (listName === 'favorites') actions.append(actionButton('remove', 'Remove'));
      listItem.append(copy, actions);
      fragment.append(listItem);
    });
    return fragment;
  };

  $('#favorites-list').replaceChildren(renderItems(state.saved.favorites, 'favorites', 'No saved lookups yet.'));
  $('#recent-list').replaceChildren(renderItems(state.saved.recent, 'recent', 'No recent lookups yet.'));
  const isFavorite = state.lastSearch && state.saved.favorites.some((item) => item.id === searchKey(state.lastSearch));
  $('#save-current').textContent = isFavorite ? 'Saved' : 'Save lookup';
}

async function toggleCurrentFavorite() {
  if (!state.lastSearch) return;
  const record = searchRecord(state.lastSearch);
  const current = await getFavorites();
  const exists = current.some((item) => item.id === record.id);
  await saveFavorites(exists ? current.filter((item) => item.id !== record.id) : [record, ...current].slice(0, 12));
  await refreshSavedSearches();
  showMessage(exists ? 'Lookup removed from saved items.' : 'Lookup saved locally in this browser.', 'info');
}

async function runSavedSearch(listName, index) {
  const item = state.saved[listName]?.[index];
  if (!item?.params) return;
  const params = item.params;
  setMode(params.mode);
  if (params.mode === 'route') {
    const form = $('#route-form');
    $('[name="origin"]', form).value = params.dep_iata;
    $('[name="destination"]', form).value = params.arr_iata;
    $('[name="date"]', form).value = params.date;
    state.selected.origin = null;
    state.selected.destination = null;
  } else {
    const form = $('#flight-form');
    $('[name="airline"]', form).value = params.airline_iata;
    $('[name="flightNumber"]', form).value = params.flight_number;
    $('[name="date"]', form).value = params.date;
    state.selected.airline = null;
  }
  await runSearch(params);
}

async function runSearch(params, button = null) {
  const originalText = button?.textContent;
  try {
    if (button) {
      button.disabled = true;
      button.textContent = 'Tracking…';
    }
    showMessage('');
    const result = await lookupFlights(params);
    state.results = result.data || [];
    state.resultMeta = result.meta || null;
    state.lastSearch = { ...params };
    await rememberSearch(params);
    await refreshSavedSearches();
    renderResults();
    $('#results-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!state.results.length) showMessage('No matching flights were returned for those details.', 'info');
  } catch (error) {
    state.results = [];
    state.resultMeta = null;
    renderResults();
    showMessage(error.message || 'Flight lookup failed. Please try again.', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function submitSearch(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  try {
    await runSearch(collectSearchParams(form), button);
  } catch (error) {
    showMessage(error.message || 'Check the search fields and try again.', 'error');
  }
}

async function renderConsent() {
  const [consent, domainConsent] = await Promise.all([getConsent(), getDomainSharingConsent()]);
  $('#consent-dialog').hidden = consent !== null;
  $('#optional-search').hidden = consent !== true;
  const domainLabel = domainConsent === true ? 'Domain sharing: enabled' : domainConsent === false ? 'Domain sharing: off' : 'Domain choice needed';
  const searchLabel = consent === true ? 'optional search enabled' : consent === false ? 'optional search hidden' : 'search choice needed';
  $('#privacy-state').textContent = `${domainLabel} · ${searchLabel}`;
}

function applyConsentUi(value) {
  $('#consent-dialog').hidden = true;
  $('#optional-search').hidden = value !== true;
  $('#privacy-state').textContent = value === true ? 'Optional search: enabled' : 'Optional search: disabled';
}

async function chooseConsent(value) {
  applyConsentUi(value);
  try {
    await setConsent(value);
    await renderConsent();
  } catch (error) {
    showMessage(error.message || 'Your privacy choice could not be saved. Please try again.', 'error');
    $('#consent-dialog').hidden = false;
  }
}

async function initConsent() {
  $('#consent-accept').addEventListener('click', () => chooseConsent(true));
  $('#consent-decline').addEventListener('click', () => chooseConsent(false));
  $('#manage-privacy').addEventListener('click', () => openOptions());
  $('#optional-search-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = $('[name="query"]', event.currentTarget).value.trim();
    if (!query) return;
    await openExternal(APP_CONFIG.webSearchUrl.replace('{query}', encodeURIComponent(query)));
  });
  await renderConsent();
}

async function initTheme() {
  const preferences = await getPreferences();
  document.documentElement.dataset.theme = preferences.theme;
}

function initAutocomplete() {
  const origin = $('[name="origin"]');
  const destination = $('[name="destination"]');
  const airline = $('[name="airline"]');
  setupAutocomplete({ input: origin, listbox: $('#origin-listbox'), loader: lookupAirports, label: 'Departure airport', onSelect: (item) => selectItem('origin', origin, item) });
  setupAutocomplete({ input: destination, listbox: $('#destination-listbox'), loader: lookupAirports, label: 'Arrival airport', onSelect: (item) => selectItem('destination', destination, item) });
  setupAutocomplete({ input: airline, listbox: $('#airline-listbox'), loader: lookupAirlines, label: 'Airline', onSelect: (item) => selectItem('airline', airline, item) });
}

function initUi() {
  $('#app-name').textContent = APP_CONFIG.appName;
  $('#build-label').textContent = `v${APP_CONFIG.buildVersion}`;
  $('#data-mode').textContent = `Environment: ${APP_CONFIG.environmentName}`;
  const today = localToday();
  $$('input[type="date"]').forEach((input) => { input.value = today; input.min = today; });
  $$('.mode-tab').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $$('.search-form').forEach((form) => form.addEventListener('submit', submitSearch));
  $('#swap-route').addEventListener('click', () => {
    const origin = $('[name="origin"]');
    const destination = $('[name="destination"]');
    [origin.value, destination.value] = [destination.value, origin.value];
    [state.selected.origin, state.selected.destination] = [state.selected.destination, state.selected.origin];
  });
  $('#sort').addEventListener('change', (event) => { state.sort = event.target.value; renderResults(); });
  $('#details-close').addEventListener('click', () => $('#details-dialog').close());
  $('#details-dialog').addEventListener('click', (event) => { if (event.target === $('#details-dialog')) $('#details-dialog').close(); });
  $('#open-support').addEventListener('click', async () => { if (APP_CONFIG.supportUrl.startsWith('http')) await openExternal(APP_CONFIG.supportUrl); });
  $('#save-current').addEventListener('click', toggleCurrentFavorite);
  $('#saved-searches').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const listName = button.dataset.savedList;
    const index = Number(button.dataset.savedIndex);
    if (button.dataset.action === 'run') await runSavedSearch(listName, index);
    if (button.dataset.action === 'remove' && listName === 'favorites') {
      const current = await getFavorites();
      await saveFavorites(current.filter((_, itemIndex) => itemIndex !== index));
      await refreshSavedSearches();
    }
  });
  $('#clear-recent').addEventListener('click', async () => { await clearSavedLookups('recent'); await refreshSavedSearches(); });
  $('#clear-favorites').addEventListener('click', async () => { await clearSavedLookups('favorites'); await refreshSavedSearches(); });
}

async function main() {
  await initTheme();
  initUi();
  initAutocomplete();
  await initConsent();
  await refreshSavedSearches();
  renderResults();
}

document.addEventListener('DOMContentLoaded', () => main().catch((error) => showMessage(error.message || 'Unable to start the dashboard.', 'error')));
