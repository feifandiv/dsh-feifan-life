let nextFieldId = 0;

export function formField(label: string, prefix: string, multiline = false): { row: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const row = document.createElement('div');
  row.className = `ff-field ${prefix}-field`;
  const id = `ff-field-${++nextFieldId}`;
  row.createEl('label', { text: label, cls: `ff-field-label ${prefix}-field-label`, attr: { for: id } });
  const input = multiline ? row.createEl('textarea') : row.createEl('input');
  input.className = `ff-input ${prefix}-input` + (multiline ? ` ${prefix}-textarea` : '');
  input.id = id;
  return { row, input };
}
