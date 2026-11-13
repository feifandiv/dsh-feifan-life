import { setIcon } from 'obsidian';

let activeKeys: ((event: KeyboardEvent) => void) | null = null;
export function handleSelectKey(event: KeyboardEvent): boolean {
  if (!activeKeys) return false;
  activeKeys(event);
  return event.defaultPrevented;
}

export interface SelectOption { value: string; label: string }
export interface SelectControl extends HTMLElement { value: string }
let nextId = 0;
let closeCurrent: (() => void) | null = null;

/** Shared, keyboard-accessible select. Portals keep menus outside scroll clipping. */
export function createSelect(options: {
  options: SelectOption[];
  value?: string;
  placeholder?: string;
  searchable?: boolean;
  prefix: 'fl' | 'll' | 'pk';
  onSelect?: (value: string) => void;
}): SelectControl {
  const { prefix } = options;
  const wrap = document.createElement('div') as unknown as SelectControl;
  wrap.className = `ff-select ${prefix}-select`;
  const button = wrap.createEl('button', { cls: `ff-select-button ${prefix === 'pk' ? 'pk-select__btn' : `${prefix}-select-btn`}`, attr: { type: 'button', role: 'combobox', 'aria-expanded': 'false', 'aria-haspopup': 'listbox' } });
  const label = button.createSpan();
  const icon = button.createSpan({ cls: 'ff-select-caret' });
  setIcon(icon, 'chevron-down');
  let value = options.value ?? '';
  const id = `ff-select-${++nextId}`;
  button.setAttribute('aria-controls', id);
  let portal: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let items: HTMLButtonElement[] = [];
  let active = 0;
  let search: HTMLInputElement | null = null;
  let query = '';
  let doc = wrap.ownerDocument;
  let win = doc.defaultView ?? window;

  const renderLabel = (): void => { label.textContent = options.options.find(item => item.value === value)?.label ?? options.placeholder ?? '请选择'; };
  const close = (): void => {
    observer?.disconnect(); observer = null;
    doc.removeEventListener('pointerdown', outside);
    doc.removeEventListener('keydown', keys, true);
    win.removeEventListener('resize', position);
    doc.removeEventListener('scroll', position, true);
    portal?.remove(); portal = null; search = null;
    wrap.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-activedescendant');
    if (closeCurrent === close) closeCurrent = null;
    activeKeys = null;
  };
  const choose = (next: string): void => {
    value = next; renderLabel(); close();
    options.onSelect?.(next);
    wrap.dispatchEvent(new Event('change', { bubbles: true }));
    if (button.isConnected) button.focus();
  };
  const setActive = (index: number, scroll = false): void => {
    const next = Math.max(0, Math.min(index, items.length - 1));
    if (next !== active || !items[next]?.classList.contains('is-highlighted')) {
      items[active]?.classList.remove('is-highlighted');
      active = next;
      items[active]?.classList.add('is-highlighted');
    }
    if (items[active]) {
      button.setAttribute('aria-activedescendant', items[active].id);
      if (scroll && portal) {
        const menu = portal.firstElementChild as HTMLElement;
        const option = items[active].getBoundingClientRect();
        const viewport = menu.getBoundingClientRect();
        if (option.top < viewport.top + 4) menu.scrollTop += option.top - viewport.top - 4;
        else if (option.bottom > viewport.bottom - 4) menu.scrollTop += option.bottom - viewport.bottom + 4;
      }
    }
  };
  const renderItems = (): void => {
    const list = portal!.querySelector<HTMLElement>('.ff-select-options')!;
    list.empty();
    const visible = options.options.filter(item => item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    items = visible.map((item, index) => {
      const option = list.createEl('button', { cls: 'ff-select-option', text: item.label, attr: { type: 'button', role: 'option', 'aria-selected': String(item.value === value), id: `${id}-${index}`, tabindex: '-1' } });
      option.addEventListener('click', () => choose(item.value));
      option.addEventListener('pointerenter', () => setActive(index));
      return option;
    });
    if (!items.length) list.createDiv({ cls: 'ff-select-empty', text: '无匹配' });
    setActive(Math.max(0, visible.findIndex(item => item.value === value)));
  };
  const outside = (event: PointerEvent): void => { if (!wrap.contains(event.target as Node) && !portal?.contains(event.target as Node)) close(); };
  const keys = (event: KeyboardEvent): void => {
    if (!portal) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !(search && doc.activeElement === search && ['Home', 'End'].includes(event.key))) {
      event.preventDefault(); event.stopPropagation();
      setActive(event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (active + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % Math.max(1, items.length), true);
    } else if (event.key === 'Enter' && items[active]) {
      event.preventDefault(); event.stopPropagation(); items[active].click();
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close(); button.focus();
    } else if (event.key === 'Tab') close();
  };
  const position = (): void => {
    if (!portal) return;
    if (!wrap.isConnected) { close(); return; }
    const rect = button.getBoundingClientRect();
    const menu = portal.firstElementChild as HTMLElement;
    // Measure intrinsic option text, independent of the trigger and legacy module geometry.
    menu.style.width = 'max-content';
    const width = Math.min(Math.ceil(Math.max(144, rect.width, menu.getBoundingClientRect().width)), win.innerWidth - 16);
    menu.style.width = width + 'px';
    menu.style.left = Math.max(8, Math.min(rect.left, win.innerWidth - width - 8)) + 'px';
    const height = Math.min(menu.scrollHeight, 280, win.innerHeight - 24);
    menu.style.maxHeight = height + 'px';
    menu.style.top = Math.max(8, rect.bottom + height + 4 > win.innerHeight - 8 ? rect.top - height - 4 : rect.bottom + 4) + 'px';
  };
  const open = (): void => {
    if (portal) { close(); return; }
    closeCurrent?.(); closeCurrent = close;
    activeKeys = keys;
    doc = wrap.ownerDocument; win = doc.defaultView ?? window;
    const owner = wrap.closest<HTMLElement>('.ff-ui');
    portal = doc.createElement('div');
    portal.className = 'ff-ui ff-select-portal';
    const mode = (): void => { if (portal) portal.dataset.ffMode = owner?.dataset.ffMode ?? 'light'; };
    mode();
    if (owner) { observer = new MutationObserver(mode); observer.observe(owner, { attributes: true, attributeFilter: ['data-ff-mode'] }); }
    const menu = portal.createDiv({ cls: 'ff-select-menu' });
    query = '';
    if (options.searchable) {
      search = menu.createEl('input', { attr: { type: 'search', placeholder: '搜索', 'aria-label': '搜索选项' } });
      search.addEventListener('input', () => { query = search!.value; renderItems(); position(); });
    }
    menu.createDiv({ cls: 'ff-select-options', attr: { role: 'listbox', id } });
    doc.body.appendChild(portal);
    wrap.classList.add('is-open'); button.setAttribute('aria-expanded', 'true');
    renderItems(); position(); setActive(active, true); search?.focus();
    doc.addEventListener('pointerdown', outside);
    doc.addEventListener('keydown', keys, true);
    win.addEventListener('resize', position);
    doc.addEventListener('scroll', position, true);
  };
  button.addEventListener('click', open);
  button.addEventListener('keydown', event => {
    if (!portal && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
  });
  Object.defineProperty(wrap, 'value', { get: () => value, set: (next: string) => { value = next; renderLabel(); }, configurable: true });
  renderLabel();
  return wrap;
}

export function closeSelect(): void { closeCurrent?.(); }
