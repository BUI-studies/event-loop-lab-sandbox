import { formatValue } from '../engine/format';
import type { ConsoleLine, Frame, HeapEntry, LoopEvent, TraceLine } from '../engine/types';
import type { World } from '../engine/world';
import type { Translator } from '../i18n';
import { escapeHtml, fillSlot, itemHtml, type Elements } from './dom';

const TAG = {
  frame: '▸',
  micro: 'µ',
  task: '■',
  web: '⇄',
  promise: '○',
  paused: '❄',
} as const;

/** Older trace lines are dropped: the panel scrolls, the DOM should not grow. */
const TRACE_TAIL = 90;

const heapItem = (entry: HeapEntry, tr: Translator): string => {
  if (entry.kind === 'async') {
    return itemHtml(
      TAG.paused,
      tr.t('iPaused', { name: entry.name }),
      entry.at === 'start' ? tr.t('iStart') : tr.t('iAwaiting'),
    );
  }
  return itemHtml(
    TAG.promise,
    `${entry.label} - ${entry.state}`,
    entry.state === 'pending'
      ? tr.t('iWaiting', { n: entry.pendingReactions })
      : tr.t('iValue', { v: formatValue(entry.value) }),
  );
};

const consoleRow = (line: ConsoleLine, index: number, tr: Translator): string =>
  `<div class="${line.level === 'error' ? 'err' : ''}">` +
  `<span class="ord">${index + 1}</span>${escapeHtml(tr.resolve(line.text))}</div>`;

const traceRow = (line: TraceLine, tr: Translator): string =>
  `<div class="${line.lane}">${line.at}ms <b>${escapeHtml(tr.resolve(line.text))}</b></div>`;

/** Works for both stack frames and queued jobs, since a `Job` is a `Frame`. */
const frameItem = (frame: Frame, tag: string, tr: Translator): string =>
  itemHtml(
    tag,
    tr.resolve(frame.label),
    frame.meta === undefined ? undefined : tr.resolve(frame.meta),
  );

const renderPanels = (els: Elements, world: World, tr: Translator): void => {
  fillSlot(els.stack, world.callStack, (f) => frameItem(f, TAG.frame, tr), tr.t('emptyStack'));
  fillSlot(els.micro, world.microtasks, (j) => frameItem(j, TAG.micro, tr), tr.t('emptyQueue'));
  fillSlot(els.macro, world.macrotasks, (j) => frameItem(j, TAG.task, tr), tr.t('emptyQueue'));
  fillSlot(
    els.web,
    world.webApi,
    (entry) =>
      itemHtml(
        TAG.web,
        tr.resolve(entry.label),
        tr.t('iFires', { meta: entry.meta, t: entry.due }),
      ),
    tr.t('emptyWeb'),
  );
  fillSlot(els.heap, world.heap, (entry) => heapItem(entry, tr), tr.t('emptyHeap'));

  els.counts.stack.textContent = String(world.callStack.length);
  els.counts.micro.textContent = String(world.microtasks.length);
  els.counts.macro.textContent = String(world.macrotasks.length);
  els.counts.web.textContent = String(world.webApi.length);
  els.counts.heap.textContent = String(world.heap.length);
};

const renderConsole = (els: Elements, world: World, tr: Translator): void => {
  els.consoleOutput.innerHTML = world.consoleLines.length
    ? world.consoleLines.map((line, index) => consoleRow(line, index, tr)).join('')
    : `<div class="empty no-rule">${escapeHtml(tr.t('emptyConsole'))}</div>`;
  els.consoleOutput.scrollTop = els.consoleOutput.scrollHeight;
  els.consoleCount.textContent = world.consoleLines.length
    ? `${world.consoleLines.length} ${tr.t('lines')}`
    : '';
};

const renderTrace = (els: Elements, world: World, tr: Translator): void => {
  els.traceOutput.innerHTML = world.traceLines
    .slice(-TRACE_TAIL)
    .map((line) => traceRow(line, tr))
    .join('');
  els.traceOutput.scrollTop = els.traceOutput.scrollHeight;
};

/** Blue marks where this step stopped, violet the other lines it touched. */
const lineClass = (world: World, line: number): string => {
  if (line === world.currentLine) return ' hot';
  return world.stepLines.includes(line) ? ' warm' : '';
};

const scrollToCurrentLine = (view: HTMLElement): void => {
  const hot = view.querySelector<HTMLElement>('.row.hot');
  if (!hot) return;

  const outOfView = hot.offsetTop < view.scrollTop || hot.offsetTop > view.scrollTop + view.clientHeight - 30;
  if (outOfView) view.scrollTop = Math.max(0, hot.offsetTop - view.clientHeight / 2);
};

const renderCode = (els: Elements, world: World): void => {
  if (!world.sourceLines.length) return;

  els.codeView.innerHTML = world.sourceLines
    .map((line, index) => {
      const number = index + 1;
      return (
        `<div class="row${lineClass(world, number)}">` +
        `<span class="n">${number}</span>${escapeHtml(line) || ' '}</div>`
      );
    })
    .join('');

  scrollToCurrentLine(els.codeView);
};

/** The single place the DOM is written. Everything upstream is plain data. */
export const render = (
  els: Elements,
  world: World,
  tr: Translator,
  event: LoopEvent | null,
): void => {
  els.tick.textContent = `t=${world.clock}ms`;
  if (event) {
    els.phase.dataset.lane = event.lane;
    els.phaseMessage.textContent = tr.resolve(event.message);
  }

  renderPanels(els, world, tr);
  renderConsole(els, world, tr);
  renderTrace(els, world, tr);
  renderCode(els, world);
};
