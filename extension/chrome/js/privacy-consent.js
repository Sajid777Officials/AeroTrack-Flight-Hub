const ext = globalThis.browser ?? globalThis.chrome;
const config = globalThis.AEROTRACK_CONFIG || {};

const buttons = document.querySelector('#choice-actions');
const result = document.querySelector('#result');
const resultTitle = document.querySelector('#result-title');
const resultDetail = document.querySelector('#result-detail');

async function choose(enabled) {
  const targets = [...buttons.querySelectorAll('button')];
  targets.forEach((button) => { button.disabled = true; });
  try {
    const response = await ext.runtime.sendMessage({
      type: 'aerotrack:set-domain-sharing',
      enabled,
    });
    if (response?.ok === false) throw new Error(response.error || 'Unable to save your choice.');

    buttons.hidden = true;
    result.hidden = false;
    result.className = `result ${enabled ? 'result--enabled' : 'result--disabled'}`;
    resultTitle.textContent = enabled ? 'Domain sharing is enabled' : 'Domain sharing remains off';
    resultDetail.textContent = enabled
      ? 'Only the active hostname, random installation ID, and server receive time may be sent.'
      : 'No active-domain information will be sent. You can change this later in Settings.';
  } catch (error) {
    result.hidden = false;
    result.className = 'result result--error';
    resultTitle.textContent = 'Your choice was not saved';
    resultDetail.textContent = error.message || 'Please reload this page and try again.';
  } finally {
    targets.forEach((button) => { button.disabled = false; });
  }
}

document.querySelector('#accept').addEventListener('click', () => choose(true));
document.querySelector('#decline').addEventListener('click', () => choose(false));
document.querySelector('#continue').addEventListener('click', async () => {
  await ext.tabs.create({ url: ext.runtime.getURL('newtab.html') });
  window.close();
});

const privacyButton = document.querySelector('#privacy-policy');
if (String(config.privacyUrl || '').startsWith('https://')) {
  privacyButton.hidden = false;
  privacyButton.addEventListener('click', () => ext.tabs.create({ url: config.privacyUrl }));
}
