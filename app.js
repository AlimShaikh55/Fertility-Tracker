/* ---------- Storage ---------- */

const STORAGE_KEY = 'twoOfUsCycleTracker';

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      settings: { defaultCycleLength: 28, defaultPeriodLength: 5 },
      periods: [],   // [{ start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' | null }]
      notes: {}      // { 'YYYY-MM-DD': 'text' }
    };
  }
  try {
    const parsed = JSON.parse(raw);
    parsed.settings = parsed.settings || { defaultCycleLength: 28, defaultPeriodLength: 5 };
    parsed.periods = parsed.periods || [];
    parsed.notes = parsed.notes || {};
    return parsed;
  } catch (e) {
    console.error('Could not read saved data, starting fresh.', e);
    return {
      settings: { defaultCycleLength: 28, defaultPeriodLength: 5 },
      periods: [],
      notes: {}
    };
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadData();

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
  const status = { period: false, periodProjected: false, fertile: false, ovulation: false, best: false };
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

    const number = document.createElement('span');
    number.className = 'day-number';
    number.textContent = day;
    cell.appendChild(number);

    const tags = document.createElement('span');
    tags.className = 'day-tags';
    if (status.period) tags.appendChild(dot('period'));
    if (status.fertile && !status.ovulation) tags.appendChild(dot('fertile'));
    if (status.ovulation) tags.appendChild(dot('ovulation'));
    else if (status.best) tags.appendChild(dot('best'));
    cell.appendChild(tags);

    if (status.period) {
      cell.appendChild(underline('period'));
    } else if (status.periodProjected) {
      cell.appendChild(underline('period-predicted'));
    } else if (status.ovulation) {
      cell.appendChild(underline('ovulation'));
    } else if (status.fertile) {
      cell.appendChild(underline('fertile'));
    }

    cell.addEventListener('click', () => openDayPanel(date));
    calendarGrid.appendChild(cell);
  }

  renderStats(cyclesData, today);
  renderHistory(cyclesData);
}

function dot(kind) {
  const s = document.createElement('span');
  s.className = `tag-dot tag-dot--${kind}`;
  return s;
}

function underline(kind) {
  const s = document.createElement('span');
  s.className = `day-underline day-underline--${kind}`;
  return s;
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

/* ---------- Day detail panel ---------- */

const overlay = document.getElementById('overlay');
const dayPanel = document.getElementById('dayPanel');
const dayPanelDate = document.getElementById('dayPanelDate');
const dayPanelStatus = document.getElementById('dayPanelStatus');
const dayNotes = document.getElementById('dayNotes');
const markStartBtn = document.getElementById('markStart');
const markEndBtn = document.getElementById('markEnd');
const clearPeriodBtn = document.getElementById('clearPeriod');

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
  dayPanelStatus.textContent = labels.length ? labels.join(' · ') : 'No events logged for this day';

  const isStart = state.periods.some(p => p.start === selectedDateKey);
  const isEnd = state.periods.some(p => p.end === selectedDateKey);
  markStartBtn.classList.toggle('pill-btn--active', isStart);
  markEndBtn.classList.toggle('pill-btn--active', isEnd);
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

renderCalendar();
