/**
 * The interactive Obsidian primitives the plugin builds on: modals, menus,
 * notices, settings rows and their controls.
 *
 * These are real DOM components here rather than wrappers around an existing
 * app.css: the port has no Obsidian shell, so the elements are created with the
 * same class structure Obsidian uses, which lets the plugin's own stylesheet
 * (`.ff-ui .modal-content` and friends) style them exactly as before.
 */
import { buildIcon } from './dom';
import type { App } from './app';

/* ------------------------------------------------------------------ scope */

export class Scope {
  private bindings: Array<{ modifiers: string[]; key: string; handler: (event: KeyboardEvent) => boolean | void }> = [];

  constructor(public parent?: Scope | null) {}

  register(modifiers: string[], key: string, handler: (event: KeyboardEvent) => boolean | void): this {
    this.bindings.push({ modifiers: modifiers ?? [], key, handler });
    return this;
  }

  /** Run the first matching binding; a `false` result means "handled". */
  handle(event: KeyboardEvent): boolean {
    const anyKey = this.bindings.find((binding) => binding.key === event.key);
    if (anyKey) {
      const result = anyKey.handler(event);
      if (result === false) return true;
    }
    return this.parent ? this.parent.handle(event) : false;
  }
}

/* ------------------------------------------------------------------ modal */

export class Modal {
  readonly app: App;
  readonly containerEl: HTMLElement;
  readonly modalEl: HTMLElement;
  readonly titleEl: HTMLElement;
  readonly contentEl: HTMLElement;
  scope: Scope | null = null;
  isOpen = false;
  returnFocusElement: HTMLElement | null = null;
  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.scope) return;
    const handled = this.scope.handle(event);
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  constructor(app: App) {
    this.app = app;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'modal-container';
    this.containerEl.setAttribute('data-fl-portal', '');
    this.containerEl.createDiv({ cls: 'modal-bg' });
    this.modalEl = this.containerEl.createDiv({ cls: 'modal' });
    this.modalEl.tabIndex = -1;
    const closeButton = this.modalEl.createDiv({ cls: 'modal-close-button', attr: { role: 'button', 'aria-label': '关闭' } });
    closeButton.addEventListener('click', () => this.close());
    this.titleEl = this.modalEl.createDiv({ cls: 'modal-title' });
    this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
  }

  setTitle(title: string): this {
    this.titleEl.setText(title);
    return this;
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.returnFocusElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.appendChild(this.containerEl);
    document.addEventListener('keydown', this.onKeyDown, true);
    this.onOpen();
    requestAnimationFrame(() => {
      if (this.modalEl.contains(document.activeElement)) return;
      this.modalEl.focus();
    });
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.onClose();
    this.containerEl.remove();
    if (this.returnFocusElement?.isConnected) this.returnFocusElement.focus();
    this.returnFocusElement = null;
  }

  onOpen(): void {}
  onClose(): void {}
}

/* ------------------------------------------------------------------- menu */

export class MenuItem {
  title = '';
  icon = '';
  checked = false;
  disabled = false;
  callback: ((event: MouseEvent) => void) | null = null;

  constructor(private menu: Menu) {}

  setTitle(title: string): this { this.title = title; return this; }
  setIcon(icon: string | null): this { this.icon = icon ?? ''; return this; }
  setChecked(checked: boolean | null): this { this.checked = checked === true; return this; }
  setDisabled(disabled: boolean): this { this.disabled = disabled; return this; }
  setIsLabel(_label: boolean): this { return this; }
  setSection(_section: string): this { return this; }
  onClick(callback: (event: MouseEvent) => void): this { this.callback = callback; return this; }
}

type MenuEntry = MenuItem | { separator: true };

export class Menu {
  private entries: MenuEntry[] = [];
  private parentElement: HTMLElement | null = null;
  private hideCallbacks: Array<() => void> = [];
  private menuEl: HTMLElement | null = null;
  private onOutside = (event: PointerEvent): void => {
    if (this.menuEl && event.target instanceof Node && this.menuEl.contains(event.target)) return;
    this.hide();
  };
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.hide();
    }
  };

  addItem(callback: (item: MenuItem) => void): this {
    const item = new MenuItem(this);
    callback(item);
    this.entries.push(item);
    return this;
  }

  addSeparator(): this {
    this.entries.push({ separator: true });
    return this;
  }

  setUseNativeMenu(_native: boolean): this {
    return this;
  }

  setParentElement(parent: HTMLElement): this {
    this.parentElement = parent;
    return this;
  }

  onHide(callback: () => void): void {
    this.hideCallbacks.push(callback);
  }

  showAtMouseEvent(event: MouseEvent): this {
    const position = { x: event.clientX, y: event.clientY };
    return this.showAtPosition(position);
  }

  showAtPosition(position: { x: number; y: number }): this {
    this.hide();
    const parent = this.parentElement ?? document.body;
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('data-fl-portal', '');
    menu.setAttribute('role', 'menu');
    for (const entry of this.entries) {
      if ('separator' in entry) {
        menu.createDiv({ cls: 'menu-separator' });
        continue;
      }
      const item = menu.createDiv({ cls: 'menu-item' + (entry.checked ? ' is-checked' : '') + (entry.disabled ? ' is-disabled' : '') });
      item.setAttribute('role', 'menuitem');
      item.tabIndex = entry.disabled ? -1 : 0;
      if (entry.icon) {
        const icon = item.createDiv({ cls: 'menu-item-icon' });
        icon.appendChild(buildIcon(entry.icon, 16));
      }
      item.createDiv({ cls: 'menu-item-title', text: entry.title });
      if (entry.checked) {
        const check = item.createDiv({ cls: 'menu-item-checkbox' });
        check.appendChild(buildIcon('check', 16));
      }
      if (!entry.disabled) {
        item.addEventListener('click', (event) => {
          this.hide();
          entry.callback?.(event);
        });
      }
    }
    parent.appendChild(menu);
    this.menuEl = menu;
    // Position after layout so the flip uses the real size.
    const rect = menu.getBoundingClientRect();
    const x = Math.min(position.x, window.innerWidth - rect.width - 8);
    const y = Math.min(position.y, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(8, x) + 'px';
    menu.style.top = Math.max(8, y) + 'px';
    menu.style.position = 'absolute';
    window.setTimeout(() => {
      document.addEventListener('pointerdown', this.onOutside, true);
      document.addEventListener('keydown', this.onKeyDown, true);
    }, 0);
    return this;
  }

  hide(): void {
    if (!this.menuEl) return;
    document.removeEventListener('pointerdown', this.onOutside, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.menuEl.remove();
    this.menuEl = null;
    const callbacks = this.hideCallbacks.splice(0);
    for (const callback of callbacks) callback();
  }

  /** Keep TypeScript happy where the plugin drops a menu reference. */
  get items(): MenuEntry[] { return this.entries; }
  close(): void { this.hide(); }
}

/* ----------------------------------------------------------------- notice */

let noticeContainer: HTMLElement | null = null;

function ensureNoticeContainer(): HTMLElement {
  if (noticeContainer?.isConnected) return noticeContainer;
  const container = document.createElement('div');
  container.className = 'notice-container';
  container.setAttribute('data-fl-portal', '');
  document.body.appendChild(container);
  noticeContainer = container;
  return container;
}

export class Notice {
  readonly noticeEl: HTMLElement;
  private timeout: number | null = null;

  constructor(message: string | DocumentFragment, duration = 5000) {
    const container = ensureNoticeContainer();
    this.noticeEl = document.createElement('div');
    this.noticeEl.className = 'notice';
    this.noticeEl.setAttribute('data-fl-portal', '');
    if (typeof message === 'string') this.noticeEl.setText(message);
    else this.noticeEl.appendChild(message);
    container.appendChild(this.noticeEl);
    if (duration > 0) this.timeout = window.setTimeout(() => this.hide(), duration);
  }

  setMessage(message: string | DocumentFragment): this {
    if (typeof message === 'string') this.noticeEl.setText(message);
    else {
      this.noticeEl.empty();
      this.noticeEl.appendChild(message);
    }
    return this;
  }

  hide(): void {
    if (this.timeout !== null) {
      window.clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.noticeEl.addClass('is-hidden');
    window.setTimeout(() => this.noticeEl.remove(), 200);
  }
}

/* ---------------------------------------------------------------- setting */

export class TextComponent {
  readonly inputEl: HTMLInputElement;
  private change: ((value: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.inputEl = parent.createEl('input', { cls: 'ff-text-input', attr: { type: 'text' } });
    this.inputEl.addEventListener('input', () => this.change?.(this.inputEl.value));
  }

  getValue(): string { return this.inputEl.value; }
  setValue(value: string): this { this.inputEl.value = value; return this; }
  setPlaceholder(placeholder: string): this { this.inputEl.placeholder = placeholder; return this; }
  onChange(callback: (value: string) => void): this { this.change = callback; return this; }
  setDisabled(disabled: boolean): this { this.inputEl.disabled = disabled; return this; }
  onChanged(): void {}
  registerOptionListener(): void {}
}

export class TextAreaComponent extends TextComponent {}

export class DropdownComponent {
  readonly selectEl: HTMLSelectElement;
  private change: ((value: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.selectEl = parent.createEl('select', { cls: 'dropdown' });
    this.selectEl.addEventListener('change', () => this.change?.(this.selectEl.value));
  }

  addOption(value: string, label: string): this {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    this.selectEl.appendChild(option);
    return this;
  }

  addOptions(record: Record<string, string>): this {
    for (const [value, label] of Object.entries(record)) this.addOption(value, label);
    return this;
  }

  getValue(): string { return this.selectEl.value; }
  setValue(value: string): this { this.selectEl.value = value; return this; }
  onChange(callback: (value: string) => void): this { this.change = callback; return this; }
  setDisabled(disabled: boolean): this { this.selectEl.disabled = disabled; return this; }
}

export class ToggleComponent {
  readonly toggleEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private change: ((value: boolean) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.toggleEl = parent.createDiv({ cls: 'checkbox-container' });
    this.inputEl = this.toggleEl.createEl('input', { attr: { type: 'checkbox' } });
    this.inputEl.addEventListener('change', () => {
      this.toggleEl.classList.toggle('is-enabled', this.inputEl.checked);
      this.change?.(this.inputEl.checked);
    });
  }

  getValue(): boolean { return this.inputEl.checked; }
  setValue(value: boolean): this {
    this.inputEl.checked = value;
    this.toggleEl.classList.toggle('is-enabled', value);
    return this;
  }
  onChange(callback: (value: boolean) => void): this { this.change = callback; return this; }
  setDisabled(disabled: boolean): this { this.inputEl.disabled = disabled; return this; }
}

export class SliderComponent {
  readonly sliderEl: HTMLInputElement;
  private change: ((value: number) => void) | null = null;
  private tooltip: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.sliderEl = parent.createEl('input', { attr: { type: 'range' } });
    this.sliderEl.addEventListener('input', () => {
      this.updateTooltip();
      this.change?.(Number(this.sliderEl.value));
    });
  }

  setLimits(min: number, max: number, step: number): this {
    this.sliderEl.min = String(min);
    this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  }
  getValue(): number { return Number(this.sliderEl.value); }
  setValue(value: number): this { this.sliderEl.value = String(value); this.updateTooltip(); return this; }
  onChange(callback: (value: number) => void): this { this.change = callback; return this; }
  setDynamicTooltip(): this { this.showTooltip(); return this; }
  showTooltip(): this {
    if (!this.tooltip) {
      this.tooltip = this.sliderEl.createDiv({ cls: 'slider-tooltip' });
      this.tooltip.style.position = 'absolute';
    }
    this.updateTooltip();
    return this;
  }
  setDisabled(disabled: boolean): this { this.sliderEl.disabled = disabled; return this; }
  private updateTooltip(): void {
    if (this.tooltip) this.tooltip.setText(this.sliderEl.value);
  }
}

export class ButtonComponent {
  readonly buttonEl: HTMLButtonElement;
  private click: ((event: MouseEvent) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.buttonEl = parent.createEl('button', { cls: 'button', attr: { type: 'button' } });
    this.buttonEl.addEventListener('click', (event) => this.click?.(event));
  }

  setButtonText(text: string): this { this.buttonEl.setText(text); return this; }
  setCta(): this { this.buttonEl.addClass('mod-cta'); return this; }
  setWarning(): this { this.buttonEl.addClass('mod-warning'); return this; }
  setIcon(icon: string): this {
    const host = this.buttonEl.createSpan({ cls: 'button-icon' });
    host.appendChild(buildIcon(icon, 16));
    return this;
  }
  onClick(callback: (event: MouseEvent) => void): this { this.click = callback; return this; }
  setDisabled(disabled: boolean): this { this.buttonEl.disabled = disabled; return this; }
  setClass(cls: string): this { this.buttonEl.addClass(cls); return this; }
  setTooltip(tooltip: string): this { this.buttonEl.setAttribute('aria-label', tooltip); this.buttonEl.title = tooltip; return this; }
}

export class ExtraButtonComponent extends ButtonComponent {
  readonly extraSettingsEl: HTMLElement;
  constructor(parent: HTMLElement) {
    super(parent);
    this.extraSettingsEl = this.buttonEl;
    this.buttonEl.addClass('clickable-icon');
  }
}

export class Setting {
  readonly settingEl: HTMLElement;
  readonly infoEl: HTMLElement;
  readonly nameEl: HTMLElement;
  readonly descEl: HTMLElement;
  readonly controlEl: HTMLElement;
  private components: unknown[] = [];

  constructor(containerEl: HTMLElement) {
    this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
    this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
    this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
    this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
    this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
  }

  setName(name: string): this { this.nameEl.setText(name); return this; }
  setDesc(desc: string | DocumentFragment): this {
    if (typeof desc === 'string') this.descEl.setText(desc);
    else {
      this.descEl.empty();
      this.descEl.appendChild(desc);
    }
    return this;
  }
  setHeading(): this { this.settingEl.addClass('setting-item-heading'); return this; }
  setClass(cls: string): this { this.settingEl.addClass(cls); return this; }
  setTooltip(tooltip: string): this { this.settingEl.setAttribute('title', tooltip); return this; }
  setDisabled(disabled: boolean): this {
    this.settingEl.classList.toggle('is-disabled', disabled);
    for (const input of Array.from(this.settingEl.querySelectorAll('input,select,button'))) {
      (input as HTMLInputElement).disabled = disabled;
    }
    return this;
  }
  clear(): this {
    this.controlEl.empty();
    this.components = [];
    return this;
  }
  then(callback: (setting: Setting) => void): this { callback(this); return this; }

  addText(callback: (component: TextComponent) => void): this {
    const component = new TextComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addTextArea(callback: (component: TextAreaComponent) => void): this {
    const component = new TextAreaComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addDropdown(callback: (component: DropdownComponent) => void): this {
    const component = new DropdownComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addToggle(callback: (component: ToggleComponent) => void): this {
    const component = new ToggleComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addSlider(callback: (component: SliderComponent) => void): this {
    const component = new SliderComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addButton(callback: (component: ButtonComponent) => void): this {
    const component = new ButtonComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addExtraButton(callback: (component: ExtraButtonComponent) => void): this {
    const component = new ExtraButtonComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addMomentFormat(): void {}
}

export class PluginSettingTab {
  readonly app: App;
  readonly plugin: unknown;
  readonly containerEl: HTMLElement;

  constructor(app: App, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'vertical-tab-content';
  }

  display(): void {}
  hide(): void {}
}
