/**
 * Accessible autocomplete controller.
 * @param {{input:HTMLInputElement, listbox:HTMLElement, loader:(query:string, options:{signal:AbortSignal})=>Promise<Array<{name:string,iata:string,city?:string}>>, onSelect:(item:object)=>void, label:string}} options
 */
export function setupAutocomplete({ input, listbox, loader, onSelect, label }) {
  let timer = null;
  let controller = null;
  let items = [];
  let activeIndex = -1;

  const close = () => {
    activeIndex = -1;
    listbox.hidden = true;
    listbox.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const choose = (index) => {
    const item = items[index];
    if (!item) return;
    onSelect(item);
    close();
  };

  const render = () => {
    const fragment = document.createDocumentFragment();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'suggestion-empty';
      empty.setAttribute('role', 'option');
      empty.setAttribute('aria-disabled', 'true');
      empty.textContent = 'No matches found';
      fragment.append(empty);
    } else {
      items.forEach((item, index) => {
        const button = document.createElement('button');
        button.id = `${input.id}-option-${index}`;
        button.className = `suggestion${index === activeIndex ? ' is-active' : ''}`;
        button.type = 'button';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(index === activeIndex));

        const copy = document.createElement('span');
        const name = document.createElement('strong');
        name.textContent = String(item.name || '');
        copy.append(name);
        if (item.city) {
          const city = document.createElement('small');
          city.textContent = String(item.city);
          copy.append(city);
        }

        const iata = document.createElement('b');
        iata.textContent = String(item.iata || '');
        button.append(copy, iata);
        button.addEventListener('mousedown', (event) => {
          event.preventDefault();
          choose(index);
        });
        fragment.append(button);
      });
    }

    listbox.replaceChildren(fragment);
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (activeIndex >= 0) input.setAttribute('aria-activedescendant', `${input.id}-option-${activeIndex}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const load = async () => {
    const query = input.value.trim();
    if (query.length < 2) return close();
    controller?.abort();
    controller = new AbortController();
    try {
      items = await loader(query, { signal: controller.signal });
      activeIndex = -1;
      render();
    } catch (error) {
      if (error.name !== 'AbortError') close();
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 220);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { close(); return; }
    if (event.key === 'ArrowDown') {
      if (listbox.hidden) { load(); return; }
      event.preventDefault(); activeIndex = Math.min(activeIndex + 1, items.length - 1); render(); return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); render(); return;
    }
    if (event.key === 'Enter' && activeIndex >= 0 && !listbox.hidden) {
      event.preventDefault(); choose(activeIndex);
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.setAttribute('aria-label', label);

  return { close };
}
