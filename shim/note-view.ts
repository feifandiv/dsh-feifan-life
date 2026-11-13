/**
 * Note preview for `WorkspaceLeaf.openFile`.
 *
 * The original plugin opens review notes through Obsidian's editor. The port has
 * no editor, so the same call opens a read-only preview dialog with the note's
 * markdown rendered lightly (headings, lists, emphasis, code, links as text).
 * This is the only intentional behavioural divergence in the port and it is
 * documented in the verification report.
 */
import { Modal } from './ui';
import type { App } from './app';
import type { TFile } from './vault';

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Small, dependency-free markdown subset renderer for note previews. */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let inCode = false;
  let paragraph: string[] = [];

  const inline = (text: string): string => escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    html.push('<p>' + inline(paragraph.join(' ')) + '</p>');
    paragraph = [];
  };
  const closeList = (): void => {
    if (!listType) return;
    html.push('</' + listType + '>');
    listType = null;
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      flushParagraph();
      closeList();
      html.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html.push(escapeHtml(line));
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      flushParagraph();
      closeList();
      html.push('<hr />');
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      closeList();
      html.push('<blockquote>' + inline(quote[1]) + '</blockquote>');
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push('<li>' + inline(bullet[1]) + '</li>');
      continue;
    }
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      flushParagraph();
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push('<li>' + inline(ordered[1]) + '</li>');
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();
  if (inCode) html.push('</code></pre>');
  return html.join('\n');
}

class NotePreviewModal extends Modal {
  constructor(app: App, private readonly file: TFile, private readonly text: string) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.file.name);
    const meta = this.contentEl.createDiv({ cls: 'fl-note-meta' });
    meta.setText(this.file.path);
    const body = this.contentEl.createDiv({ cls: 'fl-note-body' });
    body.innerHTML = renderMarkdown(this.text);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export async function openNotePreview(app: App, file: TFile): Promise<void> {
  const modal = new NotePreviewModal(app, file, await app.vault.cachedRead(file).catch(() => '（读取失败）'));
  modal.open();
}
