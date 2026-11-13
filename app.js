// ============================================================
// DateUtils — pure date-string helpers (all dates as "YYYY-MM-DD")
// ============================================================

const DateUtils = {
  today() {
    return new Date().toLocaleDateString('en-CA');
  },

  toKey(date) {
    return date.toLocaleDateString('en-CA');
  },

  fromKey(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  },

  dayOfWeek(dateStr) {
    return this.fromKey(dateStr).getDay();
  },

  addDays(dateStr, n) {
    const d = this.fromKey(dateStr);
    d.setDate(d.getDate() + n);
    return this.toKey(d);
  },

  getWeekDates(refDate) {
    const d = this.fromKey(refDate);
    const dow = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((dow + 6) % 7));
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      dates.push(this.toKey(day));
    }
    return dates;
  },

  getMonthDates(year, month) {
    const dates = [];
    const d = new Date(year, month, 1);
    while (d.getMonth() === month) {
      dates.push(this.toKey(d));
      d.setDate(d.getDate() + 1);
    }
    return dates;
  },

  formatShort(dateStr) {
    const d = this.fromKey(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  formatDayShort(dateStr) {
    const d = this.fromKey(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  },

  formatMonthYear(year, month) {
    return new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  },

  formatDateNum(dateStr) {
    return parseInt(dateStr.split('-')[2], 10);
  },

  isSameDay(a, b) {
    return a === b;
  }
};


// ============================================================
// HabitStore — CRUD, completions, streaks, heatmap, persistence
// ============================================================

const HabitStore = (() => {
  const HABITS_KEY = 'habitTracker_habits';
  const COMPLETIONS_KEY = 'habitTracker_completions';
  const SETTINGS_KEY = 'habitTracker_settings';

  const PRESET_COLORS = [
    '#6366f1', '#10b981', '#f59e0b', '#f43f5e',
    '#0ea5e9', '#8b5cf6', '#f97316', '#14b8a6',
    '#ec4899', '#84cc16'
  ];

  const DEFAULT_CATEGORIES = ['Health', 'Learning', 'Fitness', 'Mindfulness', 'Productivity', 'Other'];

  let habits = [];
  let completions = {};
  let settings = {};
  let streakCache = {};

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function save() {
    try {
      localStorage.setItem(HABITS_KEY, JSON.stringify(habits));
      localStorage.setItem(COMPLETIONS_KEY, JSON.stringify(completions));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }

  function load() {
    try {
      const h = localStorage.getItem(HABITS_KEY);
      const c = localStorage.getItem(COMPLETIONS_KEY);
      const s = localStorage.getItem(SETTINGS_KEY);
      habits = h ? JSON.parse(h) : [];
      completions = c ? JSON.parse(c) : {};
      settings = s ? JSON.parse(s) : {};
    } catch (e) {
      console.error('Corrupted localStorage data, resetting:', e);
      habits = [];
      completions = {};
      settings = {};
    }
    if (!settings.categories) settings.categories = [...DEFAULT_CATEGORIES];
  }

  function isScheduledDay(habit, dateStr) {
    const dow = DateUtils.dayOfWeek(dateStr);
    const freq = habit.frequency;
    if (freq.type === 'daily') return true;
    if (freq.type === 'weekdays') return dow >= 1 && dow <= 5;
    if (freq.type === 'weekends') return dow === 0 || dow === 6;
    if (freq.type === 'custom') return freq.days.includes(dow);
    return true;
  }

  return {
    PRESET_COLORS,
    DEFAULT_CATEGORIES,

    init() {
      load();
    },

    getAll() {
      return habits.filter(h => !h.archived);
    },

    getById(id) {
      return habits.find(h => h.id === id);
    },

    getForDate(dateStr) {
      return this.getAll().filter(h => isScheduledDay(h, dateStr));
    },

    create(data) {
      const habit = {
        id: generateId(),
        name: data.name,
        category: data.category || 'Other',
        color: data.color || PRESET_COLORS[0],
        frequency: data.frequency || { type: 'daily', days: [] },
        createdAt: DateUtils.today(),
        archived: false,
        order: habits.length
      };
      habits.push(habit);
      streakCache = {};
      save();
      return habit;
    },

    update(id, data) {
      const habit = this.getById(id);
      if (!habit) return null;
      Object.assign(habit, data);
      streakCache = {};
      save();
      return habit;
    },

    delete(id) {
      const keysToRemove = Object.keys(completions).filter(k => k.startsWith(id + ':'));
      keysToRemove.forEach(k => delete completions[k]);
      habits = habits.filter(h => h.id !== id);
      streakCache = {};
      save();
    },

    isCompleted(habitId, dateStr) {
      return completions[habitId + ':' + dateStr] === true;
    },

    toggleCompletion(habitId, dateStr) {
      const key = habitId + ':' + dateStr;
      completions[key] = !completions[key];
      delete streakCache[habitId];
      save();
      return completions[key];
    },

    getCompletionRate(dateStr) {
      const todayHabits = this.getForDate(dateStr);
      if (todayHabits.length === 0) return { completed: 0, total: 0, percent: 0 };
      const completed = todayHabits.filter(h => this.isCompleted(h.id, dateStr)).length;
      return {
        completed,
        total: todayHabits.length,
        percent: Math.round((completed / todayHabits.length) * 100)
      };
    },

    getCurrentStreak(habitId) {
      if (streakCache[habitId] !== undefined) return streakCache[habitId];
      const habit = this.getById(habitId);
      if (!habit) return 0;

      let streak = 0;
      let dateStr = DateUtils.today();

      if (this.isCompleted(habitId, dateStr) && isScheduledDay(habit, dateStr)) {
        streak = 1;
        dateStr = DateUtils.addDays(dateStr, -1);
      } else if (isScheduledDay(habit, dateStr)) {
        dateStr = DateUtils.addDays(dateStr, -1);
      }

      let safety = 0;
      while (safety < 1000) {
        safety++;
        if (dateStr < habit.createdAt) break;
        if (!isScheduledDay(habit, dateStr)) {
          dateStr = DateUtils.addDays(dateStr, -1);
          continue;
        }
        if (this.isCompleted(habitId, dateStr)) {
          streak++;
          dateStr = DateUtils.addDays(dateStr, -1);
        } else {
          break;
        }
      }
      streakCache[habitId] = streak;
      return streak;
    },

    getBestStreak(habitId) {
      const habit = this.getById(habitId);
      if (!habit) return 0;

      let best = 0;
      let current = 0;
      let dateStr = habit.createdAt;
      const today = DateUtils.today();
      let safety = 0;

      while (dateStr <= today && safety < 2000) {
        safety++;
        if (!isScheduledDay(habit, dateStr)) {
          dateStr = DateUtils.addDays(dateStr, 1);
          continue;
        }
        if (this.isCompleted(habitId, dateStr)) {
          current++;
          if (current > best) best = current;
        } else {
          current = 0;
        }
        dateStr = DateUtils.addDays(dateStr, 1);
      }
      return best;
    },

    getOverallBestStreak() {
      const all = this.getAll();
      if (all.length === 0) return 0;
      let best = 0;
      all.forEach(h => {
        const s = this.getBestStreak(h.id);
        if (s > best) best = s;
      });
      return best;
    },

    getHeatmapData(days) {
      const data = [];
      const today = DateUtils.today();
      for (let i = days - 1; i >= 0; i--) {
        const dateStr = DateUtils.addDays(today, -i);
        const habitsForDay = this.getForDate(dateStr);
        if (habitsForDay.length === 0) {
          data.push({ date: dateStr, completed: 0, total: 0, percent: 0 });
        } else {
          const completed = habitsForDay.filter(h => this.isCompleted(h.id, dateStr)).length;
          data.push({
            date: dateStr,
            completed,
            total: habitsForDay.length,
            percent: Math.round((completed / habitsForDay.length) * 100)
          });
        }
      }
      return data;
    },

    getCategories() {
      return settings.categories || [...DEFAULT_CATEGORIES];
    },

    addCategory(name) {
      if (!settings.categories) settings.categories = [...DEFAULT_CATEGORIES];
      if (!settings.categories.includes(name)) {
        settings.categories.push(name);
        save();
      }
    },

    isScheduledDay
  };
})();


// ============================================================
// UIController — rendering, events, modals, view switching
// ============================================================

const UIController = (() => {
  let currentView = 'today';
  let weekOffset = 0;
  let monthOffset = 0;
  let selectedHabitId = null;
  let returnFocusEl = null;

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];

  const checkSvg = '<svg class="check-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 7.5 5.5 10.5 11.5 4"/></svg>';

  const dotsSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/></svg>';

  function el(tag, className, attrs) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  }

  function clearContainer(container) {
    container.innerHTML = '';
  }

  // ---- Render: Today View ----

  function renderTodayView() {
    const main = $('#app-main');
    clearContainer(main);

    const today = DateUtils.today();
    const rate = HabitStore.getCompletionRate(today);
    const habits = HabitStore.getForDate(today);
    const bestStreak = HabitStore.getOverallBestStreak();

    renderStatsBar(main, rate, bestStreak);
    renderHabitList(main, habits, today);
    renderHeatmapSection(main);
  }

  function renderStatsBar(parent, rate, bestStreak) {
    const bar = el('section', 'stats-bar');

    // Completed count
    const card1 = el('div', 'stat-card');
    card1.innerHTML = `<span class="stat-value">${rate.completed}/${rate.total}</span><span class="stat-label">Completed</span>`;
    bar.appendChild(card1);

    // Progress ring
    const card2 = el('div', 'stat-card stat-card--ring');
    const circumference = 2 * Math.PI * 26;
    const offset = circumference - (rate.percent / 100) * circumference;
    card2.innerHTML = `
      <div class="progress-ring-wrap">
        <svg class="progress-ring" width="64" height="64" viewBox="0 0 64 64">
          <circle class="progress-ring-bg" cx="32" cy="32" r="26"/>
          <circle class="progress-ring-fill" cx="32" cy="32" r="26"
            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/>
        </svg>
        <div class="progress-ring-text">${rate.percent}%</div>
      </div>
      <span class="stat-label">Today</span>`;
    bar.appendChild(card2);

    // Best streak
    const card3 = el('div', 'stat-card');
    card3.innerHTML = `<span class="stat-value">${bestStreak}</span><span class="stat-label">Best Streak</span>`;
    bar.appendChild(card3);

    parent.appendChild(bar);
  }

  function renderHabitList(parent, habits, dateStr) {
    const title = el('h3', 'section-title');
    title.textContent = "Today's Habits";
    parent.appendChild(title);

    if (habits.length === 0) {
      const empty = el('div', 'empty-state');
      empty.innerHTML = `
        <span class="empty-state-icon">&#127793;</span>
        <div class="empty-state-title">No habits yet</div>
        <div class="empty-state-text">Tap the + button to create your first habit</div>`;
      parent.appendChild(empty);
      return;
    }

    const list = el('div', 'habit-list');
    list.setAttribute('aria-label', "Today's habits");

    habits.forEach(habit => {
      const completed = HabitStore.isCompleted(habit.id, dateStr);
      const streak = HabitStore.getCurrentStreak(habit.id);

      const item = el('div', 'habit-item');
      item.dataset.habitId = habit.id;
      item.dataset.completed = completed;

      const checkbox = el('button', 'habit-checkbox');
      checkbox.setAttribute('role', 'checkbox');
      checkbox.setAttribute('aria-checked', completed);
      checkbox.setAttribute('aria-label', `Mark ${habit.name} as ${completed ? 'incomplete' : 'complete'}`);
      checkbox.style.setProperty('--habit-color', habit.color);
      checkbox.innerHTML = checkSvg;
      checkbox.addEventListener('click', () => handleToggle(habit.id, dateStr));

      const info = el('div', 'habit-info');
      info.innerHTML = `
        <span class="habit-name">${escapeHtml(habit.name)}</span>
        <div class="habit-meta">
          <span class="habit-category">${escapeHtml(habit.category)}</span>
          ${streak > 0 ? `<span class="habit-streak">\u{1F525} ${streak} day${streak !== 1 ? 's' : ''}</span>` : ''}
        </div>`;

      const menuBtn = el('button', 'habit-menu');
      menuBtn.setAttribute('aria-label', 'Habit options');
      menuBtn.setAttribute('aria-haspopup', 'true');
      menuBtn.innerHTML = dotsSvg;
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showContextMenu(habit.id, menuBtn);
      });

      item.appendChild(checkbox);
      item.appendChild(info);
      item.appendChild(menuBtn);
      list.appendChild(item);
    });

    parent.appendChild(list);
  }

  function renderHeatmapSection(parent) {
    const data = HabitStore.getHeatmapData(91);
    if (HabitStore.getAll().length === 0) return;

    const section = el('section', 'heatmap-section');
    const title = el('h3', 'section-title');
    title.textContent = 'Activity (Last 13 Weeks)';
    section.appendChild(title);

    const container = el('div', 'heatmap-container');
    const grid = el('div', 'heatmap-grid');
    grid.setAttribute('role', 'img');
    grid.setAttribute('aria-label', 'Habit completion heatmap for the last 91 days');

    // Pad start so first column starts on Monday
    const firstDow = DateUtils.dayOfWeek(data[0].date);
    const padStart = (firstDow + 6) % 7; // 0=Mon offset
    for (let i = 0; i < padStart; i++) {
      const cell = el('div', 'heatmap-cell');
      cell.style.visibility = 'hidden';
      grid.appendChild(cell);
    }

    data.forEach(d => {
      const cell = el('div', 'heatmap-cell');
      let intensity = 0;
      if (d.total > 0) {
        if (d.percent > 0) intensity = 1;
        if (d.percent >= 30) intensity = 2;
        if (d.percent >= 60) intensity = 3;
        if (d.percent >= 90) intensity = 4;
      }
      cell.dataset.intensity = intensity;
      cell.title = `${DateUtils.formatShort(d.date)}: ${d.completed}/${d.total} completed`;
      grid.appendChild(cell);
    });

    container.appendChild(grid);

    // Legend
    const legend = el('div', 'heatmap-legend');
    legend.innerHTML = `<span>Less</span>`;
    for (let i = 0; i <= 4; i++) {
      const lc = el('div', 'heatmap-legend-cell');
      lc.dataset.intensity = i;
      legend.appendChild(lc);
    }
    legend.innerHTML += `<span>More</span>`;
    container.appendChild(legend);

    section.appendChild(container);
    parent.appendChild(section);
  }

  // ---- Render: Weekly View ----

  function renderWeeklyView() {
    const main = $('#app-main');
    clearContainer(main);

    const today = DateUtils.today();
    const refDate = DateUtils.addDays(today, weekOffset * 7);
    const weekDates = DateUtils.getWeekDates(refDate);
    const allHabits = HabitStore.getAll();

    // Navigation
    const nav = el('div', 'week-nav');
    const prevBtn = el('button', 'nav-btn');
    prevBtn.innerHTML = '&larr; Prev';
    prevBtn.setAttribute('aria-label', 'Previous week');
    prevBtn.addEventListener('click', () => { weekOffset--; renderWeeklyView(); });

    const label = el('span', 'nav-label');
    label.textContent = `${DateUtils.formatShort(weekDates[0])} — ${DateUtils.formatShort(weekDates[6])}`;

    const nextBtn = el('button', 'nav-btn');
    nextBtn.innerHTML = 'Next &rarr;';
    nextBtn.setAttribute('aria-label', 'Next week');
    nextBtn.addEventListener('click', () => { weekOffset++; renderWeeklyView(); });

    nav.appendChild(prevBtn);
    nav.appendChild(label);
    nav.appendChild(nextBtn);
    main.appendChild(nav);

    if (allHabits.length === 0) {
      const empty = el('div', 'empty-state');
      empty.innerHTML = `<span class="empty-state-icon">&#128197;</span><div class="empty-state-title">No habits to display</div><div class="empty-state-text">Create habits to see your weekly progress</div>`;
      main.appendChild(empty);
      return;
    }

    const grid = el('div', 'weekly-grid');

    // Header
    const header = el('div', 'weekly-header');
    const labelCell = el('div', 'weekly-header-cell');
    labelCell.textContent = 'Habit';
    header.appendChild(labelCell);
    weekDates.forEach(d => {
      const hc = el('div', 'weekly-header-cell' + (d === today ? ' today' : ''));
      hc.innerHTML = `${DateUtils.formatDayShort(d)}<br>${DateUtils.formatDateNum(d)}`;
      header.appendChild(hc);
    });
    grid.appendChild(header);

    // Rows
    allHabits.forEach(habit => {
      const row = el('div', 'weekly-row');
      row.dataset.habitId = habit.id;

      const nameCell = el('div', 'weekly-habit-name');
      nameCell.innerHTML = `<span class="color-dot" style="background:${habit.color}"></span><span>${escapeHtml(habit.name)}</span>`;
      row.appendChild(nameCell);

      weekDates.forEach(d => {
        const cell = el('div', 'weekly-cell');
        const completed = HabitStore.isCompleted(habit.id, d);
        const scheduled = HabitStore.isScheduledDay(habit, d);

        const toggle = el('button', 'day-toggle' + (!scheduled ? ' not-scheduled' : ''));
        toggle.setAttribute('role', 'checkbox');
        toggle.setAttribute('aria-pressed', completed);
        toggle.setAttribute('aria-label', `${habit.name}, ${DateUtils.formatDayShort(d)} ${DateUtils.formatShort(d)}`);
        toggle.style.setProperty('--habit-color', habit.color);
        toggle.innerHTML = checkSvg;

        if (scheduled) {
          toggle.addEventListener('click', () => {
            HabitStore.toggleCompletion(habit.id, d);
            renderWeeklyView();
          });
        }

        cell.appendChild(toggle);
        row.appendChild(cell);
      });

      grid.appendChild(row);
    });

    main.appendChild(grid);
  }

  // ---- Render: Monthly View ----

  function renderMonthlyView() {
    const main = $('#app-main');
    clearContainer(main);

    const now = new Date();
    const targetMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const year = targetMonth.getFullYear();
    const month = targetMonth.getMonth();
    const today = DateUtils.today();
    const monthDates = DateUtils.getMonthDates(year, month);
    const allHabits = HabitStore.getAll();

    // Navigation
    const nav = el('div', 'month-nav');
    const prevBtn = el('button', 'nav-btn');
    prevBtn.innerHTML = '&larr; Prev';
    prevBtn.setAttribute('aria-label', 'Previous month');
    prevBtn.addEventListener('click', () => { monthOffset--; renderMonthlyView(); });

    const label = el('span', 'nav-label');
    label.textContent = DateUtils.formatMonthYear(year, month);

    const nextBtn = el('button', 'nav-btn');
    nextBtn.innerHTML = 'Next &rarr;';
    nextBtn.setAttribute('aria-label', 'Next month');
    nextBtn.addEventListener('click', () => { monthOffset++; renderMonthlyView(); });

    nav.appendChild(prevBtn);
    nav.appendChild(label);
    nav.appendChild(nextBtn);
    main.appendChild(nav);

    const grid = el('div', 'calendar-grid');

    // Header row
    const headerRow = el('div', 'calendar-header');
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(day => {
      const hc = el('div', 'calendar-header-cell');
      hc.textContent = day;
      headerRow.appendChild(hc);
    });
    grid.appendChild(headerRow);

    // Calendar body
    const body = el('div', 'calendar-body');

    // Pad start
    const firstDow = DateUtils.dayOfWeek(monthDates[0]);
    const padStart = (firstDow + 6) % 7;
    for (let i = 0; i < padStart; i++) {
      const emptyCell = el('div', 'calendar-cell empty');
      body.appendChild(emptyCell);
    }

    monthDates.forEach(dateStr => {
      const cell = el('div', 'calendar-cell' + (dateStr === today ? ' today' : ''));

      const dateLabel = el('span', 'calendar-date');
      dateLabel.textContent = DateUtils.formatDateNum(dateStr);
      cell.appendChild(dateLabel);

      if (allHabits.length > 0) {
        const habitsForDay = HabitStore.getForDate(dateStr);
        if (habitsForDay.length > 0) {
          const dots = el('div', 'calendar-dots');
          habitsForDay.forEach(h => {
            const dot = el('span', 'calendar-dot' + (HabitStore.isCompleted(h.id, dateStr) ? ' completed' : ''));
            dot.style.background = h.color;
            dots.appendChild(dot);
          });
          cell.appendChild(dots);

          const completedCount = habitsForDay.filter(h => HabitStore.isCompleted(h.id, dateStr)).length;
          if (completedCount > 0) {
            const overlay = el('div', 'calendar-completion');
            overlay.style.background = 'var(--color-primary)';
            overlay.style.opacity = (completedCount / habitsForDay.length) * 0.15;
            cell.appendChild(overlay);
          }
        }
      }

      body.appendChild(cell);
    });

    // Pad end
    const totalCells = padStart + monthDates.length;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 0; i < remaining; i++) {
      const emptyCell = el('div', 'calendar-cell empty');
      body.appendChild(emptyCell);
    }

    grid.appendChild(body);
    main.appendChild(grid);
  }

  // ---- Handle Toggle ----

  function handleToggle(habitId, dateStr) {
    HabitStore.toggleCompletion(habitId, dateStr);
    if (currentView === 'today') renderTodayView();
    else if (currentView === 'weekly') renderWeeklyView();
  }

  // ---- Context Menu ----

  function showContextMenu(habitId, anchor) {
    selectedHabitId = habitId;
    const menu = $('#context-menu');
    menu.hidden = false;

    const rect = anchor.getBoundingClientRect();
    menu.style.top = rect.bottom + 4 + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - 160) + 'px';

    const closeHandler = (e) => {
      if (!menu.contains(e.target) && e.target !== anchor) {
        menu.hidden = true;
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

    const editBtn = menu.querySelector('[data-action="edit"]');
    const deleteBtn = menu.querySelector('[data-action="delete"]');

    editBtn.onclick = () => {
      menu.hidden = true;
      showEditModal(habitId);
    };
    deleteBtn.onclick = () => {
      menu.hidden = true;
      showDeleteConfirm(habitId);
    };
  }

  // ---- Modals ----

  function openModal(title, contentFn) {
    returnFocusEl = document.activeElement;
    const overlay = $('#modal-overlay');
    const titleEl = $('#modal-title');
    const body = $('#modal-body');

    titleEl.textContent = title;
    clearContainer(body);
    contentFn(body);

    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    $('#app-main').setAttribute('aria-hidden', 'true');

    requestAnimationFrame(() => {
      const first = body.querySelector('input, select, button, textarea');
      if (first) first.focus();
    });

    overlay.addEventListener('keydown', trapFocusHandler);
  }

  function closeModal() {
    const overlay = $('#modal-overlay');
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    $('#app-main').removeAttribute('aria-hidden');
    overlay.removeEventListener('keydown', trapFocusHandler);

    if (returnFocusEl) {
      returnFocusEl.focus();
      returnFocusEl = null;
    }
  }

  function trapFocusHandler(e) {
    if (e.key === 'Escape') {
      closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const modal = $('.modal');
    const focusable = modal.querySelectorAll('input, select, textarea, button, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  }

  function showAddModal() {
    openModal('New Habit', (body) => renderHabitForm(body, null));
  }

  function showEditModal(habitId) {
    const habit = HabitStore.getById(habitId);
    if (!habit) return;
    openModal('Edit Habit', (body) => renderHabitForm(body, habit));
  }

  function showDeleteConfirm(habitId) {
    const habit = HabitStore.getById(habitId);
    if (!habit) return;
    openModal('Delete Habit', (body) => {
      const dialog = el('div', 'confirm-dialog');
      dialog.innerHTML = `<p>Are you sure you want to delete <strong>${escapeHtml(habit.name)}</strong>? This will remove all completion data and cannot be undone.</p>`;

      const actions = el('div', 'confirm-actions');

      const cancelBtn = el('button', 'btn btn--secondary');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', closeModal);

      const deleteBtn = el('button', 'btn btn--danger');
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => {
        HabitStore.delete(habitId);
        closeModal();
        render();
      });

      actions.appendChild(cancelBtn);
      actions.appendChild(deleteBtn);
      dialog.appendChild(actions);
      body.appendChild(dialog);
    });
  }

  function renderHabitForm(body, existingHabit) {
    const form = el('form', 'habit-form');
    form.setAttribute('id', 'habit-form');

    const categories = HabitStore.getCategories();
    const colors = HabitStore.PRESET_COLORS;
    const selectedColor = existingHabit ? existingHabit.color : colors[0];
    const selectedFreq = existingHabit ? existingHabit.frequency.type : 'daily';
    const selectedDays = existingHabit && existingHabit.frequency.type === 'custom' ? existingHabit.frequency.days : [];

    form.innerHTML = `
      <div class="form-group">
        <label for="habit-name">Habit Name</label>
        <input type="text" id="habit-name" class="form-input" required maxlength="50"
          placeholder="e.g., Meditate 10 min" value="${existingHabit ? escapeHtml(existingHabit.name) : ''}">
      </div>

      <div class="form-group">
        <label for="habit-category">Category</label>
        <select id="habit-category" class="frequency-select">
          ${categories.map(c => `<option value="${escapeHtml(c)}" ${existingHabit && existingHabit.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
      </div>

      <div class="form-group">
        <label>Color</label>
        <div class="color-picker" role="radiogroup" aria-label="Habit color">
          ${colors.map(c => `<button type="button" class="color-swatch" role="radio" aria-checked="${c === selectedColor}" aria-label="Color ${c}" style="background:${c}" data-color="${c}"></button>`).join('')}
        </div>
      </div>

      <div class="form-group">
        <label for="habit-frequency">Frequency</label>
        <select id="habit-frequency" class="frequency-select">
          <option value="daily" ${selectedFreq === 'daily' ? 'selected' : ''}>Every day</option>
          <option value="weekdays" ${selectedFreq === 'weekdays' ? 'selected' : ''}>Weekdays (Mon–Fri)</option>
          <option value="weekends" ${selectedFreq === 'weekends' ? 'selected' : ''}>Weekends (Sat–Sun)</option>
          <option value="custom" ${selectedFreq === 'custom' ? 'selected' : ''}>Specific days</option>
        </select>
        <div class="day-checkboxes" id="custom-days" ${selectedFreq !== 'custom' ? 'hidden' : ''}>
          ${[
            { value: 1, label: 'Mon' },
            { value: 2, label: 'Tue' },
            { value: 3, label: 'Wed' },
            { value: 4, label: 'Thu' },
            { value: 5, label: 'Fri' },
            { value: 6, label: 'Sat' },
            { value: 0, label: 'Sun' }
          ].map(d => `<button type="button" class="day-checkbox" role="checkbox" aria-checked="${selectedDays.includes(d.value)}" data-day="${d.value}">${d.label}</button>`).join('')}
        </div>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn--secondary" id="form-cancel">Cancel</button>
        <button type="submit" class="btn btn--primary">${existingHabit ? 'Update' : 'Create'} Habit</button>
      </div>
    `;

    body.appendChild(form);

    // Color picker interaction
    form.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        form.querySelectorAll('.color-swatch').forEach(s => s.setAttribute('aria-checked', 'false'));
        swatch.setAttribute('aria-checked', 'true');
      });
    });

    // Frequency change
    const freqSelect = form.querySelector('#habit-frequency');
    const customDays = form.querySelector('#custom-days');
    freqSelect.addEventListener('change', () => {
      customDays.hidden = freqSelect.value !== 'custom';
    });

    // Day checkbox toggles
    form.querySelectorAll('.day-checkbox').forEach(btn => {
      btn.addEventListener('click', () => {
        const checked = btn.getAttribute('aria-checked') === 'true';
        btn.setAttribute('aria-checked', !checked);
      });
    });

    // Cancel
    form.querySelector('#form-cancel').addEventListener('click', closeModal);

    // Submit
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.querySelector('#habit-name').value.trim();
      if (!name) return;

      const category = form.querySelector('#habit-category').value;
      const color = form.querySelector('.color-swatch[aria-checked="true"]')?.dataset.color || colors[0];
      const freqType = freqSelect.value;
      let days = [];
      if (freqType === 'custom') {
        days = [...form.querySelectorAll('.day-checkbox[aria-checked="true"]')].map(b => parseInt(b.dataset.day, 10));
        if (days.length === 0) {
          days = [1, 2, 3, 4, 5, 6, 0]; // default to all if none selected
        }
      }

      const data = {
        name,
        category,
        color,
        frequency: { type: freqType, days }
      };

      if (existingHabit) {
        HabitStore.update(existingHabit.id, data);
      } else {
        HabitStore.create(data);
      }

      closeModal();
      render();
    });
  }

  // ---- View Switching ----

  function switchView(view) {
    currentView = view;
    $$('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.view === view));
    render();
  }

  function render() {
    if (currentView === 'today') renderTodayView();
    else if (currentView === 'weekly') renderWeeklyView();
    else if (currentView === 'monthly') renderMonthlyView();
  }

  // ---- Keyboard Shortcuts ----

  function handleKeyboard(e) {
    if (e.target.matches('input, select, textarea')) return;
    if ($('#modal-overlay').classList.contains('active')) return;

    switch (e.key) {
      case 'n':
        e.preventDefault();
        showAddModal();
        break;
      case '1':
        switchView('today');
        break;
      case '2':
        switchView('weekly');
        break;
      case '3':
        switchView('monthly');
        break;
    }
  }

  // ---- Init ----

  function init() {
    // Tab switching
    $$('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    // FAB
    $('#btn-add-habit').addEventListener('click', showAddModal);

    // Close modal on overlay click
    $('#modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    // Close button
    $('.modal-close').addEventListener('click', closeModal);

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboard);

    // Initial render
    render();
  }

  return { init, switchView, render };
})();


// ============================================================
// Helpers
// ============================================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


// ============================================================
// App — entry point
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  HabitStore.init();
  UIController.init();
});