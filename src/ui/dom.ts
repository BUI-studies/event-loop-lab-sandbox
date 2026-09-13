const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/** Everything rendered through these helpers is untrusted user output. */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>]/g, (char) => ESCAPES[char] ?? char);

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
};

/**
 * Looked up once at startup. The alternative, `getElementById` inside the
 * paint function, re-queries forty nodes on every single step.
 */
export const queryElements = () => ({
  title: el('t-title'),
  subtitle: el('t-sub'),
  yourCode: el('t-yourcode'),
  pace: el('t-pace'),
  consoleTitle: el('t-console'),
  traceTitle: el('t-trace'),
  stackTitle: el('t-stack'),
  webTitle: el('t-web'),
  microTitle: el('t-micro'),
  macroTitle: el('t-macro'),
  heapTitle: el('t-heap'),
  note: el('t-note'),
  legend: el('legend'),

  langEn: el<HTMLButtonElement>('lang-en'),
  langUk: el<HTMLButtonElement>('lang-uk'),

  preset: el<HTMLSelectElement>('preset'),
  code: el<HTMLTextAreaElement>('code'),
  codeView: el('codeview'),
  speed: el<HTMLInputElement>('speed'),

  load: el<HTMLButtonElement>('load'),
  step: el<HTMLButtonElement>('step'),
  play: el<HTMLButtonElement>('play'),
  finish: el<HTMLButtonElement>('finish'),
  edit: el<HTMLButtonElement>('edit'),
  reset: el<HTMLButtonElement>('reset'),

  phase: el('phase'),
  phaseMessage: el('phasemsg'),
  tick: el('tick'),

  consoleOutput: el('console'),
  consoleCount: el('consolecount'),
  traceOutput: el('trace'),

  stack: el('stack'),
  web: el('web'),
  micro: el('micro'),
  macro: el('macro'),
  heap: el('heap'),

  counts: {
    stack: el('c-stack'),
    web: el('c-web'),
    micro: el('c-micro'),
    macro: el('c-macro'),
    heap: el('c-heap'),
  },
});

export type Elements = ReturnType<typeof queryElements>;

/** One row inside a queue, stack, Web API or heap panel. */
export const itemHtml = (tag: string, label: string, meta?: string): string =>
  `<div class="item"><span class="tag">${tag}</span><span>${escapeHtml(label)}` +
  `${meta ? `<br><span class="meta">${escapeHtml(meta)}</span>` : ''}</span></div>`;

export const fillSlot = <T>(
  node: HTMLElement,
  items: readonly T[],
  toHtml: (item: T) => string,
  emptyText: string,
): void => {
  node.innerHTML = items.length
    ? items.map(toHtml).join('')
    : `<div class="empty">${escapeHtml(emptyText)}</div>`;
};
