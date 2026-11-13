/**
 * Obsidian's DOM extensions, reimplemented for the browser.
 *
 * Obsidian augments `HTMLElement` with `createEl`/`createDiv`/`addClass` and
 * friends, and the ported plugin uses those helpers ~1400 times. The port keeps
 * the plugin source untouched, so this module installs the same helpers on the
 * live prototypes. Every helper is idempotent and skips a name the host already
 * defines, so a future page that ships its own versions keeps them.
 */
import { ICONS, FALLBACK_ICON } from './icons.generated';

export interface DomElementInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null | undefined>;
  href?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  rows?: number;
  cols?: number;
}

type ChildBuilder<T extends HTMLElement> = (el: T) => void;

function applyInfo<T extends HTMLElement>(el: T, info?: string | DomElementInfo): T {
  if (!info) return el;
  if (typeof info === 'string') {
    if (info) el.className = info;
    return el;
  }
  if (info.cls) {
    const classes = Array.isArray(info.cls) ? info.cls : info.cls.split(/\s+/);
    for (const cls of classes) if (cls) el.classList.add(cls);
  }
  if (typeof info.text === 'string') el.textContent = info.text;
  if (info.attr) {
    for (const [key, value] of Object.entries(info.attr)) {
      if (value === null || value === undefined || value === false) continue;
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (info.href) el.setAttribute('href', info.href);
  if (info.title) el.setAttribute('title', info.title);
  if (info.type) el.setAttribute('type', info.type);
  if (info.placeholder) el.setAttribute('placeholder', info.placeholder);
  if (info.rows) el.setAttribute('rows', String(info.rows));
  if (info.cols) el.setAttribute('cols', String(info.cols));
  if (info.value !== undefined && 'value' in el) (el as unknown as { value: string }).value = info.value;
  return el;
}

/** Turn an icon node into an SVG element the way Obsidian's setIcon does. */
export function buildIcon(name: string, size?: number): SVGSVGElement {
  const node = ICONS[name] ?? ICONS[FALLBACK_ICON] ?? [];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(size ?? 24));
  svg.setAttribute('height', String(size ?? 24));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('svg-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attrs] of node) {
    const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs ?? {})) child.setAttribute(key, String(value));
    svg.appendChild(child);
  }
  return svg;
}

let installed = false;

export function installDomHelpers(): void {
  if (installed) return;
  installed = true;
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;

  const define = (name: string, value: unknown): void => {
    if (name in proto) return;
    Object.defineProperty(proto, name, { value, writable: true, configurable: true, enumerable: false });
  };

  define('createEl', function createEl(this: HTMLElement, tag: string, info?: string | DomElementInfo, callback?: ChildBuilder<HTMLElement>) {
    const el = document.createElement(tag);
    applyInfo(el, info);
    this.appendChild(el);
    callback?.(el);
    return el;
  });
  define('createDiv', function createDiv(this: HTMLElement, info?: string | DomElementInfo, callback?: ChildBuilder<HTMLDivElement>) {
    return (this as HTMLElement).createEl('div', info, callback as ChildBuilder<HTMLElement>);
  });
  define('createSpan', function createSpan(this: HTMLElement, info?: string | DomElementInfo, callback?: ChildBuilder<HTMLSpanElement>) {
    return (this as HTMLElement).createEl('span', info, callback as ChildBuilder<HTMLElement>);
  });
  define('createSvg', function createSvg(this: HTMLElement, tag: string, info?: DomElementInfo) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag) as unknown as HTMLElement;
    applyInfo(el, info);
    this.appendChild(el);
    return el;
  });
  define('empty', function empty(this: HTMLElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
    return this;
  });
  define('addClass', function addClass(this: HTMLElement, ...classes: (string | string[])[]) {
    for (const entry of classes.flat()) for (const cls of String(entry).split(/\s+/)) if (cls) this.classList.add(cls);
    return this;
  });
  define('addClasses', function addClasses(this: HTMLElement, classes: string[]) {
    for (const cls of classes) if (cls) this.classList.add(cls);
    return this;
  });
  define('removeClass', function removeClass(this: HTMLElement, ...classes: (string | string[])[]) {
    for (const entry of classes.flat()) for (const cls of String(entry).split(/\s+/)) if (cls) this.classList.remove(cls);
    return this;
  });
  define('toggleClass', function toggleClass(this: HTMLElement, classes: string | string[], value: boolean) {
    for (const cls of Array.isArray(classes) ? classes : String(classes).split(/\s+/)) {
      if (cls) this.classList.toggle(cls, value);
    }
    return this;
  });
  define('hasClass', function hasClass(this: HTMLElement, cls: string) {
    return this.classList.contains(cls);
  });
  define('setText', function setText(this: HTMLElement, text: string | DocumentFragment | Node) {
    this.empty();
    if (typeof text === 'string') this.textContent = text;
    else this.appendChild(text as Node);
  });
  define('appendText', function appendText(this: HTMLElement, text: string) {
    this.appendChild(document.createTextNode(text));
  });
  define('setAttr', function setAttr(this: HTMLElement, key: string, value: string | number | boolean | null) {
    if (value === null || value === undefined || value === false) this.removeAttribute(key);
    else this.setAttribute(key, value === true ? '' : String(value));
  });
  define('getAttr', function getAttr(this: HTMLElement, key: string) {
    return this.getAttribute(key);
  });
  define('setAttrs', function setAttrs(this: HTMLElement, attrs: Record<string, string | number | boolean | null>) {
    for (const [key, value] of Object.entries(attrs)) (this as HTMLElement).setAttr(key, value);
  });
  define('detach', function detach(this: HTMLElement) {
    this.remove();
    return this;
  });
  define('show', function show(this: HTMLElement) {
    this.removeClass('is-hidden');
    this.style.display = '';
  });
  define('hide', function hide(this: HTMLElement) {
    this.addClass('is-hidden');
    this.style.display = 'none';
  });
  define('toggle', function toggle(this: HTMLElement, show: boolean) {
    if (show) (this as HTMLElement).show();
    else (this as HTMLElement).hide();
    return this;
  });
  define('isShown', function isShown(this: HTMLElement) {
    return this.style.display !== 'none' && !this.classList.contains('is-hidden');
  });
  define('setCssStyles', function setCssStyles(this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
    Object.assign(this.style, styles);
  });
  define('setCssProps', function setCssProps(this: HTMLElement, props: Record<string, string>) {
    for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value);
  });
  define('find', function find(this: HTMLElement, selector: string) {
    return this.querySelector(selector);
  });
  define('findAll', function findAll(this: HTMLElement, selector: string) {
    return Array.from(this.querySelectorAll(selector));
  });
  define('insertAfter', function insertAfter(this: HTMLElement, node: Node) {
    this.parentNode?.insertBefore(node, this.nextSibling);
    return node;
  });
  define('setIcon', function setIcon(this: HTMLElement, name: string) {
    this.empty();
    this.appendChild(buildIcon(name, 24));
  });
  // Obsidian also exposes `createEl` on Document/SVGElement; only the HTMLElement
  // forms are used by the plugin, so the prototype above is enough.
  void (document as unknown as { documentElement: HTMLElement }).documentElement;
}
