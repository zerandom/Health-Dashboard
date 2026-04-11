// Apple Health Data Parser
// Handles server-parsed JSON from /api/data, live-sync JSON from /api/health,
// raw XML dropped into the browser, and a synthetic demo fallback.

class HealthParser {

    // ── 1. Build from Server-Parsed JSON (/api/data) ──────────────────────────
    // The server returns flat arrays: { dates, hrv, rhr, sleepDeep, sleepREM, sleepCore, workoutMinutes }
    static buildFromServerParsed(raw) {
        const n = raw.dates?.length;
        if (!n) return null;

        // Ensure chronological order by sorting the ISO YYYY-MM-DD strings
        const indices = raw.dates.map((d, i) => i)
            .sort((a, b) => raw.dates[a].localeCompare(raw.dates[b]));
        
        raw.dates = indices.map(i => raw.dates[i]);
        if (raw.hrv) raw.hrv = indices.map(i => raw.hrv[i]);
        if (raw.rhr) raw.rhr = indices.map(i => raw.rhr[i]);
        if (raw.sleepDeep) raw.sleepDeep = indices.map(i => raw.sleepDeep[i]);
        if (raw.sleepREM) raw.sleepREM = indices.map(i => raw.sleepREM[i]);
        if (raw.sleepCore) raw.sleepCore = indices.map(i => raw.sleepCore[i]);
        if (raw.workoutMinutes) raw.workoutMinutes = indices.map(i => raw.workoutMinutes[i]);
        if (raw.sleepBedtimes) raw.sleepBedtimes = indices.map(i => raw.sleepBedtimes[i]);
        if (raw.sleepWakeups) raw.sleepWakeups = indices.map(i => raw.sleepWakeups[i]);

        // Normalise nulls to interpolated/neighbour values
        const fill = (arr) => {
            const out = [...arr];
            for (let i = 0; i < out.length; i++) {
                if (out[i] === null || out[i] === undefined) {
                    // find nearest non-null neighbour
                    let left = null, right = null;
                    for (let l = i - 1; l >= 0; l--) { if (out[l] !== null) { left = out[l]; break; } }
                    for (let r = i + 1; r < out.length; r++) { if (out[r] !== null) { right = out[r]; break; } }
                    out[i] = left !== null ? left : (right !== null ? right : 0);
                }
            }
            return out;
        };

        const hrv  = fill(raw.hrv  || Array(n).fill(null));
        const rhr  = fill(raw.rhr  || Array(n).fill(null));
        const deep = raw.sleepDeep || Array(n).fill(0);
        const rem  = raw.sleepREM  || Array(n).fill(0);
        const core = raw.sleepCore || Array(n).fill(0);
        const wMin = raw.workoutMinutes || Array(n).fill(0);

        // Compute TSB (Training Stress Balance) via ATL/CTL model
        // TRIMP proxy = workout minutes (simple)
        const { tsb, atl, ctl } = HealthParser._computeTSB(wMin);

        // Composite scores from last day
        const lastHrv  = hrv[n - 1]  || 40;
        const lastRhr  = rhr[n - 1]  || 60;
        const lastDeep = deep[n - 1] || 0;
        const lastRem  = rem[n - 1]  || 0;
        const lastCore = core[n - 1] || 0;
        const totalSleep = (lastDeep + lastRem + lastCore) / 60; // hours

        const recoveryScore = HealthParser._recoveryScore(hrv, rhr, n - 1);
        const sleepScore    = HealthParser._sleepScore(lastDeep, lastRem, lastCore);

        // Format dates for display (keep ISO string as-is — charts use them)
        const displayDates = raw.dates.map(d => {
            const dt = new Date(d + 'T00:00:00');
            return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });

        return {
            dates: displayDates,
            rawDates: raw.dates,  // ISO strings (YYYY-MM-DD) — used for tag keying
            sleep: {
                score: sleepScore,
                totalHoursLast: +totalSleep.toFixed(1),
                deep,
                rem,
                core,
            },
            recovery: {
                score: recoveryScore,
                hrv,
                rhr,
            },
            workouts: {
                tsb,
                atl,
                ctl,
                minutes: wMin,
                detailed: raw.workouts || Array(n).fill([]),
            },
            circadian: HealthParser._estimateCircadian(raw.sleepBedtimes, raw.sleepWakeups, raw.workouts),
            screentime: HealthParser._emptyScreentime(n),
            sleepBedtimes:  raw.sleepBedtimes  || Array(n).fill(null),
            sleepWakeups:   raw.sleepWakeups   || Array(n).fill(null),
            sleepInBedMins: raw.sleepInBedMins || Array(n).fill(0),
            signals: HealthParser._computeAdvancedSignals({ hrv, rhr, deep, rem, core, wMin, inBed: raw.sleepInBedMins }),
            averages: HealthParser._computeRollingAverages({ hrv, rhr, deep, rem, core }),
            _source: raw.dataSource || 'xml',
        };
    }

    static _computeAdvancedSignals(data) {
        const { hrv, rhr, deep, rem, core, inBed } = data;
        const n = hrv.length;
        
        const efficiency = [];
        const velocity = { hrv: [], quality: [] };
        const debt = { deep: [] };
        const fingerprints = [];

        for (let i = 0; i < n; i++) {
            // Real Sleep Efficiency = TST ÷ In-Bed window
            // Falls back to TST/(TST+30) approximation when in-bed data is absent
            const tst = (deep[i] || 0) + (rem[i] || 0) + (core[i] || 0);
            const inBedMins = inBed && inBed[i] > 0 ? inBed[i] : 0;
            let se;
            if (inBedMins > 0 && tst > 0 && inBedMins >= tst) {
                // Real formula: TST / Time In Bed
                se = Math.min(100, (tst / inBedMins) * 100);
            } else {
                // Fallback: approximate 30min wake overhead
                se = tst ? Math.min(100, (tst / (tst + 30)) * 100) : 0;
            }
            efficiency.push(+se.toFixed(1));

            // 2. Signal Velocity (7d vs 14d trend)
            if (i >= 14) {
                const avg7 = hrv.slice(i-6, i+1).reduce((a,b)=>a+b,0)/7;
                const avg14 = hrv.slice(i-13, i+1).reduce((a,b)=>a+b,0)/14;
                velocity.hrv.push(+(avg7 - avg14).toFixed(2));
            } else {
                velocity.hrv.push(0);
            }

            // 3. Deep Debt (3+ nights < 15%)
            let isDeepDebt = false;
            if (i >= 2) {
                 const window = [deep[i], deep[i-1], deep[i-2]];
                 // Assume 15% of 8h = 72 mins
                 isDeepDebt = window.every(val => val < 72);
            }
            debt.deep.push(isDeepDebt);

            // 4. Fingerprinting
            if (deep[i] < 45 && rhr[i] > (rhr[i-1] * 1.15)) {
                fingerprints.push({ date: i, type: 'ALCOHOL_SIGNATURE' });
            }
        }

        return { efficiency, velocity, debt, fingerprints };
    }

    static _computeRollingAverages(data) {
        const result = {};
        for (const [key, values] of Object.entries(data)) {
            const rolling = [];
            for (let i = 0; i < values.length; i++) {
                const window = values.slice(Math.max(0, i - 6), i + 1).filter(v => v !== null);
                const avg = window.length ? window.reduce((a, b) => a + b, 0) / window.length : null;
                rolling.push(avg);
            }
            result[key] = rolling;
        }
        return result;
    }

    // ── 2. Build from Live Sync JSON (/api/health, posted by iOS Shortcut) ────
    // Expects: { hrv, rhr, heartRate, sleepDeep, sleepREM, sleepCore,
    //            activeCalories, workoutMinutes, steps, timestamp }
    // Single-day snapshot — merged on top of existing parsed data if available.
    static buildFromLiveSync(json, existingState) {
        const hrv  = parseFloat(json.hrv  || json.heartRateVariability || 0) || null;
        const rhr  = parseFloat(json.rhr  || json.restingHeartRate     || 0) || null;
        const deep = parseFloat(json.sleepDeep  || json.deepSleep  || 0);
        const rem_ = parseFloat(json.sleepREM   || json.remSleep   || 0);
        const core = parseFloat(json.sleepCore  || json.coreSleep  || 0);
        const wMin = parseFloat(json.workoutMinutes || json.exerciseMinutes || 0);

        // If we already have historical data, patch today's slot
        if (existingState && existingState.recovery.hrv.length > 0) {
            const s = JSON.parse(JSON.stringify(existingState)); // deep clone
            const last = s.recovery.hrv.length - 1;
            if (hrv  !== null) s.recovery.hrv[last] = hrv;
            if (rhr  !== null) s.recovery.rhr[last] = rhr;
            if (deep) s.sleep.deep[last] = deep;
            if (rem_) s.sleep.rem[last]  = rem_;
            if (core) s.sleep.core[last] = core;
            s.recovery.score = HealthParser._recoveryScore(s.recovery.hrv, s.recovery.rhr, last);
            s.sleep.score    = HealthParser._sleepScore(
                s.sleep.deep[last], s.sleep.rem[last], s.sleep.core[last]
            );
            s._source = 'live_sync+xml';
            return s;
        }

        // Standalone single-point snapshot (no XML data)
        const DAYS = 14;
        return {
            dates: Array.from({ length: DAYS }, (_, i) => {
                const d = new Date(); d.setDate(d.getDate() - (DAYS - 1 - i));
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }),
            sleep: {
                score: HealthParser._sleepScore(deep, rem_, core),
                totalHoursLast: +((deep + rem_ + core) / 60).toFixed(1),
                deep:  Array.from({ length: DAYS - 1 }, () => Math.random() * 50 + 35).concat([deep]),
                rem:   Array.from({ length: DAYS - 1 }, () => Math.random() * 40 + 50).concat([rem_]),
                core:  Array.from({ length: DAYS - 1 }, () => Math.random() * 80 + 140).concat([core]),
            },
            recovery: {
                score: HealthParser._recoveryScore([hrv], [rhr], 0),
                hrv:  Array.from({ length: DAYS - 1 }, () => (hrv || 40) + (Math.random() - 0.5) * 10).concat([hrv || 40]),
                rhr:  Array.from({ length: DAYS - 1 }, () => (rhr || 60) + (Math.random() - 0.5) * 5 ).concat([rhr || 60]),
            },
            workouts: {
                tsb:     Array(DAYS).fill(0),
                atl:     Array(DAYS).fill(0),
                ctl:     Array(DAYS).fill(0),
                minutes: Array.from({ length: DAYS - 1 }, () => 0).concat([wMin]),
            },
            circadian: HealthParser._defaultCircadian(),
            screentime: HealthParser._emptyScreentime(DAYS),
            _source: 'live_sync',
        };
    }

    // ── 3. Parse raw Apple Health XML in browser ───────────────────────────────
    // Fallback when server-side parse fails or file is dropped without a server.
    static parseXML(xmlString) {
        console.log('[Parser] Parsing XML in browser…');
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, 'text/xml'); // ← was parseString (bug)

        if (xmlDoc.querySelector('parsererror')) {
            console.error('[Parser] XML parse error');
            return null;
        }

        const records  = xmlDoc.getElementsByTagName('Record');
        const workouts = xmlDoc.getElementsByTagName('Workout');

        const hrvByDate   = {};
        const rhrByDate   = {};
        const sleepByDate = {};
        const wByDate     = {};

        const DEEP_VAL  = 'HKCategoryValueSleepAnalysisAsleepDeep';
        const REM_VAL   = 'HKCategoryValueSleepAnalysisAsleepREM';
        const CORE_VALS = new Set([
            'HKCategoryValueSleepAnalysisAsleepCore',
            'HKCategoryValueSleepAnalysisAsleepUnspecified',
            'HKCategoryValueSleepAnalysisAsleep',
        ]);

        for (let r of records) {
            const type  = r.getAttribute('type');
            const start = r.getAttribute('startDate') || '';
            const date  = start.slice(0, 10);
            if (!date) continue;

            if (type === 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN') {
                (hrvByDate[date] = hrvByDate[date] || []).push(+r.getAttribute('value'));
            } else if (type === 'HKQuantityTypeIdentifierRestingHeartRate') {
                (rhrByDate[date] = rhrByDate[date] || []).push(+r.getAttribute('value'));
            } else if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
                const val    = r.getAttribute('value') || '';
                const end    = r.getAttribute('endDate') || '';
                const mins   = (new Date(end) - new Date(start)) / 60000;
                if (!sleepByDate[date]) sleepByDate[date] = { deep: 0, rem: 0, core: 0 };
                if (val === DEEP_VAL)      sleepByDate[date].deep += mins;
                else if (val === REM_VAL)  sleepByDate[date].rem  += mins;
                else if (CORE_VALS.has(val)) sleepByDate[date].core += mins;
            }
        }

        for (let w of workouts) {
            const start = w.getAttribute('startDate') || '';
            const date  = start.slice(0, 10);
            if (date) wByDate[date] = (wByDate[date] || 0) + (+w.getAttribute('duration') || 0);
        }

        const allDates = [...new Set([
            ...Object.keys(hrvByDate),
            ...Object.keys(rhrByDate),
            ...Object.keys(sleepByDate),
        ])].sort().slice(-365);

        const avg = arr => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;

        const raw = {
            dataSource: 'xml_browser',
            dates:          allDates,
            hrv:            allDates.map(d => avg(hrvByDate[d]  || [])),
            rhr:            allDates.map(d => avg(rhrByDate[d]  || [])),
            sleepDeep:      allDates.map(d => +(sleepByDate[d]?.deep || 0).toFixed(1)),
            sleepREM:       allDates.map(d => +(sleepByDate[d]?.rem  || 0).toFixed(1)),
            sleepCore:      allDates.map(d => +(sleepByDate[d]?.core || 0).toFixed(1)),
            workoutMinutes: allDates.map(d => +(wByDate[d] || 0).toFixed(1)),
        };

        return HealthParser.buildFromServerParsed(raw);
    }

    // ── 4. Synthetic Demo Fallback ─────────────────────────────────────────────
    static generateSimulatedParsedData() {
        const DAYS = 365;
        const wMin = Array.from({ length: DAYS }, (_, i) =>
            i % 3 === 0 ? Math.random() * 40 + 20 : (i % 6 === 0 ? 0 : Math.random() * 20)
        );
        const { tsb, atl, ctl } = HealthParser._computeTSB(wMin);
        const hrv = Array.from({ length: DAYS }, (_, i) =>
            +(Math.sin(i / 14) * 15 + Math.random() * 20 + 40).toFixed(1)
        );
        const rhr = Array.from({ length: DAYS }, (_, i) =>
            +(Math.cos(i / 10) * 5 + Math.random() * 5 + 48).toFixed(1)
        );
        const deep = Array.from({ length: DAYS }, () => +(Math.random() * 50 + 40).toFixed(1));
        const rem  = Array.from({ length: DAYS }, () => +(Math.random() * 40 + 60).toFixed(1));
        const core = Array.from({ length: DAYS }, () => +(Math.random() * 80 + 150).toFixed(1));

        const dates = Array.from({ length: DAYS }, (_, i) => {
            const d = new Date(); d.setDate(d.getDate() - (DAYS - 1 - i));
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });

        const rawDates = Array.from({ length: DAYS }, (_, i) => {
            const d = new Date(); d.setDate(d.getDate() - (DAYS - 1 - i));
            return d.toISOString().split('T')[0];
        });

        // Mock sleep timings (11pm bedtime, 7am wakeup ±30m variance) as HH:MM strings
        const _pad = n => String(Math.round(n)).padStart(2, '0');
        const bedtimes = Array.from({ length: DAYS }, () => {
            const h = 23, m = Math.floor((Math.random() - 0.5) * 60);
            const adj = (h * 60 + m + 1440) % 1440;
            return `${_pad(Math.floor(adj / 60))}:${_pad(adj % 60)}`;
        });
        const wakeups = Array.from({ length: DAYS }, () => {
            const h = 7, m = Math.floor((Math.random() - 0.5) * 60);
            const adj = (h * 60 + m + 1440) % 1440;
            return `${_pad(Math.floor(adj / 60))}:${_pad(adj % 60)}`;
        });

        const n = DAYS - 1;
        return {
            dates,
            rawDates,
            sleep: {
                score: HealthParser._sleepScore(deep[n], rem[n], core[n]),
                totalHoursLast: +((deep[n] + rem[n] + core[n]) / 60).toFixed(1),
                deep, rem, core,
            },
            recovery: {
                score: HealthParser._recoveryScore(hrv, rhr, n),
                hrv, rhr,
            },
            workouts: { tsb, atl, ctl, minutes: wMin },
            circadian: HealthParser._estimateCircadian(rhr, hrv, DAYS),
            screentime: {
                totalHours: Array.from({ length: DAYS }, () => +(Math.random() * 3 + 3).toFixed(1)),
                pickups:    Array.from({ length: DAYS }, () => Math.floor(Math.random() * 40 + 40)),
                categories: {
                    labels: ['Productivity', 'Social', 'Entertainment', 'Information', 'Other'],
                    data:   [120, 95, 60, 45, 20],
                },
            },
            sleepBedtimes: bedtimes,
            sleepWakeups: wakeups,
            signals: HealthParser._computeAdvancedSignals({ hrv, rhr, deep, rem, core, wMin }),
            averages: HealthParser._computeRollingAverages({ hrv, rhr, deep, rem, core }),
            _source: 'demo',
        };
    }

    // ── Private Helpers ────────────────────────────────────────────────────────

    static _computeTSB(workoutMinutes) {
        // ATL (7-day EMA) and CTL (42-day EMA) from workout load proxy
        const K_ATL = 2 / (7  + 1);
        const K_CTL = 2 / (42 + 1);
        const atl = [], ctl = [], tsb = [];
        let aTL = 0, cTL = 0;
        for (const mins of workoutMinutes) {
            const load = mins * 1.2; // simple TRIMP proxy
            aTL = load * K_ATL + aTL * (1 - K_ATL);
            cTL = load * K_CTL + cTL * (1 - K_CTL);
            atl.push(+aTL.toFixed(1));
            ctl.push(+cTL.toFixed(1));
            tsb.push(+(cTL - aTL).toFixed(1));
        }
        return { atl, ctl, tsb };
    }

    static _recoveryScore(hrv, rhr, idx) {
        const h = hrv[idx] || 40;
        const r = rhr[idx] || 65;
        // Normalise: HRV 20–100 → 0–100, RHR 80–40 → 0–100
        const hScore = Math.min(100, Math.max(0, (h - 20) / 80 * 100));
        const rScore = Math.min(100, Math.max(0, (80 - r) / 40 * 100));
        return Math.round(hScore * 0.6 + rScore * 0.4);
    }

    static _sleepScore(deepMin, remMin, coreMin) {
        const total = deepMin + remMin + coreMin;
        if (!total) return 0;
        const hours = total / 60;
        // Score based on total hours (target 7–9h) and deep/REM ratio
        const hourScore  = Math.min(100, Math.max(0, (hours / 8) * 100));
        const deepREM    = (deepMin + remMin) / total;
        const qualScore  = Math.min(100, deepREM * 200); // 50% deep+REM = 100
        return Math.round(hourScore * 0.5 + qualScore * 0.5);
    }

    static _estimateCircadian(bedtimes, wakeups, workouts) {
        // Create 24-hour X-axis labels
        const labels = Array.from({ length: 24 }, (_, i) => {
            const h = i % 12 || 12;
            const ampm = i < 12 ? 'AM' : 'PM';
            return `${h} ${ampm}`;
        });

        const sleepProb = Array(24).fill(0);
        const activityHotspots = Array(24).fill(0);

        if (!bedtimes || !wakeups) return { labels, sleepProb, activityHotspots };

        let validSleepNights = 0;
        let validWorkouts = 0;

        // 1. Plot Sleep Probability
        for (let i = 0; i < bedtimes.length; i++) {
            if (!bedtimes[i] || !wakeups[i]) continue;
            validSleepNights++;
            
            const [bH, bM] = bedtimes[i].split(':').map(Number);
            const [wH, wM] = wakeups[i].split(':').map(Number);
            
            let currentStr = bedtimes[i];
            let current = bH + (bM / 60);
            let end = wH + (wM / 60);
            if (end < current) end += 24; // wraps past midnight

            for (let h = 0; h < 24; h++) {
                // Determine if hour 'h' falls inside the sleep window
                // To handle wrap, we check if either h or h+24 is in [current, end]
                if ((h >= current && h <= end) || (h + 24 >= current && h + 24 <= end)) {
                    sleepProb[h]++;
                }
            }
        }

        // 2. Plot Workout Activity Hotspots
        if (workouts) {
            workouts.forEach(dailyList => {
                if (!dailyList || !Array.isArray(dailyList)) return;
                dailyList.forEach(w => {
                    if (!w.start) return;
                    validWorkouts++;
                    // start is something like "2024-03-20 08:30:00 +0000"
                    const parts = w.start.trim().split(' ');
                    const timeOnly = parts.length > 1 ? parts[1] : parts[0];
                    const [h, m] = timeOnly.split(':').map(Number);
                    if (!isNaN(h)) {
                        activityHotspots[h]++;
                    }
                });
            });
        }

        // Normalize to percentages (0-100)
        const maxProb = validSleepNights > 0 ? validSleepNights : 1;
        const maxActivity = activityHotspots.reduce((a, b) => Math.max(a, b), 0) || 1;

        return {
            labels,
            sleepProb: sleepProb.map(v => Math.round((v / maxProb) * 100)),
            activityHotspots: activityHotspots.map(v => Math.round((v / maxActivity) * 100))
        };
    }

    static _defaultCircadian() {
        const labels = Array.from({ length: 24 }, (_, i) => {
            const h = i % 12 || 12;
            const ampm = i < 12 ? 'AM' : 'PM';
            return `${h} ${ampm}`;
        });
        const sleepProb = Array(24).fill(0);
        const activityHotspots = Array(24).fill(0);
        // Default sleep: 11PM to 7AM
        for (let i = 23; i <= 24; i++) sleepProb[i % 24] = 100;
        for (let i = 0; i <= 7; i++) sleepProb[i] = 100;
        // Default workouts: peak around 6PM, small spike at 7AM
        activityHotspots[7] = 30;
        activityHotspots[17] = 80;
        activityHotspots[18] = 100;

        return { labels, sleepProb, activityHotspots };
    }

    static _emptyScreentime(n) {
        return {
            totalHours: Array(n).fill(0),
            pickups:    Array(n).fill(0),
            categories: {
                labels: ['Productivity', 'Social', 'Entertainment', 'Information', 'Other'],
                data:   [0, 0, 0, 0, 0],
            },
        };
    }
}
