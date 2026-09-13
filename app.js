/* ---------- Storage ---------- */

const STORAGE_KEY = 'twoOfUsCycleTracker';

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      settings: { defaultCycleLength: 28, defaultPeriodLength: 5 },
      periods: [],   // [{ start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' | null }]
      notes: {},     // { 'YYYY-MM-DD': 'text' }
      together: []   // ['YYYY-MM-DD', ...] — days logged as time together
    };
  }
  try {
    const parsed = JSON.parse(raw);
    parsed.settings = parsed.settings || { defaultCycleLength: 28, defaultPeriodLength: 5 };
    parsed.periods = parsed.periods || [];
    parsed.notes = parsed.notes || {};
    parsed.together = parsed.together || [];
    return parsed;
  } catch (e) {
    console.error('Could not read saved data, starting fresh.', e);
    return {
      settings: { defaultCycleLength: 28, defaultPeriodLength: 5 },
      periods: [],
      notes: {},
      together: []
    };
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadData();

/* ---------- Icon set (inline SVG, tinted via currentColor) ---------- */

const HEART_PATH = 'M12 21s-7.5-4.6-10-9.1C.5 8.8 1.9 5.5 5 4.8c2-.5 4 .4 5 2.2 1-1.8 3-2.7 5-2.2 3.1.7 4.5 4 3 7.1-2.5 4.5-10 9.1-10 9.1Z';

const ICONS = {
  drop: `<svg viewBox="0 0 24 24" class="stage-icon"><path style="fill:currentColor" d="M12 2C12 2 5 11 5 15.5C5 19.09 8.13 22 12 22C15.87 22 19 19.09 19 15.5C19 11 12 2 12 2Z"/></svg>`,
  leaf: `<svg viewBox="0 0 24 24" class="stage-icon"><path style="fill:currentColor" d="M20 4C10.5 4.5 4 11 4 18.5c.6.2 1.3.3 2 .3C15 18.8 20 12.7 20 4Z"/><path style="fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round" opacity="0.7" d="M6 18C10 13 14 9 19 5"/></svg>`,
  egg: `<svg viewBox="0 0 24 24" class="stage-icon"><circle style="fill:none;stroke:currentColor;stroke-width:1.6" cx="12" cy="12" r="7"/><circle style="fill:currentColor" cx="9.6" cy="9.8" r="2.5"/></svg>`,
  best: `<svg viewBox="0 0 24 24" class="stage-icon"><path style="fill:currentColor" opacity="0.5" transform="translate(-3,-2) scale(0.72)" d="${HEART_PATH}"/><path style="fill:currentColor" transform="translate(3,2) scale(0.72)" d="${HEART_PATH}"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" class="stage-icon"><path style="fill:currentColor" d="${HEART_PATH}"/></svg>`
};

function populateStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach(el => {
    const name = el.getAttribute('data-icon');
    if (ICONS[name]) el.innerHTML = ICONS[name];
  });
}

/* ---------- Date helpers (local-time safe, no timezone drift) ---------- */

function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, n) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function daysBetween(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((stripTime(b) - stripTime(a)) / MS);
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(a, b) {
  return toKey(a) === toKey(b);
}

function formatLong(date) {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatMed(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMonthLabel(date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/* ---------- Cycle math ---------- */

function getSortedPeriods() {
  return [...state.periods]
    .map(p => ({ start: parseKey(p.start), end: p.end ? parseKey(p.end) : null, startKey: p.start, endKey: p.end }))
    .sort((a, b) => a.start - b.start);
}

function computeAverages() {
  const periods = getSortedPeriods();
  const cycleLengths = [];
  for (let i = 1; i < periods.length; i++) {
    cycleLengths.push(daysBetween(periods[i - 1].start, periods[i].start));
  }
  const recentCycleLengths = cycleLengths.slice(-6);
  const avgCycleLength = recentCycleLengths.length
    ? Math.round(recentCycleLengths.reduce((a, b) => a + b, 0) / recentCycleLengths.length)
    : state.settings.defaultCycleLength;

  const periodLengths = periods
    .filter(p => p.end)
    .map(p => daysBetween(p.start, p.end) + 1);
  const avgPeriodLength = periodLengths.length
    ? Math.round(periodLengths.reduce((a, b) => a + b, 0) / periodLengths.length)
    : state.settings.defaultPeriodLength;

  return { avgCycleLength, avgPeriodLength, periods };
}

/**
 * Builds a list of cycles: real logged ones plus projected future ones.
 * Each cycle: { start, periodEnd, isLogged, nextStart, isNextProjected,
 *               ovulation, fertileStart, fertileEnd, bestStart, bestEnd }
 */
function buildCycles() {
  const { avgCycleLength, avgPeriodLength, periods } = computeAverages();
  const cycles = [];

  for (let i = 0; i < periods.length; i++) {
    const start = periods[i].start;
    const hasNextLogged = !!periods[i + 1];
    const nextStart = hasNextLogged ? periods[i + 1].start : addDays(start, avgCycleLength);
    const periodEnd = periods[i].end || addDays(start, avgPeriodLength - 1);
    const ovulation = addDays(nextStart, -14);
    cycles.push({
      start, periodEnd, isLogged: true,
      nextStart, isNextProjected: !hasNextLogged,
      ovulation,
      fertileStart: addDays(ovulation, -5),
      fertileEnd: addDays(ovulation, 1),
      bestStart: addDays(ovulation, -2),
      bestEnd: ovulation
    });
  }

  // Extend forward with purely projected cycles so far-future months still show predictions.
  let lastStart = cycles.length ? cycles[cycles.length - 1].nextStart : null;
  const FUTURE_PROJECTIONS = 18;
  if (lastStart) {
    for (let k = 0; k < FUTURE_PROJECTIONS; k++) {
      const start = lastStart;
      const nextStart = addDays(start, avgCycleLength);
      const periodEnd = addDays(start, avgPeriodLength - 1);
      const ovulation = addDays(nextStart, -14);
      cycles.push({
        start, periodEnd, isLogged: false,
        nextStart, isNextProjected: true,
        ovulation,
        fertileStart: addDays(ovulation, -5),
        fertileEnd: addDays(ovulation, 1),
        bestStart: addDays(ovulation, -2),
        bestEnd: ovulation
      });
      lastStart = nextStart;
    }
  }

  return { cycles, avgCycleLength, avgPeriodLength, periods };
}

function inRange(date, start, end) {
  const d = stripTime(date), s = stripTime(start), e = stripTime(end);
  return d >= s && d <= e;
}

function getDayStatus(date, cyclesData) {
  const { cycles } = cyclesData;
  const status = { period: false, periodProjected: false, fertile: false, ovulation: false, best: false, together: false };
  status.together = state.together.includes(toKey(date));
  for (const c of cycles) {
    if (inRange(date, c.start, c.periodEnd)) {
      if (c.isLogged) status.period = true;
      else status.periodProjected = true;
    }
    if (c.isNextProjected && inRange(date, c.nextStart, addDays(c.nextStart, cyclesData.avgPeriodLength - 1))) {
      status.periodProjected = true;
    }
    if (inRange(date, c.fertileStart, c.fertileEnd)) status.fertile = true;
    if (sameDay(date, c.ovulation)) status.ovulation = true;
    if (inRange(date, c.bestStart, c.bestEnd)) status.best = true;
  }
  return status;
}

/* ---------- Calendar rendering ---------- */

let viewDate = new Date(); // month currently displayed
let selectedDateKey = null;

const monthLabel = document.getElementById('monthLabel');
const calendarGrid = document.getElementById('calendarGrid');

function renderCalendar() {
  const cyclesData = buildCycles();
  monthLabel.textContent = formatMonthLabel(viewDate);
  calendarGrid.innerHTML = '';

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < startWeekday; i++) {
    const empty = document.createElement('div');
    empty.className = 'day-cell day-cell--empty';
    calendarGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const status = getDayStatus(date, cyclesData);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'day-cell';
    if (sameDay(date, today)) cell.classList.add('day-cell--today');

    // Priority: logged period > predicted period > ovulation > best day > fertile window
    let bgClass = null, iconKind = null, iconClass = null;
    if (status.period) { bgClass = 'day-cell--period'; iconKind = 'drop'; iconClass = 'cell-icon--period'; }
    else if (status.periodProjected) { bgClass = 'day-cell--period-predicted'; iconKind = 'drop'; iconClass = 'cell-icon--period'; }
    else if (status.ovulation) { bgClass = 'day-cell--ovulation'; iconKind = 'egg'; iconClass = 'cell-icon--ovulation'; }
    else if (status.best) { bgClass = 'day-cell--best'; iconKind = 'best'; iconClass = 'cell-icon--best'; }
    else if (status.fertile) { bgClass = 'day-cell--fertile'; iconKind = 'leaf'; iconClass = 'cell-icon--fertile'; }

    if (bgClass) cell.classList.add(bgClass);

    const top = document.createElement('div');
    top.className = 'cell-top';

    const number = document.createElement('span');
    number.className = 'day-number';
    number.textContent = day;
    top.appendChild(number);

    if (iconKind) {
      const icon = document.createElement('span');
      icon.className = `cell-icon ${iconClass}`;
      icon.innerHTML = ICONS[iconKind];
      top.appendChild(icon);
    }
    cell.appendChild(top);

    const bottom = document.createElement('div');
    bottom.className = 'cell-bottom';
    if (status.together) {
      const badge = document.createElement('span');
      badge.className = 'cell-icon cell-icon--together';
      badge.innerHTML = ICONS.heart;
      bottom.appendChild(badge);
    }
    cell.appendChild(bottom);

    cell.addEventListener('click', () => openDayPanel(date));
    calendarGrid.appendChild(cell);
  }

  renderStats(cyclesData, today);
  renderHistory(cyclesData);
  renderTogetherInsight(cyclesData, today);
  renderJourney(cyclesData, today);
}

/* ---------- Stats ledger ---------- */

function renderStats(cyclesData, today) {
  const { cycles, avgCycleLength, avgPeriodLength, periods } = cyclesData;

  document.getElementById('statAvgCycle').textContent = periods.length ? `${avgCycleLength} days` : `${avgCycleLength} days (default)`;
  document.getElementById('statAvgPeriod').textContent = periods.length ? `${avgPeriodLength} days` : `${avgPeriodLength} days (default)`;

  if (!periods.length) {
    document.getElementById('statCycleDay').textContent = '—';
    document.getElementById('statNextPeriod').textContent = 'Log a period to begin';
    document.getElementById('statOvulation').textContent = '—';
    document.getElementById('statFertileWindow').textContent = '—';
    document.getElementById('statToday').textContent = 'No data yet';
    return;
  }

  const lastPeriod = periods[periods.length - 1];
  const cycleDay = daysBetween(lastPeriod.start, today) + 1;
  document.getElementById('statCycleDay').textContent = cycleDay > 0 ? `Day ${cycleDay}` : '—';

  // The relevant "current/upcoming" cycle is the last logged cycle's entry in `cycles`.
  const currentCycle = cycles.find(c => sameDay(c.start, lastPeriod.start));
  document.getElementById('statNextPeriod').textContent = formatMed(currentCycle.nextStart);
  document.getElementById('statOvulation').textContent = formatMed(currentCycle.ovulation);
  document.getElementById('statFertileWindow').textContent =
    `${formatMed(currentCycle.fertileStart)} – ${formatMed(currentCycle.fertileEnd)}`;

  const status = getDayStatus(today, cyclesData);
  let todayText = 'No notable events';
  if (status.period) todayText = 'Period';
  else if (status.ovulation) todayText = 'Predicted ovulation day';
  else if (status.best) todayText = 'Best day to try';
  else if (status.fertile) todayText = 'Fertile window';
  else if (status.periodProjected) todayText = 'Period expected soon';
  document.getElementById('statToday').textContent = todayText;
}

function renderHistory(cyclesData) {
  const logged = cyclesData.periods;
  const list = document.getElementById('historyList');
  if (!logged.length) {
    list.innerHTML = '<p class="empty-note">No periods logged yet. Tap a date on the calendar to begin.</p>';
    return;
  }
  const rows = [...logged].reverse().slice(0, 8).map(p => {
    const endLabel = p.end ? formatMed(p.end) : '—';
    return `<div class="history-row"><span>${formatMed(p.start)}</span><span>to ${endLabel}</span></div>`;
  });
  list.innerHTML = rows.join('');
}

/* ---------- Timing insight (time together vs. fertile window) ---------- */

function findActiveCycle(cycles, date) {
  return cycles.find(c => stripTime(date) >= stripTime(c.start) && stripTime(date) < stripTime(c.nextStart));
}

function renderTogetherInsight(cyclesData, today) {
  const el = document.getElementById('togetherInsight');
  const { periods, cycles } = cyclesData;
  if (!periods.length) {
    el.textContent = 'Log a period to see timing insights.';
    return;
  }
  const activeCycle = findActiveCycle(cycles, today) || cycles[cycles.length - 1];
  const togetherInCycle = state.together.filter(key => {
    const d = parseKey(key);
    return stripTime(d) >= stripTime(activeCycle.start) && stripTime(d) < stripTime(activeCycle.nextStart);
  });
  const inFertile = togetherInCycle.filter(key => inRange(parseKey(key), activeCycle.fertileStart, activeCycle.fertileEnd));

  let text = '';
  if (togetherInCycle.length === 0) {
    text = `Nothing logged yet this cycle. Fertile window: <strong>${formatMed(activeCycle.fertileStart)} – ${formatMed(activeCycle.fertileEnd)}</strong>.`;
  } else {
    text = `<strong>${togetherInCycle.length}</strong> time${togetherInCycle.length === 1 ? '' : 's'} together logged this cycle, <strong>${inFertile.length}</strong> within the fertile window.`;
  }

  if (stripTime(today) <= stripTime(activeCycle.fertileEnd) && inFertile.length === 0) {
    text += ` Fertile window ${stripTime(today) < stripTime(activeCycle.fertileStart) ? 'starts' : 'is open'} — nothing logged there yet.`;
  }

  el.innerHTML = text;
}

/* ---------- Cycle journey diagram ---------- */

const TUBE_LEFT = { p0: { x: 70, y: 92 }, p1: { x: 70, y: 150 }, p2: { x: 150, y: 168 }, p3: { x: 188, y: 174 } };
const TUBE_RIGHT = { p0: { x: 330, y: 92 }, p1: { x: 330, y: 150 }, p2: { x: 250, y: 168 }, p3: { x: 212, y: 174 } };

function bezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const x = mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x;
  const y = mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y;
  return { x, y };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function setMarkerPosition(p) {
  const marker = document.getElementById('eggMarker');
  marker.style.left = (p.x / 400 * 100) + '%';
  marker.style.top = (p.y / 260 * 100) + '%';
}

function renderJourney(cyclesData, today) {
  const caption = document.getElementById('journeyCaption');
  const eggMarker = document.getElementById('eggMarker');
  const follicleLeft = document.getElementById('follicleLeft');
  const follicleRight = document.getElementById('follicleRight');
  const { periods, cycles } = cyclesData;

  if (!periods.length) {
    follicleLeft.setAttribute('r', 4);
    follicleRight.setAttribute('r', 4);
    eggMarker.style.opacity = 0;
    eggMarker.classList.remove('egg-marker--pulse');
    caption.textContent = 'Log your first period to see where things stand in your cycle.';
    return;
  }

  const activeCycle = findActiveCycle(cycles, today) || cycles[cycles.length - 1];
  const cycleIndex = cycles.indexOf(activeCycle);
  const side = cycleIndex % 2 === 0 ? 'left' : 'right';
  const tube = side === 'left' ? TUBE_LEFT : TUBE_RIGHT;
  const activeFollicle = side === 'left' ? follicleLeft : follicleRight;
  const restingFollicle = side === 'left' ? follicleRight : follicleLeft;
  restingFollicle.setAttribute('r', 4);

  const dayNum = daysBetween(activeCycle.start, today) + 1;
  eggMarker.classList.remove('egg-marker--pulse');

  if (stripTime(today) <= stripTime(activeCycle.periodEnd)) {
    activeFollicle.setAttribute('r', 4);
    eggMarker.style.opacity = 0;
    caption.textContent = `Cycle day ${dayNum} — the uterine lining is shedding (period).`;

  } else if (stripTime(today) < stripTime(activeCycle.ovulation)) {
    const span = daysBetween(activeCycle.periodEnd, activeCycle.ovulation) || 1;
    const progress = clamp(daysBetween(activeCycle.periodEnd, today) / span, 0, 1);
    activeFollicle.setAttribute('r', (4 + progress * 11).toFixed(1));
    eggMarker.style.opacity = 0;
    caption.textContent = `Cycle day ${dayNum} — a follicle is maturing in the ovary, preparing an egg for around ${formatMed(activeCycle.ovulation)}.`;

  } else if (sameDay(today, activeCycle.ovulation)) {
    activeFollicle.setAttribute('r', 15);
    setMarkerPosition(tube.p0);
    eggMarker.style.opacity = 1;
    eggMarker.classList.add('egg-marker--pulse');
    caption.textContent = `Cycle day ${dayNum} — ovulation day. The egg is expected to release today.`;

  } else {
    const travelEnd = addDays(activeCycle.ovulation, 5);
    if (stripTime(today) <= stripTime(travelEnd)) {
      activeFollicle.setAttribute('r', 5);
      const t = clamp(daysBetween(activeCycle.ovulation, today) / 5, 0, 1);
      setMarkerPosition(bezierPoint(tube.p0, tube.p1, tube.p2, tube.p3, t));
      eggMarker.style.opacity = 1;
      const daysSince = daysBetween(activeCycle.ovulation, today);
      caption.textContent = daysSince === 1
        ? `Cycle day ${dayNum} — the egg has just been released and is at its most fertile. This is typically the highest-chance window if you're trying to conceive.`
        : `Cycle day ${dayNum} — moving into the luteal phase, following ovulation.`;
    } else {
      activeFollicle.setAttribute('r', 5);
      setMarkerPosition(bezierPoint(tube.p0, tube.p1, tube.p2, tube.p3, 1));
      eggMarker.style.opacity = 1;
      caption.textContent = `Cycle day ${dayNum} — in the luteal phase, waiting to see if the next period begins around ${formatMed(activeCycle.nextStart)}.`;
    }
  }
}

/* ---------- Day detail panel ---------- */

const overlay = document.getElementById('overlay');
const dayPanel = document.getElementById('dayPanel');
const dayPanelDate = document.getElementById('dayPanelDate');
const dayPanelStatus = document.getElementById('dayPanelStatus');
const dayNotes = document.getElementById('dayNotes');
const markStartBtn = document.getElementById('markStart');
const markEndBtn = document.getElementById('markEnd');
const clearPeriodBtn = document.getElementById('clearPeriod');
const markTogetherBtn = document.getElementById('markTogether');

function openDayPanel(date) {
  selectedDateKey = toKey(date);
  dayPanelDate.textContent = formatLong(date);
  dayNotes.value = state.notes[selectedDateKey] || '';
  refreshDayPanelStatus(date);
  overlay.classList.add('visible');
  dayPanel.classList.add('open');
}

function refreshDayPanelStatus(date) {
  const cyclesData = buildCycles();
  const status = getDayStatus(date, cyclesData);
  const labels = [];
  if (status.period) labels.push('Logged period day');
  if (status.periodProjected) labels.push('Predicted period day');
  if (status.ovulation) labels.push('Predicted ovulation day');
  else if (status.best) labels.push('Best day to try');
  else if (status.fertile) labels.push('Fertile window');
  if (status.together) labels.push('Time together logged');
  dayPanelStatus.textContent = labels.length ? labels.join(' · ') : 'No events logged for this day';

  const isStart = state.periods.some(p => p.start === selectedDateKey);
  const isEnd = state.periods.some(p => p.end === selectedDateKey);
  markStartBtn.classList.toggle('pill-btn--active', isStart);
  markEndBtn.classList.toggle('pill-btn--active', isEnd);
  markTogetherBtn.classList.toggle('pill-btn--active', state.together.includes(selectedDateKey));
}

function closeDayPanel() {
  overlay.classList.remove('visible');
  dayPanel.classList.remove('open');
  selectedDateKey = null;
}

document.getElementById('closePanel').addEventListener('click', closeDayPanel);
overlay.addEventListener('click', closeDayPanel);

markStartBtn.addEventListener('click', () => {
  if (!selectedDateKey) return;
  const existingIndex = state.periods.findIndex(p => p.start === selectedDateKey);
  if (existingIndex !== -1) {
    // toggle off
    state.periods.splice(existingIndex, 1);
  } else {
    state.periods.push({ start: selectedDateKey, end: null });
  }
  saveData();
  renderCalendar();
  refreshDayPanelStatus(parseKey(selectedDateKey));
});

markEndBtn.addEventListener('click', () => {
  if (!selectedDateKey) return;
  const selected = parseKey(selectedDateKey);
  const candidates = state.periods
    .filter(p => parseKey(p.start) <= selected)
    .sort((a, b) => parseKey(b.start) - parseKey(a.start));
  if (!candidates.length) {
    alert('Mark a period start on or before this date first.');
    return;
  }
  const target = candidates[0];
  target.end = (target.end === selectedDateKey) ? null : selectedDateKey;
  saveData();
  renderCalendar();
  refreshDayPanelStatus(selected);
});

clearPeriodBtn.addEventListener('click', () => {
  if (!selectedDateKey) return;
  const startIndex = state.periods.findIndex(p => p.start === selectedDateKey);
  if (startIndex !== -1) {
    state.periods.splice(startIndex, 1);
  } else {
    const endMatch = state.periods.find(p => p.end === selectedDateKey);
    if (endMatch) endMatch.end = null;
  }
  saveData();
  renderCalendar();
  refreshDayPanelStatus(parseKey(selectedDateKey));
});

markTogetherBtn.addEventListener('click', () => {
  if (!selectedDateKey) return;
  const idx = state.together.indexOf(selectedDateKey);
  if (idx !== -1) state.together.splice(idx, 1);
  else state.together.push(selectedDateKey);
  saveData();
  renderCalendar();
  refreshDayPanelStatus(parseKey(selectedDateKey));
});

document.getElementById('saveDay').addEventListener('click', () => {
  if (!selectedDateKey) return;
  const text = dayNotes.value.trim();
  if (text) state.notes[selectedDateKey] = text;
  else delete state.notes[selectedDateKey];
  saveData();
  closeDayPanel();
});

/* ---------- Month navigation ---------- */

document.getElementById('prevMonth').addEventListener('click', () => {
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
  renderCalendar();
});

document.getElementById('nextMonth').addEventListener('click', () => {
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
  renderCalendar();
});

document.getElementById('todayBtn').addEventListener('click', () => {
  viewDate = new Date();
  renderCalendar();
});

/* ---------- Settings ---------- */

const cycleLenInput = document.getElementById('defaultCycleLength');
const periodLenInput = document.getElementById('defaultPeriodLength');

cycleLenInput.value = state.settings.defaultCycleLength;
periodLenInput.value = state.settings.defaultPeriodLength;

cycleLenInput.addEventListener('change', () => {
  const val = parseInt(cycleLenInput.value, 10);
  if (val >= 15 && val <= 60) {
    state.settings.defaultCycleLength = val;
    saveData();
    renderCalendar();
  }
});

periodLenInput.addEventListener('change', () => {
  const val = parseInt(periodLenInput.value, 10);
  if (val >= 1 && val <= 15) {
    state.settings.defaultPeriodLength = val;
    saveData();
    renderCalendar();
  }
});

/* ---------- Init ---------- */

populateStaticIcons();
renderCalendar();
