import { App, Menu } from 'obsidian';
import { attachTheme } from './theme';

const openMenus = new Map<App, Set<FfMenu>>();
export function closeMenus(app: App): void {
  for (const menu of [...(openMenus.get(app) ?? [])]) menu.hide();
  openMenus.delete(app);
}

export class FfMenu extends Menu {
  constructor(private app: App) { super(); }

  showAtMouseEvent(event: MouseEvent): this {
    const doc = (event.target as Node | null)?.ownerDocument ?? (typeof activeDocument !== 'undefined' ? activeDocument : document);
    const portal = doc.createElement('div');
    portal.className = 'ff-menu-portal';
    const detach = attachTheme(this.app, portal);
    if (!openMenus.has(this.app)) openMenus.set(this.app, new Set());
    openMenus.get(this.app)!.add(this);
    doc.body.appendChild(portal);
    this.setUseNativeMenu(false);
    this.setParentElement(portal);
    const existing = new Set(Array.from(doc.querySelectorAll('.menu')));
    const menuThemes: (() => void)[] = [];
    this.onHide(() => {
      openMenus.get(this.app)?.delete(this);
      if (!openMenus.get(this.app)?.size) openMenus.delete(this.app);
      for (const cleanup of menuThemes) cleanup();
      detach(); portal.remove();
    });
    super.showAtMouseEvent(event);
    // Obsidian's parent element owns menu lifetime, but its DOM stays on body.
    for (const menu of Array.from(doc.querySelectorAll<HTMLElement>('.menu'))) {
      if (!existing.has(menu)) menuThemes.push(attachTheme(this.app, menu));
    }
    return this;
  }
}
