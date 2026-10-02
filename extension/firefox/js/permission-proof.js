const ext = globalThis.browser ?? globalThis.chrome;
const proofKey = '__aerotrack_permission_proof__';
const proofAlarm = '__aerotrack_permission_proof__';

const cards = Object.fromEntries(
  [...document.querySelectorAll('[data-permission]')].map((card) => [
    card.dataset.permission,
    card,
  ]),
);

function setCard(permission, passed) {
  const card = cards[permission];
  card.classList.remove('pending', 'pass', 'fail');
  card.classList.add(passed ? 'pass' : 'fail');
  card.querySelector('.status-icon').textContent = passed ? '✓' : '!';
  card.querySelector('.status-label').textContent = passed ? 'PASS' : 'FAILED';
}

function detectBrowser() {
  const userAgent = navigator.userAgent;
  if (userAgent.includes('Edg/')) return 'Microsoft Edge';
  if (userAgent.includes('Firefox/')) return 'Mozilla Firefox';
  if (userAgent.includes('Chrome/')) return 'Google Chrome';
  return 'Compatible browser';
}

async function renderBackendStatus() {
  const panel = document.querySelector('#backend-status');
  const title = document.querySelector('#backend-status-title');
  const detail = document.querySelector('#backend-status-detail');
  const icon = document.querySelector('#backend-status-icon');
  const values = await ext.storage.local.get({
    aerotrackDomainSharingConsent: null,
    aerotrackDomainSharingStatus: null,
  });
  const consent = values.aerotrackDomainSharingConsent;
  const state = values.aerotrackDomainSharingStatus?.state || '';

  panel.className = 'backend-status';
  if (consent !== true) {
    panel.classList.add(consent === false ? 'off' : 'pending');
    icon.textContent = consent === false ? '–' : '!';
    title.textContent = consent === false ? 'Domain sharing is off' : 'User consent is required';
    detail.textContent = consent === false
      ? 'No active-domain records are being sent.'
      : 'Nothing is sent until the user accepts the data-sharing choice.';
    return;
  }

  if (state === 'sent') {
    panel.classList.add('pass');
    icon.textContent = '✓';
    title.textContent = 'Backend domain logging connected';
    detail.textContent = 'The latest active-domain record was sent successfully.';
    return;
  }

  if (state === 'not_configured') {
    panel.classList.add('fail');
    icon.textContent = '!';
    title.textContent = 'Backend URL setup required';
    detail.textContent = 'Deploy the Worker and add its HTTPS URL to this build.';
    return;
  }

  if (state === 'queued') {
    panel.classList.add('pending');
    icon.textContent = '…';
    title.textContent = 'Waiting to reconnect';
    detail.textContent = 'The latest domain will retry when the backend is available.';
    return;
  }

  panel.classList.add('pending');
  icon.textContent = '…';
  title.textContent = 'Backend logging is ready';
  detail.textContent = 'Waiting for the next active-domain change.';
}

async function verifyStorage(permissionSet) {
  try {
    await ext.storage.local.set({ [proofKey]: 'storage-ok' });
    const stored = await ext.storage.local.get(proofKey);
    await ext.storage.local.remove(proofKey);
    return permissionSet.has('storage') && stored[proofKey] === 'storage-ok';
  } catch {
    return false;
  }
}

async function verifyAlarms(permissionSet) {
  try {
    await ext.alarms.create(proofAlarm, { when: Date.now() + 60000 });
    const alarm = await ext.alarms.get(proofAlarm);
    await ext.alarms.clear(proofAlarm);
    return permissionSet.has('alarms') && Boolean(alarm);
  } catch {
    return false;
  }
}

async function verifyTabs(permissionSet) {
  try {
    const tabs = await ext.tabs.query({});
    const readableTab = tabs.some(
      (tab) => typeof tab.url === 'string' && tab.url.length > 0,
    );
    return permissionSet.has('tabs') && readableTab;
  } catch {
    return false;
  }
}

async function runVerification() {
  const summary = document.querySelector('#summary');
  summary.classList.remove('pass', 'fail');
  summary.classList.add('pending');
  document.querySelector('#summary-icon').textContent = '…';
  document.querySelector('#summary-title').textContent = 'Running live checks';
  document.querySelector('#summary-detail').textContent = 'Please wait a moment.';

  for (const card of Object.values(cards)) {
    card.classList.remove('pass', 'fail');
    card.classList.add('pending');
    card.querySelector('.status-icon').textContent = '…';
    card.querySelector('.status-label').textContent = 'Checking';
  }

  const granted = await ext.permissions.getAll();
  const permissionSet = new Set(granted.permissions ?? []);
  const results = {
    storage: await verifyStorage(permissionSet),
    alarms: await verifyAlarms(permissionSet),
    tabs: await verifyTabs(permissionSet),
  };

  for (const [permission, passed] of Object.entries(results)) {
    setCard(permission, passed);
  }

  const passedCount = Object.values(results).filter(Boolean).length;
  const allPassed = passedCount === 3;
  summary.classList.remove('pending');
  summary.classList.add(allPassed ? 'pass' : 'fail');
  document.querySelector('#summary-icon').textContent = allPassed ? '✓' : '!';
  document.querySelector('#summary-title').textContent = allPassed
    ? 'All 3 permissions verified'
    : `${passedCount} of 3 permissions verified`;
  document.querySelector('#summary-detail').textContent = allPassed
    ? 'Declared, granted, and tested successfully.'
    : 'One or more checks need attention.';
  document.querySelector('#verified-at').textContent = new Date().toLocaleString();
}

document.querySelector('#browser-name').textContent = detectBrowser();
document.querySelector('#extension-version').textContent =
  ext.runtime.getManifest().version;
document.querySelector('#rerun').addEventListener('click', runVerification);
document.querySelector('#dashboard').addEventListener('click', () => {
  ext.tabs.create({ url: ext.runtime.getURL('newtab.html') });
  window.close();
});

async function runAllChecks() {
  try {
    await ext.runtime.sendMessage({ type: 'aerotrack:retry-domain-sharing' });
  } catch {
    // Permission checks still run even if the background process is restarting.
  }
  await Promise.all([runVerification(), renderBackendStatus()]);
}

document.querySelector('#rerun').removeEventListener('click', runVerification);
document.querySelector('#rerun').addEventListener('click', runAllChecks);

runAllChecks().catch(() => {
  document.querySelector('#summary').classList.add('fail');
  document.querySelector('#summary-icon').textContent = '!';
  document.querySelector('#summary-title').textContent = 'Verification unavailable';
  document.querySelector('#summary-detail').textContent =
    'Reload the extension and try again.';
});
