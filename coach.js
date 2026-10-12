// =============================================================
// AI Coach card for the Fitness page.
// Gathers the goal you type, your WHOOP data and your logged
// workouts into one prompt and copies it to the clipboard, ready
// to paste into the Claude app. Nothing is sent anywhere by this
// file except the WHOOP requests to this site's own /api routes.
// =============================================================
(function () {
  'use strict';

  const GOAL_KEY = 'po_coach_goal';
  const STATE_KEY = 'po_coach_v1';
  const WEIGHTS_KEY = 'po_coach_weights';
  const WHOOP_KEY = 'whoop_tokens_v1';
  const LOG_DAYS = 28;

  const css = `
.coach-card {
  margin-top: 16px;
  background: rgba(255,255,255,0.025);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
}
.coach-eyebrow {
  font-size: 11px; font-weight: 600; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--text-3); margin-bottom: 6px;
}
.coach-title { font-size: 17px; font-weight: 600; color: var(--text-1); margin-bottom: 4px; }
.coach-sub { font-size: 13px; color: var(--text-2); line-height: 1.5; margin-bottom: 12px; }
.coach-label {
  display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--text-3); margin: 0 0 6px;
}
.coach-goal, .coach-fallback {
  width: 100%; box-sizing: border-box; min-height: 76px; resize: vertical;
  padding: 11px 12px; border-radius: 12px;
  background: rgba(0,0,0,0.28); border: 1px solid var(--border);
  color: var(--text-1); font-family: inherit; font-size: 16px; line-height: 1.45;
  outline: none;
}
.coach-goal:focus { border-color: var(--border-strong); }
.coach-fallback { margin-top: 10px; min-height: 140px; font-family: var(--font-mono); font-size: 12px; }
.coach-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.coach-btn {
  flex: 1 1 150px; padding: 12px 16px; border-radius: 12px;
  border: 1px solid var(--border-strong); background: var(--text-1); color: #0a0a0b;
  font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  text-align: center; text-decoration: none;
  -webkit-tap-highlight-color: transparent;
}
.coach-btn.secondary { background: rgba(255,255,255,0.04); color: var(--text-1); border-color: var(--border); }
.coach-status { font-size: 12px; color: var(--text-3); margin-top: 10px; min-height: 16px; line-height: 1.5; }
`;

  const html = `
<div class="coach-eyebrow">AI Coach</div>
<div class="coach-title">Get today's workout from Claude</div>
<div class="coach-sub">Copies your goal, WHOOP recovery and logged workouts as one message. Paste it into the Claude app and it will plan today's session around them.</div>
<label class="coach-label" for="coachGoal">My goal</label>
<textarea id="coachGoal" class="coach-goal" placeholder="e.g. Build muscle, 4 sessions a week, 60 minutes each. Sore left shoulder — avoid heavy overhead pressing."></textarea>
<div class="coach-actions">
  <button type="button" class="coach-btn" id="coachCopyBtn">Copy for Claude</button>
  <a class="coach-btn secondary" id="coachOpenBtn" href="https://claude.ai/new" target="_blank" rel="noopener">Open Claude</a>
</div>
<div class="coach-status" id="coachStatus"></div>
<textarea id="coachFallback" class="coach-fallback" readonly hidden></textarea>
`;

  // ---------- helpers ----------
  const readJson = (k, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  };
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const num = (v, digits) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(digits || 0) : null;
  const dur = (ms) => {
    if (!ms || ms < 0) return null;
    const m = Math.round(ms / 60000);
    return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm';
  };
  const mean = (list) => {
    const xs = list.filter((n) => typeof n === 'number' && isFinite(n));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };

  // ---------- WHOOP (prefetched so the copy tap stays instant) ----------
  let whoop = { status: 'loading' };

  function whoopTokens() { return readJson(WHOOP_KEY, null); }
  async function whoopRefresh(t) {
    if (!t || !t.refresh) return null;
    try {
      const r = await fetch('/api/whoop-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: t.refresh }),
      });
      const j = await r.json();
      if (!j.access_token) return null;
      const next = {
        access: j.access_token,
        refresh: j.refresh_token || t.refresh,
        expires: Date.now() + (j.expires_in || 3500) * 1000,
      };
      try { localStorage.setItem(WHOOP_KEY, JSON.stringify(next)); } catch (e) {}
      return next;
    } catch (e) { return null; }
  }
  async function whoopGet(path, limit, tokens) {
    const r = await fetch('/api/whoop-data?path=' + encodeURIComponent(path) + '&limit=' + limit, {
      headers: { Authorization: 'Bearer ' + tokens.access, Accept: 'application/json' },
    });
    if (r.status === 401) { const e = new Error('unauthorized'); e.unauthorized = true; throw e; }
    if (!r.ok) throw new Error('WHOOP ' + r.status);
    const j = await r.json();
    return (j && j.records) || [];
  }
  async function loadWhoop() {
    let t = whoopTokens();
    if (!t || !t.access) { whoop = { status: 'disconnected' }; return; }
    if (t.expires && Date.now() > t.expires - 60000) t = (await whoopRefresh(t)) || t;
    const fetchAll = (tok) => Promise.all([
      whoopGet('/recovery', 7, tok),
      whoopGet('/activity/sleep', 7, tok),
      whoopGet('/cycle', 7, tok),
      whoopGet('/activity/workout', 10, tok).catch((e) => { if (e.unauthorized) throw e; return []; }),
    ]);
    try {
      let res;
      try { res = await fetchAll(t); }
      catch (e) {
        if (!e.unauthorized) throw e;
        const next = await whoopRefresh(t);
        if (!next) { whoop = { status: 'expired' }; return; }
        res = await fetchAll(next);
      }
      whoop = { status: 'ok', recovery: res[0], sleep: res[1], cycle: res[2], workouts: res[3], at: new Date() };
    } catch (e) {
      whoop = { status: e.unauthorized ? 'expired' : 'error' };
    }
  }

  function whoopSection() {
    if (whoop.status === 'disconnected') return ['Not connected on this device, so no WHOOP data is included.'];
    if (whoop.status === 'expired') return ['WHOOP login has expired on this device, so no WHOOP data is included.'];
    if (whoop.status !== 'ok') return ['WHOOP data could not be loaded just now, so none is included.'];
    const out = [];
    const scored = (r) => r && r.score_state === 'SCORED' && r.score;

    const recs = whoop.recovery.filter(scored);
    const rec = recs[0];
    if (rec) {
      const s = rec.score;
      const zone = s.recovery_score >= 67 ? 'green' : s.recovery_score >= 34 ? 'yellow' : 'red';
      out.push('Latest recovery (' + String(rec.created_at || '').slice(0, 10) + '): ' +
        num(s.recovery_score) + '% (' + zone + '), HRV ' + num(s.hrv_rmssd_milli) + ' ms, resting HR ' +
        num(s.resting_heart_rate) + ' bpm' +
        (num(s.spo2_percentage, 1) ? ', SpO2 ' + num(s.spo2_percentage, 1) + '%' : '') +
        (num(s.skin_temp_celsius, 1) ? ', skin temp ' + num(s.skin_temp_celsius, 1) + ' C' : '') +
        (s.user_calibrating ? ' [WHOOP still calibrating]' : ''));
    } else {
      out.push('Latest recovery: not scored yet today.');
    }
    if (recs.length > 1) {
      out.push(recs.length + '-day averages: recovery ' + num(mean(recs.map((r) => r.score.recovery_score))) +
        '%, HRV ' + num(mean(recs.map((r) => r.score.hrv_rmssd_milli))) +
        ' ms, resting HR ' + num(mean(recs.map((r) => r.score.resting_heart_rate))) + ' bpm');
      out.push('Recovery by day (newest first): ' + recs.map((r) => num(r.score.recovery_score) + '%').join(', '));
    }

    const sleeps = whoop.sleep.filter((s) => scored(s) && !s.nap);
    const sl = sleeps[0];
    if (sl) {
      const st = sl.score.stage_summary || {};
      const asleep = (st.total_in_bed_time_milli || 0) - (st.total_awake_time_milli || 0);
      out.push('Last night\'s sleep: ' + (dur(asleep) || '?') + ' asleep, performance ' +
        num(sl.score.sleep_performance_percentage) + '%, efficiency ' + num(sl.score.sleep_efficiency_percentage) +
        '%, deep ' + (dur(st.total_slow_wave_sleep_time_milli) || '?') + ', REM ' + (dur(st.total_rem_sleep_time_milli) || '?') +
        (num(sl.score.respiratory_rate, 1) ? ', respiratory rate ' + num(sl.score.respiratory_rate, 1) + ' rpm' : ''));
    }
    if (sleeps.length > 1) {
      out.push('Sleep performance by night (newest first): ' +
        sleeps.map((s) => num(s.score.sleep_performance_percentage) + '%').join(', '));
    }

    const cycles = whoop.cycle.filter((c) => c && c.score && c.score.strain != null);
    if (cycles.length) {
      out.push('Day strain (0-21 scale, newest first; first value is today so far): ' +
        cycles.map((c) => num(c.score.strain, 1)).join(', '));
    }

    const wos = (whoop.workouts || []).filter((w) => w && w.score);
    if (wos.length) {
      out.push('Recent WHOOP-recorded activities:');
      wos.forEach((w) => {
        const mins = (w.start && w.end) ? Math.round((new Date(w.end) - new Date(w.start)) / 60000) : null;
        out.push('  - ' + String(w.start || '').slice(0, 10) + ' ' + (w.sport_name || 'activity') +
          (mins != null ? ', ' + mins + ' min' : '') +
          ', strain ' + num(w.score.strain, 1) +
          (num(w.score.average_heart_rate) ? ', avg HR ' + num(w.score.average_heart_rate) : '') +
          (num(w.score.max_heart_rate) ? ', max HR ' + num(w.score.max_heart_rate) : ''));
      });
    }
    return out;
  }

  // ---------- gym data ----------
  function todaySplit(state) {
    try {
      const rot = state.splitRotation;
      if (!rot || !rot.length || !state.splitAnchor) return null;
      const a = new Date(state.splitAnchor.date);
      const t = new Date();
      a.setHours(0, 0, 0, 0); t.setHours(0, 0, 0, 0);
      const diff = Math.round((t - a) / 86400000);
      const idx = ((state.splitAnchor.index + diff) % rot.length + rot.length) % rot.length;
      return { name: rot[idx], rotation: rot };
    } catch (e) { return null; }
  }

  function gymSections(state) {
    const unit = state.units || 'kg';
    const exercises = Array.isArray(state.exercises) ? state.exercises : [];
    const logs = state.logs || {};
    const dayName = (id) => { const d = (state.days || []).find((x) => x.id === id); return d ? d.name : id; };
    const gymName = (id) => {
      if (id === 'both') return 'any gym';
      const g = (state.gyms || []).find((x) => x.id === id); return g ? g.name : id;
    };
    const setText = (ex, l) => ex.bw ? ('BW x' + l.reps) : (l.weight + unit + ' x' + l.reps);

    // Program
    const program = [];
    const byDay = {};
    exercises.forEach((ex) => { (byDay[ex.day] = byDay[ex.day] || []).push(ex); });
    Object.keys(byDay).forEach((day) => {
      program.push(dayName(day) + ':');
      byDay[day].forEach((ex) => {
        const all = logs[ex.id] || [];
        let best = null;
        all.forEach((l) => {
          if (ex.bw || !l.weight) return;
          const est = l.reps < 2 ? l.weight : l.weight * (1 + l.reps / 30);
          if (best == null || est > best) best = est;
        });
        program.push('  - ' + ex.name +
          (ex.repMin && ex.repMax ? ', target ' + ex.repMin + '-' + ex.repMax + ' reps' : '') +
          (ex.bw ? ', bodyweight' : '') +
          ', ' + gymName(ex.gym) +
          (best != null ? ', best estimated 1RM ' + best.toFixed(1) + unit : '') +
          (all.length ? '' : ', never logged'));
      });
    });
    if (!program.length) program.push('No exercises set up yet.');

    // Recent log, grouped by calendar day
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - LOG_DAYS);
    const days = {};
    exercises.forEach((ex) => {
      (logs[ex.id] || []).forEach((l) => {
        const when = new Date(l.date);
        if (isNaN(when) || when < cutoff) return;
        const dk = dateKey(when);
        days[dk] = days[dk] || {};
        (days[dk][ex.id] = days[dk][ex.id] || { ex: ex, sets: [] }).sets.push(l);
      });
    });
    const history = [];
    Object.keys(days).sort().reverse().forEach((dk) => {
      history.push(dk + ':');
      Object.keys(days[dk]).forEach((id) => {
        const entry = days[dk][id];
        entry.sets.sort((a, b) => new Date(a.date) - new Date(b.date));
        history.push('  - ' + entry.ex.name + ': ' + entry.sets.map((l) => setText(entry.ex, l)).join(', '));
      });
    });
    if (!history.length) history.push('No sets logged in the last ' + LOG_DAYS + ' days.');

    return { unit, program, history };
  }

  function weightSection(unit) {
    const entries = readJson(WEIGHTS_KEY, []);
    if (!Array.isArray(entries) || !entries.length) return ['No body weight entries.'];
    const sorted = entries.slice().sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
    const recent = sorted.slice(-8);
    return ['Body weight (' + unit + ', oldest to newest): ' +
      recent.map((e) => e.dateKey + ' ' + Number(e.weight).toFixed(1)).join(', ')];
  }

  // ---------- prompt ----------
  function buildPrompt(goal) {
    const state = readJson(STATE_KEY, {}) || {};
    const gym = gymSections(state);
    const split = todaySplit(state);
    const now = new Date();
    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
    const L = [];
    L.push('Act as my personal fitness coach. Below is data exported from my own training dashboard: my goal, my WHOOP recovery data and the workouts I have logged. Use it to plan my training for today.');
    L.push('');
    L.push('How I want you to work:');
    L.push('1. Before prescribing anything, search the web for current evidence-based guidance relevant to my goal (for example weekly volume per muscle group, rep ranges, proximity to failure / RPE, progression and deload practice, and adjusting training to recovery and sleep). Briefly cite the sources you rely on.');
    L.push('2. Read my WHOOP data to decide how hard today should be. Tell me plainly whether to push, hold steady or back off, and why.');
    L.push('3. Read my logged sets to find my real working weights, where I am progressing and where I have stalled.');
    L.push('4. Give me today\'s workout as a table: exercise, sets, rep range, target weight in ' + gym.unit + ', target effort (RPE or reps in reserve) and rest time. Include a short warm-up. Prefer the exercises already in my program, and say why if you swap or add one.');
    L.push('5. Tell me exactly what to log, and what result should trigger adding weight next time.');
    L.push('6. If something important is missing (injuries, equipment, time available, experience), ask me before finalising. If my goal below is blank, ask me for it first.');
    L.push('Keep it practical and concise. You are not a doctor; flag anything in the data that looks worth checking with one.');
    L.push('');
    L.push('=== MY GOAL ===');
    L.push(goal ? goal : '(not filled in)');
    L.push('');
    L.push('=== TODAY ===');
    L.push(weekday + ' ' + dateKey(now) + ', ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ' local time');
    if (split) {
      L.push('Scheduled in my split today: ' + split.name);
      L.push('Split rotation: ' + split.rotation.join(' > '));
    }
    L.push('');
    L.push('=== WHOOP ===');
    whoopSection().forEach((x) => L.push(x));
    L.push('');
    L.push('=== BODY WEIGHT ===');
    weightSection(gym.unit).forEach((x) => L.push(x));
    L.push('');
    L.push('=== MY PROGRAM (exercises set up in my app) ===');
    gym.program.forEach((x) => L.push(x));
    L.push('');
    L.push('=== LOGGED SETS, LAST ' + LOG_DAYS + ' DAYS (newest first, weight x reps) ===');
    gym.history.forEach((x) => L.push(x));
    return L.join('\n');
  }

  // ---------- UI ----------
  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok;
  }

  function boot() {
    const shell = document.querySelector('.po-shell');
    if (!shell || document.getElementById('coachCard')) return;

    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const card = document.createElement('div');
    card.className = 'coach-card';
    card.id = 'coachCard';
    card.innerHTML = html.trim();
    shell.appendChild(card);

    const goalEl = document.getElementById('coachGoal');
    const statusEl = document.getElementById('coachStatus');
    const fallbackEl = document.getElementById('coachFallback');
    const storedGoal = () => { const g = readJson(GOAL_KEY, ''); return typeof g === 'string' ? g : ''; };

    goalEl.value = storedGoal();
    let saveTimer = null;
    goalEl.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try { localStorage.setItem(GOAL_KEY, JSON.stringify(goalEl.value)); } catch (e) {}
      }, 400);
    });
    // Pick up a goal synced in from another device, unless it's being edited.
    setInterval(() => {
      if (document.activeElement === goalEl) return;
      const g = storedGoal();
      if (g !== goalEl.value) goalEl.value = g;
    }, 3000);

    const whoopNote = () =>
      whoop.status === 'ok' ? 'WHOOP data included.' :
      whoop.status === 'loading' ? 'WHOOP data was still loading, so it was left out — wait a moment and copy again.' :
      whoop.status === 'disconnected' ? 'WHOOP isn\'t connected on this device, so it was left out. Connect it on the Health page.' :
      whoop.status === 'expired' ? 'WHOOP login expired, so it was left out. Reconnect on the Health page.' :
      'WHOOP data couldn\'t be loaded, so it was left out.';

    document.getElementById('coachCopyBtn').addEventListener('click', async () => {
      try { localStorage.setItem(GOAL_KEY, JSON.stringify(goalEl.value)); } catch (e) {}
      const text = buildPrompt(goalEl.value.trim());
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          ok = true;
        }
      } catch (e) {}
      if (!ok) ok = legacyCopy(text);
      if (ok) {
        fallbackEl.hidden = true;
        statusEl.textContent = 'Copied. Open Claude and paste. ' + whoopNote();
      } else {
        fallbackEl.value = text;
        fallbackEl.hidden = false;
        fallbackEl.focus();
        fallbackEl.select();
        statusEl.textContent = 'Couldn\'t copy automatically — select all the text below and copy it. ' + whoopNote();
      }
    });

    loadWhoop();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadWhoop(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
