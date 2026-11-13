import { Modal, Scope } from 'obsidian';
import { attachTheme } from './theme';
import { closeSelect, handleSelectKey } from './select';

const openDialogs = new Map<object, Set<FfModal>>();
export function closeModals(app: object): void {
  for (const modal of [...(openDialogs.get(app) ?? [])].reverse()) modal.close();
  openDialogs.delete(app);
}

/** One lifecycle for all business dialogs, including body-mounted portals. */
export class FfModal extends Modal {
  private detachTheme: (() => void) | null = null;
  private returnFocus: HTMLElement | null = null;
  private initialFocusFrame = 0;
  constructor(app: import('obsidian').App) {
    super(app);
    this.scope = new Scope(this.scope);
    // Obsidian dispatches its key scope before DOM listeners on the modal.
    for (const key of ['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter']) {
      this.scope?.register([], key, event => {
        if (handleSelectKey(event)) return false;
        if (key === 'Escape') { this.close(); return false; }
      });
    }
  }
  private readonly trapFocus = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(this.modalEl.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"],a[href]',
    )).filter(el => el.getClientRects().length && !el.closest('[hidden]'));
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); this.modalEl.focus(); return; }
    const focused = this.modalEl.ownerDocument.activeElement;
    if (event.shiftKey && (focused === first || !this.modalEl.contains(focused))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (focused === last || !this.modalEl.contains(focused))) {
      event.preventDefault(); first.focus();
    }
  };

  open(): void {
    if (this.detachTheme) return;
    const doc = typeof activeDocument !== 'undefined' ? activeDocument : document;
    this.returnFocus = doc.activeElement as HTMLElement | null;
    this.detachTheme = attachTheme(this.app, this.containerEl);
    if (!openDialogs.has(this.app)) openDialogs.set(this.app, new Set());
    openDialogs.get(this.app)!.add(this);
    this.modalEl.classList.add('ff-dialog');
    this.modalEl.setAttribute('role', 'dialog');
    this.modalEl.setAttribute('aria-modal', 'true');
    this.modalEl.tabIndex = -1;
    this.modalEl.addEventListener('keydown', this.trapFocus);
    super.open();
    this.initialFocusFrame = requestAnimationFrame(() => {
      this.modalEl.setAttribute('aria-label', this.titleEl.textContent || this.contentEl.querySelector('.pk-modal__title,.cc-plan-modal-head')?.textContent || '非凡人生');
      if (!this.modalEl.contains(this.modalEl.ownerDocument.activeElement)) {
        (this.modalEl.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled)') ?? this.modalEl).focus();
      }
    });
  }

  close(): void {
    openDialogs.get(this.app)?.delete(this);
    if (!openDialogs.get(this.app)?.size) openDialogs.delete(this.app);
    closeSelect();
    cancelAnimationFrame(this.initialFocusFrame);
    this.modalEl.removeEventListener('keydown', this.trapFocus);
    super.close();
    const detach = this.detachTheme;
    this.detachTheme = null;
    // Keep the opaque theme during the host's exit transition.
    window.setTimeout(() => detach?.(), 200);
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
    this.returnFocus = null;
  }
}

export class FfFormModal extends FfModal {
  bodyEl!: HTMLElement;
  footerEl!: HTMLElement;

  constructor(app: any, title: string, private prefix: string, private build?: (body: HTMLElement, footer: HTMLElement) => void) {
    super(app);
    this.titleEl.setText(title);
  }

  onOpen(): void {
    this.modalEl.addClass(`${this.prefix}-modal-el`);
    this.contentEl.empty();
    this.contentEl.addClass(`${this.prefix}-modal`);
    this.bodyEl = this.contentEl.createDiv(`ff-dialog-body ${this.prefix}-modal-body`);
    this.footerEl = this.contentEl.createDiv(`ff-dialog-actions ${this.prefix}-modal-footer`);
    this.build?.(this.bodyEl, this.footerEl);
  }

  onClose(): void { this.contentEl.empty(); }
}
