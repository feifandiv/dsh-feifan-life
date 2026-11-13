/**
 * Global type augmentations Obsidian ships in its own `obsidian.d.ts`.
 *
 * The ported plugin is authored against Obsidian, where `HTMLElement` carries
 * `createEl`/`addClass`/... and `activeDocument` is a global. The runtime shim
 * installs the same helpers (`shim/dom.ts`); this file only restores the types
 * so `node build.mjs typecheck` reports real mismatches instead of missing
 * augmentation noise.
 */
export {};

declare global {
  interface DomElementInfo {
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

  interface Element {
    removeClass(...classes: (string | string[])[]): this;
  }

  interface HTMLElement {
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, info?: string | DomElementInfo, callback?: ChildBuilder<HTMLElementTagNameMap[K]>): HTMLElementTagNameMap[K];
    createEl(tag: string, info?: string | DomElementInfo, callback?: ChildBuilder<HTMLElement>): HTMLElement;
    createDiv(info?: string | DomElementInfo, callback?: ChildBuilder<HTMLDivElement>): HTMLDivElement;
    createSpan(info?: string | DomElementInfo, callback?: ChildBuilder<HTMLSpanElement>): HTMLSpanElement;
    createSvg(tag: string, info?: DomElementInfo): SVGElement;
    empty(): this;
    addClass(...classes: (string | string[])[]): this;
    addClasses(classes: string[]): this;
    removeClass(...classes: (string | string[])[]): this;
    toggleClass(classes: string | string[], value: boolean): this;
    hasClass(cls: string): boolean;
    setText(text: string | DocumentFragment | Node): void;
    appendText(text: string): void;
    setAttr(key: string, value: string | number | boolean | null): void;
    getAttr(key: string): string | null;
    setAttrs(attrs: Record<string, string | number | boolean | null>): void;
    detach(): this;
    show(): void;
    hide(): void;
    toggle(show: boolean): this;
    isShown(): boolean;
    setCssStyles(styles: Partial<CSSStyleDeclaration>): void;
    setCssProps(props: Record<string, string>): void;
    find(selector: string): HTMLElement | null;
    find<T extends Element>(selector: string): T | null;
    findAll(selector: string): HTMLElement[];
    findAll<T extends Element>(selector: string): T[];
    insertAfter(node: Node): Node;
    setIcon(name: string): void;
  }

  const activeDocument: Document;
  const activeWindow: Window;
}
