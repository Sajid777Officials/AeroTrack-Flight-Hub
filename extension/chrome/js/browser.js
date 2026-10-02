export const ext = globalThis.browser ?? globalThis.chrome;

export const storage = {
  async get(defaults = {}) {
    return ext.storage.local.get(defaults);
  },
  async set(values) {
    return ext.storage.local.set(values);
  },
};

export async function openExtensionPage(path = 'newtab.html') {
  return ext.tabs.create({ url: ext.runtime.getURL(path) });
}

export async function openExternal(url) {
  return ext.tabs.create({ url });
}

export async function openOptions() {
  return ext.runtime.openOptionsPage();
}
