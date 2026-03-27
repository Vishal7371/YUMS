const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:3001/api'
    : 'https://yums-server.onrender.com/api';
const TREND_KEY = 'yums_trend';

/* ── Helpers ── */
const $ = id => document.getElementById(id);
const show = id => $(id)?.classList.remove('hidden');
const hide = id => $(id)?.classList.add('hidden');
const text = (id, v) => { const e = $(id); if (e) e.textContent = v; };
const esc = t => { const d = document.createElement('div'); d.appendChild(document.createTextNode(t)); return d.innerHTML; };

/* ── Toast ── */
function toast(msg, type = 'info', dur = 3000) {
    const c = $('toastContainer'); if (!c) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    c.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, dur);
}

/* ── Theme ── */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('yums_theme', theme);
    const icon = $('themeIcon');
    const label = $('themeLabel');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (label) label.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
}
function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
}
applyTheme(localStorage.getItem('yums_theme') || 'dark');

/* ── PWA Service Worker ── */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { });
    });
}

/* ── Shared: Init page header (sidebar topbar + profile) ── */
function initPageHeader() {
    const rawName = sessionStorage.getItem('yums_name') || localStorage.getItem('yums_name') || '';
    const regNo = sessionStorage.getItem('yums_regNo') || localStorage.getItem('yums_regNo') || '';
    const name = (rawName && rawName !== 'LPU Student') ? rawName : (regNo || 'Student');
    const program = sessionStorage.getItem('yums_program') || localStorage.getItem('yums_program') || '';
    const fetched = sessionStorage.getItem('yums_fetched') || localStorage.getItem('yums_fetched') || 'just now';
    const fetchedTs = parseInt(sessionStorage.getItem('yums_fetchedTs') || localStorage.getItem('yums_fetchedTs') || '0');

    const initials = name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
    text('topbarAvatar', initials || '🎓');
    text('topbarName', name);
    text('topbarRole', program || 'LPU Student');

    // Extended profile badges (dashboard only)
    const cgpa = sessionStorage.getItem('yums_cgpa') || localStorage.getItem('yums_cgpa') || '';
    const rollNo = sessionStorage.getItem('yums_rollNo') || localStorage.getItem('yums_rollNo') || '';
    const term = sessionStorage.getItem('yums_term') || localStorage.getItem('yums_term') || '';

    const cgpaBadge = document.getElementById('cgpaBadge');
    if (cgpaBadge) {
        if (cgpa) { cgpaBadge.innerText = '★ ' + cgpa; cgpaBadge.style.display = 'inline-block'; }
        else { cgpaBadge.style.display = 'none'; }
    }
    const rollNoBadge = document.getElementById('rollNoBadge');
    if (rollNoBadge) {
        if (rollNo) { rollNoBadge.innerText = rollNo; rollNoBadge.style.display = 'inline-block'; }
        else { rollNoBadge.style.display = 'none'; }
    }
    const termBadge = document.getElementById('termBadge');
    if (termBadge) {
        if (term) { termBadge.innerText = 'Term ' + term; termBadge.style.display = 'inline-block'; }
        else { termBadge.style.display = 'none'; }
    }

    const isLocal = !sessionStorage.getItem('yums_subjects');
    const fetchStr = (isLocal && fetchedTs)
        ? (() => { const d = Math.round((Date.now() - fetchedTs) / 60000); return d < 60 ? `Cached · ${d}m ago` : `Cached · ${Math.round(d / 60)}h ago`; })()
        : `Fetched at ${fetched}`;
    text('fetchTimeStrip', fetchStr);
    text('fetchTime', fetchStr);

    $('logoutBtn')?.addEventListener('click', () => {
        sessionStorage.clear();
        ['yums_name', 'yums_program', 'yums_subjects', 'yums_overallPct', 'yums_fetched', 'yums_fetchedTs', 'yums_grades']
            .forEach(k => localStorage.removeItem(k));
        window.location.href = 'index.html';
    });
    $('refreshBtn')?.addEventListener('click', () => {
        const regNo = sessionStorage.getItem('yums_regNo') || localStorage.getItem('yums_regNo');
        if (!regNo) {
            toast('Session expired. Please log in again.', 'error');
            setTimeout(() => { window.location.href = 'index.html'; }, 1500);
            return;
        }
        toast('⟳ Refreshing attendance data…', 'info', 60000);

        const url = `${API_BASE}/login/stream?regNo=${encodeURIComponent(regNo)}`;
        const es = new EventSource(url);

        es.addEventListener('attendance', (e) => {
            es.close();
            try {
                const data = JSON.parse(e.data);
                const fetchedAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                const fetchedTs = Date.now();
                const displayName = (data.name && data.name.trim() && data.name !== 'LPU Student')
                    ? data.name : (regNo || 'LPU Student');
                const keys = {
                    yums_name: displayName,
                    yums_program: data.program || '',
                    yums_subjects: JSON.stringify(data.subjects || []),
                    yums_overallPct: data.overallPct != null ? String(data.overallPct) : '',
                    yums_fetched: fetchedAt,
                    yums_fetchedTs: String(fetchedTs),
                    yums_cgpa: data.cgpa || '',
                    yums_rollNo: data.rollNo || '',
                    yums_term: data.term || '',
                    yums_grades: JSON.stringify(data.gradeData || []),
                };
                Object.entries(keys).forEach(([k, v]) => {
                    sessionStorage.setItem(k, v);
                    localStorage.setItem(k, v);
                });
                saveTrendSnapshot(data.overallPct, data.subjects || []);
                saveTrendSnapshotPerSubject(data.subjects || []);
                toast('✅ Attendance updated!', 'success');
                // Reload the current page to reflect new data (stays on same page)
                window.location.reload();
            } catch (err) {
                if (btn) { btn.disabled = false; btn.style.opacity = ''; }
                toast('Failed to parse refresh data.', 'error');
            }
        });

        es.addEventListener('done', () => { es.close(); });

        es.addEventListener('error', (e) => {
            es.close();
            if (btn) { btn.disabled = false; btn.style.opacity = ''; }
            let msg = 'Refresh failed. Please try again.';
            try { msg = JSON.parse(e.data)?.error || msg; } catch (_) { }
            toast(msg, 'error');
        });

        es.onerror = () => {
            if (es.readyState === EventSource.CLOSED) return;
            es.close();
            if (btn) { btn.disabled = false; btn.style.opacity = ''; }
            toast('Could not connect to YUMS server.', 'error');
        };
    });

    return { name, program, initials, fetched };
}

/* ── Toggle Action Sheet (More menu) ── */
function toggleActionSheet() {
    const sheet = $('actionSheet');
    if (!sheet) return;
    sheet.classList.toggle('hidden');
}

/* ── Trigger Refresh (called from app-bar button) ── */
function triggerRefresh() {
    $('refreshBtn')?.click();
}


/* ── Guard: redirect to login if no data ── */
function guardAuth() {
    if (!sessionStorage.getItem('yums_subjects') && !localStorage.getItem('yums_subjects')) {
        window.location.href = 'index.html';
        return false;
    }
    return true;
}

/* ══════════════════════════════════════════════
   LOGIN PAGE  (index.html)
══════════════════════════════════════════════ */
if ($('loginBtn')) {
    if (sessionStorage.getItem('yums_subjects') || localStorage.getItem('yums_subjects')) {
        window.location.href = 'dashboard.html';
    }
}

async function startLogin() {
    const errorDiv = $('loginError');
    const infoDiv  = $('loginInfo');

    hide('loginError');
    $('loginBtn').disabled = true;
    $('loginBtnText').textContent = 'Opening UMS…';
    show('loginSpinner');
    infoDiv.innerHTML = '🌐 <strong>Opening UMS…</strong> Log in with your credentials in the browser window.';
    show('loginInfo');

    const url = `${API_BASE}/login/stream`;
    const es = new EventSource(url);

    es.addEventListener('progress', (e) => {
        try {
            const { msg } = JSON.parse(e.data);
            infoDiv.innerHTML = `<span class="progress-dot"></span> ${msg}`;
            show('loginInfo');
        } catch (_) { }
    });

    es.addEventListener('attendance', (e) => {
        try {
            const data = JSON.parse(e.data);
            const fetchedAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
            const fetchedTs = Date.now();
            const regNo = data.regNo || '';
            const displayName = (data.name && data.name.trim() && data.name !== 'LPU Student')
                ? data.name : (regNo || 'LPU Student');
            const keys = {
                yums_name: displayName,
                yums_program: data.program || '',
                yums_subjects: JSON.stringify(data.subjects || []),
                yums_overallPct: data.overallPct != null ? String(data.overallPct) : '',
                yums_fetched: fetchedAt,
                yums_fetchedTs: String(fetchedTs),
                yums_cgpa: data.cgpa || '',
                yums_rollNo: data.rollNo || '',
                yums_term: data.term || '',
                yums_grades: JSON.stringify(data.gradeData || []),
            };

            if (data.timetable && data.timetable.length > 0) {
                keys.yums_timetable = JSON.stringify(data.timetable);
            }

            Object.entries(keys).forEach(([k, v]) => {
                sessionStorage.setItem(k, v);
                localStorage.setItem(k, v);
            });
            saveTrendSnapshot(data.overallPct, data.subjects || []);
            saveTrendSnapshotPerSubject(data.subjects || []);
            infoDiv.innerHTML = '⚡ <strong>Attendance loaded!</strong> Fetching timetable…';
        } catch (err) {
            console.error('attendance parse error', err);
        }
    });

    es.addEventListener('done', (e) => {
        es.close();
        try {
            if (e.data) {
                const finalData = JSON.parse(e.data);
                if (finalData && finalData.timetable && finalData.timetable.length > 0) {
                    sessionStorage.setItem('yums_timetable', JSON.stringify(finalData.timetable));
                    localStorage.setItem('yums_timetable', JSON.stringify(finalData.timetable));
                }
                if (finalData && finalData.gradeData && finalData.gradeData.length > 0) {
                    sessionStorage.setItem('yums_grades', JSON.stringify(finalData.gradeData));
                    localStorage.setItem('yums_grades', JSON.stringify(finalData.gradeData));
                }
            }
        } catch (_) {}
        infoDiv.innerHTML = '✅ <strong>All data loaded!</strong> Opening dashboard…';
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 300);
    });

    es.addEventListener('error', (e) => {
        es.close();
        let msg = 'Login failed. Please try again.';
        try { msg = JSON.parse(e.data)?.error || msg; } catch (_) { }
        hide('loginInfo');
        errorDiv.textContent = msg;
        show('loginError');
        $('loginBtn').disabled = false;
        $('loginBtnText').textContent = 'Login with UMS';
        hide('loginSpinner');
    });

    es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) return;
        es.close();
        hide('loginInfo');
        errorDiv.textContent = 'Could not connect to YUMS server. Make sure it is running.';
        show('loginError');
        $('loginBtn').disabled = false;
        $('loginBtnText').textContent = 'Login with UMS';
        hide('loginSpinner');
    };
}

/* ══════════════════════════════════════════════
   HOME PAGE  (dashboard.html)
══════════════════════════════════════════════ */
if ($('homePage')) {
    if (!guardAuth()) { /* redirect handled */ } else {
        const { name, program, initials } = initPageHeader();
        text('profileAvatar', initials || '🎓');
        text('profileName', name);
        text('profileProg', program);
        text('welcomeMsg', `Welcome back, ${name.split(' ')[0]} 👋`);
        requestNotificationPermission();
        initAutoRefresh();

        try {
            const raw = sessionStorage.getItem('yums_subjects') || localStorage.getItem('yums_subjects');
            const subjects = JSON.parse(raw || '[]');
            if (!subjects.length) throw new Error('No data');

            let totalAtt = 0, totalCls = 0, safe = 0, warn = 0, danger = 0;
            subjects.forEach(s => {
                totalAtt += s.attended; totalCls += s.total;
                if (s.percentage >= 75) safe++;
                else if (s.percentage >= 65) warn++;
                else danger++;
            });

            const umsOverall = sessionStorage.getItem('yums_overallPct') || localStorage.getItem('yums_overallPct');
            const overall = (umsOverall && umsOverall !== '') ? parseInt(umsOverall)
                : (totalCls > 0 ? Math.round(totalAtt / totalCls * 100) : 0);

            text('overallPct', `${overall}%`);
            const arc = $('ringArc');
            const circ = 427.26;
            const color = overall >= 75 ? '#2DD4A3' : overall >= 65 ? '#F5C542' : '#FF6B8A';
            if (arc) setTimeout(() => {
                arc.style.strokeDashoffset = circ - (circ * Math.min(overall, 100) / 100);
                arc.style.stroke = color;
            }, 200);

            text('heroAttended', totalAtt);
            text('heroTotal', totalCls);
            text('heroMissed', totalCls - totalAtt);

            // Bunk Budget
            const bunkBudget = computeBunkBudget(subjects);
            text('heroBunkBudget', bunkBudget);

            const badge = $('heroStatusBadge');
            if (badge) {
                if (overall >= 75) { badge.textContent = '✅ Safe'; badge.className = 'hero-badge badge-green'; }
                else if (overall >= 65) { badge.textContent = '⚠️ Warning'; badge.className = 'hero-badge badge-yellow'; }
                else { badge.textContent = '🔴 Critical'; badge.className = 'hero-badge badge-red'; }
            }

            text('safeCount', safe);
            text('warningCount', warn);
            text('dangerCount', danger);
            text('totalSubj', subjects.length);

            // Danger alerts
            renderDangerBanner(subjects);

            // Semester progress
            renderSemesterProgress();

            // Attendance prediction
            renderPredictionPanel(subjects);

            // Badges
            const badges = computeBadges(subjects, overall);
            renderBadges(badges);
            // Streak
            const streak = computeStreak();
            text('streakCount', streak > 0 ? `🔥 ${streak} session${streak > 1 ? 's' : ''} improving` : 'Start improving to build a streak!');

            // Today's timetable
            renderTodayTimetable(subjects);

            // Safe to bunk today
            renderSafeToday(subjects);

            setTimeout(() => notifyLowAttendance(subjects), 1500);
        } catch (_) { }
    }
}


/* ══════════════════════════════════════════════
   ATTENDANCE PAGE  (attendance.html)
══════════════════════════════════════════════ */
if ($('attendancePage')) {
    if (!guardAuth()) { /* redirect handled */ } else {
        initPageHeader();
        try {
            const raw = sessionStorage.getItem('yums_subjects') || localStorage.getItem('yums_subjects');
            const subjects = JSON.parse(raw || '[]');
            if (!subjects.length) throw new Error('No attendance data found. Please log in again.');
            window._allSubjects = subjects;
            renderCards([...subjects].sort((a, b) => a.percentage - b.percentage));
            show('gridWrapper');
            hide('loadingState');
            // Draw sparklines after cards render
            requestAnimationFrame(() => {
                document.querySelectorAll('.card-sparkline').forEach(canvas => {
                    drawSparkline(canvas, canvas.dataset.subject);
                });
            });
        } catch (e) {
            hide('loadingState');
            text('errorMsg', e.message);
            show('errorState');
        }
    }
}

/* ══════════════════════════════════════════════
   CALCULATOR PAGE  (calculator.html)
══════════════════════════════════════════════ */
if ($('calculatorPage')) {
    if (!guardAuth()) { /* redirect handled */ } else {
        initPageHeader();
        initSemCalcPage();
    }
}

/* ══════════════════════════════════════════════
   PLANNER PAGE  (planner.html)
══════════════════════════════════════════════ */
if ($('plannerPage')) {
    if (!guardAuth()) { /* redirect handled */ } else {
        initPageHeader();
        initPlanner();
    }
}

/* ══════════════════════════════════════════════
   TREND PAGE  (trend.html)
══════════════════════════════════════════════ */
if ($('trendPage')) {
    if (!guardAuth()) { /* redirect handled */ } else {
        initPageHeader();
        drawTrendChart();
        populateSubjectDropdown();
        loadReminderTime();
    }
}

/* ══════════════════════════════════════════════
   CGPA PAGE  (cgpa.html)
══════════════════════════════════════════════ */
if ($('cgpaPage')) {
    if (!guardAuth()) { /* redirect handled */ } else {
        initPageHeader();
        initCgpaPage();
    }
}

/* ══════════════════════════════════════════════
   ATTENDANCE CARDS
══════════════════════════════════════════════ */
function renderCards(sorted) {
    const grid = $('subjectsGrid');
    const frag = document.createDocumentFragment();
    sorted.forEach(s => frag.appendChild(buildCard(s)));
    grid.innerHTML = '';
    grid.appendChild(frag);
    requestAnimationFrame(() => {
        grid.querySelectorAll('.progress-fill[data-w]').forEach(f => {
            f.style.width = f.dataset.w + '%';
        });
    });
}

function sortCards(dir) {
    $('sortAsc')?.classList.toggle('active', dir === 'asc');
    $('sortDesc')?.classList.toggle('active', dir === 'desc');
    const sorted = [...(window._allSubjects || [])].sort((a, b) =>
        dir === 'asc' ? a.percentage - b.percentage : b.percentage - a.percentage
    );
    renderCards(sorted);
}

function buildCard(s) {
    const c = s.percentage >= 75 ? 'green' : s.percentage >= 65 ? 'yellow' : 'red';
    const pill = s.percentage >= 75
        ? `✅ Can skip <strong>${s.canBunk}</strong> more class${s.canBunk !== 1 ? 'es' : ''}`
        : `📚 Need <strong>${s.needed}</strong> more class${s.needed !== 1 ? 'es' : ''} for 75%`;

    const goalKey = `yums_goal_${s.subject}`;
    const goal = parseInt(localStorage.getItem(goalKey)) || 75;

    const div = document.createElement('div');
    div.className = `subject-card card-${c}`;
    div.innerHTML = `
    <div class="card-top">
      <p class="subject-name">${esc(s.subject)}</p>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <canvas class="card-sparkline" data-subject="${esc(s.subject)}" width="80" height="28" style="display:none"></canvas>
        <span class="pct-badge ${c}">${s.percentage}%</span>
      </div>
    </div>
    <div class="progress-track">
      <div class="progress-fill ${c}" style="width:0%" data-w="${Math.min(s.percentage, 100)}"></div>
    </div>
    <div class="card-stats">
      <div class="cs-item"><span class="cs-val">${s.attended}</span><span class="cs-lbl">Attended</span></div>
      <div class="cs-div"></div>
      <div class="cs-item"><span class="cs-val">${s.total}</span><span class="cs-lbl">Total</span></div>
      <div class="cs-div"></div>
      <div class="cs-item"><span class="cs-val">${s.total - s.attended}</span><span class="cs-lbl">Missed</span></div>
    </div>
    <span class="status-pill pill-${c}">${pill}</span>
    <div class="card-goal-row">
      <label class="goal-label">🎯 Goal:</label>
      <input class="goal-input" type="number" min="1" max="100" value="${goal}"
        onchange="saveGoal('${esc(s.subject)}', this.value, this)"
        onclick="event.stopPropagation()" />
      <span class="goal-pct-label">%</span>
      <span class="goal-status ${s.percentage >= goal ? 'goal-met' : 'goal-miss'}">
        ${s.percentage >= goal ? '✅' : `Need ${Math.ceil((goal / 100 * s.total - s.attended) / (1 - goal / 100))} more`}
      </span>
    </div>
    <button class="card-calc-toggle" onclick="toggleCardCalc(this)">🧮 Calculate for this subject</button>
    <div class="card-calc-panel hidden">
      <div class="card-calc-inputs">
        <div><label>Attended</label><input type="number" value="${s.attended}" oninput="runCardCalc(this)" data-total="${s.total}" /></div>
        <div><label>Total</label><input type="number" value="${s.total}" oninput="runCardCalc(this.parentElement.parentElement.querySelector('input'))" /></div>
        <div><label>Target %</label><input type="number" value="${goal}" oninput="runCardCalc(this.parentElement.parentElement.querySelector('input'))" /></div>
      </div>
      <div class="card-calc-result"></div>
    </div>`;
    return div;
}

function saveGoal(subject, val, inputEl) {
    const g = Math.max(1, Math.min(100, parseInt(val) || 75));
    localStorage.setItem(`yums_goal_${subject}`, g);
    if (inputEl) inputEl.value = g;
    toast(`Goal for ${subject.split(' ')[0]}… set to ${g}%`, 'success');
}

function toggleCardCalc(btn) {
    const panel = btn.nextElementSibling;
    const hidden = panel.classList.toggle('hidden');
    btn.textContent = hidden ? '🧮 Calculate for this subject' : '✖ Close calculator';
    if (!hidden) { const inp = panel.querySelector('input'); runCardCalc(inp); }
}

function runCardCalc(attendedInput) {
    const row = attendedInput.closest('.card-calc-inputs');
    const inputs = row.querySelectorAll('input');
    const attended = parseInt(inputs[0].value) || 0;
    const total = parseInt(inputs[1].value) || 0;
    const target = parseFloat(inputs[2].value) || 75;
    const resEl = row.parentElement.querySelector('.card-calc-result');
    if (total <= 0) { resEl.textContent = ''; return; }

    const cur = Math.round(attended / total * 100);
    const tf = target / 100;
    if (cur >= target) {
        const skip = Math.floor((attended - tf * total) / tf);
        resEl.innerHTML = `<span style="color:var(--green)">✅ ${cur}% — can skip <strong>${skip}</strong> more</span>`;
    } else {
        const need = Math.ceil((tf * total - attended) / (1 - tf));
        const col = cur >= 65 ? 'var(--yellow)' : 'var(--red)';
        resEl.innerHTML = `<span style="color:${col}">📚 ${cur}% — attend <strong>${need}</strong> more to reach ${target}%</span>`;
    }
}

/* ══════════════════════════════════════════════
   COPY / EXPORT
══════════════════════════════════════════════ */
function copyStats() {
    const subjects = window._allSubjects || JSON.parse(sessionStorage.getItem('yums_subjects') || localStorage.getItem('yums_subjects') || '[]');
    if (!subjects.length) { toast('No data to copy', 'error'); return; }
    const umsOverall = sessionStorage.getItem('yums_overallPct') || localStorage.getItem('yums_overallPct');
    const overall = umsOverall || '?';
    const lines = [
        `📊 YUMS Attendance Report`,
        `Overall: ${overall}%`,
        ``,
        ...subjects.map(s =>
            `${s.percentage >= 75 ? '✅' : s.percentage >= 65 ? '⚠️' : '🔴'} ${s.subject}: ${s.percentage}% (${s.attended}/${s.total})`
        ),
        ``, `Generated by YUMS · ${new Date().toLocaleDateString('en-IN')}`,
    ];
    navigator.clipboard.writeText(lines.join('\n'))
        .then(() => toast('📋 Stats copied to clipboard!', 'success'))
        .catch(() => toast('Could not copy — try again', 'error'));
}

function exportPrint() { window.print(); }

/* ══════════════════════════════════════════════
   BROWSER NOTIFICATIONS
══════════════════════════════════════════════ */
function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission();
}

function enableNotifications() {
    if (!('Notification' in window)) { toast('Notifications not supported in this browser', 'error'); return; }
    Notification.requestPermission().then(p => {
        if (p === 'granted') toast('🔔 Notifications enabled!', 'success');
        else toast('Notifications blocked. Allow them in browser settings.', 'error');
    });
}

function notifyLowAttendance(subjects) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    subjects.filter(s => s.percentage < 75).forEach(s => {
        new Notification(`⚠️ Low Attendance: ${s.subject}`, {
            body: `${s.percentage}% — You need ${s.needed} more classes to reach 75%`,
            icon: '🎓',
            tag: `yums-${s.subject}`,
        });
    });
}

/* ══════════════════════════════════════════════
   TREND CHART
══════════════════════════════════════════════ */
function saveTrendSnapshot(overall, subjects) {
    if (overall == null) return;
    const history = JSON.parse(localStorage.getItem(TREND_KEY) || '[]');
    const todayStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    
    // If today already exists, update it instead of pushing a duplicate
    const existingIndex = history.findIndex(h => h.date === todayStr);
    if (existingIndex >= 0) {
        history[existingIndex].pct = parseInt(overall);
    } else {
        history.push({ date: todayStr, pct: parseInt(overall) });
    }
    
    if (history.length > 30) history.splice(0, history.length - 30);
    localStorage.setItem(TREND_KEY, JSON.stringify(history));
}

function drawTrendChart() {
    const history = JSON.parse(localStorage.getItem(TREND_KEY) || '[]');
    const canvas = $('trendChart');
    const section = $('trendSection');
    if (!canvas || history.length < 2) { if (section) show('noTrendMsg'); return; }

    show('trendSection');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 800;
    const H = 160;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad = { t: 16, r: 16, b: 32, l: 40 };
    const cW = W - pad.l - pad.r;
    const cH = H - pad.t - pad.b;
    const min = Math.max(0, Math.min(...history.map(h => h.pct)) - 10);
    const max = Math.min(100, Math.max(...history.map(h => h.pct)) + 10);
    const xStep = history.length > 1 ? cW / (history.length - 1) : cW;
    const yScale = pct => pad.t + cH - ((pct - min) / (max - min || 1)) * cH;

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    ctx.clearRect(0, 0, W, H);

    const y75 = yScale(75);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(245,197,66,.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, y75); ctx.lineTo(W - pad.r, y75); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(245,197,66,.7)';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText('75%', 2, y75 + 4);

    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + cH);
    grad.addColorStop(0, 'rgba(124,107,255,.35)');
    grad.addColorStop(1, 'rgba(124,107,255,0)');
    ctx.beginPath();
    history.forEach((h, i) => {
        const x = pad.l + i * xStep, y = yScale(h.pct);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.l + (history.length - 1) * xStep, pad.t + cH);
    ctx.lineTo(pad.l, pad.t + cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    history.forEach((h, i) => {
        const x = pad.l + i * xStep, y = yScale(h.pct);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#7C6BFF';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    history.forEach((h, i) => {
        const x = pad.l + i * xStep, y = yScale(h.pct);
        const dotColor = h.pct >= 75 ? '#2DD4A3' : h.pct >= 65 ? '#F5C542' : '#FF6B8A';
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = dotColor; ctx.fill();
        ctx.strokeStyle = isDark ? '#080B14' : '#fff'; ctx.lineWidth = 2; ctx.stroke();

        if (history.length <= 10 || i % 2 === 0) {
            ctx.fillStyle = isDark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.45)';
            ctx.font = '9px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(h.date, x, H - 6);
        }
    });
    // Draw prediction line overlay
    drawPredictionLine(ctx, history, pad, W, H, xStep, yScale);
}

function clearTrend() {
    localStorage.removeItem(TREND_KEY);
    toast('Trend history cleared', 'info');
    const canvas = $('trendChart');
    if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
    show('noTrendMsg');
}

/* ══════════════════════════════════════════════
   SEMESTER END PROJECTOR  (calculator.html)
   Auto-reads timetable to get per-subject class frequency
══════════════════════════════════════════════ */

function formatDate(d) {
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function saveSemEndDate(val)  { if (val) localStorage.setItem('yums_sem_end', val); }
function saveSemMidTerm(val)  { if (val) localStorage.setItem('yums_sem_midterm', val); else localStorage.removeItem('yums_sem_midterm'); }
function saveSemEndTerm(val)  { if (val) localStorage.setItem('yums_sem_endterm', val); else localStorage.removeItem('yums_sem_endterm'); }

function initSemCalcPage() {
    const endSaved  = localStorage.getItem('yums_sem_end');
    const midSaved  = localStorage.getItem('yums_sem_midterm');
    const endtSaved = localStorage.getItem('yums_sem_endterm');
    const endEl  = $('semEndDate');
    const midEl  = $('semMidTerm');
    const endtEl = $('semEndTerm');
    if (endSaved  && endEl  && !endEl.value)  endEl.value  = endSaved;
    if (midSaved  && midEl  && !midEl.value)  midEl.value  = midSaved;
    if (endtSaved && endtEl && !endtEl.value) endtEl.value = endtSaved;
    runSemCalc();
}

/* Count working Mon–Fri days between two dates (exclusive `from`, inclusive `to`),
   skipping ±4 days around any exam date. */
function countWorkingDays(from, to, skipDates) {
    let count = 0;
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);

    const skipSet = new Set();
    (skipDates || []).forEach(sd => {
        const ex = new Date(sd); ex.setHours(0, 0, 0, 0);
        for (let delta = -4; delta <= 4; delta++) {
            const dd = new Date(ex); dd.setDate(dd.getDate() + delta);
            skipSet.add(dd.toISOString().slice(0, 10));
        }
    });

    while (d <= end) {
        const dow = d.getDay();
        const iso = d.toISOString().slice(0, 10);
        if (dow !== 0 && dow !== 6 && !skipSet.has(iso)) count++;
        d.setDate(d.getDate() + 1);
    }
    return count;
}

/* Build map: timetable-key → classes per week (counting unique day+time slots) */
function buildTimetableFreqMap(timetable) {
    const WEEKDAYS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
    const slotSets = {}; // key → Set of "day_time" strings

    timetable.forEach(slot => {
        const day = (slot.day || '').trim();
        if (!WEEKDAYS.has(day)) return;
        const raw = (slot.subject || slot.courseCode || slot.title || '').trim();
        if (!raw) return;
        const key = raw.toUpperCase().replace(/\s+/g, '_');
        if (!slotSets[key]) slotSets[key] = new Set();
        slotSets[key].add(day + '_' + (slot.time || ''));
    });

    const result = {};
    Object.entries(slotSets).forEach(([k, s]) => { result[k] = s.size; });
    return result;
}

/* Match attendance subject to timetable key.
   Attendance subjects look like: "FOUNDATIONS OF CLOUD COMPUTING (CSR212)"
   Timetable keys are course codes like: "CSR212"
   Strategy: extract code from parentheses first, then fall back to fuzzy match. */
function matchSubjectToTimetable(attSubject, ttFreqMap) {
    // 1. Try to extract course code from parentheses: "Subject Name (CSR212)"
    const parenMatch = attSubject.match(/\(([A-Z]{2,6}\d{2,4}[A-Z]?)\)/i);
    if (parenMatch) {
        const code = parenMatch[1].toUpperCase();
        if (ttFreqMap[code]) return code;
        // also try with underscore key format
        const codeKey = code.replace(/\s+/g, '_');
        if (ttFreqMap[codeKey]) return codeKey;
    }

    // 2. Check if any part of the attendance subject matches a timetable key directly
    const attUpper = attSubject.toUpperCase();
    for (const ttKey of Object.keys(ttFreqMap)) {
        const code = ttKey.replace(/_/g, '');
        if (attUpper.includes(code) && code.length >= 5) return ttKey;
    }

    // 3. Fuzzy substring match (fallback)
    const attNorm = attSubject.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let bestKey = null, bestScore = 0;
    Object.keys(ttFreqMap).forEach(ttKey => {
        const ttNorm = ttKey.replace(/[^A-Z0-9]/g, '');
        const shorter = attNorm.length < ttNorm.length ? attNorm : ttNorm;
        const longer  = attNorm.length < ttNorm.length ? ttNorm  : attNorm;
        if (shorter.length >= 4 && longer.includes(shorter)) {
            const score = shorter.length;
            if (score > bestScore) { bestScore = score; bestKey = ttKey; }
        }
    });
    return bestKey;
}


function runSemCalc() {
    const wrapper = $('semResultsWrapper');
    if (!wrapper) return;

    const endDateVal = $('semEndDate')?.value;
    const target     = parseFloat($('semTarget')?.value) || 75;
    const midTermVal = $('semMidTerm')?.value;
    const endTermVal = $('semEndTerm')?.value;

    // ── Load attendance ──
    const subjects = JSON.parse(
        sessionStorage.getItem('yums_subjects') ||
        localStorage.getItem('yums_subjects') || '[]'
    );
    if (!subjects.length) {
        wrapper.innerHTML = `<div class="calc-empty"><span>🔒</span><strong>No attendance data found</strong>
            <p style="margin-top:8px;font-size:13px;">Log in from the Home page first.</p></div>`;
        return;
    }

    // ── Load timetable & build frequency map ──
    const ttRaw = sessionStorage.getItem('yums_timetable') || localStorage.getItem('yums_timetable');
    let ttFreqMap = {}, hasTimetable = false;
    try {
        if (ttRaw) {
            const tt = JSON.parse(ttRaw);
            ttFreqMap = buildTimetableFreqMap(tt);
            hasTimetable = Object.keys(ttFreqMap).length > 0;
        }
    } catch (_) {}

    // Timetable status badge
    const badge = $('ttStatusBadge');
    if (badge) {
        if (hasTimetable) {
            const n = Object.keys(ttFreqMap).length;
            badge.innerHTML = `<div class="tt-badge">✅ Timetable loaded — ${n} unique subject slots detected, weekly frequency auto-calculated</div>`;
        } else {
            badge.innerHTML = `<div class="tt-badge warn">⚠️ No timetable detected — go to Home and refresh data to load it, or estimates will be used.</div>`;
        }
    }

    // ── Working days calculation ──
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let workingDays = 0, weeksLeft = 0, hasEndDate = false;
    if (endDateVal) {
        const end = new Date(endDateVal); end.setHours(0, 0, 0, 0);
        if (end > today) {
            hasEndDate = true;
            const skipDates = [];
            if (midTermVal) skipDates.push(midTermVal);
            if (endTermVal) skipDates.push(endTermVal);
            workingDays = countWorkingDays(today, end, skipDates);
            weeksLeft = workingDays / 5;
        }
    }

    const tf = target / 100;
    const DEFAULT_PER_WEEK = 3;

    // ── Per-subject data ──
    const subjData = subjects.map(s => {
        const ttKey = matchSubjectToTimetable(s.subject, ttFreqMap);
        const classesPerWeek = ttKey
            ? ttFreqMap[ttKey]
            : (hasTimetable ? 0 : DEFAULT_PER_WEEK);

        const classesLeft  = hasEndDate ? Math.round(weeksLeft * classesPerWeek) : 0;
        const grandTotal   = s.total + classesLeft;
        const hasProj      = hasEndDate && classesLeft > 0;

        const bestPct   = hasProj ? Math.round((s.attended + classesLeft) / grandTotal * 100) : s.percentage;
        const worstPct  = hasProj ? Math.round(s.attended / grandTotal * 100)                : s.percentage;
        const mustAttend = hasProj ? Math.max(0, Math.ceil(tf * grandTotal - s.attended)) : 0;
        const canBunk    = hasProj ? Math.max(0, classesLeft - mustAttend) : 0;

        return { ...s, classesPerWeek, classesLeft, grandTotal, bestPct, worstPct, mustAttend, canBunk, hasProj, ttMatched: !!ttKey };
    });

    // ── Summary ──
    const totalAtt  = subjects.reduce((a, s) => a + s.attended, 0);
    const totalHeld = subjects.reduce((a, s) => a + s.total, 0);
    const umsOverall = sessionStorage.getItem('yums_overallPct') || localStorage.getItem('yums_overallPct');
    const overallNow  = (umsOverall && umsOverall !== '') ? umsOverall
        : (totalHeld > 0 ? (totalAtt / totalHeld * 100).toFixed(1) : '0');
    const safeCount   = subjects.filter(s => s.percentage >= 75).length;
    const dangerCount = subjects.filter(s => s.percentage < 65).length;
    const overallColor = parseFloat(overallNow) >= 75 ? 'var(--green)' : parseFloat(overallNow) >= 65 ? 'var(--yellow)' : 'var(--red)';

    let bestOvPct = overallNow, worstOvPct = overallNow;
    if (hasEndDate) {
        const bAtt  = subjData.reduce((a, s) => a + s.attended + s.classesLeft, 0);
        const bHeld = subjData.reduce((a, s) => a + s.grandTotal, 0);
        bestOvPct  = bHeld > 0 ? (bAtt        / bHeld * 100).toFixed(1) : overallNow;
        worstOvPct = bHeld > 0 ? (totalAtt    / bHeld * 100).toFixed(1) : overallNow;
    }

    const bOvCol = parseFloat(bestOvPct)  >= 75 ? 'var(--green)' : parseFloat(bestOvPct)  >= 65 ? 'var(--yellow)' : 'var(--red)';
    const wOvCol = parseFloat(worstOvPct) >= 75 ? 'var(--green)' : parseFloat(worstOvPct) >= 65 ? 'var(--yellow)' : 'var(--red)';

    let sumHTML = `<div class="sem-summary-banner">
        <div class="sem-stat"><span class="sem-stat-val" style="color:${overallColor}">${overallNow}%</span><span class="sem-stat-lbl">Overall Now</span></div>`;
    if (hasEndDate) {
        const note = (midTermVal || endTermVal) ? ' (exam weeks skipped)' : '';
        sumHTML += `
        <div class="sem-stat"><span class="sem-stat-val" style="color:${wOvCol}">${worstOvPct}%</span><span class="sem-stat-lbl">Worst Case</span></div>
        <div class="sem-stat"><span class="sem-stat-val" style="color:${bOvCol}">${bestOvPct}%</span><span class="sem-stat-lbl">Best Case</span></div>
        <div class="sem-stat"><span class="sem-stat-val">${workingDays}</span><span class="sem-stat-lbl">Working Days Left${note}</span></div>`;
    }
    sumHTML += `
        <div class="sem-stat"><span class="sem-stat-val" style="color:var(--green)">${safeCount}</span><span class="sem-stat-lbl">Safe ≥75%</span></div>
        <div class="sem-stat"><span class="sem-stat-val" style="color:var(--red)">${dangerCount}</span><span class="sem-stat-lbl">Danger <65%</span></div>
    </div>`;

    // ── Per-subject cards ──
    const cardsHTML = subjData.map(s => {
        const curColor = s.percentage >= 75 ? 'safe' : s.percentage >= 65 ? 'warn' : 'danger';
        let cardClass = curColor;
        if (s.hasProj) {
            cardClass = s.bestPct < target ? 'impossible'
                : s.worstPct >= target ? 'safe'
                : 'warn';
        }

        let verdict = '', verdictClass = cardClass;
        if (!s.hasProj) {
            if (s.percentage >= target) {
                const bk = Math.floor((s.attended - tf * s.total) / tf);
                verdict = `✅ At ${s.percentage}% — can bunk <strong>${bk}</strong> more class${bk !== 1 ? 'es' : ''} and stay at ${target}%.`;
                verdictClass = 'safe';
            } else {
                const nd = Math.ceil((tf * s.total - s.attended) / (1 - tf));
                verdict = `📚 At ${s.percentage}% — need <strong>${nd}</strong> more classes to hit ${target}%.`;
                verdictClass = s.percentage >= 65 ? 'warn' : 'danger';
            }
        } else if (s.bestPct < target) {
            verdict = `⚠️ Even attending ALL <strong>${s.classesLeft}</strong> remaining classes (<strong>${s.classesPerWeek}/week</strong>), your best is <strong>${s.bestPct}%</strong> — below ${target}%. Mathematically not recoverable this semester.`;
            verdictClass = 'impossible';
        } else if (s.worstPct >= target) {
            verdict = `🎉 Even if you miss ALL <strong>${s.classesLeft}</strong> remaining classes, you'll end at <strong>${s.worstPct}%</strong> — above ${target}%. You're completely safe!`;
            verdictClass = 'safe';
        } else {
            verdict = `📚 Attend <strong>${s.mustAttend}</strong> of <strong>${s.classesLeft}</strong> remaining classes (<strong>${s.classesPerWeek}/week</strong>) to hit ${target}%. You can skip <strong>${s.canBunk}</strong>.`;
            verdictClass = 'warn';
        }

        // Range bar
        let barHTML = '';
        if (s.hasProj) {
            const wP = Math.min(s.worstPct, 100), bP = Math.min(s.bestPct, 100), tP = Math.min(target, 100);
            barHTML = `<div class="src-bar-wrap">
                <div class="src-bar-labels">
                    <span>Worst: <strong>${s.worstPct}%</strong></span>
                    <span style="color:var(--yellow)">▼ ${target}%</span>
                    <span>Best: <strong>${s.bestPct}%</strong></span>
                </div>
                <div class="src-bar-track">
                    <div class="src-bar-fill-best" style="width:${bP}%"></div>
                    <div class="src-bar-fill-worst" style="width:${wP}%"></div>
                    <div class="src-bar-target" style="left:${tP}%"></div>
                </div>
            </div>`;
        }

        // Info chips
        const ttChip = s.ttMatched
            ? `<div class="src-chip">📅 <strong>${s.classesPerWeek}</strong>/week from timetable</div>`
            : (hasTimetable
                ? `<div class="src-chip" style="opacity:.6">⚠️ Not found in timetable</div>`
                : `<div class="src-chip" style="opacity:.6">📅 ~${s.classesPerWeek}/week (default estimate)</div>`);
        const projChips = s.hasProj ? `
            <div class="src-chip">📚 Classes remaining: <strong>${s.classesLeft}</strong></div>
            <div class="src-chip">✅ Must attend: <strong>${s.mustAttend}</strong></div>
            <div class="src-chip">💤 Can skip: <strong>${s.canBunk}</strong></div>` : '';

        return `<div class="src-card ${cardClass}">
            <div class="src-top">
                <div>
                    <div class="src-name">${esc(s.subject.split('(')[0].trim())}</div>
                    <div class="src-sub">${s.attended}/${s.total} attended now · ${s.total - s.attended} missed</div>
                </div>
                <span class="src-pct ${curColor}">${s.percentage}%</span>
            </div>
            ${barHTML}
            <div class="src-chips">${ttChip}${projChips}</div>
            <div class="src-verdict ${verdictClass}">${verdict}</div>
        </div>`;
    }).join('');

    wrapper.innerHTML = `<div class="sem-results">${sumHTML}${cardsHTML}</div>`;
}

/* ══════════════════════════════════════════════
   BADGES & STREAK
══════════════════════════════════════════════ */
const SUBJECT_TREND_KEY = 'yums_subject_trend';

function computeBadges(subjects, overall) {
    const trend = JSON.parse(localStorage.getItem(TREND_KEY) || '[]');
    const prev = trend.length >= 2 ? trend[trend.length - 2].pct : null;
    const cur  = trend.length >= 1 ? trend[trend.length - 1].pct : overall;
    const badges = [];
    if (subjects.every(s => s.percentage >= 75))             badges.push({ icon: '🏆', name: '75% Club',    desc: 'All subjects ≥ 75%' });
    if (overall >= 90)                                        badges.push({ icon: '💎', name: 'Elite',       desc: 'Overall ≥ 90%' });
    else if (overall >= 80)                                   badges.push({ icon: '⭐', name: 'Above 80',   desc: 'Overall ≥ 80%' });
    if (subjects.every(s => s.percentage >= 65))             badges.push({ icon: '🔥', name: 'No Danger',  desc: 'No subject in danger zone' });
    if (prev !== null && cur > prev)                         badges.push({ icon: '📈', name: 'Improving',  desc: 'Attendance went up this session' });
    if (prev !== null && prev < 75 && cur >= 75)             badges.push({ icon: '💪', name: 'Comeback',   desc: 'Crossed the 75% threshold!' });
    if (trend.length >= 5)                                   badges.push({ icon: '🎖️', name: 'Veteran',   desc: 'Logged in 5+ times' });
    if (trend.length >= 10)                                  badges.push({ icon: '🌟', name: 'Legend',     desc: 'Logged in 10+ times' });
    if (subjects.some(s => s.percentage === 100))            badges.push({ icon: '✨', name: 'Perfect',    desc: 'At least one subject at 100%' });
    return badges;
}

function renderBadges(badges) {
    const strip = $('badgesStrip');
    if (!strip) return;
    if (!badges.length) { strip.innerHTML = '<span style="color:var(--text-3);font-size:13px">Log in more to earn badges!</span>'; return; }
    strip.innerHTML = badges.map(b =>
        `<div class="badge-chip" title="${esc(b.desc)}"><span>${b.icon}</span><span class="badge-chip-name">${esc(b.name)}</span></div>`
    ).join('');
}

function computeStreak() {
    const trend = JSON.parse(localStorage.getItem(TREND_KEY) || '[]');
    if (trend.length < 2) return 0;
    let streak = 0;
    for (let i = trend.length - 1; i >= 1; i--) {
        if (trend[i].pct > trend[i - 1].pct) streak++;
        else break;
    }
    return streak;
}

/* ══════════════════════════════════════════════
   SAFE TO BUNK TODAY
══════════════════════════════════════════════ */
function renderSafeToday(subjects) {
    const el = $('safeTodayList');
    if (!el) return;
    el.innerHTML = subjects.map(s => {
        const safe = s.percentage >= 75;
        const canMiss = safe ? Math.floor((s.attended - 0.75 * s.total) / 0.75) : 0;
        return `<div class="safe-today-item">
            <span class="safe-dot ${safe ? 'dot-green' : 'dot-red'}"></span>
            <span class="safe-subject">${esc(s.subject.split('(')[0].trim())}</span>
            <span class="safe-verdict ${safe ? 'verdict-safe' : 'verdict-risky'}">${safe ? `✅ Safe (${canMiss} left)` : '⚠️ Risky'}</span>
        </div>`;
    }).join('');
}

/* ══════════════════════════════════════════════
   SUBJECT-WISE TREND (per-subject history)
══════════════════════════════════════════════ */
function saveTrendSnapshotPerSubject(subjects) {
    const stored = JSON.parse(localStorage.getItem(SUBJECT_TREND_KEY) || '{}');
    const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    subjects.forEach(s => {
        const key = s.subject;
        if (!stored[key]) stored[key] = [];
        stored[key].push({ date, pct: s.percentage });
        if (stored[key].length > 20) stored[key].splice(0, stored[key].length - 20);
    });
    localStorage.setItem(SUBJECT_TREND_KEY, JSON.stringify(stored));
}

function getSubjectTrendNames() {
    const stored = JSON.parse(localStorage.getItem(SUBJECT_TREND_KEY) || '{}');
    return Object.keys(stored);
}

function drawSubjectTrendChart(subjectName) {
    const stored = JSON.parse(localStorage.getItem(SUBJECT_TREND_KEY) || '{}');
    const history = stored[subjectName] || [];
    const canvas = $('subjectTrendChart');
    const noMsg = $('noSubjectTrendMsg');
    if (!canvas) return;
    if (history.length < 2) { canvas.style.display = 'none'; if (noMsg) show('noSubjectTrendMsg'); return; }
    if (noMsg) hide('noSubjectTrendMsg');
    canvas.style.display = 'block';
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement?.offsetWidth || 700;
    const H = 140;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const pad = { t: 16, r: 16, b: 28, l: 38 };
    const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
    const min = Math.max(0, Math.min(...history.map(h => h.pct)) - 10);
    const max = Math.min(100, Math.max(...history.map(h => h.pct)) + 10);
    const xStep = cW / (history.length - 1);
    const yScale = p => pad.t + cH - ((p - min) / (max - min || 1)) * cH;
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    ctx.clearRect(0, 0, W, H);
    // 75% line
    const y75 = yScale(75);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(245,197,66,.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, y75); ctx.lineTo(W - pad.r, y75); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(245,197,66,.7)'; ctx.font = '10px Inter,sans-serif';
    ctx.fillText('75%', 2, y75 + 4);
    // fill
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + cH);
    grad.addColorStop(0, 'rgba(59,130,246,.3)'); grad.addColorStop(1, 'rgba(59,130,246,0)');
    ctx.beginPath();
    history.forEach((h, i) => { const x = pad.l + i * xStep, y = yScale(h.pct); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.lineTo(pad.l + (history.length - 1) * xStep, pad.t + cH); ctx.lineTo(pad.l, pad.t + cH);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    // line
    ctx.beginPath();
    history.forEach((h, i) => { const x = pad.l + i * xStep, y = yScale(h.pct); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.strokeStyle = '#3B82F6'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
    // dots + labels
    history.forEach((h, i) => {
        const x = pad.l + i * xStep, y = yScale(h.pct);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = h.pct >= 75 ? '#2DD4A3' : h.pct >= 65 ? '#F5C542' : '#FF6B8A'; ctx.fill();
        ctx.strokeStyle = isDark ? '#080B14' : '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = isDark ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.5)';
        ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(h.date, x, H - 4);
    });
}

function populateSubjectDropdown() {
    const sel = $('subjectTrendSelect');
    if (!sel) return;
    const names = getSubjectTrendNames();
    if (!names.length) { sel.innerHTML = '<option value="">No data yet</option>'; return; }
    sel.innerHTML = '<option value="">— Overall trend —</option>' +
        names.map(n => `<option value="${esc(n)}">${esc(n.split('(')[0].trim())}</option>`).join('');
    sel.onchange = () => {
        if (!sel.value) { show('trendSection'); hide('subjectTrendSection'); }
        else { hide('trendSection'); show('subjectTrendSection'); drawSubjectTrendChart(sel.value); }
    };
}

/* ══════════════════════════════════════════════
   ATTENDANCE PREDICTION (linear regression)
══════════════════════════════════════════════ */
function drawPredictionLine(ctx, history, pad, W, H, xStep, yScale) {
    if (history.length < 3) return;
    const n = history.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    history.forEach((h, i) => { sumX += i; sumY += h.pct; sumXY += i * h.pct; sumX2 += i * i; });
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const predict = i => Math.min(100, Math.max(0, slope * i + intercept));
    const FUTURE = Math.min(5, Math.round(n * 0.5));
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(255,200,0,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const startX = pad.l + (n - 1) * xStep, startY = yScale(predict(n - 1));
    ctx.moveTo(startX, startY);
    for (let f = 1; f <= FUTURE; f++) {
        const px = pad.l + (n - 1 + f) * (xStep * 0.7);
        const py = yScale(predict(n - 1 + f));
        ctx.lineTo(Math.min(px, W - pad.r), py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Final prediction dot
    const finalPct = Math.round(predict(n + FUTURE - 1));
    const finalX = Math.min(pad.l + (n - 1 + FUTURE) * (xStep * 0.7), W - pad.r);
    const finalY = yScale(finalPct);
    ctx.beginPath(); ctx.arc(finalX, finalY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#FCD34D'; ctx.fill();
    ctx.fillStyle = 'rgba(252,211,77,0.9)'; ctx.font = 'bold 10px Inter,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`→ ${finalPct}%`, finalX, finalY - 8);
    ctx.restore();
}

/* ══════════════════════════════════════════════
   SPARKLINES IN SUBJECT CARDS
══════════════════════════════════════════════ */
function drawSparkline(canvas, subjectName) {
    if (!canvas) return;
    const stored = JSON.parse(localStorage.getItem(SUBJECT_TREND_KEY) || '{}');
    const history = stored[subjectName] || [];
    if (history.length < 2) { canvas.style.display = 'none'; return; }
    canvas.style.display = 'block';
    const W = 80, H = 28, dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const pts = history.slice(-8);
    const min = Math.min(...pts.map(h => h.pct)) - 5;
    const max = Math.max(...pts.map(h => h.pct)) + 5;
    const xS = W / (pts.length - 1), yS = p => H - 2 - ((p - min) / (max - min || 1)) * (H - 4);
    const latest = pts[pts.length - 1].pct;
    const color = latest >= 75 ? '#2DD4A3' : latest >= 65 ? '#F5C542' : '#FF6B8A';
    ctx.beginPath();
    pts.forEach((h, i) => { const x = i * xS, y = yS(h.pct); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
    const lx = (pts.length - 1) * xS, ly = yS(latest);
    ctx.beginPath(); ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
}

/* ══════════════════════════════════════════════
   SHARE AS IMAGE  (canvas → PNG download)
══════════════════════════════════════════════ */
function generateShareImage() {
    const subjects = window._allSubjects || JSON.parse(sessionStorage.getItem('yums_subjects') || localStorage.getItem('yums_subjects') || '[]');
    const name = sessionStorage.getItem('yums_name') || localStorage.getItem('yums_name') || 'Student';
    const overall = sessionStorage.getItem('yums_overallPct') || localStorage.getItem('yums_overallPct') || '?';
    if (!subjects.length) { toast('No data to share', 'error'); return; }

    const W = 620, ROW = 44, H = 140 + subjects.length * ROW + 40;
    const canvas = document.createElement('canvas');
    const dpr = 2;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // BG
    ctx.fillStyle = '#111111'; ctx.fillRect(0, 0, W, H);
    // Header band
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, W, 100);

    // Logo box
    ctx.fillStyle = '#fff'; ctx.beginPath();
    roundRect(ctx, 24, 22, 48, 48, 10); ctx.fill();
    ctx.font = 'bold 26px Inter,sans-serif'; ctx.fillStyle = '#111'; ctx.textAlign = 'center';
    ctx.fillText('🎓', 48, 52);

    // Title
    ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px Inter,sans-serif'; ctx.fillText('YUMS Attendance Report', 84, 44);
    ctx.font = '13px Inter,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(name + ' · ' + new Date().toLocaleDateString('en-IN'), 84, 66);

    // Overall %
    const pctColor = parseInt(overall) >= 75 ? '#2DD4A3' : parseInt(overall) >= 65 ? '#F5C542' : '#FF6B8A';
    ctx.textAlign = 'right'; ctx.fillStyle = pctColor;
    ctx.font = 'bold 36px Inter,sans-serif'; ctx.fillText(overall + '%', W - 24, 62);
    ctx.font = '11px Inter,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('OVERALL', W - 24, 80);

    // Subject rows
    let y = 118;
    subjects.forEach((s, i) => {
        const rowBg = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'transparent';
        ctx.fillStyle = rowBg; ctx.fillRect(16, y - 14, W - 32, ROW);
        const sc = s.percentage >= 75 ? '#2DD4A3' : s.percentage >= 65 ? '#F5C542' : '#FF6B8A';
        const dot = s.percentage >= 75 ? '✅' : s.percentage >= 65 ? '⚠️' : '🔴';
        ctx.font = '13px Inter,sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
        const label = s.subject.length > 42 ? s.subject.slice(0, 42) + '…' : s.subject;
        ctx.fillText(dot + ' ' + label, 24, y + 8);
        ctx.textAlign = 'right'; ctx.fillStyle = sc; ctx.font = 'bold 14px Inter,sans-serif';
        ctx.fillText(s.percentage + '%', W - 24, y + 8);
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '11px Inter,sans-serif';
        ctx.fillText(`${s.attended}/${s.total}`, W - 80, y + 8);
        y += ROW;
    });

    // Footer
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.textAlign = 'center';
    ctx.font = '11px Inter,sans-serif'; ctx.fillText('Generated by YUMS · yums.app', W / 2, H - 14);

    const link = document.createElement('a');
    link.download = `YUMS_${name.split(' ')[0]}_Attendance.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('📸 Image saved!', 'success');
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

/* ══════════════════════════════════════════════
   WHATSAPP SHARE
══════════════════════════════════════════════ */
function whatsappShare() {
    const subjects = window._allSubjects || JSON.parse(sessionStorage.getItem('yums_subjects') || localStorage.getItem('yums_subjects') || '[]');
    const overall = sessionStorage.getItem('yums_overallPct') || localStorage.getItem('yums_overallPct') || '?';
    const lines = [
        `📊 *My YUMS Attendance Report*`,
        `Overall: *${overall}%*`,
        ``,
        ...subjects.map(s => `${s.percentage >= 75 ? '✅' : s.percentage >= 65 ? '⚠️' : '🔴'} *${s.subject.split('(')[0].trim()}*: ${s.percentage}% (${s.attended}/${s.total})`),
        ``, `_via YUMS App_`
    ];
    window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\n')), '_blank');
}

/* ══════════════════════════════════════════════
   REMAINING CLASSES BY END DATE
══════════════════════════════════════════════ */
function runEndDateCalc() {
    const perWeek = parseFloat($('edPerWeek')?.value) || 0;
    const endDateVal = $('edEndDate')?.value;
    const res = $('edResult');
    if (!endDateVal || perWeek <= 0) { hide('edResult'); return; }

    const today = new Date();
    const end = new Date(endDateVal);
    if (end <= today) { res.className = 'calc-result res-red'; res.textContent = '⚠️ End date must be in the future.'; show('edResult'); return; }

    let workingDays = 0;
    const d = new Date(today);
    while (d < end) { d.setDate(d.getDate() + 1); const day = d.getDay(); if (day !== 0 && day !== 6) workingDays++; }
    const weeksLeft = workingDays / 5;
    const classesLeft = Math.round(weeksLeft * perWeek);
    const daysLeft = Math.ceil((end - today) / (1000 * 60 * 60 * 24));

    res.className = 'calc-result res-green';
    res.innerHTML = `
      <span class="calc-pct" style="color:var(--green)">${classesLeft}</span>
      <span class="res-msg"><strong>${daysLeft} days</strong> (≈ ${weeksLeft.toFixed(1)} weeks) until <strong>${formatDate(end)}</strong>.</span>
      <span class="res-action" style="color:var(--green)">📚 Estimated <strong>${classesLeft}</strong> classes remaining at ${perWeek}/week.</span>`;
    show('edResult');
}

/* ══════════════════════════════════════════════
   BUNK PLANNER
══════════════════════════════════════════════ */
function initPlanner() {
    const subjects = JSON.parse(sessionStorage.getItem('yums_subjects') || localStorage.getItem('yums_subjects') || '[]');
    if (!subjects.length) return;
    window._plannerSubjects = subjects;
    const sel = $('plannerSubjectSel');
    if (sel) {
        sel.innerHTML = '<option value="">— All subjects —</option>' +
            subjects.map((s, i) => `<option value="${i}">${esc(s.subject.split('(')[0].trim())}</option>`).join('');
    }
    renderPlannerResult();
}

function renderPlannerResult() {
    const subjects = window._plannerSubjects || [];
    if (!subjects.length) return;
    const bunkCount = parseInt($('plannerBunkCount')?.value) || 0;
    const classesPerDay = parseFloat($('plannerClassesPerDay')?.value) || 1;
    const subjectIdx = $('plannerSubjectSel')?.value;
    const tbody = $('plannerResultBody');
    if (!tbody) return;

    const list = (subjectIdx !== '' && subjectIdx !== undefined)
        ? [subjects[parseInt(subjectIdx)]]
        : subjects;

    const totalBunked = bunkCount * classesPerDay;

    tbody.innerHTML = list.filter(Boolean).map(s => {
        const newTotal = s.total + Math.round(totalBunked);
        const newPct = Math.round(s.attended / newTotal * 100);
        const wasSafe = s.percentage >= 75;
        const isSafe = newPct >= 75;
        const status = isSafe ? '✅ Safe' : newPct >= 65 ? '⚠️ Warning' : '🔴 Danger';
        const change = newPct - s.percentage;
        const changeStr = change === 0 ? '–' : (change > 0 ? `+${change}` : `${change}`) + '%';
        return `<tr>
            <td>${esc(s.subject.split('(')[0].trim())}</td>
            <td>${s.percentage}%</td>
            <td style="color:${isSafe ? 'var(--green)' : newPct >= 65 ? 'var(--yellow)' : 'var(--red)'};font-weight:700">${newPct}%</td>
            <td style="color:${change < 0 ? 'var(--red)' : change > 0 ? 'var(--green)' : 'var(--text-3)'}">${changeStr}</td>
            <td>${status}</td>
        </tr>`;
    }).join('');
}

/* ══════════════════════════════════════════════
   DAILY REMINDER (push notification scheduling)
══════════════════════════════════════════════ */
function scheduleDailyReminder() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    const timeStr = $('reminderTime')?.value || '08:00';
    const [h, m] = timeStr.split(':').map(Number);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const ms = next - now;
    clearTimeout(window._reminderTimeout);
    window._reminderTimeout = setTimeout(() => {
        const subjects = JSON.parse(localStorage.getItem('yums_subjects') || '[]');
        const danger = subjects.filter(s => s.percentage < 75);
        if (Notification.permission === 'granted') {
            new Notification('🎓 YUMS Daily Reminder', {
                body: danger.length
                    ? `⚠️ ${danger.length} subject${danger.length > 1 ? 's' : ''} below 75%! Check your attendance.`
                    : '✅ All subjects safe. Keep it up!',
                icon: '🎓', tag: 'yums-daily'
            });
        }
        scheduleDailyReminder();
    }, ms);
    localStorage.setItem('yums_reminder_time', timeStr);
    toast(`🔔 Daily reminder set for ${timeStr}`, 'success', 2500);
}

function loadReminderTime() {
    const el = $('reminderTime');
    if (el) el.value = localStorage.getItem('yums_reminder_time') || '08:00';
}

/* ══════════════════════════════════════════════
   BUNK BUDGET TRACKER
   Total classes you can still miss across all safe subjects
══════════════════════════════════════════════ */
function computeBunkBudget(subjects) {
    return subjects
        .filter(s => s.percentage >= 75)
        .reduce((sum, s) => sum + Math.floor((s.attended - 0.75 * s.total) / 0.75), 0);
}

/* ══════════════════════════════════════════════
   DANGER ALERT THRESHOLD
   Show subjects within 3 classes of dropping below 75%
══════════════════════════════════════════════ */
function computeDangerAlerts(subjects) {
    return subjects.filter(s => {
        if (s.percentage < 75) return false; // already below — handled elsewhere
        const canMiss = Math.floor((s.attended - 0.75 * s.total) / 0.75);
        return canMiss >= 0 && canMiss <= 3;
    });
}

function renderDangerBanner(subjects) {
    const banner = $('dangerBanner');
    if (!banner) return;

    const nearDanger = computeDangerAlerts(subjects);
    const critical = subjects.filter(s => s.percentage < 75);

    const items = [];

    critical.forEach(s => {
        items.push({
            label: s.subject.split('(')[0].trim(),
            msg: `${s.percentage}% — need ${s.needed} more classes`,
            cls: 'danger-item-red'
        });
    });

    nearDanger.forEach(s => {
        const canMiss = Math.floor((s.attended - 0.75 * s.total) / 0.75);
        items.push({
            label: s.subject.split('(')[0].trim(),
            msg: `${s.percentage}% — only ${canMiss} skip${canMiss !== 1 ? 's' : ''} left`,
            cls: 'danger-item-yellow'
        });
    });

    if (!items.length) { banner.classList.add('hidden'); return; }

    banner.innerHTML = `
        <div class="danger-banner-header">
            <span>⚠️ <strong>${items.length} subject${items.length > 1 ? 's' : ''} need${items.length === 1 ? 's' : ''} attention</strong></span>
            <button class="danger-dismiss" onclick="this.closest('.danger-banner').classList.add('hidden')">✕</button>
        </div>
        <div class="danger-banner-items">
            ${items.map(i => `
                <div class="danger-item ${i.cls}">
                    <span class="danger-item-name">${esc(i.label)}</span>
                    <span class="danger-item-msg">${i.msg}</span>
                </div>`).join('')}
        </div>`;
    banner.classList.remove('hidden');

    // Push notification for near-danger subjects
    if (Notification.permission === 'granted') {
        nearDanger.forEach(s => {
            const canMiss = Math.floor((s.attended - 0.75 * s.total) / 0.75);
            new Notification(`⚠️ Almost at limit: ${s.subject.split('(')[0].trim()}`, {
                body: `${s.percentage}% — only ${canMiss} skip${canMiss !== 1 ? 's' : ''} remaining before dropping below 75%`,
                tag: `yums-danger-${s.subject}`,
            });
        });
    }
}

/* ══════════════════════════════════════════════
   SEMESTER PROGRESS BAR
══════════════════════════════════════════════ */
function openSemesterModal() {
    const modal = $('semesterModal');
    if (!modal) return;
    const start = localStorage.getItem('yums_sem_start');
    const end = localStorage.getItem('yums_sem_end');
    if (start) ($('semStart').value = start);
    if (end) ($('semEnd').value = end);
    modal.classList.remove('hidden');
}

function closeSemesterModal() { $('semesterModal')?.classList.add('hidden'); }

function saveSemesterDates() {
    const start = $('semStart')?.value;
    const end = $('semEnd')?.value;
    if (!start || !end) { toast('Please set both dates', 'error'); return; }
    if (new Date(end) <= new Date(start)) { toast('End date must be after start date', 'error'); return; }
    localStorage.setItem('yums_sem_start', start);
    localStorage.setItem('yums_sem_end', end);
    closeSemesterModal();
    renderSemesterProgress();
    toast('📅 Semester dates saved!', 'success');
}

function renderSemesterProgress() {
    const wrap = $('semesterProgressWrap');
    if (!wrap) return;
    const start = localStorage.getItem('yums_sem_start');
    const end = localStorage.getItem('yums_sem_end');
    if (!start || !end) {
        // Show placeholder prompting user to set dates
        const fill = $('spFill');
        if (fill) fill.style.width = '0%';
        text('spElapsed', 'Set start date');
        text('spPercent', '');
        text('spRemaining', 'Set end date →');
        return;
    }
    const now = Date.now();
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    const total = endMs - startMs;
    const elapsed = Math.max(0, Math.min(now - startMs, total));
    const pct = Math.round((elapsed / total) * 100);
    const daysElapsed = Math.floor(elapsed / 86400000);
    const daysLeft = Math.max(0, Math.ceil((endMs - now) / 86400000));

    const fill = $('spFill');
    if (fill) fill.style.width = `${pct}%`;
    text('spElapsed', `${daysElapsed} day${daysElapsed !== 1 ? 's' : ''} elapsed`);
    text('spPercent', `${pct}%`);
    text('spRemaining', `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`);
}

/* ══════════════════════════════════════════════
   ATTENDANCE PREDICTION PANEL
   Linear regression on overall trend → project future %
══════════════════════════════════════════════ */
function renderPredictionPanel(subjects) {
    const el = $('predictionList');
    if (!el) return;

    if (!subjects || !subjects.length) {
        el.innerHTML = '<span style="color:var(--text-3);font-size:13px">Loading data...</span>';
        return;
    }

    const trend = JSON.parse(localStorage.getItem(TREND_KEY) || '[]');
    let aiText = '';
    let recommendation = '';
    let statusClass = 'var(--text-2)';

    const overallPct = subjects.length ? Math.round(subjects.reduce((sum, s) => sum + s.percentage, 0) / subjects.length) : 0;
    const critical = subjects.filter(s => s.percentage < 75);
    const nearDanger = subjects.filter(s => s.percentage >= 75 && s.canBunk <= 2);
    const totalBunks = subjects.reduce((sum, s) => sum + (s.canBunk > 0 ? s.canBunk : 0), 0);

    // AI Logic Branches
    if (critical.length > 0) {
        statusClass = 'var(--red)';
        aiText = `Your overall attendance is ${overallPct}%, but ${critical.length} subject(s) are actively below the 75% limit.`;
        recommendation = `You must prioritize ${critical.map(s => s.subject.split('(')[0].trim()).join(', ')} immediately. Do not skip any upcoming classes.`;
    } else if (nearDanger.length > 0) {
        statusClass = 'var(--yellow)';
        aiText = `You are maintaining ${overallPct}% overall, but ${nearDanger.length} subject(s) are within 2 classes of falling into the danger zone.`;
        recommendation = `Exercise caution with ${nearDanger.map(s => s.subject.split('(')[0].trim()).join(', ')}.`;
    } else if (overallPct >= 85) {
        statusClass = 'var(--green)';
        aiText = `Exceptional! You hold a strong ${overallPct}% average with a total budget of ${totalBunks} safe skips across all subjects.`;
        recommendation = `You are comfortably safe. You can afford to miss classes if needed.`;
    } else {
        statusClass = 'var(--green)';
        aiText = `You are perfectly on track with an average of ${overallPct}%. No subjects are currently at immediate risk.`;
        recommendation = `Keep up the current pace. You have ${totalBunks} total skips available safely.`;
    }

    // Add trend context if history exists
    if (trend.length >= 2) {
        const first = trend[0].pct;
        const last = trend[trend.length - 1].pct;
        const diff = last - first;
        if (diff > 2) aiText += ` I noticed an upward momentum in your attendance recently.`;
        if (diff < -2) aiText += ` However, your attendance has been trending slightly downwards over the last few days.`;
    }

    el.innerHTML = `
        <div class="ai-analysis" style="font-size:13.5px; line-height:1.55;">
            <div style="color:var(--text); margin-bottom: 8px;">${aiText}</div>
            <div style="padding: 10px; border-radius: 6px; background: rgba(255,255,255,0.03); border-left: 3px solid ${statusClass}; color: var(--text-2);">
                <strong style="color: ${statusClass}; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:4px;">Recommendation</strong>
                ${recommendation}
            </div>
        </div>
    `;
}

/* ══════════════════════════════════════════════
   TODAY'S TIMETABLE
   Cross-reference stored timetable with attendance data
══════════════════════════════════════════════ */
function renderTodayTimetable(subjects) {
    const el = $('timetableList');
    const dayLabel = $('timetableDay');
    if (!el) return;

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayName = days[new Date().getDay()];
    if (dayLabel) dayLabel.textContent = todayName;

    const raw = sessionStorage.getItem('yums_timetable') || localStorage.getItem('yums_timetable');
    if (!raw) {
        el.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-3);font-size:14px">No timetable data available.</div>`;
        return;
    }

    let timetable = [];
    try { timetable = JSON.parse(raw); } catch (_) { }

    // Filter for today's slots
    const todaySlots = timetable.filter(slot => {
        const d = (slot.day || slot.Day || '').trim();
        return d.toLowerCase() === todayName.toLowerCase();
    });

    if (!todaySlots.length) {
        el.innerHTML = `<div class="tt-empty">🎉 No classes scheduled today (${todayName}).</div>`;
        return;
    }

    // Cross-reference with attendance
    el.innerHTML = todaySlots.map(slot => {
        const subjectKey = (slot.subject || slot.Subject || slot.course || '').trim();
        const time = slot.time || slot.Time || slot.period || '';
        const room = slot.room || slot.Room || slot.venue || '';

        // Find matching subject in attendance
        const attMatch = subjects.find(s =>
            s.subject.toLowerCase().includes(subjectKey.toLowerCase().slice(0, 8)) ||
            subjectKey.toLowerCase().includes(s.subject.toLowerCase().slice(0, 8))
        );

        const pct = attMatch ? attMatch.percentage : null;
        const pctColor = pct === null ? 'var(--text-3)' : pct >= 75 ? 'var(--green)' : pct >= 65 ? 'var(--yellow)' : 'var(--red)';
        const pctBadge = pct !== null ? `<span class="tt-att-badge" style="color:${pctColor}">${pct}%</span>` : '';

        return `<div class="tt-slot">
            <div class="tt-time">${esc(time)}</div>
            <div class="tt-subject">${esc(subjectKey)}</div>
            ${room ? `<div class="tt-room">📍 ${esc(room)}</div>` : ''}
            ${pctBadge}
        </div>`;
    }).join('');
}

/* ══════════════════════════════════════════════
   AUTO-REFRESH SCHEDULER
   Background refresh every N hours using setInterval
══════════════════════════════════════════════ */
function setAutoRefresh(intervalMinutes) {
    const mins = parseInt(intervalMinutes) || 0;
    clearInterval(window._autoRefreshTimer);
    localStorage.setItem('yums_auto_refresh', String(mins));

    if (mins <= 0) { toast('Auto-refresh disabled', 'info', 2000); return; }

    window._autoRefreshTimer = setInterval(() => {
        console.log('[AutoRefresh] Triggering background refresh…');
        const regNo = localStorage.getItem('yums_regNo');
        if (!regNo) return;

        const url = `${API_BASE}/login/stream?regNo=${encodeURIComponent(regNo)}`;
        const es = new EventSource(url);

        es.addEventListener('attendance', (e) => {
            es.close();
            try {
                const data = JSON.parse(e.data);
                const fetchedAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                const keys = {
                    yums_name: data.name || localStorage.getItem('yums_name') || '',
                    yums_program: data.program || '',
                    yums_subjects: JSON.stringify(data.subjects || []),
                    yums_overallPct: data.overallPct != null ? String(data.overallPct) : '',
                    yums_fetched: fetchedAt,
                    yums_fetchedTs: String(Date.now()),
                };
                Object.entries(keys).forEach(([k, v]) => { sessionStorage.setItem(k, v); localStorage.setItem(k, v); });
                saveTrendSnapshot(data.overallPct, data.subjects || []);
                saveTrendSnapshotPerSubject(data.subjects || []);
                toast(`🔄 Auto-refreshed at ${fetchedAt}`, 'success', 3000);
                setTimeout(() => window.location.reload(), 1500);
            } catch (_) { }
        });

        es.addEventListener('error', () => { es.close(); });
        es.onerror = () => { if (es.readyState !== EventSource.CLOSED) es.close(); };
    }, mins * 60 * 1000);

    toast(`🔄 Auto-refresh every ${mins >= 60 ? mins / 60 + ' hr' : mins + ' min'}`, 'success', 2500);
}

function initAutoRefresh() {
    const saved = parseInt(localStorage.getItem('yums_auto_refresh')) || 0;
    const sel = $('autoRefreshInterval');
    if (sel && saved) {
        // Find matching option
        const opt = Array.from(sel.options).find(o => parseInt(o.value) === saved);
        if (opt) sel.value = opt.value;
    }
    if (saved > 0) setAutoRefresh(saved);
}

/* ══════════════════════════════════════════════
   SHAREABLE ATTENDANCE CARD (Spotify Wrapped style)
   With preview modal, download, and clipboard copy
══════════════════════════════════════════════ */
let _shareCanvas = null;

function generateShareImage() {
    const subjects = window._allSubjects || JSON.parse(sessionStorage.getItem('yums_subjects') || localStorage.getItem('yums_subjects') || '[]');
    const name = sessionStorage.getItem('yums_name') || localStorage.getItem('yums_name') || 'Student';
    const overall = parseInt(sessionStorage.getItem('yums_overallPct') || localStorage.getItem('yums_overallPct') || '0');
    if (!subjects.length) { toast('No data to share', 'error'); return; }

    const W = 640, H = 480;
    const canvas = document.createElement('canvas');
    const dpr = 2;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Background gradient
    const isDark = overall >= 75;
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    if (overall >= 75) {
        bgGrad.addColorStop(0, '#0f2027'); bgGrad.addColorStop(0.5, '#203a43'); bgGrad.addColorStop(1, '#2c5364');
    } else if (overall >= 65) {
        bgGrad.addColorStop(0, '#1a1209'); bgGrad.addColorStop(0.5, '#2d2005'); bgGrad.addColorStop(1, '#3d2f00');
    } else {
        bgGrad.addColorStop(0, '#1a0a0a'); bgGrad.addColorStop(0.5, '#2d1010'); bgGrad.addColorStop(1, '#420000');
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Glowing orb background
    const orbGrad = ctx.createRadialGradient(W * 0.75, H * 0.3, 0, W * 0.75, H * 0.3, 220);
    const orbColor = overall >= 75 ? 'rgba(45,212,163,' : overall >= 65 ? 'rgba(245,197,66,' : 'rgba(255,107,138,';
    orbGrad.addColorStop(0, orbColor + '0.15)'); orbGrad.addColorStop(1, orbColor + '0)');
    ctx.fillStyle = orbGrad;
    ctx.fillRect(0, 0, W, H);

    // Header — YUMS branding
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, 0, 0, W, 72, 0);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px Inter,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('🎓 YUMS', 28, 44);

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '13px Inter,sans-serif';
    ctx.fillText('Attendance Report · ' + new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }), 28, 64);

    // Student name top right
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '600 13px Inter,sans-serif';
    ctx.fillText(name, W - 28, 44);

    // Big ring chart (left side)
    const cx = 160, cy = 240, R = 100, strokeW = 18;
    const attColor = overall >= 75 ? '#2DD4A3' : overall >= 65 ? '#F5C542' : '#FF6B8A';

    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = strokeW;
    ctx.stroke();

    // Arc
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (Math.PI * 2 * Math.min(overall, 100) / 100);
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.strokeStyle = attColor;
    ctx.lineWidth = strokeW;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Center text
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 42px Inter,sans-serif';
    ctx.fillText(overall + '%', cx, cy + 10);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '600 13px Inter,sans-serif';
    ctx.fillText('Aggregate', cx, cy + 32);

    // Status badge below ring
    const badgeText = overall >= 75 ? '✅ SAFE' : overall >= 65 ? '⚠️ WARNING' : '🔴 CRITICAL';
    ctx.fillStyle = attColor + '22';
    roundRect(ctx, cx - 56, cy + 50, 112, 28, 14);
    ctx.fill();
    ctx.fillStyle = attColor;
    ctx.font = 'bold 12px Inter,sans-serif';
    ctx.fillText(badgeText, cx, cy + 69);

    // Stats on the right side
    const sx = 320;
    const statsTotal = subjects.reduce((s, sub) => s + sub.total, 0);
    const statsAtt = subjects.reduce((s, sub) => s + sub.attended, 0);
    const safeCnt = subjects.filter(s => s.percentage >= 75).length;
    const budget = subjects.filter(s => s.percentage >= 75).reduce((sum, s) => sum + Math.floor((s.attended - 0.75 * s.total) / 0.75), 0);

    const statRows = [
        { label: 'Classes Attended', value: String(statsAtt), color: '#2DD4A3' },
        { label: 'Total Classes', value: String(statsTotal), color: 'rgba(255,255,255,0.7)' },
        { label: 'Safe Subjects', value: `${safeCnt} / ${subjects.length}`, color: '#2DD4A3' },
        { label: 'Bunk Budget', value: `${budget} left`, color: attColor },
    ];

    statRows.forEach((row, i) => {
        const y = 110 + i * 72;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        roundRect(ctx, sx, y, 280, 56, 10);
        ctx.fill();

        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '11px Inter,sans-serif';
        ctx.fillText(row.label.toUpperCase(), sx + 16, y + 20);

        ctx.fillStyle = row.color;
        ctx.font = 'bold 22px Inter,sans-serif';
        ctx.fillText(row.value, sx + 16, y + 44);
    });

    // Subject list at bottom
    const topSubjects = subjects.slice(0, 4);
    const byRow = Math.floor((W - 40) / topSubjects.length);
    topSubjects.forEach((s, i) => {
        const bx = 20 + i * byRow;
        const by = 390;
        const sw = byRow - 8;
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        roundRect(ctx, bx, by, sw, 60, 8);
        ctx.fill();

        const sc = s.percentage >= 75 ? '#2DD4A3' : s.percentage >= 65 ? '#F5C542' : '#FF6B8A';
        ctx.fillStyle = sc;
        ctx.font = 'bold 16px Inter,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(s.percentage + '%', bx + sw / 2, by + 26);

        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '10px Inter,sans-serif';
        const shortName = s.subject.split('(')[0].trim().slice(0, 14);
        ctx.fillText(shortName, bx + sw / 2, by + 46);
    });

    // Footer watermark
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '11px Inter,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Generated by YUMS — Your Ultimate Management System', W / 2, H - 12);

    // Store for later download/copy
    _shareCanvas = canvas;

    // Show preview modal
    const previewCanvas = $('sharePreviewCanvas');
    if (previewCanvas) {
        previewCanvas.width = W;
        previewCanvas.height = H;
        const pCtx = previewCanvas.getContext('2d');
        pCtx.drawImage(canvas, 0, 0, W * dpr, H * dpr, 0, 0, W, H);
    }
    $('shareModal')?.classList.remove('hidden');
}

function closeShareModal() { $('shareModal')?.classList.add('hidden'); }

function downloadShareCard() {
    if (!_shareCanvas) return;
    const name = sessionStorage.getItem('yums_name') || localStorage.getItem('yums_name') || 'Student';
    const link = document.createElement('a');
    link.download = `YUMS_${name.split(' ')[0]}_Attendance.png`;
    link.href = _shareCanvas.toDataURL('image/png');
    link.click();
    toast('📸 Image downloaded!', 'success');
}

function copyShareCardToClipboard() {
    if (!_shareCanvas) return;
    _shareCanvas.toBlob(async (blob) => {
        try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            toast('📋 Copied to clipboard!', 'success');
        } catch (_) {
            toast('Could not copy — try download instead', 'error');
        }
    }, 'image/png');
}

/* ══════════════════════════════════════════════
   (old calculator functions removed — see runSemCalc above)
══════════════════════════════════════════════ */




function renderTodayStrategy(subjects) {
    const strategyList = $('todayStrategyList');
    if (!strategyList) return;

    if (!subjects || !subjects.length) {
        strategyList.innerHTML = `<div style="text-align:center;color:var(--text-3);font-size:13px;padding:16px;">No attendance data found.</div>`;
        return;
    }

    const timetableRaw = localStorage.getItem('yums_timetable') || sessionStorage.getItem('yums_timetable');
    if (!timetableRaw) {
        strategyList.innerHTML = `<div style="text-align:center;color:var(--text-3);font-size:13px;padding:16px;">No timetable data found. Try refreshing!</div>`;
        return;
    }

    try {
        const tt = JSON.parse(timetableRaw);
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const todayName = dayNames[new Date().getDay()];
        
        const todayClasses = tt.filter(c => c.day === todayName);
        
        if (todayClasses.length === 0) {
            strategyList.innerHTML = `
                <div style="background:var(--subtle); border-radius:12px; padding:16px; text-align:center;">
                    <span style="font-size:24px; display:block; margin-bottom:8px;">🛌</span>
                    <strong style="color:var(--text); font-size:16px;">No classes today!</strong>
                    <p style="color:var(--text-3); font-size:13px; margin-top:4px;">Enjoy your day off or get ahead on assignments.</p>
                </div>
            `;
            return;
        }

        let html = '';
        
        todayClasses.forEach(cls => {
            // Find matching subject to get attendance stats
            const matchedSubject = subjects.find(s => 
                s.subject.toLowerCase().includes(cls.courseCode.toLowerCase()) || 
                s.subject.toLowerCase().includes(cls.title.toLowerCase())
            );

            if (!matchedSubject) {
                html += `
                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:12px; border-radius:8px;">
                    <div>
                        <strong style="font-size:14px; color:var(--text);">${cls.courseCode}</strong>
                        <span style="font-size:12px; color:var(--text-3); margin-left:8px;">${cls.time}</span>
                    </div>
                    <span style="font-size:12px; color:var(--text-3);">Mismatched data</span>
                </div>`;
                return;
            }

            // Calculate if bunkable right now
            const canMiss = Math.floor((matchedSubject.attended - 0.75 * matchedSubject.total) / 0.75);
            let badgeHtml = '';
            
            if (canMiss > 0) {
                badgeHtml = `<span style="background:rgba(45, 212, 163, 0.15); color:var(--green); padding:4px 8px; border-radius:6px; font-weight:700; font-size:12px;">✅ Safe to Bunk</span>`;
            } else if (canMiss === 0) {
                badgeHtml = `<span style="background:rgba(245, 197, 66, 0.15); color:var(--yellow); padding:4px 8px; border-radius:6px; font-weight:700; font-size:12px;">⚠️ At exact 75%</span>`;
            } else {
                badgeHtml = `<span style="background:rgba(255, 107, 138, 0.15); color:var(--red); padding:4px 8px; border-radius:6px; font-weight:700; font-size:12px;">🔴 DO NOT BUNK</span>`;
            }

            html += `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:12px 16px; border-radius:8px;">
                <div>
                    <strong style="font-size:14px; color:var(--text); display:block; margin-bottom:4px;">${matchedSubject.subject.split('(')[0].trim()}</strong>
                    <div style="display:flex; gap:12px; font-size:12px; color:var(--text-3);">
                        <span style="display:flex; align-items:center; gap:4px;">⏱️ ${cls.time}</span>
                        <span style="display:flex; align-items:center; gap:4px;">📍 ${cls.room || 'TBA'}</span>
                    </div>
                </div>
                <div>${badgeHtml}</div>
            </div>`;
        });

        strategyList.innerHTML = html;

    } catch (e) {
        console.error('Error rendering today strategy', e);
        strategyList.innerHTML = `<div style="text-align:center;color:var(--text-3);font-size:13px;padding:16px;">Error analyzing timetable.</div>`;
    }
}

function initOverallSimulatorStats() {
    const subjects = JSON.parse(localStorage.getItem('yums_subjects') || sessionStorage.getItem('yums_subjects') || '[]');
    let totAtt = 0;
    let totHeld = 0;
    subjects.forEach(s => {
        totAtt += s.attended;
        totHeld += s.total;
    });
    
    const currPct = totHeld > 0 ? (totAtt / totHeld * 100).toFixed(2) : 0;
    
    const attEl = document.getElementById('simCurrentAtt');
    const totEl = document.getElementById('simCurrentTot');
    const pctEl = document.getElementById('simCurrentPct');
    
    if (attEl) attEl.textContent = totAtt;
    if (totEl) totEl.textContent = totHeld;
    if (pctEl) pctEl.textContent = currPct + '%';
    
    window._simTotAtt = totAtt;
    window._simTotHeld = totHeld;
}

function runOverallSimulator() {
    // Mode 1: Trajectory
    const upcoming = parseInt(document.getElementById('simUpcomingObj')?.value) || 0;
    const planAtt = parseInt(document.getElementById('simPlanToAtt')?.value) || 0;
    const res1 = document.getElementById('simMode1Result');
    
    const totAtt = window._simTotAtt || 0;
    const totHeld = window._simTotHeld || 0;
    const currentPct = totHeld > 0 ? (totAtt / totHeld * 100) : 0;
    
    if (upcoming > 0 && res1) {
        const newTotAtt = totAtt + planAtt;
        const newTotHeld = totHeld + upcoming;
        const newPct = (newTotAtt / newTotHeld * 100);
        const diff = (newPct - currentPct).toFixed(2);
        const diffStr = diff > 0 ? `+${diff}%` : `${diff}%`;
        const diffColor = diff > 0 ? 'var(--green)' : (diff < 0 ? 'var(--red)' : 'var(--text-3)');
        
        res1.className = 'calc-result res-' + (newPct >= 75 ? 'green' : 'red');
        res1.innerHTML = `
            <span class="calc-pct" style="color:${newPct >= 75 ? 'var(--green)' : 'var(--red)'}">${newPct.toFixed(2)}%</span>
            <span class="res-msg">New Overall Percentage</span>
            <span class="res-action" style="color:${diffColor}">Shift: <strong>${diffStr}</strong></span>
        `;
        res1.classList.remove('hidden');
    } else if (res1) {
        res1.classList.add('hidden');
    }

    // Mode 2: Goal Seeker
    const target = parseFloat(document.getElementById('simTargetPct')?.value) || 0;
    const res2 = document.getElementById('simMode2Result');
    
    if (target > 0 && res2) {
        if (currentPct >= target) {
            const tf = target / 100;
            const canBunk = Math.floor((totAtt - tf * totHeld) / tf);
            
            res2.className = 'calc-result res-green';
            res2.innerHTML = `
                <span class="calc-pct" style="color:var(--green)">✅ Above Target</span>
                <span class="res-msg">You are already above <strong>${target}%</strong>.</span>
                <span class="res-action" style="color:var(--green)">You can globally safely miss your next <strong>${canBunk}</strong> classes to remain at this goal.</span>
            `;
            res2.classList.remove('hidden');
        } else {
            const tf = target / 100;
            const needAtt = Math.ceil((tf * totHeld - totAtt) / (1 - tf));
            
            res2.className = 'calc-result res-yellow';
            res2.innerHTML = `
                <span class="calc-pct" style="color:var(--yellow)">🎯 Below Target</span>
                <span class="res-msg">You are currently below <strong>${target}%</strong>.</span>
                <span class="res-action" style="color:var(--yellow)">You must attend your next <strong>${needAtt}</strong> classes consecutively across all subjects to hit this goal.</span>
            `;
            res2.classList.remove('hidden');
        }
    } else if (res2) {
        res2.classList.add('hidden');
    }
}

/* ══════════════════════════════════════════════
   CGPA TRACKER  (cgpa.html)
══════════════════════════════════════════════ */

const LPU_GRADE_POINTS = {
    'O': 10, 'A+': 10, 'A': 9, 'B+': 8, 'B': 7,
    'C+': 6, 'C': 5, 'D': 4, 'F': 0, 'E': 0,
    'AB': 0, 'I': 0, 'W': 0,
};
const LPU_GRADES_LIST = ['O', 'A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'];

function getGradePoints(grade) {
    if (!grade) return null;
    const g = grade.toString().trim().toUpperCase();
    return LPU_GRADE_POINTS.hasOwnProperty(g) ? LPU_GRADE_POINTS[g] : null;
}

function gradePillClass(grade) {
    const g = (grade || '').toString().trim().toUpperCase();
    const map = { 'O': 'A+', 'A+': 'A+', 'A': 'A', 'B+': 'B+', 'B': 'B', 'C+': 'C+', 'C': 'C', 'D': 'D', 'F': 'F' };
    return map[g] || 'default';
}

function computeSimGpa(simSubjects) {
    let totalCredits = 0, totalWeighted = 0;
    simSubjects.forEach(s => {
        const pts = getGradePoints(s.simGrade || s.grade);
        if (pts !== null && s.credits > 0) {
            totalCredits += s.credits;
            totalWeighted += pts * s.credits;
        }
    });
    return totalCredits > 0 ? (totalWeighted / totalCredits).toFixed(2) : '—';
}

function simChanged() {
    const rows = document.querySelectorAll('.sim-grade-select');
    const simSubjects = window._cgpaSubjects || [];
    rows.forEach((sel, i) => {
        if (simSubjects[i]) simSubjects[i].simGrade = sel.value;
    });
    const gpa = computeSimGpa(simSubjects);
    const chip = document.getElementById('simGpaChip');
    if (chip) chip.textContent = 'Simulated GPA: ' + gpa;
}

function initCgpaPage() {
    const container = document.getElementById('cgpaContent');
    if (!container) return;

    const cgpa = sessionStorage.getItem('yums_cgpa') || localStorage.getItem('yums_cgpa') || '';
    const rawGrades = sessionStorage.getItem('yums_grades') || localStorage.getItem('yums_grades') || '[]';
    let gradeData = [];
    try { gradeData = JSON.parse(rawGrades); } catch (_) {}

    const cgpaNum = parseFloat(cgpa) || 0;
    const cgpaFraction = Math.min(cgpaNum / 10, 1);
    const circ = 2 * Math.PI * 44;
    const heroColor = cgpaNum >= 8 ? '#2DD4A3' : cgpaNum >= 6 ? '#7C6BFF' : cgpaNum >= 5 ? '#F5C542' : '#FF6B8A';

    const totalCredits = gradeData.reduce((s, r) => s + (r.credits || 0), 0);
    const earnedCredits = gradeData.filter(r => {
        const pts = getGradePoints(r.grade);
        return pts !== null && pts > 0;
    }).reduce((s, r) => s + (r.credits || 0), 0);

    const heroHtml = `
    <div class="cgpa-hero">
        <div class="cgpa-ring-wrap">
            <svg class="cgpa-ring-svg" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="10"/>
                <circle id="cgpaArc" cx="50" cy="50" r="44" fill="none" stroke="${heroColor}" stroke-width="10"
                    stroke-linecap="round"
                    stroke-dasharray="${circ.toFixed(2)}"
                    stroke-dashoffset="${circ.toFixed(2)}"
                    transform="rotate(-90 50 50)"
                    style="transition:stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)"/>
            </svg>
            <div class="cgpa-ring-label">
                <span class="cgpa-ring-val">${cgpa || '—'}</span>
                <span class="cgpa-ring-lbl">CGPA</span>
            </div>
        </div>
        <div class="cgpa-hero-stats">
            <div class="cgpa-stat">
                <span class="cgpa-stat-val" style="color:${heroColor}">${cgpa || '—'}</span>
                <span class="cgpa-stat-lbl">Current CGPA</span>
            </div>
            <div class="cgpa-stat">
                <span class="cgpa-stat-val">${totalCredits || '—'}</span>
                <span class="cgpa-stat-lbl">Total Credits</span>
            </div>
            <div class="cgpa-stat">
                <span class="cgpa-stat-val">${earnedCredits || '—'}</span>
                <span class="cgpa-stat-lbl">Credits Earned</span>
            </div>
            <div class="cgpa-stat">
                <span class="cgpa-stat-val">${gradeData.length || '—'}</span>
                <span class="cgpa-stat-lbl">Subjects</span>
            </div>
        </div>
    </div>`;

    let tableHtml = '';
    let simHtml = '';

    if (gradeData.length > 0) {
        const maxCredits = Math.max(...gradeData.map(r => r.credits || 0), 1);

        const tableRows = gradeData.map(r => {
            const pts = getGradePoints(r.grade);
            const pillClass = gradePillClass(r.grade);
            const credits = r.credits || 0;
            const barPct = Math.round((credits / maxCredits) * 100);
            return `<tr>
                <td style="font-weight:600;max-width:200px;word-break:break-word;font-size:13px">${r.subject}</td>
                <td><div class="credit-bar-wrap">
                    <div class="credit-bar"><div class="credit-bar-fill" style="width:0%" data-w="${barPct}"></div></div>
                    <span style="font-size:11px;color:var(--text-3);margin-top:3px;display:block">${credits} cr</span>
                </div></td>
                <td><span class="grade-pill ${pillClass}">${r.grade || '—'}</span></td>
                <td style="font-weight:700;color:var(--text)">${pts !== null ? pts : '—'}</td>
                <td style="color:var(--text-3)">${(pts !== null && credits > 0) ? (pts * credits) : '—'}</td>
            </tr>`;
        }).join('');

        tableHtml = `
        <div class="panel" style="margin-bottom:24px">
            <div class="panel-header">
                <span class="panel-title"><span class="panel-title-icon">📚</span>Subject Grades &amp; Credits</span>
            </div>
            <div class="grade-table-wrap">
                <table class="grade-table">
                    <thead><tr>
                        <th>Subject</th><th>Credits</th><th>Grade</th>
                        <th>Grade Pts</th><th>Weighted</th>
                    </tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        </div>`;

        window._cgpaSubjects = gradeData.map(r => ({ ...r, simGrade: r.grade }));
        const currentGpa = computeSimGpa(window._cgpaSubjects);

        const simRows = gradeData.map((r, i) => {
            const opts = LPU_GRADES_LIST.map(g =>
                '<option value="' + g + '"' + (r.grade && r.grade.toUpperCase() === g ? ' selected' : '') + '>' + g + '</option>'
            ).join('');
            return '<tr><td style="font-weight:600;font-size:12px">' + r.subject +
                   '</td><td style="color:var(--text-3)">' + (r.credits || '—') + ' cr' +
                   '</td><td><select class="sim-grade-select" onchange="simChanged()">' + opts + '</select></td></tr>';
        }).join('');

        simHtml = `
        <div class="panel" style="margin-bottom:24px">
            <div class="panel-header">
                <span class="panel-title"><span class="panel-title-icon">🎮</span>GPA Simulator</span>
            </div>
            <p style="font-size:13px;color:var(--text-3);margin:0 0 12px">Change any subject's grade to see how it affects your overall GPA.</p>
            <div class="sim-header">
                <span style="font-size:13px;color:var(--text-2)">Current GPA: <strong style="color:var(--text)">${currentGpa}</strong></span>
                <div class="sim-result-chip" id="simGpaChip">Simulated GPA: ${currentGpa}</div>
            </div>
            <table class="sim-table">
                <thead><tr><th>Subject</th><th>Credits</th><th>Change Grade</th></tr></thead>
                <tbody>${simRows}</tbody>
            </table>
        </div>`;
    } else {
        tableHtml = `
        <div class="cgpa-no-data">
            <span>📂</span>
            <p>Grade &amp; credit data wasn't found on your UMS grade card page. This usually means grades for the current semester haven't been published yet.</p>
            ${cgpa ? '<p style="font-size:16px;font-weight:700;color:var(--text)">Your CGPA from UMS: <span style="color:#7C6BFF">' + cgpa + '</span></p>' : ''}
            <p style="font-size:12px;color:var(--text-3)">Try refreshing after your grade card is released. The grade table and GPA simulator will appear automatically.</p>
        </div>`;
    }

    container.innerHTML = heroHtml + tableHtml + simHtml;

    setTimeout(() => {
        const arc = document.getElementById('cgpaArc');
        if (arc) arc.style.strokeDashoffset = circ - (circ * cgpaFraction);
        document.querySelectorAll('.credit-bar-fill[data-w]').forEach(el => {
            el.style.width = el.dataset.w + '%';
        });
    }, 150);
}
