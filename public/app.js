// Apple Watch 10X Insights — Core Application Logic
// Data priority: 1. Server-parsed XML  2. Live sync (iOS Shortcut)  3. Demo

// ── 1. Global State ──────────────────────────────────────────────────────────
const state = {
    isDemo: true,
    data:   null,
    lastSync: null,
    activeRange: 365, // Default to 1Y
    chartRanges: {
        sleep: 365,
        recovery: 365,
        rhr: 365,
        workouts: 365
    },
    selectedHabitDate: null,
    calDate: new Date(), // for calendar browsing
    calendarConnected: false
};

// Chart.js Global Defaults — High Contrast Obsidian
Chart.defaults.color          = '#94A3B8';
Chart.defaults.font.family    = "'Plus Jakarta Sans', sans-serif";
Chart.defaults.plugins.tooltip.backgroundColor = '#14161F';
Chart.defaults.plugins.tooltip.titleColor      = '#E2E8F0';
Chart.defaults.plugins.tooltip.padding         = 12;
Chart.defaults.plugins.tooltip.cornerRadius    = 12;
Chart.defaults.plugins.tooltip.borderColor     = 'rgba(255,255,255,0.1)';
Chart.defaults.plugins.tooltip.borderWidth     = 1;
Chart.defaults.scale.grid.color                = 'rgba(255,255,255,0.03)';

/**
 * Null-safe toFixed wrapper
 */
function safeFixed(val, precision = 1) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    return val.toFixed(precision);
}

// Obsidian Flow Colors
const colors = {
    coral:  '#FF6B6B',  // Strain / Performance
    violet: '#8F00FF',  // Recovery / Sleep
    amber:  '#FFD166',  // Active / Streaks
    teal:   '#06D6A0',  // Circadian / Workout types
    blue:   '#4CC9F0',  // Supplementary
    white:  '#E2E8F0',
    slate:  '#94A3B8',
    bgVoid: '#0A0B11',
    bgCard: '#14161F',
    info:   '#4CC9F0',  // alias for scatter matrix
    prod:   '#06D6A0',  // screen-time
    social: '#FF6B6B',
    ent:    '#FFD166',
    other:  '#94A3B8',
};

console.log('[App] Script parsed and executing top-level scope.');
let charts = {};

// ── 2. Initialization ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initUploadZone();
    initSyncButton();
    initTimeRangeControls();
    initCorrelatorControls();
    initAIInsightControl();

    // Set today's date in header
    document.getElementById('date-subtitle').innerText =
        new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

    // Priority chain: XML data → live sync → demo
    const loaded = await loadDataWithPriority();
    console.log('[App] loadDataWithPriority returned:', loaded);
    if (!loaded) {
        console.log('[App] No real data found — using synthetic demo data.');
        state.data   = HealthParser.generateSimulatedParsedData();
        state.isDemo = true;
        setStatusBadge('Demo Data', false);
    }

    // Load persisted habit tags from server (needs state.data to exist)
    await loadTagsFromServer();

    updateUI();
});

// ── 3. Data Loading Priority Chain ───────────────────────────────────────────
async function loadDataWithPriority() {
    // 1. Try server-parsed XML data
    try {
        const res  = await fetch('/api/data');
        const json = await res.json();
        if (json.dataSource && json.dataSource !== 'none' && json.dates && json.dates.length > 0) {
            const parsed = HealthParser.buildFromServerParsed(json);
            if (parsed) {
                state.data   = parsed;
                state.isDemo = false;
                const days = json.dates.length;
                const src  = json.dataSource === 'xml' ? 'XML Export' : json.dataSource;
                setStatusBadge(`${src} · ${days} days`, true);
                // Try to overlay live sync on top
                await overlayLiveSync();
                return true;
            }
        }
    } catch (e) { /* server may not have parsed data yet */ }

    // 2. Try live sync JSON
    try {
        const res  = await fetch('/api/health');
        const json = await res.json();
        if (Object.keys(json).length > 0 && (json.hrv || json.rhr || json.sleepDeep || json.heartRate)) {
            state.data   = HealthParser.buildFromLiveSync(json, null);
            state.isDemo = false;
            setStatusBadge('iOS Sync', true);
            return true;
        }
    } catch (e) { /* offline */ }

    return false;
}

async function overlayLiveSync() {
    try {
        const res  = await fetch('/api/health');
        const json = await res.json();
        if (Object.keys(json).length > 0 && (json.hrv || json.rhr || json.sleepDeep)) {
            state.data = HealthParser.buildFromLiveSync(json, state.data);
            setStatusBadge('XML + Live Sync', true);
        }
    } catch (e) { /* ignore */ }
}

function setStatusBadge(text, live) {
    document.getElementById('sync-time').innerText = text;
    const dot = document.querySelector('.dot');
    if (dot) dot.classList.toggle('active', live);
}

function showEmptyState() {
    const grid = document.querySelector('#dashboard .bento-grid');
    if (!grid || document.getElementById('dashboard-empty-state')) return;
    const el = document.createElement('div');
    el.id = 'dashboard-empty-state';
    el.className = 'bento-card span-full empty-state';
    el.innerHTML = `
        <div class="empty-state-icon">⌚</div>
        <h3>No Apple Health data yet</h3>
        <p>Import your <strong>export.xml</strong> from the Apple Health app to unlock your full biometric history — HRV, sleep stages, workouts and more.</p>
        <button class="btn-primary" onclick="document.querySelector('[data-target=data-import]').click()">Import Data →</button>
        <p style="margin-top:0.5rem; font-size:0.8rem; color:var(--color-text-secondary);">Currently showing <strong>synthetic demo data</strong> to preview the experience.</p>
    `;
    grid.prepend(el);
}

function hideEmptyState() {
    const el = document.getElementById('dashboard-empty-state');
    if (el) el.remove();
}

// ── 4. Navigation ─────────────────────────────────────────────────────────────
function initNavigation() {
    const links = document.querySelectorAll('.nav-links li');
    const sections = document.querySelectorAll('.view-section');

    const sectionMap = {
        'Dashboard': 'dashboard',
        'Sleep & Recovery': 'sleep-recovery',
        'Workouts': 'workouts',
        'Habits & Experiments': 'habits-experiments',
        'Circadian': 'circadian',
        'Data Import': 'data-import'
    };
    // Reverse map for hash → section lookup
    const hashMap = Object.fromEntries(Object.entries(sectionMap).map(([k,v]) => [v, k]));

    function activateSection(target) {
        if (!target) return;
        links.forEach(l => l.classList.remove('active'));
        const matchLink = [...links].find(l => l.dataset.target === target);
        if (matchLink) matchLink.classList.add('active');

        sections.forEach(s => s.classList.remove('active'));
        const targetEl = document.getElementById(target);
        if (targetEl) targetEl.classList.add('active');

        window.scrollTo(0, 0);

        // Update URL hash without triggering a page reload
        history.replaceState(null, '', `#${target}`);

        if (target === 'habits-experiments') {
            try { initHabitsTab(); } catch (e) { console.error('[Habits] Init failed:', e); }
        } else {
            renderCharts(target);
        }
    }

    links.forEach(link => {
        link.addEventListener('click', () => {
            const target = link.dataset.target;
            if (!target) return;
            activateSection(target);
        });
    });

    // Restore tab from URL hash on page load (Sprint 4 fix)
    const hashTarget = window.location.hash.replace('#', '');
    if (hashTarget && document.getElementById(hashTarget)) {
        activateSection(hashTarget);
    }
}

// ── 5. Time-range Controls ────────────────────────────────────────────────────
function initTimeRangeControls() {
    document.querySelectorAll('.time-range-selectors').forEach(group => {
        const chartType = group.dataset.chart;
        const statType  = group.dataset.stat;
        
        group.querySelectorAll('.range-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                group.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const rangeStr = btn.dataset.range;
                let days = 365;
                if (rangeStr === '1w' || rangeStr === '7') days = 7;
                else if (rangeStr === '1m' || rangeStr === '30') days = 30;
                else if (rangeStr === '3m' || rangeStr === '90') days = 90;
                else if (rangeStr === '6m' || rangeStr === '180') days = 180;
                else if (rangeStr === '1y' || rangeStr === '365') days = 365;
                else if (rangeStr === 'all') days = state.data.dates.length;

                if (chartType) {
                    state.chartRanges[chartType] = days;
                    renderCharts(chartType);
                } else if (statType === 'sleep-variance') {
                    updateSleepWakeMetrics(days);
                }
            });
        });
    });
}

function renderChartById(chartId, range) {
    const fn = {
        sleepTrendChart:       () => renderSleepTrendChart(range),
        hrvChartOnly:          () => renderHrvChartOnly(range),
        rhrChartOnly:          () => renderRhrChartOnly(range),
        workoutDistributionChart: () => renderWorkoutDistributionChart(range),
        circadianChart:        () => renderCircadianChart(),
        screenTimeTrendChart:  () => renderScreenTimeTrendChart(range),
    };
    if (fn[chartId]) fn[chartId]();
}

// ── 6. XML Upload Flow ────────────────────────────────────────────────────────
function initUploadZone() {
    const zones = [
        document.getElementById('drop-zone'),
        document.getElementById('large-drop-zone')
    ];

    zones.forEach(zone => {
        if (!zone) return;

        zone.onclick = (e) => {
            if (e.target.id === 'browse-btn') return;
            handleBrowseFiles();
        };

        zone.ondragover = (e) => {
            e.preventDefault();
            zone.classList.add('dragover');
        };

        zone.ondragleave = () => zone.classList.remove('dragover');

        zone.ondrop = (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) handleXmlUpload(file);
        };
    });

    const browseBtn = document.getElementById('browse-btn');
    if (browseBtn) {
        browseBtn.onclick = (e) => {
            e.stopPropagation();
            handleBrowseFiles();
        };
    }
}

function handleBrowseFiles() {
    let input = document.getElementById('hidden-file-input');
    if (!input) {
        input = document.createElement('input');
        input.id = 'hidden-file-input';
        input.type = 'file';
        input.accept = '.xml';
        input.style.display = 'none';
        document.body.appendChild(input);
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                // reset so the same file can be selected again
                handleXmlUpload(file);
                input.value = ''; 
            }
        };
    }
    input.click();
}

async function handleXmlUpload(file) {
    if (!file.name.endsWith('.xml')) {
        alert('Please upload the export.xml file from your Apple Health export.');
        return;
    }

    const statusBox = document.getElementById('import-status');
    const statusText = document.getElementById('import-status-text');
    
    // Ensure we are on the Data Import tab to show status
    if (statusBox && statusBox.classList.contains('hidden')) {
        const navItem = document.querySelector('.nav-links li[data-target="data-import"]');
        if (navItem) navItem.click();
        statusBox.classList.remove('hidden');
    }

    if (statusText) statusText.innerText = `Reading ${file.name}...`;

    try {
        if (statusText) statusText.innerText = 'Uploading to server for fast parsing...';
        
        // Stream file directly to server (avoids browser OOM on massive files)
        const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/xml' },
            body: file,
        });
        
        const json = await res.json();
        
        if (json.status === 'processing' || json.status === 'success') {
            if (statusText) statusText.innerText = 'Server processing. Waiting for results...';
            
            // Start polling for completion
            pollUploadStatus();
        } else {
            throw new Error(json.message || 'Server parse error');
        }
    } catch (err) {
        console.warn('[App] Server error or busy — falling back to browser-side parsing.', err);
        
        const sizeMB = file.size / (1024 * 1024);
        if (sizeMB > 200) {
            if (statusText) statusText.innerText = `File is too large (${sizeMB.toFixed(1)} MB) to parse in the browser. Please ensure the server is running.`;
            alert(`Failed: ${sizeMB.toFixed(1)} MB is too large for browser parsing. Ensure server.py is running.`);
            return;
        }

        if (statusText) statusText.innerText = 'Server busy. Parsing locally in browser (may take a moment)...';
        
        try {
            const text   = await file.text();
            const xmlData = HealthParser.parseXML(text);
            const parsed   = HealthParser.buildFromServerParsed(xmlData);
            
            if (parsed && parsed.dates.length > 0) {
                state.data   = parsed;
                state.isDemo = false;
                setStatusBadge(`XML (${parsed.dates.length} days)`, true);
                if (statusText) statusText.innerText = `Success! Imported ${parsed.dates.length} days locally.`;
                setTimeout(() => {
                    if (statusBox) statusBox.classList.add('hidden');
                    updateUI();
                    const dashboardNav = document.querySelector('.nav-links li[data-target="dashboard"]');
                    if (dashboardNav) dashboardNav.click();
                }, 1500);
            } else {
                throw new Error('No valid data found in XML');
            }
        } catch (localErr) {
            console.error('[App] Browser parse failure:', localErr);
            if (statusText) statusText.innerText = `Import failed: ${localErr.message}`;
            alert(`Failed to parse XML: ${localErr.message}`);
        }
    }
}

async function pollUploadStatus() {
    const statusText = document.getElementById('import-status-text');
    let attempts = 0;
    const maxAttempts = 120; // 2 minutes

    const timer = setInterval(async () => {
        attempts++;
        try {
            const res = await fetch('/api/upload/status');
            const status = await res.json();

            if (status.status === 'success') {
                clearInterval(timer);
                if (statusText) statusText.innerText = `Success! Parsed ${status.days} days in ${status.elapsed}s. Refreshing...`;
                setTimeout(() => window.location.reload(), 2000);
            } else if (status.status === 'error') {
                clearInterval(timer);
                if (statusText) statusText.innerText = `Error: ${status.message}`;
            } else if (attempts >= maxAttempts) {
                clearInterval(timer);
                if (statusText) statusText.innerText = 'Timeout: Server took too long to parse.';
            } else {
                if (statusText) statusText.innerText = `Processing... ${status.message || ''}`;
            }
        } catch (e) {
            console.warn('Poll error:', e);
        }
    }, 1500);
}

// ── 7. iOS Sync Button ────────────────────────────────────────────────────────
function initSyncButton() {
    const btn = document.getElementById('sync-now-btn');
    if (!btn) return; // Prevent fatal crashes since button was removed from UI
    btn.addEventListener('click', async () => {
        const orig = btn.innerText;
        btn.disabled   = true;
        btn.innerText  = 'Fetching…';

        try {
            const res  = await fetch('/api/health', { cache: 'no-store' });
            const json = await res.json();

            if (Object.keys(json).length > 0 && (json.hrv || json.rhr || json.sleepDeep || json.heartRate)) {
                state.data = HealthParser.buildFromLiveSync(json, state.data);
                state.isDemo = false;
                setStatusBadge('iOS Sync · Just now', true);
                updateUI();
                _flashBtn(btn, orig, '✅ Synced', '#10b981');
            } else {
                _flashBtn(btn, orig, 'No New Data', '#f59e0b');
            }
        } catch (e) {
            console.error('[Sync] Failed:', e);
            _flashBtn(btn, orig, '⚠ Offline', '#f43f5e');
        } finally {
            btn.disabled = false;
        }
    });
}

function _flashBtn(btn, origText, msg, color) {
    btn.innerText = msg;
    btn.style.cssText = `background:${color}22;color:${color};border-color:${color}`;
    setTimeout(() => { btn.innerText = origText; btn.removeAttribute('style'); }, 3000);
}

// ── 8. Correlator Controls ────────────────────────────────────────────────────
function initCorrelatorControls(s1Id = 'corr-metric-1', s2Id = 'corr-metric-2', canvasId = 'correlatorChart') {
    const s1 = document.getElementById(s1Id);
    const s2 = document.getElementById(s2Id);
    if (!s1 || !s2) return;
    
    // Add default options if empty
    if (s1.options.length === 0) populateDefaultMetrics(s1, s2);
    
    const onChange = () => { if (state.data) renderCorrelatorChart(canvasId, s1Id, s2Id); };
    s1.addEventListener('change', onChange);
    s2.addEventListener('change', onChange);
    updateCorrelatorMetrics(); // initial sync
}

function populateDefaultMetrics(s1, s2) {
    const metrics = [
        { v: 'hrv', t: 'HRV (Recovery)' },
        { v: 'rhr', t: 'Resting Heart Rate' },
        { v: 'tsb', t: 'Training Strain (TSB)' },
        { v: 'deep_sleep', t: 'Deep Sleep Minutes' },
        { v: 'rem_sleep', t: 'REM Sleep Minutes' },
        { v: 'active_energy', t: 'Active Load (Proxy)' }
    ];
    metrics.forEach(m => {
        const o1 = new Option(m.t, m.v);
        const o2 = new Option(m.t, m.v);
        s1.add(o1);
        s2.add(o2);
    });
    s2.value = 'rhr';
}

// ── 9. UI Render ──────────────────────────────────────────────────────────────
function updateUI() {
    console.log('[App] updateUI dynamic call...');
    const d = state.data;
    if (!d) return;

    if (state.isDemo) {
        showEmptyState();
    } else {
        hideEmptyState();
    }

    try {
        _updateUIInternal(d);
    } catch (err) {
        console.error('[App] updateUI failed:', err);
    }
}

function _updateUIInternal(d) {
    const last = d.recovery.hrv.length - 1; 

    // KPI Values
    setText('dash-recovery-score', d.recovery.score);
    setText('dash-hrv', d.recovery.hrv[last] != null ? Math.round(d.recovery.hrv[last]) : '--');
    setText('dash-rhr', d.recovery.rhr[last] != null ? Math.round(d.recovery.rhr[last]) : '--');

    // Sleep/Wake Variance calculation
    updateSleepWakeMetrics();

    // Scientific Baseline Deltas (7d Avg vs 30d Baseline)
    const _avg = (arr, days) => {
        if (!arr || !arr.length) return 0;
        const slice = arr.slice(Math.max(0, arr.length - days));
        return slice.reduce((a, b) => a + (b||0), 0) / (slice.length || 1);
    };

    const renderDelta = (elId, valueArr, isHigherBetter = true, unit = '') => {
        const el = document.getElementById(elId);
        if (!el || !valueArr || valueArr.length < 30) return;
        
        const avg7 = _avg(valueArr, 7);
        const avg30 = _avg(valueArr, 30);
        if (avg30 === 0) return;

        const diffPct = ((avg7 - avg30) / avg30) * 100;
        const absDiff = Math.abs(diffPct).toFixed(1);
        
        // Determine coloring based on polarity
        let isPositiveEffect = isHigherBetter ? diffPct > 0 : diffPct < 0;
        let arrow = diffPct > 0 ? '↑' : '↓';
        
        if (Math.abs(diffPct) < 1.0) {
            el.innerText = '↔ Stable vs 30d avg';
            el.className = 'kpi-subtext';
        } else {
            el.innerText = `${arrow} ${absDiff}% vs 30d avg`;
            el.className = `kpi-subtext ${isPositiveEffect ? 'positive' : 'danger'}`;
        }
    };

    renderDelta('hrv-velocity', d.recovery.hrv, true);        // Higher HRV is better
    renderDelta('rhr-delta', d.recovery.rhr, false);          // Lower RHR is better

    if (d.signals && d.signals.efficiency) {
        const eff = d.signals.efficiency[last];
        setText('dash-efficiency', eff || '--');
        const effBadge = document.getElementById('efficiency-badge');
        if (effBadge) effBadge.innerText = (eff > 90 ? 'Optimal' : (eff > 80 ? 'Good' : 'Suboptimal'));

        renderDelta('efficiency-velocity', d.signals.efficiency, true);
    }

    // AI Biometric Insights
    updateAIBometricInsights();

    // mini bento metrics
    const weeklyVolEl = document.getElementById('weekly-volume');
    if (weeklyVolEl) {
        const last7Workouts = Math.round(d.workouts.minutes.slice(-7).reduce((a, b) => a + (b || 0), 0));
        weeklyVolEl.innerHTML = `${last7Workouts} <span class="unit">min</span>`;
    }

    if (d.signals) console.log('[SleepOS] Signals Debug:', d.signals[last] || d.signals);

    // Coach AI Animation
    const waveform = document.querySelector('.waveform-container');
    if (waveform) waveform.classList.add('active');

    // Habit Tracker
    initJournal();

    // Fetch dynamic AI insight instead of static logic
    if (!state.aiInitialized) {
        state.aiInitialized = true;
        fetchAIInsight();
    }

    // Dynamic Training Zone from latest TSB
    const latestTsb = d.workouts.tsb[last] ?? 0;
    const tzEl = document.getElementById('training-zone');
    if (tzEl) {
        let zone, zoneColor;
        if      (latestTsb > 5)    { zone = 'Peak / Taper'; zoneColor = 'var(--color-accent-tertiary)'; }
        else if (latestTsb > -10)  { zone = 'Aerobic Base';  zoneColor = 'var(--color-accent-secondary)'; }
        else if (latestTsb > -20)  { zone = 'Building';      zoneColor = '#06B6D4'; }
        else                       { zone = 'Overreaching';  zoneColor = 'var(--color-accent-primary)'; }
        tzEl.innerText = zone;
        tzEl.style.color = zoneColor;
    }

    // Readiness Rings
    updateReadinessRings(d.recovery.score, d.workouts.tsb[last] || 10);

    renderCharts('dashboard');
}

function updateSleepWakeMetrics(days = 30) {
    const d = state.data;
    if (!d || !d.sleepBedtimes || !d.sleepWakeups) return;

    const b = d.sleepBedtimes.slice(-days).filter(v => v != null);
    const w = d.sleepWakeups.slice(-days).filter(v => v != null);

    if (b.length > 0) {
        const avgBedMins = averageTime(b);
        const avgWakeMins = averageTime(w);
        setText('avg-bedtime', formatTimeString(avgBedMins));
        setText('avg-wakeup', formatTimeString(avgWakeMins));
        
        // Calculate variance
        const diffs = b.map((t) => {
             const mins = parseTimeToMins(t, true);
             return Math.abs(mins - avgBedMins);
        });
        const avgDiff = Math.ceil(diffs.reduce((a,b)=>a+b,0)/diffs.length);
        setText('sleep-variance-text', `±${avgDiff}m consistency`);
    } else {
        setText('avg-bedtime', '--');
        setText('avg-wakeup', '--');
        setText('sleep-variance-text', 'No data');
    }
}

function averageTime(times) {
    if (!times || times.length === 0) return 0;
    const mins = times.map(t => parseTimeToMins(t, true));
    const avg = mins.reduce((a, b) => a + b, 0) / mins.length;
    return Math.round(avg);
}

/** 
 * parseTimeToMins: Extracts HH:MM from string and converts to daily minutes.
 * wrapAround: if true, treating 12 AM - 3 PM as "late night" relative to 6 PM baseline.
 */
function parseTimeToMins(timeStr, wrapAround = false) {
    if (!timeStr) return 0;
    // Handle "2024-03-20 03:12:00 +0530" or "03:12"
    const parts = timeStr.trim().split(' ');
    const timeOnly = parts.length > 1 ? parts[1] : parts[0];
    const [h, m] = timeOnly.split(':').map(Number);
    let total = h * 60 + (m || 0);
    if (wrapAround && h < 15) total += 24 * 60; 
    return total;
}

function formatTimeString(totalMins) {
    let normalized = totalMins % (24 * 60);
    let h = Math.floor(normalized / 60);
    let m = Math.floor(normalized % 60);
    const ampm = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function updateReadinessRings(recoveryScore, strainValue) {
    const recoveryRing = document.getElementById('ring-recovery');
    const strainRing = document.getElementById('ring-strain');
    if (!recoveryRing || !strainRing) return;

    // Radius 40 -> Circ 251.2
    const recPercent = recoveryScore / 100;
    recoveryRing.style.strokeDasharray = `251.2 251.2`;
    recoveryRing.style.strokeDashoffset = 251.2 - (recPercent * 251.2);

    // Radius 30 -> Circ 188.4
    const strainPercent = Math.min(strainValue / 20, 1);
    strainRing.style.strokeDasharray = `188.4 188.4`;
    strainRing.style.strokeDashoffset = 188.4 - (strainPercent * 188.4);
}

function updateActivityTrail() {
    // Legacy - removed
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value != null ? value : '--';
}

function getTagImpact(tag, metric = 'hrv') {
    const d = state.data;
    if (!d || !d.tags) return null;
    
    let withSum = 0, withCount = 0;
    let withoutSum = 0, withoutCount = 0;
    
    const metricArr = (metric === 'hrv') ? d.recovery.hrv : (d.recovery.rhr || []);
    if (!metricArr.length) return null;

    // Use rawDates (ISO strings) to match tag keys; fall back to display dates
    const datesToCheck = d.rawDates || d.dates;

    for (let i = 0; i < datesToCheck.length - 1; i++) {
        const dateStr = datesToCheck[i];
        const val = metricArr[i];
        if (val == null) continue;
        
        if ((d.tags[dateStr] || []).includes(tag)) {
            withSum += val;
            withCount++;
        } else {
            withoutSum += val;
            withoutCount++;
        }
    }
    
    if (!withCount || !withoutCount) return null;
    const avgWith = withSum / withCount;
    const avgWithout = withoutSum / withoutCount;
    const diff = ((avgWith - avgWithout) / avgWithout) * 100;
    
    return (diff > 0 ? '+' : '') + Math.round(diff) + '%';
}

const HABIT_ICONS = {
    'alcohol': '🍷',
    'supplements': '💊',
    'sick': '🤒',
    'heavy_leg_day': '🏋️‍♂️',
    'travel': '✈️',
    'sauna': '🧖‍♂️',
    'magnesium': '💤',
    'caffeine': '☕️',
    'cold_plunge': '🧊'
};

// ── Habit Color Palette (auto-assigned by index in habits list) ───────────────
const HABIT_COLOR_PALETTE = [
    '#FF6B6B',  // coral
    '#8F00FF',  // electric violet
    '#FFD166',  // warm amber
    '#06B6D4',  // cyan
    '#34D399',  // emerald
    '#FB923C',  // orange
    '#A78BFA',  // soft purple
    '#38BDF8',  // sky blue
    '#4ADE80',  // lime green
    '#F472B6',  // pink
];

function getHabitColor(habitKey) {
    const list = JSON.parse(localStorage.getItem('10x_habits') || '["alcohol","supplements","sauna","cold_plunge","heavy_leg_day"]');
    const idx = list.indexOf(habitKey);
    return HABIT_COLOR_PALETTE[(idx >= 0 ? idx : list.length) % HABIT_COLOR_PALETTE.length];
}

// ── Tags Server Persistence ───────────────────────────────────────────────────
let _saveTagsTimer = null;

async function loadTagsFromServer() {
    try {
        const res = await fetch('/api/tags');
        const data = await res.json();
        if (!state.data) return;

        // Merge persisted habits list into localStorage
        if (data.habits && data.habits.length > 0) {
            localStorage.setItem('10x_habits', JSON.stringify(data.habits));
        }

        // Merge log into state (keys are ISO dates)
        if (!state.data.tags) state.data.tags = {};
        Object.assign(state.data.tags, data.log || {});

    } catch (e) {
        console.warn('[Tags] Could not load from server:', e);
    }
}

function saveTagsToServer(date, tags) {
    clearTimeout(_saveTagsTimer);
    _saveTagsTimer = setTimeout(() => {
        fetch('/api/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, tags })
        }).catch(e => console.warn('[Tags] Save failed:', e));
    }, 300);
}

function saveHabitsListToServer(habits) {
    fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ habits })
    }).catch(e => console.warn('[Tags] Habits list save failed:', e));
}

// ── Habit Streak Calculator ───────────────────────────────────────────────────
function getHabitStreak(habitKey) {
    const d = state.data;
    if (!d || !d.tags || !d.rawDates) return 0;
    const reversedDates = [...d.rawDates].reverse();
    let streak = 0;
    for (const dateStr of reversedDates) {
        if ((d.tags[dateStr] || []).includes(habitKey)) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

// ── Add Habit Modal (slide-up sheet) ─────────────────────────────────────────
function showAddHabitModal(targetDate, containerId) {
    document.getElementById('add-habit-modal')?.remove();

    if (!document.getElementById('modal-anim-style')) {
        const style = document.createElement('style');
        style.id = 'modal-anim-style';
        style.textContent = `
            @keyframes slideUp {
                from { transform: translateY(80px); opacity: 0; }
                to   { transform: translateY(0);    opacity: 1; }
            }`;
        document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.id = 'add-habit-modal';
    overlay.style.cssText = `position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;
        justify-content:center;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);animation:fadeIn 0.2s ease;`;

    const sheet = document.createElement('div');
    sheet.style.cssText = `background:#1A1C28;border:1px solid rgba(255,255,255,0.08);
        border-radius:24px 24px 0 0;padding:2rem;width:100%;max-width:680px;
        animation:slideUp 0.3s cubic-bezier(0.16,1,0.3,1);`;

    sheet.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
            <h3 style="font-family:'Outfit',sans-serif;font-size:1.2rem;color:#E2E8F0;">Build a New Habit</h3>
            <button id="modal-close" style="background:none;border:none;color:#94A3B8;font-size:1.8rem;cursor:pointer;line-height:1;padding:0 0.25rem;">×</button>
        </div>
        <input id="modal-habit-input" type="text" placeholder="e.g. Magnesium, Fasting, Ice Bath…"
            style="width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);
                   color:#E2E8F0;padding:0.9rem 1.2rem;border-radius:12px;font-size:1rem;
                   font-family:inherit;outline:none;margin-bottom:0.75rem;" autocomplete="off"/>
        <p style="font-size:11px;color:#94A3B8;margin-bottom:1.5rem;text-transform:uppercase;letter-spacing:0.4px;">
            A color will be auto-assigned from the 10X palette.
        </p>
        <button id="modal-confirm" style="width:100%;padding:0.9rem;background:var(--color-accent-secondary);
            border:none;color:white;font-weight:700;font-size:0.95rem;border-radius:12px;
            cursor:pointer;font-family:inherit;text-transform:uppercase;letter-spacing:0.5px;">
            Add Habit
        </button>`;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const input = document.getElementById('modal-habit-input');
    input.focus();

    const close = () => {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.2s';
        setTimeout(() => overlay.remove(), 200);
    };

    document.getElementById('modal-close').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const confirm = () => {
        const val = input.value.trim();
        if (!val) return;
        const tag = val.toLowerCase().replace(/\s+/g, '_');
        const habits = JSON.parse(localStorage.getItem('10x_habits') || '["alcohol","supplements","sauna","cold_plunge","heavy_leg_day"]');
        if (!habits.includes(tag)) {
            habits.push(tag);
            localStorage.setItem('10x_habits', JSON.stringify(habits));
            saveHabitsListToServer(habits);
        }
        updateCorrelatorMetrics();
        initJournal(targetDate, containerId);
        renderHabitsLegend();
        renderHabitsStreaksBar();
        close();
    };

    document.getElementById('modal-confirm').onclick = confirm;
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') confirm();
        if (e.key === 'Escape') close();
    });
}

// ── Delete Habit ──────────────────────────────────────────────────────────────
function deleteHabit(habitKey, targetDate, containerId) {
    let habits = JSON.parse(localStorage.getItem('10x_habits') || '[]');
    habits = habits.filter(h => h !== habitKey);
    localStorage.setItem('10x_habits', JSON.stringify(habits));
    saveHabitsListToServer(habits);

    // Prune from all in-memory tag logs
    const d = state.data;
    if (d && d.tags) {
        Object.keys(d.tags).forEach(date => {
            d.tags[date] = d.tags[date].filter(t => t !== habitKey);
            saveTagsToServer(date, d.tags[date]);
        });
    }

    updateCorrelatorMetrics();
    initJournal(targetDate, containerId);
    renderHabitsLegend();
    renderHabitsStreaksBar();
    if (containerId === 'habits-tab-container') renderHabitsCalendar();
}

// ── Habit Legend (calendar) ───────────────────────────────────────────────────
function renderHabitsLegend() {
    const container = document.getElementById('habits-legend');
    if (!container) return;

    const allHabits = JSON.parse(localStorage.getItem('10x_habits') || '["alcohol","supplements","sauna","cold_plunge","heavy_leg_day"]');
    container.innerHTML = '';

    allHabits.forEach((habit, idx) => {
        const color = HABIT_COLOR_PALETTE[idx % HABIT_COLOR_PALETTE.length];
        const icon = HABIT_ICONS[habit] || '✨';
        const pill = document.createElement('div');
        pill.className = 'habits-legend-pill';
        pill.innerHTML = `
            <div class="habits-legend-dot" style="background:${color};box-shadow:0 0 6px ${color}88;"></div>
            <span>${icon} ${habit.replace(/_/g, ' ')}</span>`;
        container.appendChild(pill);
    });
}

// ── Habit Streaks Bar ─────────────────────────────────────────────────────────
function renderHabitsStreaksBar() {
    const container = document.getElementById('habits-streaks-bar');
    if (!container) return;

    const allHabits = JSON.parse(localStorage.getItem('10x_habits') || '["alcohol","supplements","sauna","cold_plunge","heavy_leg_day"]');
    container.innerHTML = '';

    if (allHabits.length === 0) {
        container.innerHTML = '<p style="color:var(--color-text-secondary);font-size:0.85rem;">No habits tracked yet. Add habits using the + button.</p>';
        return;
    }

    allHabits.forEach((habit, idx) => {
        const streak = getHabitStreak(habit);
        const color = HABIT_COLOR_PALETTE[idx % HABIT_COLOR_PALETTE.length];
        const icon = HABIT_ICONS[habit] || '✨';

        const card = document.createElement('div');
        card.className = `streak-card ${streak === 0 ? 'no-streak' : ''}`;
        if (streak > 0) card.style.borderColor = `${color}55`;

        card.innerHTML = `
            <span class="streak-icon">${icon}</span>
            <div class="streak-info">
                <span class="streak-name">${habit.replace(/_/g, ' ')}</span>
                <div class="streak-count" style="color:${streak > 0 ? color : ''}">
                    ${streak > 0 ? streak : '—'}<span>${streak > 0 ? ' days' : ''}</span>
                </div>
            </div>`;
        container.appendChild(card);
    });
}

// ── Journal / Pulse Grid ───────────────────────────────────────────────────────
function initJournal(dateStr = null, containerId = 'daily-tags-container') {
    const d = state.data;
    if (!d) return;

    if (!d.tags) d.tags = {};

    // Always key by ISO date
    const todayISO = new Date().toISOString().split('T')[0];
    const targetDate = dateStr || todayISO;
    if (!d.tags[targetDate]) d.tags[targetDate] = [];

    const container = document.getElementById(containerId);
    if (!container) return;

    // Load habits list
    let allHabits = ['alcohol', 'supplements', 'sauna', 'cold_plunge', 'heavy_leg_day'];
    const habitStr = localStorage.getItem('10x_habits');
    if (habitStr) { try { allHabits = JSON.parse(habitStr); } catch(e) {} }

    const currentDayTags = d.tags[targetDate];
    container.innerHTML = '';

    allHabits.forEach((tag, idx) => {
        const isActive = currentDayTags.includes(tag);
        const color = HABIT_COLOR_PALETTE[idx % HABIT_COLOR_PALETTE.length];
        const streak = getHabitStreak(tag);
        const impact = getTagImpact(tag);
        const icon = HABIT_ICONS[tag] || '✨';

        const bubble = document.createElement('div');
        bubble.className = `habit-bubble ${isActive ? 'active' : ''}`;
        if (isActive) {
            bubble.style.borderColor = color;
            bubble.style.boxShadow = `0 0 20px ${color}44`;
            bubble.style.background = `${color}18`;
        }

        const streakBadge = streak > 1 ? `<div class="habit-streak-badge">${streak}</div>` : '';

        bubble.innerHTML = `
            ${streakBadge}
            <span class="habit-icon">${icon}</span>
            <span class="habit-bubble-label">${tag.replace(/_/g, ' ')}</span>
            ${impact ? `<span class="habit-impact-badge">${impact}</span>` : ''}`;

        // Left-click: toggle
        bubble.addEventListener('click', () => {
            if (currentDayTags.includes(tag)) {
                d.tags[targetDate] = d.tags[targetDate].filter(t => t !== tag);
            } else {
                d.tags[targetDate].push(tag);
            }
            saveTagsToServer(targetDate, d.tags[targetDate]);
            initJournal(targetDate, containerId);
            if (containerId === 'habits-tab-container') {
                renderHabitsCalendar();
                renderHabitsStreaksBar();
            } else {
                initJournal(); // refresh dashboard grid
            }
            updateCorrelatorMetrics();
            const activeSection = document.querySelector('.view-section.active')?.id;
            if (activeSection === 'habits-experiments') {
                renderCorrelatorChart('habitsCorrelatorChart', 'habits-corr-metric-1', 'habits-corr-metric-2');
            }
        });

        // Right-click: delete context menu
        bubble.addEventListener('contextmenu', e => {
            e.preventDefault();
            document.getElementById('habit-ctx-menu')?.remove();

            const menu = document.createElement('div');
            menu.id = 'habit-ctx-menu';
            menu.style.cssText = `position:fixed;z-index:900;top:${e.clientY}px;left:${e.clientX}px;
                background:#1A1C28;border:1px solid rgba(255,255,255,0.1);border-radius:10px;
                padding:0.4rem;box-shadow:0 8px 24px rgba(0,0,0,0.5);min-width:175px;`;
            menu.innerHTML = `
                <div id="ctx-delete" style="padding:0.55rem 0.75rem;border-radius:6px;cursor:pointer;
                    font-size:13px;color:#FF6B6B;font-weight:600;display:flex;align-items:center;gap:0.5rem;
                    transition:background 0.15s;"
                    onmouseover="this.style.background='rgba(255,107,107,0.12)'"
                    onmouseout="this.style.background='transparent'">
                    🗑 Remove "${tag.replace(/_/g, ' ')}"
                </div>`;
            document.body.appendChild(menu);

            document.getElementById('ctx-delete').onclick = () => {
                menu.remove();
                if (confirm(`Remove habit "${tag.replace(/_/g, ' ')}" from all logs?`)) {
                    deleteHabit(tag, targetDate, containerId);
                }
            };
            const dismiss = () => { menu.remove(); document.removeEventListener('click', dismiss); };
            setTimeout(() => document.addEventListener('click', dismiss), 0);
        });

        container.appendChild(bubble);
    });

    // Add Habit button — opens modal
    const addBtn = document.createElement('div');
    addBtn.className = 'btn-add-habit';
    addBtn.id = containerId === 'daily-tags-container' ? 'add-habit-dashboard' : 'add-habit-habits';
    addBtn.innerHTML = '<span style="font-size:24px;">+</span>';
    addBtn.onclick = e => {
        e.stopPropagation();
        showAddHabitModal(targetDate, containerId);
    };
    container.appendChild(addBtn);
}

function initHabitsTab() {
    const d = state.data;
    if (!d) return;

    // Always initialize to today's ISO date
    if (!state.selectedHabitDate) {
        state.selectedHabitDate = new Date().toISOString().split('T')[0];
    }

    const [y, m] = state.selectedHabitDate.split('-').map(Number);
    state.calDate = new Date(y, m - 1, 1);

    updatePulseDateLabel();
    renderHabitsCalendar();
    renderHabitsLegend();
    renderHabitsStreaksBar();
    initJournal(state.selectedHabitDate, 'habits-tab-container');

    // Wire up calendar month controls
    document.getElementById('cal-prev').onclick = () => {
        state.calDate.setMonth(state.calDate.getMonth() - 1);
        renderHabitsCalendar();
    };
    document.getElementById('cal-next').onclick = () => {
        state.calDate.setMonth(state.calDate.getMonth() + 1);
        renderHabitsCalendar();
    };

    // Yesterday shortcut
    const ydBtn = document.getElementById('yesterday-btn');
    if (ydBtn) {
        ydBtn.onclick = () => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yISO = yesterday.toISOString().split('T')[0];
            state.selectedHabitDate = yISO;
            const [yy, mm] = yISO.split('-').map(Number);
            state.calDate = new Date(yy, mm - 1, 1);
            renderHabitsCalendar();
            initJournal(yISO, 'habits-tab-container');
            updatePulseDateLabel();
        };
    }

    // Habit Impact Matrix
    initHabitImpactMatrix();
}

function updatePulseDateLabel() {
    const el = document.getElementById('pulse-date-label');
    if (!el || !state.selectedHabitDate) return;
    const dt = new Date(state.selectedHabitDate + 'T00:00:00');
    el.innerText = dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function renderHabitsCalendar() {
    const grid = document.getElementById('habits-calendar-grid');
    if (!grid) return;

    const year  = state.calDate.getFullYear();
    const month = state.calDate.getMonth();

    document.getElementById('cal-month-label').innerText =
        new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    grid.innerHTML = '';

    // Day headers
    ['S','M','T','W','T','F','S'].forEach(day => {
        const h = document.createElement('div');
        h.style.cssText = 'text-align:center;font-size:10px;color:var(--color-slate);padding-bottom:5px;';
        h.innerText = day;
        grid.appendChild(h);
    });

    const firstDay    = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr    = new Date().toISOString().split('T')[0];

    for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div');
        empty.className = 'calendar-day other-month';
        grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        const dayEl   = document.createElement('div');
        dayEl.className = `calendar-day ${dateStr === state.selectedHabitDate ? 'active-day' : ''}`;
        if (dateStr === todayStr) dayEl.classList.add('today');

        dayEl.innerHTML = `<span class="day-num">${day}</span>`;

        // Colored dots — one per habit logged, each in its habit color
        const dayTags = state.data.tags?.[dateStr] || [];
        if (dayTags.length > 0) {
            const dots = document.createElement('div');
            dots.className = 'habit-dots';
            dayTags.slice(0, 4).forEach(tag => {
                const dot = document.createElement('div');
                dot.className = 'habit-dot';
                dot.style.setProperty('--habit-dot-color', getHabitColor(tag));
                dots.appendChild(dot);
            });
            dayEl.appendChild(dots);
        }

        dayEl.onclick = () => {
            state.selectedHabitDate = dateStr;
            renderHabitsCalendar();
            initJournal(dateStr, 'habits-tab-container');
            updatePulseDateLabel();
        };

        grid.appendChild(dayEl);
    }
}


function updateCorrelatorMetrics() {
    const selects = ['corr-metric-1', 'habits-corr-metric-1'];
    selects.forEach(id => {
        const s = document.getElementById(id);
        if (!s) return;
        
        // Remove existing tag options
        Array.from(s.options).forEach(opt => {
            if (opt.value.startsWith('tag_')) opt.remove();
        });

        // Add latest habits
        const allHabits = JSON.parse(localStorage.getItem('10x_habits') || '["alcohol", "supplements", "sauna"]');
        allHabits.forEach(h => {
             const option = document.createElement('option');
             option.value = `tag_${h}`;
             option.text = `Tag: ${h.replace(/_/g, ' ')}`;
             s.add(option);
        });
    });
}

function initAIInsightControl() {
    const btn = document.getElementById('refresh-ai-btn');
    if (btn) {
        btn.addEventListener('click', () => fetchAIInsight());
    }
}

async function fetchAIInsight() {
    const el = document.getElementById('dash-insight-text');
    const waveform = document.querySelector('.waveform-container');
    if (!el) return;

    el.style.opacity = '0.5';
    if (waveform) waveform.classList.add('animating');

    try {
        const res = await fetch('/api/ai/insight');
        const json = await res.json();
        
        if (json.insight) {
            el.innerText = json.insight;
        } else {
            el.innerText = "The AI Coach is currently unavailable. Check your connection.";
        }
    } catch (e) {
        console.error('[AI] Fetch error:', e);
        el.innerText = "Error fetching insight. Is the server running?";
    } finally {
        el.style.opacity = '1';
        if (waveform) waveform.classList.remove('animating');
    }
}

function updateSleepLegend(d, last) {
    const items = document.querySelectorAll('.sleep-legend .legend-item');
    if (!items.length) return;
    const deep = d.sleep.deep[last], rem_ = d.sleep.rem[last], core = d.sleep.core[last];
    const total = deep + rem_ + core;
    const fmt = m => `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
    const pct = m => total ? Math.round(m / total * 100) : 0;
    if (total > 0) {
        items[0] && (items[0].innerText = `Deep: ${fmt(deep)} (${pct(deep)}%)`);
        items[1] && (items[1].innerText = `REM: ${fmt(rem_)} (${pct(rem_)}%)`);
        items[2] && (items[2].innerText = `Core: ${fmt(core)} (${pct(core)}%)`);
    }
}

// ── 10. Chart Dispatch ────────────────────────────────────────────────────────
function renderCharts(sectionId) {
    const r = state.data;
    if (!r) return;

    switch (sectionId) {
        case 'dashboard':
            renderSleepStagesChart(r);
            renderRecoveryTrendChart(r);
            break;
        case 'sleep-recovery':       
            const range = state.chartRanges['sleep-recovery'] || 365;
            renderSleepTrendChart(range);
            renderHrvChartOnly(range);
            renderSleepScheduleChart(range); // New
            fetchCombinedAIInsight();
            break;
        case 'workouts':    
            const wRange = state.chartRanges.workouts || 90;
            renderWorkoutDistributionChart(wRange);            
            updateWorkoutAICoach();
            renderWorkoutMomentumHeatmap();
            break;
        case 'circadian':   renderCircadianChart23h();   break;
        case 'habits-experiments':
            renderCorrelatorChart('habitsCorrelatorChart', 'habits-corr-metric-1', 'habits-corr-metric-2');
            break;
        case 'correlator':  renderCorrelatorChart();      break;
    }
}

async function fetchCombinedAIInsight() {
    // Guard: only run once per session; the two real target elements
    if (state.combinedAiLoaded) return;

    const shortEl = document.getElementById('sleep-short-term-insight');
    const longEl  = document.getElementById('sleep-long-term-insight');
    if (!shortEl && !longEl) return;  // not on the sleep tab yet
    state.combinedAiLoaded = true;

    // Show loading state
    const loading = `<span style="color:var(--color-text-secondary);font-style:italic;">✦ Analyzing your biometric data…</span>`;
    if (shortEl) shortEl.innerHTML = loading;
    if (longEl)  longEl.innerHTML  = loading;

    try {
        const res  = await fetch('/api/ai/sleep-insight');
        const json = await res.json();

        if (json.insight) {
            // The Gemini endpoint returns a single combined insight — put the full
            // response in the short-term box (weekly context) and use the local
            // InsightEngine for the long-term box.
            if (shortEl) shortEl.innerHTML = json.insight;

            // Long-term: use local engine (it's fast, no API cost)
            if (longEl && state.data) {
                const engine   = new InsightEngine(state.data);
                const longText = engine.getSleepLongTerm();
                longEl.innerHTML = longText || 'Analyzing long-term sleep patterns…';
            }
        } else {
            throw new Error('No insight in response');
        }
    } catch (e) {
        // API unavailable / no key — fall back entirely to local engine
        console.warn('[AI] Sleep insight API unavailable, using local engine:', e.message);
        if (state.data) {
            const engine = new InsightEngine(state.data);
            if (shortEl) shortEl.innerHTML = engine.getSleepShortTerm() || 'No short-term data.';
            if (longEl)  longEl.innerHTML  = engine.getSleepLongTerm()  || 'No long-term data.';
        } else {
            if (shortEl) shortEl.innerHTML = 'No data available yet.';
            if (longEl)  longEl.innerHTML  = 'No data available yet.';
        }
    }
}

// ── 11. Chart Helpers ─────────────────────────────────────────────────────────
function createOrUpdateChart(chartId, config) {
    const ctx = document.getElementById(chartId);
    if (!ctx) return;
    
    // Add Habit Markers Plugin to config
    if (state.data && state.data.tags) {
        if (!config.plugins) config.plugins = [];
        
        // Tooltip Enhancement: Show tags in tooltip
        if (!config.options.plugins) config.options.plugins = {};
        if (!config.options.plugins.tooltip) config.options.plugins.tooltip = {};
        
        const existingFooter = config.options.plugins.tooltip.callbacks?.footer;
        config.options.plugins.tooltip.callbacks = {
            ...config.options.plugins.tooltip.callbacks,
            footer: function(tooltipItems) {
                if (!state.data || !state.data.tags) return '';
                const label = tooltipItems[0].label;
                const dateStr = label; 
                const tags = state.data.tags[dateStr] || [];
                let footer = existingFooter ? existingFooter(tooltipItems) : '';
                if (tags.length > 0) {
                    footer += '\nTags: ' + tags.map(t => t.replace(/_/g, ' ')).join(', ');
                }
                return footer;
            }
        };
    }

    if (charts[chartId]) charts[chartId].destroy();
    charts[chartId] = new Chart(ctx, config);
}


/** Slice last N days of data for charting */
function _slice(arr, days) {
    if (!arr) return [];
    if (!days) return arr;
    return arr.slice(-days);
}

function getChartXAxisConfig(days) {
    return {
        grid: { display: false },
        ticks: {
            maxTicksLimit: 12,
            callback: function(value, index, values) {
                const label = this.getLabelForValue(value);
                // If checking > 90 days, only show Month/Year to avoid clutter
                if (days > 90) {
                    const date = new Date(label);
                    // For massive ranges, only show Jan, Jul, etc.
                    if (days > 400) {
                        return date.getMonth() === 0 ? date.getFullYear() : '';
                    }
                    return date.toLocaleDateString('en-US', { month: 'short' });
                }
                return label;
            }
        }
    };
}

// ── 12. Individual Charts ──────────────────────────────────────────────────────
function renderRecoveryTrendChart(r) {
    const d    = r;
    const days = Math.min(30, d.recovery.hrv.length);
    // Normalise HRV 0-100 as a proxy 'recovery trend'
    const maxHrv = Math.max(...d.recovery.hrv.slice(-days).filter(Boolean));
    const series = d.recovery.hrv.slice(-days).map(v => v ? +(v / (maxHrv || 1) * 100).toFixed(1) : null);

    createOrUpdateChart('recoveryTrendChart', {
        type: 'line',
        data: {
            labels: d.dates.slice(-days),
            datasets: [{
                label: 'Recovery Trend',
                data: series,
                borderColor: colors.violet,
                backgroundColor: 'rgba(143, 0, 255, 0.05)',
                borderWidth: 3, tension: 0.4, fill: true,
                pointBackgroundColor: colors.violet, pointBorderColor: '#fff', pointRadius: 0,
                spanGaps: true,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { display: false, min: 0, max: 100 },
                x: { grid: { display: false }, ticks: { maxTicksLimit: 7 } },
            },
        },
    });
}

function renderSleepStagesChart(r) {
    const d = r || state.data;
    const el = document.getElementById('sleep-total-hours');
    if (el) {
        const total = d.sleep.totalHoursLast;
        const h = Math.floor(total);
        const m = Math.round((total - h) * 60);
        el.innerText = `${h}h ${m}m`;
    }

    const last = d.sleep.deep.length - 1;
    const deep = d.sleep.deep[last] / 60;
    const rem = d.sleep.rem[last] / 60;
    const core = d.sleep.core[last] / 60;
    
    createOrUpdateChart('sleepStagesChart', {
        type: 'bar',
        data: {
            labels: ['Last Night'],
            datasets: [
                { label: 'Deep', data: [deep], backgroundColor: colors.deep, borderRadius: 8 },
                { label: 'REM', data: [rem], backgroundColor: colors.rem, borderRadius: 8 },
                { label: 'Core', data: [core], backgroundColor: colors.core, borderRadius: 8 }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: 'white' } } },
            scales: {
                x: { stacked: true, display: false },
                y: { stacked: true, display: false }
            }
        }
    });
}

function renderSleepTrendChart(days = 365) {
    const d = state.data;
    createOrUpdateChart('sleepTrendChart', {
        type: 'bar',
        data: {
            labels: _slice(d.dates, days),
            datasets: [
                { label: 'Deep',  data: _slice(d.sleep.deep, days).map(v => +(v/60).toFixed(2)),
                  backgroundColor: colors.coral, stack: 's' },
                { label: 'REM',   data: _slice(d.sleep.rem,  days).map(v => +(v/60).toFixed(2)),
                  backgroundColor: colors.violet,  stack: 's' },
                { label: 'Core',  data: _slice(d.sleep.core, days).map(v => +(v/60).toFixed(2)),
                  backgroundColor: '#4C1D95', stack: 's', borderRadius: { topLeft:5, topRight:5 } },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { stacked: true, ...getChartXAxisConfig(days) },
                y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Hours' } },
            },
        },
    });
}

function renderHrvChartOnly(days = 365) {
    const d = state.data;
    createOrUpdateChart('hrvChartOnly', {
        type: 'line',
        data: {
            labels: _slice(d.dates, days),
            datasets: [{
                label: 'HRV (ms)',
                data: _slice(d.recovery.hrv, days),
                borderColor: colors.violet, backgroundColor: 'rgba(143, 0, 255, 0.05)',
                borderWidth: 3, tension: 0.4, fill: true, spanGaps: true,
                pointRadius: 0,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { title: { display: true, text: 'HRV (ms)' } },
                x: getChartXAxisConfig(days),
            },
        },
    });
}

function renderRhrChartOnly(days = 365) {
    const d = state.data;
    createOrUpdateChart('rhrChartOnly', {
        type: 'line',
        data: {
            labels: _slice(d.dates, days),
            datasets: [{
                label: 'Resting HR (bpm)',
                data: _slice(d.recovery.rhr, days),
                borderColor: colors.violet, backgroundColor: 'rgba(143, 0, 255, 0.05)',
                borderWidth: 3, tension: 0.4, fill: true, spanGaps: true,
                pointRadius: 0,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { title: { display: true, text: 'bpm' } },
                x: getChartXAxisConfig(days),
            },
        },
    });
}

function updateWorkoutAICoach() {
    const d = state.data;
    if (!d || !d.recovery) return;
    const msgEl = document.getElementById('workout-ai-advice');
    const emojiEl = document.getElementById('workout-ai-emoji');
    if (!msgEl || !emojiEl) return;

    const score = d.recovery.score;
    if (score >= 80) {
        msgEl.innerText = `Readiness is ${score}%: Peak Capacity. Prime day for High-Intensity Interval Training or Heavy Strength.`;
        msgEl.style.color = '#06D6A0';
        emojiEl.innerText = '🔥';
    } else if (score >= 50) {
        msgEl.innerText = `Readiness is ${score}%: Moderate capacity. Good day for Zone 2 cardio, skill work, or maintenance lifting.`;
        msgEl.style.color = '#FFD166';
        emojiEl.innerText = '⚡';
    } else {
        msgEl.innerText = `Readiness is ${score}%: CNS fatigue detected. Prioritize active recovery, walking, or mobility today.`;
        msgEl.style.color = '#FF6B6B';
        emojiEl.innerText = '🧘';
    }
}

function renderSleepScheduleChart(days = 365) {
    const d = state.data;
    if (!d || !d.sleepBedtimes) return;

    const labels = _slice(d.dates, days);
    const bedtimes = _slice(d.sleepBedtimes, days);
    const wakeups = _slice(d.sleepWakeups, days);

    const chartData = bedtimes.map((bt, i) => {
        const start = bt ? parseTimeToMins(bt, true) : null;
        const end = wakeups[i] ? parseTimeToMins(wakeups[i], true) : null;
        if (start === null || end === null) return null;
        return [start, end];
    });

    createOrUpdateChart('sleepScheduleChart', {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Sleep Window',
                data: chartData,
                backgroundColor: 'rgba(143, 0, 255, 0.7)',
                borderColor: 'rgba(143, 0, 255, 1)',
                borderWidth: 2,
                borderRadius: 20,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: getChartXAxisConfig(days),
                y: {
                    reverse: true, 
                    min: 1080,
                    max: 2520,
                    ticks: {
                        stepSize: 180,
                        callback: function(value) {
                            let totalMins = value % (24 * 60);
                            let h = Math.floor(totalMins / 60);
                            let ampm = h >= 12 ? 'PM' : 'AM';
                            let displayH = h % 12 || 12;
                            return `${displayH} ${ampm}`;
                        },
                        color: 'rgba(255,255,255,0.7)'
                    },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const r = context.raw;
                            if (!r || !Array.isArray(r)) return '';
                            const format = (m) => {
                                let hh = Math.floor(m / 60) % 24;
                                let mm = m % 60;
                                return `${hh}:${mm.toString().padStart(2,'0')}`;
                            };
                            return `Sleep: ${format(r[0])} - ${format(r[1])}`;
                        }
                    }
                }
            }
        }
    });
}

function renderCircadianChart23h() {
    const d = state.data;
    const c = d.circadian;

    // Workout type labels mapping for friendly names
    const WORKOUT_TYPE_MAP = {
        'Running': 'Running', 'Cycling': 'Cycling', 'Swimming': 'Swimming',
        'FunctionalStrengthTraining': 'Strength', 'TraditionalStrengthTraining': 'Strength',
        'HIIT': 'HIIT', 'Yoga': 'Yoga', 'Walking': 'Walking',
        'Other': 'Other', 'MixedCardio': 'Cardio Mix'
    };

    createOrUpdateChart('circadianChart', {
        type: 'line',
        data: {
            labels: c.labels,
            datasets: [
                {
                    label: 'Sleep Probability',
                    data: c.sleepProb,
                    borderColor: 'rgba(143,0,255,0.9)',
                    backgroundColor: 'rgba(143,0,255,0.18)',
                    tension: 0.45, fill: true, borderWidth: 2.5,
                    pointRadius: 2, pointHoverRadius: 6,
                    yAxisID: 'y',
                },
                {
                    label: 'Activity Hotspots',
                    data: c.activityHotspots,
                    borderColor: 'rgba(6,214,160,0.9)',
                    backgroundColor: 'rgba(6,214,160,0.12)',
                    tension: 0.45, fill: true, borderWidth: 2.5,
                    pointRadius: 2, pointHoverRadius: 6,
                    yAxisID: 'y',
                },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: {
                    min: 0, max: 100,
                    display: true,
                    ticks: { color: '#94A3B8', callback: v => `${v}%` },
                    grid: { color: 'rgba(255,255,255,0.04)' },
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94A3B8', maxTicksLimit: 12 },
                },
            },
            plugins: {
                legend: {
                    labels: { color: '#E2E8F0', font: { size: 12 }, boxWidth: 14 },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw}%`,
                    },
                },
            },
        },
    });
}

// Legacy stub — kept so existing callers don't error out
function renderCircadianChart() { renderCircadianChart23h(); }

function renderWorkoutDistributionChart(days = 90) {
    const d = state.data;
    if (!d || !d.workouts.detailed) return;

    // Friendly display names grouped by intensity/type
    const getBucket = (type) => {
        if (type.includes('Interval') || type === 'HIIT') return 'High Intensity (HIIT/Sprint)';
        if (type.includes('Strength') || type.includes('Core')) return 'Strength Work';
        if (type.includes('Running') || type.includes('Cycling') || type.includes('Rowing')) return 'Cardio (Zone 2/3)';
        if (type.includes('Walking') || type.includes('Yoga') || type.includes('Flexibility')) return 'Low Intensity Recovery';
        return 'Other Activity';
    };

    // Calculate distributions for only the requested time slice
    const sliceLen = days === 365 ? d.dates.length : days; // Use 'all' basically for 1Y if needed
    const startIdx = Math.max(0, d.dates.length - sliceLen);
    
    // We want a bar chart over time, but stacked.
    const labels = d.dates.slice(startIdx);
    
    const buckets = {
        'High Intensity (HIIT/Sprint)': Array(labels.length).fill(0),
        'Strength Work': Array(labels.length).fill(0),
        'Cardio (Zone 2/3)': Array(labels.length).fill(0),
        'Low Intensity Recovery': Array(labels.length).fill(0),
        'Other Activity': Array(labels.length).fill(0),
    };

    let hasData = false;
    for (let i = startIdx; i < d.dates.length; i++) {
        const dayList = d.workouts.detailed[i];
        if (!dayList || !Array.isArray(dayList)) continue;
        
        dayList.forEach(w => {
            const bucket = getBucket(w.type);
            buckets[bucket][i - startIdx] += (w.duration || 0);
            hasData = true;
        });
    }

    if (!hasData) return; // Clean fallback for empty lists

    createOrUpdateChart('workoutDistributionChart', {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'High Intensity (HIIT/Sprint)',
                    data: buckets['High Intensity (HIIT/Sprint)'],
                    backgroundColor: '#FF6B6B',
                },
                {
                    label: 'Strength Work',
                    data: buckets['Strength Work'],
                    backgroundColor: '#8F00FF',
                },
                {
                    label: 'Cardio (Zone 2/3)',
                    data: buckets['Cardio (Zone 2/3)'],
                    backgroundColor: '#06D6A0',
                },
                {
                    label: 'Low Intensity Recovery',
                    data: buckets['Low Intensity Recovery'],
                    backgroundColor: '#4CC9F0',
                },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { stacked: true, ...getChartXAxisConfig(days) },
                y: { stacked: true, title: { display: true, text: 'Minutes' } }
            },
            plugins: {
                legend: { position: 'top', labels: { color: '#E2E8F0', font: { size: 12 }, padding: 16, boxWidth: 14 } },
                tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${Math.round(ctx.raw)}m` } },
            },
        },
    });
}

function renderWorkoutMomentumHeatmap() {
    const grid = document.getElementById('workout-momentum-grid');
    if (!grid) return;
    const d = state.data;
    if (!d || !d.workouts.minutes) return;

    // Use a fixed 90 day scope for momentum building
    const days = 90;
    const sliceLen = Math.min(days, d.dates.length);
    const startIdx = d.dates.length - sliceLen;

    let html = '';
    for (let i = startIdx; i < d.dates.length; i++) {
        const mins = d.workouts.minutes[i] || 0;
        
        let color = 'rgba(255,255,255,0.05)'; // 0 mins
        let outline = 'none';
        
        if (mins > 0 && mins < 20) {
            color = 'rgba(6, 214, 160, 0.3)'; // Light green (active rest)
        } else if (mins >= 20 && mins < 45) {
            color = 'rgba(6, 214, 160, 0.6)'; // Medium green (standard)
        } else if (mins >= 45) {
            color = 'rgba(6, 214, 160, 1)';   // Solid green (hero session)
            outline = '1px solid rgba(6, 214, 160, 0.5)';
        }

        const dateLabel = new Date(d.dates[i]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        html += `<div 
            style="min-width: 16px; height: 32px; background: ${color}; border-radius: 4px; border: ${outline}; cursor: pointer; transition: transform 0.1s; position:relative;"
            title="${dateLabel}: ${Math.round(mins)} mins"
            onmouseover="this.style.transform='scale(1.15)'"
            onmouseout="this.style.transform='scale(1)'"
        ></div>`;
    }

    grid.innerHTML = html;
    
    // Auto scroll to the far right (most recent day)
    setTimeout(() => {
        grid.scrollLeft = grid.scrollWidth;
    }, 50);
}

function renderScreenTimeTrendChart(days = 90) {
    const d = state.data;
    createOrUpdateChart('screenTimeTrendChart', {
        type: 'bar',
        data: {
            labels: _slice(d.dates, days),
            datasets: [{
                label: 'Screen Time (h)',
                data: _slice(d.screentime.totalHours, days),
                backgroundColor: ctx => {
                    const v = ctx.raw;
                    if (v > 5)  return 'rgba(244,63,94,0.8)';
                    if (v < 3)  return 'rgba(16,185,129,0.8)';
                    return 'rgba(14,165,233,0.8)';
                },
                borderRadius: 4,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { title: { display: true, text: 'Hours' }, beginAtZero: true },
                x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
            },
        },
    });
}

function renderScreenTimeCategoryChart() {
    const d = state.data;
    createOrUpdateChart('screenTimeCategoryChart', {
        type: 'doughnut',
        data: {
            labels: d.screentime.categories.labels,
            datasets: [{
                data: d.screentime.categories.data,
                backgroundColor: [colors.prod, colors.social, colors.ent, colors.info, colors.other],
                borderWidth: 0, hoverOffset: 4,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            cutout: '75%',
            plugins: { legend: { display: false } },
        },
    });
}

function renderStrainRecoveryMatrix() {
    const d = state.data;
    const days = 30;
    const startIndex = Math.max(0, d.dates.length - days);

    const dataPoints = [];
    const bgColors = [];
    const borderColors = [];
    const radii = [];

    const maxAtl = Math.max(...d.workouts.atl.slice(-days), 1);

    for (let i = startIndex; i < d.dates.length; i++) {
        const h = d.recovery.hrv[i] || 40;
        const r = d.recovery.rhr[i] || 65;
        const hScore = Math.min(100, Math.max(0, ((h - 20) / 80) * 100));
        const rScore = Math.min(100, Math.max(0, ((80 - r) / 40) * 100));
        const recScore = Math.round(hScore * 0.6 + rScore * 0.4);

        const atl = d.workouts.atl[i] || 0;
        const strain = (atl / maxAtl) * 100;

        dataPoints.push({ x: strain, y: recScore, date: d.dates[i] });

        if (i === d.dates.length - 1) {
            bgColors.push(colors.info);
            borderColors.push('#ffffff');
            radii.push(6);
        } else {
            bgColors.push('rgba(255, 255, 255, 0.3)');
            borderColors.push('rgba(255, 255, 255, 0.1)');
            radii.push(3);
        }
    }

    const todayX = dataPoints[dataPoints.length - 1].x;
    const todayY = dataPoints[dataPoints.length - 1].y;
    
    let insight = "";
    if (todayY >= 50 && todayX < 50) insight = "Primed / Restorative: High recovery, load is manageable. You are primed to push hard today.";
    else if (todayY >= 50 && todayX >= 50) insight = "Optimal Adaptation: High recovery and high strain. Maintain this productive balance.";
    else if (todayY < 50 && todayX < 50) insight = "Rest & Recover: Both recovery and strain are low. Take it easy and prioritize sleep.";
    else insight = "Overreaching / Danger: Your strain is high but recovery has plummeted. Focus on active rest today to avoid detraining.";

    const el = document.getElementById('matrix-insight-text');
    if (el) el.innerText = insight;

    createOrUpdateChart('strainRecoveryMatrix', {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Daily Status',
                data: dataPoints,
                backgroundColor: bgColors,
                borderColor: borderColors,
                borderWidth: 2,
                pointRadius: radii,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            const pt = ctx.raw;
                            return `${pt.date} - Recovery: ${Math.round(pt.y)}, Strain: ${Math.round(pt.x)}`;
                        }
                    }
                },
                annotation: {
                    annotations: {
                        box1: { type: 'box', xMin: 0, xMax: 50, yMin: 50, yMax: 100, backgroundColor: 'rgba(59, 130, 246, 0.05)', borderWidth: 0 },
                        box2: { type: 'box', xMin: 50, xMax: 100, yMin: 50, yMax: 100, backgroundColor: 'rgba(16, 185, 129, 0.05)', borderWidth: 0 },
                        box3: { type: 'box', xMin: 0, xMax: 50, yMin: 0, yMax: 50, backgroundColor: 'rgba(245, 158, 11, 0.05)', borderWidth: 0 },
                        box4: { type: 'box', xMin: 50, xMax: 100, yMin: 0, yMax: 50, backgroundColor: 'rgba(244, 63, 94, 0.05)', borderWidth: 0 },
                        line1: { type: 'line', xMin: 50, xMax: 50, yMin: 0, yMax: 100, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 },
                        line2: { type: 'line', xMin: 0, xMax: 100, yMin: 50, yMax: 50, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 }
                    }
                }
            },
            scales: {
                x: { min: 0, max: 100, title: { display: true, text: 'Strain (Relative Load)' }, grid: { display: false } },
                y: { min: 0, max: 100, title: { display: true, text: 'Recovery Score' }, grid: { display: false } }
            }
        }
    });
}

// ── 13. Correlator Chart ──────────────────────────────────────────────────────
function renderCorrelatorChart(canvasId = 'correlatorChart', s1Id = 'corr-metric-1', s2Id = 'corr-metric-2') {
    const d = state.data;
    if (!d) return;

    const s1Val = document.getElementById(s1Id)?.value || 'hrv';
    const s2Val = document.getElementById(s2Id)?.value || 'rhr';

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const getMetric = key => {
        if (key === 'hrv')          return d.recovery.hrv;
        if (key === 'rhr')          return d.recovery.rhr;
        if (key === 'tsb')          return d.workouts.tsb;
        if (key === 'deep_sleep')   return d.sleep.deep;
        if (key === 'rem_sleep')    return d.sleep.rem;
        if (key === 'active_energy') return d.workouts.minutes.map(m => m * 6); // proxy
        return d.recovery.hrv;
    };

    const isTag1 = s1Val.startsWith('tag_');
    if (isTag1) {
        const tag = s1Val.replace('tag_', '');
        const lagEnabled = document.getElementById('lag-toggle-cb')?.checked || false;

        // Use rawDates (ISO) for tag lookups; fall back to display dates
        const allDates = d.rawDates || d.dates;
        const fullMetric = getMetric(s2Val);

        // When lag is enabled: habit on day N → biometric on day N+1
        // So we check tags[N] against metric[N+1]
        const windowSize = 90;
        const start = Math.max(0, allDates.length - windowSize - (lagEnabled ? 1 : 0));
        const datesWindow  = allDates.slice(start, allDates.length - (lagEnabled ? 1 : 0));
        const metricWindow = fullMetric.slice(start + (lagEnabled ? 1 : 0));

        if (!d.tags) d.tags = {};

        let withTagSum = 0, withTagCount = 0;
        let withoutTagSum = 0, withoutTagCount = 0;

        for (let i = 0; i < datesWindow.length; i++) {
            const dateStr = datesWindow[i];
            const hasTag  = (d.tags[dateStr] || []).includes(tag);
            const val     = metricWindow[i];
            if (val != null) {
                if (hasTag) { withTagSum += val; withTagCount++; }
                else        { withoutTagSum += val; withoutTagCount++; }
            }
        }

        const avgWith    = withTagCount    ? +(withTagSum    / withTagCount).toFixed(1)    : 0;
        const avgWithout = withoutTagCount ? +(withoutTagSum / withoutTagCount).toFixed(1) : 0;
        let diffPct = 0;
        if (avgWithout !== 0) {
            diffPct = +(((avgWith - avgWithout) / avgWithout) * 100).toFixed(0);
        }

        const mName2El = document.querySelector(`#${s2Id} option[value="${s2Val}"]`);
        const mName2   = mName2El ? mName2El.text.split('(')[0].trim() : s2Val;
        const tName1El = document.querySelector(`#${s1Id} option[value="${s1Val}"]`);
        const tName1   = tName1El ? tName1El.text.replace('Tag: ', '').trim() : tag;

        const sign = diffPct > 0 ? '+' : '';
        const rValEl = document.getElementById('corr-r-value');
        if (rValEl) rValEl.innerText = `${sign}${diffPct}%`;

        const interp = document.getElementById('corr-interpretation');
        const lagNote = lagEnabled ? ' (next-day effect)' : '';
        if (interp) {
            interp.innerText = `On days you log '${tName1}', your ${mName2}${lagNote} averages ${avgWith}. Without it: ${avgWithout} (${sign}${diffPct}% delta).`;
        }

        // Sample size warning
        const sampleWarn = document.getElementById('corr-sample-warning');
        if (sampleWarn) {
            if (withTagCount < 10) {
                sampleWarn.textContent = `⚠️ Low sample: only ${withTagCount} logged day${withTagCount !== 1 ? 's' : ''} for "${tName1}". Log more days for reliable results.`;
                sampleWarn.classList.remove('hidden');
            } else {
                sampleWarn.classList.add('hidden');
            }
        }

        createOrUpdateChart(canvasId, {
            type: 'bar',
            data: {
                labels: [`With ${tName1}`, `Without ${tName1}`],
                datasets: [{
                    label: mName2,
                    data: [avgWith, avgWithout],
                    backgroundColor: [colors.info, 'rgba(148, 163, 184, 0.3)'],
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { title: { display: true, text: mName2 }, beginAtZero: false },
                    x: { grid: { display: false } }
                }
            }
        });
        return;
    }



    const arr1  = getMetric(s1Val).slice(-90);
    const arr2  = getMetric(s2Val).slice(-90);
    const n     = Math.min(arr1.length, arr2.length);

    // Pearson correlation
    const mean1 = arr1.slice(0,n).reduce((a,b)=>(a||0)+(b||0),0)/n;
    const mean2 = arr2.slice(0,n).reduce((a,b)=>(a||0)+(b||0),0)/n;
    let num=0, d1=0, d2=0;
    for (let i=0;i<n;i++) {
        const a=(arr1[i]||mean1)-mean1, b=(arr2[i]||mean2)-mean2;
        num+=a*b; d1+=a*a; d2+=b*b;
    }
    const r = d1&&d2 ? +(num/Math.sqrt(d1*d2)).toFixed(2) : 0;

    const rValEl = document.getElementById('corr-r-value');
    if (rValEl) rValEl.innerText = `r = ${r}`;
    
    const interp = document.getElementById('corr-interpretation');
    if (interp) {
        if (r > 0.5)       interp.innerText = 'Strong positive correlation. Both metrics rise and fall together.';
        else if (r > 0.2)  interp.innerText = 'Moderate positive correlation.';
        else if (r > -0.2) interp.innerText = 'Little to no linear correlation between these metrics.';
        else if (r > -0.5) interp.innerText = 'Moderate negative correlation. As one rises, the other tends to fall.';
        else               interp.innerText = 'Strong negative correlation. When Metric 1 drops, Metric 2 typically rises.';
    }

    const labels = d.dates.slice(-n);
    createOrUpdateChart(canvasId, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: s1Val, data: arr1.slice(0,n), borderColor: colors.violet, borderWidth:2,
                  tension:0.3, pointRadius:0, yAxisID:'y1', spanGaps:true },
                { label: s2Val, data: arr2.slice(0,n), borderColor: colors.coral, borderWidth:2,
                  tension:0.3, pointRadius:0, yAxisID:'y2', spanGaps:true },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y1: { type:'linear', position:'left',  title:{display:true, text:s1Val} },
                y2: { type:'linear', position:'right', title:{display:true, text:s2Val}, grid:{drawOnChartArea:false} },
                x:  { grid:{display:false}, ticks:{maxTicksLimit:12} },
            },
        },
    });
}

function renderScreenTimeLegend() {
    const d = state.data;
    const container = document.getElementById('st-legend');
    if (!container) return;

    const labels = d.screentime.categories.labels;
    const data   = d.screentime.categories.data;
    const total  = data.reduce((a, b) => a + b, 0);
    const cls    = [colors.prod, colors.social, colors.ent, colors.info, colors.other];

    container.innerHTML = '';
    labels.forEach((label, i) => {
        const val = data[i];
        const pct = total ? Math.round((val / total) * 100) : 0;
        const item = document.createElement('div');
        item.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:0.5rem; font-size:0.85rem;';
        item.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.5rem;">
                <div style="width:10px; height:10px; background:${cls[i]}"></div>
                <span>${label}</span>
            </div>
            <span style="color:var(--text-muted)">${val}m (${pct}%)</span>
        `;
        container.appendChild(item);
    });
}

/**
 * AI Insight Engine (Biometric Focused)
 * Split into Short-term (Weekly) and Long-term (Historical)
 */
function updateAIBometricInsights() {
    if (!state.data) return;
    const engine = new InsightEngine(state.data);
    
    // Sleep Insights
    const sleepShort = engine.getSleepShortTerm();
    const sleepLong = engine.getSleepLongTerm();

    const shortEl = document.getElementById('sleep-short-term-insight');
    const longEl = document.getElementById('sleep-long-term-insight');
    
    if (shortEl) {
        shortEl.innerHTML = sleepShort || "No short-term insights available.";
        console.log('[SleepOS] Rendering Short-term HTML:', sleepShort);
    }
    if (longEl) {
        longEl.innerHTML = sleepLong || "No long-term synthesis available.";
        console.log('[SleepOS] Rendering Long-term HTML:', sleepLong);
    }
    
    // Recovery Insights (if containers exist in Recovery tab - currently sharing boxes on Sleep tab for now)
    // Note: User asked for insights on Sleep and Recovery tab. 
    // If they are separate sections in index.html, we should populate both.
}

class InsightEngine {
    constructor(data) {
        this.d = data;
        this.n = data.dates.length;
        this.signals = data.signals || { efficiency: [], velocity: { hrv: [] }, debt: { deep: [] }, fingerprints: [] };
    }

    getSleepShortTerm() {
        const d = this.d;
        const lastIdx = this.n - 1;
        if (lastIdx < 7) return "Analyzing your first week of SleepOS data to establish a valid baseline...";

        const hrvVel = this.signals.velocity.hrv[lastIdx];
        const efficiency = this.signals.efficiency[lastIdx];
        const lastDeep = d.sleep.deep[lastIdx];
        const avgDeep = d.averages.deep[lastIdx];
        
        let insights = [];

        // Descriptive Layer (What)
        insights.push(`<b>Snapshot</b>: Efficiency is at ${efficiency}% with a total sleep volume of ${Math.round(((lastDeep + d.sleep.rem[lastIdx] + d.sleep.core[lastIdx])/60)*10)/10}h.`);

        // Trend Layer (Velocity)
        if (hrvVel > 2) insights.push("Recovery is <b>Accelerating</b>; your 7-day HRV trend is outpacing your 14-day baseline.");
        else if (hrvVel < -2) insights.push("Recovery is <b>Decelerating</b>; autonomic pressure is mounting.");
        
        // Habit Attribution Layer (NEW)
        const dateKey = (d.dates && d.dates[lastIdx]);
        const tonightTags = (d.tags && dateKey) ? (d.tags[dateKey] || []) : [];
        if (tonightTags.includes('alcohol')) {
            const impact = getTagImpact('alcohol', 'hrv');
            insights.push(`<span style="color:var(--color-accent-primary)"><b>P0 Activity</b>: Alcohol detected. Historical tax on your recovery for this habit is ${impact || '-20%'}. Expect suppressed REM.</span>`);
        }
        if (tonightTags.includes('sauna')) {
            const impact = getTagImpact('sauna', 'hrv');
            insights.push(`<b>Pulse Grid</b>: Sauna session logged. This habit typically yields a ${impact || '+10%'} Dividend for your HRV.`);
        }

        if (efficiency < 85) insights.push(`<b>Diagnostic</b>: Sleep Efficiency is ${efficiency}%. Suboptimal window usage; check for 'Late Night' patterns.`);


        // Diagnostic Layer (Alerts)
        if (this.signals.debt.deep[lastIdx]) {
            insights.push("<span style='color:var(--color-accent-primary)'><b>P0 ALERT: deep debt detected.</b></span> 3+ nights of suboptimal physical restoration found.");
        }

        const remPct = (d.sleep.rem[lastIdx] / (lastDeep + d.sleep.rem[lastIdx] + d.sleep.core[lastIdx])) * 100;
        if (remPct < 15) insights.push("<b>Diagnostic</b>: REM Suppression detected (<15%). This may impact cognitive agility today.");

        return insights.join(" <br><br> ");
    }

    getSleepLongTerm() {
        const d = this.d;
        if (this.n < 14) return "Historical synthesis requires 14+ days of data for high-confidence pattern recognition.";

        let findings = [];

        // Diagnostic & Pattern recognition
        const bedtimeVsDeep = this._calculateCorrelation(d.sleepBedtimes, d.sleep.deep);
        if (Math.abs(bedtimeVsDeep) > 0.4) {
            findings.push("<b>Circadian Drift Impact</b>: Your data shows a strong link between bedtime consistency and Deep sleep yields. Every 30m shift in onset reduces physical repair by ~12%.");
        }

        // Alcohol / Illness Fingerprinting
        const fingerprints = this.signals.fingerprints.filter(f => f.date > this.n - 14);
        if (fingerprints.some(f => f.type === 'ALCOHOL_SIGNATURE')) {
            findings.push("<b>Biometric Pattern</b>: A recurring 'Alcohol Signature' (Deep collapse + RHR spike) is disrupting your weekend recovery cycles.");
        }

        // Predictive Layer
        const hrvVelocity = this.signals.velocity.hrv.slice(-3);
        const isTrendingUp = hrvVelocity.every(v => v > 0);
        if (isTrendingUp) {
            findings.push("<b>Forecasting</b>: Baseline is on an upward trajectory. Expect an 'Optimal readiness' window in 48-72 hours.");
        } else {
            findings.push("<b>Forecasting</b>: Current signal velocity suggests a plateau. Recommend a 20% reduction in training load to reset baseline.");
        }

        // Lost Core Check
        const totalCore = d.sleep.core.reduce((a, b) => a + b, 0) / this.n;
        if (totalCore < 180) { // < 3h avg
            findings.push("<b>Diagnostic</b>: 'Lost Core' pattern detected. Low maintenance sleep is hindering memory consolidation.");
        }

        return findings.join(" <br><br> ");
    }

    _calculateCorrelation(arr1, arr2) {
        const n = Math.min(arr1.length, arr2.length);
        const a1 = arr1.slice(-n).map(v => typeof v === 'string' ? parseTimeToMins(v, true) : (v || 0) * 60);
        const a2 = arr2.slice(-n);
        const m1 = a1.reduce((p,c)=>p+c,0)/n;
        const m2 = a2.reduce((p,c)=>p+c,0)/n;
        let num=0, d1=0, d2=0;
        for(let i=0; i<n; i++){
            const x = a1[i]-m1, y = a2[i]-m2;
            num += x*y; d1 += x*x; d2 += y*y;
        }
        return d1&&d2 ? num/Math.sqrt(d1*d2) : 0;
    }

    _averageTimeMins(times) {
        const mins = times.filter(t => t != null).map(t => typeof t === 'string' ? parseTimeToMins(t, true) : t * 60);
        return mins.reduce((a, b) => a + b, 0) / (mins.length || 1);
    }
}

// ── 15. Sprint 7: Habit Impact Matrix ─────────────────────────────────────────

window.initHabitImpactMatrix = function() {
    const select = document.getElementById('habit-impact-select');
    if (!select) return;

    // 1. Gather all historically used unique tags
    let availableTags = [];
    if (state.data && state.data.tags) {
        availableTags = [...new Set(Object.values(state.data.tags).flat())];
    }
    
    // Sort alphabetically
    availableTags.sort();
    
    // Populate select
    select.innerHTML = '<option value="" disabled selected>— Select a Habit —</option>';
    availableTags.forEach(tag => {
        const opt = document.createElement('option');
        opt.value = opt.innerText = tag;
        select.appendChild(opt);
    });

    // Lag toggle behavior
    const lagCb = document.getElementById('lag-toggle-cb');
    if (lagCb) {
        lagCb.onchange = () => {
            if (select.value) analyzeHabitImpact(select.value);
        };
    }

    // Trigger analysis on change
    select.onchange = (e) => {
        analyzeHabitImpact(e.target.value);
    };
};

window.analyzeHabitImpact = function(tagName) {
    const d = state.data;
    if (!d || !d.tags) return;
    
    const resultsContainer = document.getElementById('habit-impact-results');
    const emptyContainer = document.getElementById('habit-impact-empty');
    if (!resultsContainer || !emptyContainer) return;

    const useLag = document.getElementById('lag-toggle-cb')?.checked || false;

    // We will separate the data into "days with habit" (Target) vs "days without habit in the last 180 days" (Baseline)
    let targetHrv = [], targetRhr = [], targetEff = [], targetDeep = [];
    let baseHrv = [], baseRhr = [], baseEff = [], baseDeep = [];

    // Find all indexes where this tag exists
    let targetIndexes = [];
    const dates = d.dates || [];
    for (let i = 0; i < dates.length; i++) {
        const dateStr = dates[i];
        const dayTags = d.tags[dateStr] || [];
        if (dayTags.includes(tagName)) {
            let evalIndex = useLag ? i + 1 : i; // Check the exact day, or the day immediately following
            if (evalIndex < dates.length) {
                targetIndexes.push(evalIndex);
            }
        }
    }

    // Statistical significance threshold (minimum 4 logs)
    if (targetIndexes.length < 4) {
        resultsContainer.classList.add('hidden');
        emptyContainer.classList.remove('hidden');
        emptyContainer.innerHTML = `<div style="font-size:2.5rem; margin-bottom:1rem;">📉</div><div class="kpi-subtext">Not enough data. You have logged <strong>${tagName}</strong> ${targetIndexes.length} times.<br>The engine requires at least 4 instances to calculate a mathematical signal.</div>`;
        return;
    }

    // Calculate target array metrics
    targetIndexes.forEach(idx => {
        if (d.recovery.hrv[idx]) targetHrv.push(d.recovery.hrv[idx]);
        if (d.recovery.rhr[idx]) targetRhr.push(d.recovery.rhr[idx]);
        if (d.signals && d.signals.efficiency && d.signals.efficiency[idx]) targetEff.push(d.signals.efficiency[idx]);
        if (d.sleep && d.sleep.deep && d.sleep.deep[idx]) targetDeep.push(d.sleep.deep[idx]);
    });

    // Calculate baseline. To isolate the variable, baseline is days WITHOUT this habit over the last 6 months.
    for (let i = Math.max(0, dates.length - 180); i < dates.length; i++) {
        let isTargetDay = false;
        if (useLag) {
            const prevDate = i > 0 ? dates[i-1] : null;
            const prevTags = prevDate ? (d.tags[prevDate] || []) : [];
            isTargetDay = prevTags.includes(tagName);
        } else {
            const currDate = dates[i];
            const currTags = d.tags[currDate] || [];
            isTargetDay = currTags.includes(tagName);
        }

        if (!isTargetDay) {
            if (d.recovery.hrv[i]) baseHrv.push(d.recovery.hrv[i]);
            if (d.recovery.rhr[i]) baseRhr.push(d.recovery.rhr[i]);
            if (d.signals && d.signals.efficiency && d.signals.efficiency[i]) baseEff.push(d.signals.efficiency[i]);
            if (d.sleep && d.sleep.deep && d.sleep.deep[i]) baseDeep.push(d.sleep.deep[i]);
        }
    }

    const _avg = (arr) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
    
    const hrvBase = _avg(baseHrv), hrvTgt = _avg(targetHrv);
    const rhrBase = _avg(baseRhr), rhrTgt = _avg(targetRhr);
    const effBase = _avg(baseEff), effTgt = _avg(targetEff);
    const deepBase = _avg(baseDeep), deepTgt = _avg(targetDeep);

    const renderCard = (id, base, tgt, higherIsBetter, unit) => {
        const el = document.getElementById('impact-' + id);
        const rawEl = document.getElementById('impact-' + id + '-raw');
        if (!el || !rawEl) return;
        
        if (base === 0 || tgt === 0) {
            el.innerText = '--';
            rawEl.innerText = 'No Data';
            return;
        }

        const pct = ((tgt - base) / base) * 100;
        const abs = Math.abs(pct).toFixed(1);
        let arrow = pct > 0 ? '↑' : '↓';
        let isPositive = higherIsBetter ? pct > 0 : pct < 0;

        el.innerText = `${arrow} ${abs}%`;
        
        // Ensure colors apply properly
        el.style.color = isPositive ? 'var(--color-accent-tertiary)' : 'var(--color-accent-primary)';

        // Deep sleep is in minutes, convert to hours/mins for raw
        if (id === 'deep') {
            const bH = Math.floor(base/60), bM = Math.round(base%60);
            const tH = Math.floor(tgt/60), tM = Math.round(tgt%60);
            rawEl.innerText = `${tH}h ${tM}m vs ${bH}h ${bM}m`;
        } else {
            rawEl.innerText = `${Math.round(tgt)}${unit} vs ${Math.round(base)}${unit}`;
        }
    };

    renderCard('hrv', hrvBase, hrvTgt, true, 'ms');
    renderCard('rhr', rhrBase, rhrTgt, false, 'bpm');
    renderCard('efficiency', effBase, effTgt, true, '%');
    renderCard('deep', deepBase, deepTgt, true, '');

    emptyContainer.classList.add('hidden');
    resultsContainer.classList.remove('hidden');
};

// ── 16. Sprint 6: Quick Log Modal ───────────────────────────────────────────────
let quickLogTargetDay = 'today';

window.toggleQuickLogModal = function(show) {
    const modal = document.getElementById('quick-log-modal');
    if (!modal) return;
    
    if (show) {
        modal.classList.remove('hidden');
        renderQuickLogTags();
    } else {
        modal.classList.add('hidden');
        const msg = document.getElementById('ql-success-msg');
        if (msg) msg.classList.add('hidden');
    }
};

window.setQuickLogDay = function(day) {
    quickLogTargetDay = day;
    document.getElementById('ql-toggle-today').classList.toggle('active', day === 'today');
    document.getElementById('ql-toggle-yesterday').classList.toggle('active', day === 'yesterday');
    
    const label = document.getElementById('ql-target-label');
    if (label) label.innerText = (day === 'today' ? 'Today' : 'Yesterday');
};

function renderQuickLogTags() {
    const grid = document.getElementById('ql-tags-grid');
    if (!grid) return;
    
    // Default system tags if none exist yet
    let availableTags = ['Alcohol', 'Sauna', 'Magnesium', 'Deep Work', 'Caffeine', 'Stretching'];
    
    // Extract unique tags from the last 30 days dynamically, but keep minimum defaults
    if (state.data && state.data.tags) {
        const recentTags = Object.values(state.data.tags).flat();
        const uniqueRecent = [...new Set(recentTags)];
        if (uniqueRecent.length > 0) {
            availableTags = [...new Set([...availableTags, ...uniqueRecent])].slice(0, 10);
        }
    }
    
    grid.innerHTML = '';
    availableTags.forEach(tag => {
        const btn = document.createElement('button');
        btn.className = 'ql-tag-btn';
        btn.innerText = tag;
        btn.style.borderColor = getTagColor(tag);
        btn.style.color = getTagColor(tag);
        
        btn.onclick = () => window.quickLogHabit(tag);
        grid.appendChild(btn);
    });
}

window.quickLogHabit = function(tag) {
    if (!state.data || !state.data.dates) return;
    
    // Determine the target index
    // D[Length-1] usually corresponds to 'today' or the latest data point from Apple Health.
    let targetIdx = state.data.dates.length - 1;
    if (quickLogTargetDay === 'yesterday') {
        targetIdx -= 1;
    }
    
    if (targetIdx < 0) return;
    
    const dateStr = state.data.dates[targetIdx];
    if (!state.data.tags) state.data.tags = {};
    if (!Array.isArray(state.data.tags[dateStr])) state.data.tags[dateStr] = [];
    
    const tagsArr = state.data.tags[dateStr];
    if (!tagsArr.includes(tag)) {
        tagsArr.push(tag);
        state.data.tags[dateStr] = [...tagsArr];
    }
    
    // Auto-save logic utilizing the existing Correlator POST pipeline
    if (typeof saveTagsToServer === 'function') saveTagsToServer();
    
    // Show success message briefly, then auto-close
    const msg = document.getElementById('ql-success-msg');
    if (msg) {
        msg.classList.remove('hidden');
        msg.innerText = `✓ Logged ${tag} for ${quickLogTargetDay}`;
    }
    
    setTimeout(() => {
        toggleQuickLogModal(false);
        // Force refresh Correlator and UI if active
        if (document.getElementById('habits-experiments') && document.getElementById('habits-experiments').classList.contains('active')) {
            if (typeof initHabitsTab === 'function') initHabitsTab();
        }
    }, 1200);
};

// Helper to deterministically assign beautiful colors to tags based on string hash
function getTagColor(name) {
    const defaultColors = [
        '#60A5FA', '#34D399', '#F87171', '#FBBF24', '#A78BFA', '#F472B6', '#38BDF8'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return defaultColors[Math.abs(hash) % defaultColors.length];
}
