/* global document, window */
/*
 * Replay player inlined verbatim into exported HTML (see replayExport.ts).
 * It reads the JSON data block and creates every node with textContent, so
 * trace data never reaches an HTML parser. A CSP hash pins this exact text:
 * keep it free of script tags and HTML comment openers.
 */
(function () {
  'use strict';

  const root = document.getElementById('replay');
  const source = document.getElementById('replay-data');
  if (!root || !source) return;

  let data;
  try {
    data = JSON.parse(source.textContent || '');
  } catch {
    root.textContent = 'This replay file is damaged and cannot be shown.';
    return;
  }
  if (
    !data ||
    data.format !== 'code-visualizer-replay' ||
    !Array.isArray(data.steps) ||
    data.steps.length === 0
  ) {
    root.textContent = 'This replay file has no steps to show.';
    return;
  }

  const steps = data.steps;
  const strings = Array.isArray(data.strings) ? data.strings : [];
  const checkpoints = Array.isArray(data.checkpoints) ? data.checkpoints : [];
  const stdout = String(data.stdout || '');
  const last = steps.length - 1;
  const languages = { python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript' };
  const text = (index) => (index >= 0 && index < strings.length ? String(strings[index]) : '');

  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  // Assigning identical text would make screen readers repeat live regions.
  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  function button(label, title, onClick) {
    const node = el('button', '', label);
    node.type = 'button';
    node.title = title;
    node.addEventListener('click', () => {
      if (node.getAttribute('aria-disabled') !== 'true') onClick();
    });
    return node;
  }

  // aria-disabled keeps focus on a button that reaches the end of the trace.
  function setDisabled(node, disabled) {
    node.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }

  const header = el('header');
  header.append(el('h1', '', 'Code Visualizer replay'));
  header.append(
    el(
      'p',
      'meta',
      [
        String(data.title || 'Script'),
        languages[data.language] || '',
        `${steps.length} steps`,
        `exported ${String(data.exportedAt || '').slice(0, 10)}`,
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  );
  for (const note of Array.isArray(data.notes) ? data.notes : []) {
    const item = el('p', 'note', String(note));
    item.setAttribute('role', 'note');
    header.append(item);
  }

  const caption = el('section', 'panel caption');
  caption.setAttribute('aria-label', 'Checkpoint caption');
  const live = el('div', 'caption-live');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  const captionLabel = el('span', 'caption-label');
  const captionText = el('span', 'caption-text');
  live.append(captionLabel, captionText);
  const captionHint = el('p', 'hint');
  const previousCheckpoint = button(
    'Previous checkpoint',
    'Previous checkpoint ([ or Page Up)',
    () => goCheckpoint(-1),
  );
  const nextCheckpoint = button('Next checkpoint', 'Next checkpoint (] or Page Down)', () =>
    goCheckpoint(1),
  );
  caption.append(live, captionHint, previousCheckpoint, nextCheckpoint);
  caption.hidden = checkpoints.length === 0;

  const codePanel = el('section', 'panel');
  codePanel.setAttribute('aria-label', 'Code');
  const phase = el('p', 'phase');
  const list = el('ol', 'code');
  list.setAttribute('aria-label', 'Source code');
  const lines = String(data.code || '')
    .split('\n')
    .map((line, index) => {
      const item = el('li');
      const number = el('span', 'num', String(index + 1));
      number.setAttribute('aria-hidden', 'true');
      item.append(number, el('span', 'src', line || ' '));
      list.append(item);
      return item;
    });
  codePanel.append(el('h2', '', 'Code'), phase, list);

  const variablesPanel = el('section', 'panel');
  variablesPanel.setAttribute('aria-label', 'Variables');
  const frameLabel = el('p', 'hint');
  const table = el('table');
  const tableCaption = el('caption', 'sr-only');
  const head = el('thead');
  const headRow = el('tr');
  for (const name of ['Name', 'Value']) {
    const cell = el('th', '', name);
    cell.scope = 'col';
    headRow.append(cell);
  }
  head.append(headRow);
  const body = el('tbody');
  table.append(tableCaption, head, body);
  const noVariables = el('p', 'hint', 'No variables in this frame yet.');
  variablesPanel.append(el('h2', '', 'Variables'), frameLabel, table, noVariables);

  const outputPanel = el('section', 'panel');
  outputPanel.setAttribute('aria-label', 'Output');
  const output = el('pre', 'out');
  output.tabIndex = 0;
  output.setAttribute('aria-label', 'Printed output');
  const noOutput = el('p', 'hint', 'Nothing printed yet.');
  outputPanel.append(el('h2', '', 'Output'), output, noOutput);

  const controls = el('section', 'panel controls');
  controls.setAttribute('aria-label', 'Playback controls');
  const group = el('div', 'buttons');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Step navigation');
  const first = button('First', 'First step (Home)', () => userShow(0));
  const back = button('Previous', 'Previous step (Left arrow)', () => userShow(current - 1));
  const play = button('Play', 'Play or pause (Space)', togglePlay);
  play.setAttribute('aria-pressed', 'false');
  const forward = button('Next', 'Next step (Right arrow)', () => userShow(current + 1));
  const end = button('Last', 'Last step (End)', () => userShow(last));
  group.append(first, back, play, forward, end);
  const slider = el('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(last);
  slider.step = '1';
  slider.setAttribute('aria-label', 'Trace position');
  slider.addEventListener('input', () => userShow(Number(slider.value)));
  const status = el('p', 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  controls.append(
    group,
    slider,
    status,
    el(
      'p',
      'hint',
      'Keys: Left/Right step · Home/End · Space plays · [ and ] jump between checkpoints',
    ),
  );

  const side = el('div', 'side');
  side.append(variablesPanel, outputPanel);
  const layout = el('div', 'layout');
  layout.append(codePanel, side);
  root.textContent = '';
  root.append(header, caption, layout, controls);

  let current = -1;
  let timer = null;

  function describe(step) {
    if (step.event === 'line') {
      return step.phase === 'after'
        ? 'just ran (after execution)'
        : 'about to run (before execution)';
    }
    return text(step.detail) || step.event;
  }

  // Mirrors checkpointNavigation in src/engine/traceCheckpoints.ts.
  function navigation() {
    const at = checkpoints.findIndex((checkpoint) => checkpoint.step === current);
    if (at >= 0) {
      return {
        current: at,
        previous: at > 0 ? at - 1 : null,
        next: at < checkpoints.length - 1 ? at + 1 : null,
      };
    }
    let previous = null;
    let next = null;
    checkpoints.forEach((checkpoint, index) => {
      if (
        checkpoint.step < current &&
        (previous === null || checkpoint.step > checkpoints[previous].step)
      ) {
        previous = index;
      }
      if (
        checkpoint.step > current &&
        (next === null || checkpoint.step < checkpoints[next].step)
      ) {
        next = index;
      }
    });
    return { current: null, previous, next };
  }

  function updateCaption() {
    if (checkpoints.length === 0) return;
    const nav = navigation();
    if (nav.current !== null) {
      const checkpoint = checkpoints[nav.current];
      setText(
        captionLabel,
        `Checkpoint ${nav.current + 1} of ${checkpoints.length} · step ${checkpoint.step}`,
      );
      setText(captionText, String(checkpoint.note || '') || 'No note for this checkpoint.');
      setText(captionHint, '');
    } else {
      setText(captionLabel, '');
      setText(captionText, '');
      setText(
        captionHint,
        nav.next !== null
          ? `Between checkpoints. Next: checkpoint ${nav.next + 1} at step ${checkpoints[nav.next].step}.`
          : 'After the last checkpoint.',
      );
    }
    setDisabled(previousCheckpoint, nav.previous === null);
    setDisabled(nextCheckpoint, nav.next === null);
  }

  function scrollToLine(line) {
    const top = line.offsetTop;
    const bottom = top + line.offsetHeight;
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 3);
    }
  }

  function renderVariables(step) {
    const vars = Array.isArray(step.vars) ? step.vars : [];
    const rows = [];
    for (let index = 0; index + 2 < vars.length; index += 3) {
      const row = el('tr', vars[index + 2] === 2 ? 'new' : vars[index + 2] === 1 ? 'changed' : '');
      const value = el('td', '', text(vars[index + 1]));
      if (vars[index + 2])
        value.append(el('span', 'badge', vars[index + 2] === 2 ? 'new' : 'changed'));
      row.append(el('td', '', text(vars[index])), value);
      rows.push(row);
    }
    if (step.hidden > 0) {
      const row = el('tr');
      const cell = el('td', '', `${step.hidden} more not included in this replay`);
      cell.colSpan = 2;
      row.append(cell);
      rows.push(row);
    }
    body.replaceChildren(...rows);
    table.hidden = rows.length === 0;
    noVariables.hidden = rows.length > 0;
    setText(frameLabel, `${text(step.frame)} · call depth ${step.depth}`);
    setText(tableCaption, `Variables in ${text(step.frame)}`);
  }

  function show(index) {
    const target = Math.max(0, Math.min(last, Number.isFinite(index) ? Math.trunc(index) : 0));
    const previousLine = current >= 0 ? lines[steps[current].line - 1] : undefined;
    if (previousLine) {
      previousLine.classList.remove('current');
      previousLine.removeAttribute('aria-current');
    }
    current = target;
    const step = steps[current];
    const line = lines[step.line - 1];
    if (line) {
      line.classList.add('current');
      line.setAttribute('aria-current', 'step');
      scrollToLine(line);
    }
    setText(phase, `Line ${step.line} · ${describe(step)}`);
    renderVariables(step);
    const printed = stdout.slice(0, step.out);
    setText(output, printed);
    output.hidden = printed === '';
    noOutput.hidden = printed !== '';
    slider.value = String(current);
    slider.setAttribute('aria-valuetext', `Step ${current} of ${last}`);
    setText(status, `Step ${current} / ${last} · line ${step.line} · ${describe(step)}`);
    setDisabled(first, current === 0);
    setDisabled(back, current === 0);
    setDisabled(forward, current === last);
    setDisabled(end, current === last);
    updateCaption();
  }

  function stopPlaying() {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    setText(play, 'Play');
    play.setAttribute('aria-pressed', 'false');
    status.setAttribute('aria-live', 'polite');
  }

  function togglePlay() {
    if (timer !== null) {
      stopPlaying();
      return;
    }
    if (current >= last) show(0);
    setText(play, 'Pause');
    play.setAttribute('aria-pressed', 'true');
    // Announcing every step while playing would drown out the captions.
    status.setAttribute('aria-live', 'off');
    timer = window.setInterval(() => {
      show(current + 1);
      // Playback pauses on each checkpoint so its caption can be read.
      if (current >= last || checkpoints.some((checkpoint) => checkpoint.step === current)) {
        stopPlaying();
      }
    }, 700);
  }

  function userShow(index) {
    stopPlaying();
    show(index);
  }

  function goCheckpoint(direction) {
    const nav = navigation();
    const target = direction < 0 ? nav.previous : nav.next;
    if (target !== null) userShow(checkpoints[target].step);
  }

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const tag = event.target && event.target.tagName;
    const checkpointKey = ['[', ']', 'PageUp', 'PageDown'].includes(event.key);
    // The slider handles arrows, Home and End itself; buttons handle Space.
    if (tag === 'INPUT' && !checkpointKey) return;
    if (tag === 'BUTTON' && (event.key === ' ' || event.key === 'Enter')) return;
    switch (event.key) {
      case 'ArrowLeft':
        userShow(current - 1);
        break;
      case 'ArrowRight':
        userShow(current + 1);
        break;
      case 'Home':
        userShow(0);
        break;
      case 'End':
        userShow(last);
        break;
      case ' ':
        togglePlay();
        break;
      case '[':
      case 'PageUp':
        goCheckpoint(-1);
        break;
      case ']':
      case 'PageDown':
        goCheckpoint(1);
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  show(Number(data.start) || 0);
})();
