// Apple Health Data Parser
// Handles server-parsed JSON from /api/data, live-sync JSON from /api/health,
// raw XML dropped into the browser, and a synthetic demo fallback.

class HealthParser {

    // ── 1. Build from Server-Parsed JSON (/api/data) ──────────────────────────
    // The server returns flat arrays: { dates, hrv, rhr, sleepDeep, sleepREM, sleepCore, workoutMinutes }
    // 1. Build from Server-Parsed JSON (/api/data) 
    // This is the single, hardened source of truth for constructing the dashboard state.
    static buildFromServerParsed(raw) {
        try {
            if (!raw || !raw.dates || !raw.dates.length) {
                return { 
                    dates: [], 
                    rawDates: [],
                    recovery: { score: 0, hrv: [], rhr: [] }, 
                    sleep: { score: 0, totalHoursLast: 0, deep: [], rem: [], core: [] }, 
                    workouts: { minutes: [], detailed: [], tsb: [], atl: [], ctl: [] }, 
                    averages: { hrv: [], rhr: [], deep: [], rem: [], core: [] },
                    signals: { efficiency: [], velocity: { hrv: [] }, debt: { deep: [] } },
                    circadian: { labels: [], sleepProb: [], activityHotspots: [] },
                    screentime: { totalHours: [], pickups: [], categories: { labels: [], data: [] } },
                    _source: 'empty'
                };
            }
            const n = raw.dates.length;

            // Sort chronically
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
            if (raw.sleepInBedMins) raw.sleepInBedMins = indices.map(i => raw.sleepInBedMins[i]);
            if (raw.sleepNaps) raw.sleepNaps = indices.map(i => raw.sleepNaps[i]);

            const fill = (arr) => {
                const out = [...arr];
                for (let i = 0; i < out.length; i++) {
                    if (out[i] === null || out[i] === undefined) {
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

            const { tsb, atl, ctl } = HealthParser._computeTSB(wMin);

            const lastDeep = deep[n - 1] || 0;
            const lastRem  = rem[n - 1]  || 0;
            const lastCore = core[n - 1] || 0;
            const totalSleep = (lastDeep + lastRem + lastCore) / 60;

            const recoveryScore = HealthParser._recoveryScore(hrv, rhr, n - 1);
            const sleepScore    = HealthParser._sleepScore(lastDeep, lastRem, lastCore);

            const displayDates = raw.dates.map(d => {
                const dt = new Date(d + 'T00:00:00');
                if (isNaN(dt)) return d;
                return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            });

            return {
                dates: displayDates,
                rawDates: raw.dates,
                sleep: { 
                    score: sleepScore, 
                    totalHoursLast: +totalSleep.toFixed(1), 
                    deep, rem, core,
                    naps: raw.sleepNaps || Array(n).fill(0)
                },
                recovery: { score: recoveryScore, hrv, rhr },
                workouts: { tsb, atl, ctl, minutes: wMin, detailed: raw.workouts || Array(n).fill([]) },
                circadian: HealthParser._estimateCircadian(raw.sleepBedtimes, raw.sleepWakeups, raw.workouts),
                screentime: HealthParser._emptyScreentime(n),
                sleepBedtimes:  raw.sleepBedtimes  || Array(n).fill(null),
                sleepWakeups:   raw.sleepWakeups   || Array(n).fill(null),
                sleepInBedMins: raw.sleepInBedMins || Array(n).fill(0),
                signals: HealthParser._computeAdvancedSignals({ hrv, rhr, deep, rem, core, wMin, inBed: raw.sleepInBedMins }),
                averages: HealthParser._computeRollingAverages({ hrv, rhr, deep, rem, core }),
                _source: raw.dataSource || 'xml',
            };
        } catch (error) {
            console.error("[HealthParser] buildFromServerParsed failed:", error);
            return HealthParser.buildFromServerParsed({ dates: [] });
        }
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

            // 4. Fingerprinting (guard i >= 1 to avoid rhr[-1] undefined)
            if (i >= 1 && deep[i] < 45 && rhr[i] > (rhr[i-1] * 1.15)) {
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

    // ── 3. Parse raw Apple Health XML in browser (Streaming/Regex) ─────────────
    // Efficiently stream-parses multi-gigabyte XML files without blowing up DOM memory.
    static async streamParseXML(file, onProgress) {
        return new Promise((resolve, reject) => {
            console.log('[Parser] Stream parsing huge XML (Stateless Version):', file.size, 'bytes');
            const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
            const fileSize = file.size;
            let offset = 0;
            let recordCount = 0;
            let tail = '';

            const hrvByDate   = {};
            const rhrByDate   = {};
            const sleepSegmentsByDate = {}; // New session-based collection
            const wByDate     = {};
            const detailedWByDate = {};

            // Internal: Cluster sleep segments into sessions (separated by >60m gaps)
            const _identifySessions = (segments) => {
                if (!segments || !segments.length) return { main: null, napMins: 0 };
                // Clone and sort by start time
                const sorted = [...segments].sort((a, b) => a.startDt - b.startDt);
                const clusters = [];
                let current = [sorted[0]];
                for (let i = 1; i < sorted.length; i++) {
                    const gap = (sorted[i].startDt - sorted[i-1].endDt) / 60000;
                    if (gap < 60) current.push(sorted[i]);
                    else { clusters.push(current); current = [sorted[i]]; }
                }
                clusters.push(current);
                
                const sessions = clusters.map(c => {
                    const stats = { deep: 0, rem: 0, core: 0, total: 0, start: c[0].startRaw, end: c[c.length-1].endRaw, startDt: c[0].startDt, endDt: c[c.length-1].endDt };
                    c.forEach(s => {
                        if (s.val.includes('deep')) stats.deep += s.mins;
                        else if (s.val.includes('rem')) stats.rem += s.mins;
                        else if (s.val.includes('asleep')) stats.core += s.mins;
                        stats.total += s.mins;
                    });
                    stats.wearableTotal = stats.deep + stats.rem + stats.core;
                    return stats;
                });

                // NEW HEURISTIC: Prioritize wearable-validated data
                const wearableSessions = sessions.filter(s => s.wearableTotal > 0);
                
                if (wearableSessions.length > 0) {
                    // MERGE: If there are multiple wearable sessions, they are likely split rest periods
                    // We merge ALL wearable sessions into the "Main Sleep" if they are part of this logical day
                    const main = wearableSessions.reduce((acc, s) => ({
                        deep: acc.deep + s.deep,
                        rem:  acc.rem + s.rem,
                        core: acc.core + s.core,
                        total: acc.total + s.total,
                        wearableTotal: acc.wearableTotal + s.wearableTotal,
                        start: acc.startDt < s.startDt ? acc.start : s.start,
                        end:   acc.endDt > s.endDt ? acc.end : s.end,
                        startDt: new Date(Math.min(acc.startDt, s.startDt)),
                        endDt:   new Date(Math.max(acc.endDt, s.endDt))
                    }));

                    // Naps = Any session with stages that we DIDN'T count (wait, we merged all of them)
                    // Actually, if someone has a wearable session at 2 PM and 11 PM, merging them might be too aggressive.
                    // But the user said "naps don't actually have rem, deep, core dataAnyway".
                    // So if it HAS stage data, it's probably part of their main rest or a "real" sleep bout.
                    
                    // For now, follow the merge-all-wearable strategy to fix split nights.
                    const otherSessions = sessions.filter(s => !wearableSessions.includes(s));
                    const napMins = otherSessions.reduce((sum, s) => sum + s.total, 0);

                    return { main, napMins };
                } else {
                    // No wearable data found? Pick the longest manual/estimated session as main only if > 3hrs
                    const sorted = [...sessions].sort((a, b) => b.total - a.total);
                    const longest = sorted[0];
                    if (longest.total > 180) { // > 3 hours
                        return { main: longest, napMins: sorted.slice(1).reduce((sum, s) => sum + s.total, 0) };
                    } else {
                        return { main: null, napMins: sorted.reduce((sum, s) => sum + s.total, 0) };
                    }
                }
            };

            const reader = new FileReader();

            let sniffingCount = 0;

            const parseDateSafe = (dStr) => {
                if (!dStr) return new Date("");
                // Apple Health uses "2023-10-03 05:28:05 +0530"
                // Browsers hate the space before the "+". 
                // We convert to ISO: "2023-10-03T05:28:05+0530"
                const normalized = dStr.trim()
                    .replace(' ', 'T')           // Replace first space (between date and time)
                    .replace(/\s([+-])/, '$1')   // Remove space before timezone offset
                    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2"); // Insert colon in timezone (+0530 -> +05:30)
                return new Date(normalized);
            }

            const getLogicalDate = (dateStr) => {
                try {
                    const d = parseDateSafe(dateStr);
                    if (isNaN(d.getTime())) return null;
                    // Noon-to-noon logical day (subtract 12 hours)
                    d.setHours(d.getHours() - 12);
                    return d.toISOString().slice(0, 10);
                } catch (e) {
                    return null;
                }
            };

            reader.onload = function(e) {
                if (onProgress) onProgress(offset, fileSize);

                const chunk = tail + e.target.result;
                const lastBoundary = chunk.lastIndexOf('/>');
                
                let processable = '';
                if (lastBoundary !== -1) {
                    const splitIdx = lastBoundary + 2; 
                    processable = chunk.substring(0, splitIdx);
                    tail = chunk.substring(splitIdx);
                } else {
                    tail = chunk;
                    offset += CHUNK_SIZE;
                    if (offset < fileSize) readNextChunk();
                    else finishParsing();
                    return;
                }

                // STATELESS Search: Locally defined patterns avoid lastIndex leaks between chunks
                const recordRegex = /<(Record|Workout)[^>]+>/gi;
                const typeRegex   = /type=['"]([^'"]+)['"]/i;
                const startRegex  = /startDate=['"]([^'"]+)['"]/i;
                const valRegex    = /value=['"]([^'"]+)['"]/i;
                const endRegex    = /endDate=['"]([^'"]+)['"]/i;
                const durRegex    = /duration=['"]([^'"]+)['"]/i;
                const wTypeRegex  = /workoutActivityType=['"]([^'"]+)['"]/i;

                const matches = processable.matchAll(recordRegex);
                for (const match of matches) {
                    recordCount++;
                    const tagContent = match[0];
                    if (sniffingCount < 3) {
                        console.log(`[Parser] Sniffer Tag ${++sniffingCount}:`, tagContent.substring(0, 300));
                    }
                    const tagType = match[1].toLowerCase();
                    const isWorkout = tagType === 'workout';
                    
                    const startMatch = startRegex.exec(tagContent);
                    if (!startMatch) continue;
                    const fullDateStr = startMatch[1];
                    let lDate = getLogicalDate(fullDateStr);
                    
                    // RELIABILITY FALLBACK: If logical date processing fails, use literal date
                    if (!lDate) {
                        lDate = fullDateStr.split(' ')[0] || fullDateStr.split('T')[0];
                    }
                    if (!lDate || lDate.length < 10) continue;

                    if (isWorkout) {
                        const durMatch = durRegex.exec(tagContent);
                        if (durMatch) {
                            const dur = parseFloat(durMatch[1] || 0);
                            wByDate[lDate] = (wByDate[lDate] || 0) + dur;
                            
                            const wtMatch = wTypeRegex.exec(tagContent);
                            let t = wtMatch ? wtMatch[1] : 'Other';
                            t = t.replace('HKWorkoutActivityType', '');
                            if (!detailedWByDate[lDate]) detailedWByDate[lDate] = [];
                            detailedWByDate[lDate].push({ type: t, duration: dur, date: fullDateStr });
                        }
                    } else {
                        const tpMatch = typeRegex.exec(tagContent);
                        if (!tpMatch) continue;
                        const type = tpMatch[1];
                        
                        if (type.includes('HeartRateVariability')) {
                            const valMatch = valRegex.exec(tagContent);
                            if (valMatch) (hrvByDate[lDate] = hrvByDate[lDate] || []).push(parseFloat(valMatch[1]));
                        } else if (type.includes('RestingHeartRate')) {
                            const valMatch = valRegex.exec(tagContent);
                            if (valMatch) (rhrByDate[lDate] = rhrByDate[lDate] || []).push(parseFloat(valMatch[1]));
                        } else if (type.includes('SleepAnalysis')) {
                            const valMatch = valRegex.exec(tagContent);
                            const endMatch = endRegex.exec(tagContent);
                            if (valMatch && endMatch) {
                                const endStr = endMatch[1];
                                const val = valMatch[1];
                                const startDt = parseDateSafe(fullDateStr);
                                const endDt = parseDateSafe(endStr);
                                const mins = (endDt - startDt) / 60000;
                                
                                if (mins > 0) {
                                    if (!sleepSegmentsByDate[lDate]) sleepSegmentsByDate[lDate] = [];
                                    const vLower = val.toLowerCase();
                                    
                                    // Collect segments for post-process clustering
                                    if (vLower.includes('asleep') || vLower.includes('deep') || vLower.includes('rem') || vLower.includes('inbed')) {
                                        sleepSegmentsByDate[lDate].push({ 
                                            startDt, endDt, 
                                            startRaw: fullDateStr, 
                                            endRaw: endStr, 
                                            val: vLower, 
                                            mins 
                                        });
                                    }
                                }
                            }
                        }
                    }
                }

                offset += CHUNK_SIZE;
                if (offset < fileSize) readNextChunk();
                else finishParsing();
            };

            reader.onerror = function() { reject(new Error("File reading failed")); };

            function readNextChunk() {
                const slice = file.slice(offset, offset + CHUNK_SIZE);
                reader.readAsText(slice);
            }

            function finishParsing() {
                if (onProgress) onProgress(fileSize, fileSize);
                
                const hDates = Object.keys(hrvByDate);
                const rDates = Object.keys(rhrByDate);
                const sDates = Object.keys(sleepSegmentsByDate);
                const hardwareDateStrings = [...new Set([...hDates, ...rDates])].sort();
                
                if (hardwareDateStrings.length === 0 && hDates.length === 0 && rDates.length === 0) {
                    console.error("[Parser] Critical Failure: No wearable data found among", recordCount, "records.");
                    resolve(HealthParser.buildFromServerParsed({ dates: [] }));
                    return;
                }

                const firstHardwareDate = hardwareDateStrings[0] || (sDates[0] || Object.keys(wByDate)[0]);
                const allDates = [...new Set([
                    ...hDates, ...rDates, ...sDates, ...Object.keys(wByDate)
                ])].sort().filter(d => d >= firstHardwareDate);

                // Run Heuristic: Cluster segments into Primary Night sessions vs Naps
                const finalSleepByDate = {};
                const finalNapsByDate  = {};
                const finalBedtimes    = {};
                const finalWakeups     = {};

                allDates.forEach(d => {
                    const { main, napMins } = _identifySessions(sleepSegmentsByDate[d] || []);
                    finalSleepByDate[d] = main || { deep: 0, rem: 0, core: 0, total: 0 };
                    finalNapsByDate[d]  = napMins;
                    
                    // Only consider bedding/wake timings for averages if it's "Watch Data" (has stages)
                    if (main && (main.wearableTotal > 0)) {
                        finalBedtimes[d] = main.start || null;
                        finalWakeups[d]  = main.end   || null;
                    } else {
                        finalBedtimes[d] = null;
                        finalWakeups[d]  = null;
                    }
                });

                const avg = arr => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;

                const raw = {
                    dataSource: 'xml_browser_stateless',
                    dates:          allDates,
                    hrv:            allDates.map(d => avg(hrvByDate[d]  || [])),
                    rhr:            allDates.map(d => avg(rhrByDate[d]  || [])),
                    sleepDeep:      allDates.map(d => +(finalSleepByDate[d]?.deep || 0).toFixed(1)),
                    sleepREM:       allDates.map(d => +(finalSleepByDate[d]?.rem  || 0).toFixed(1)),
                    sleepCore:      allDates.map(d => +(finalSleepByDate[d]?.core || 0).toFixed(1)),
                    sleepNaps:      allDates.map(d => +(finalNapsByDate[d] || 0).toFixed(1)),
                    sleepBedtimes:  allDates.map(d => finalBedtimes[d]    || null),
                    sleepWakeups:   allDates.map(d => finalWakeups[d]     || null),
                    workoutMinutes: allDates.map(d => +(wByDate[d] || 0).toFixed(1)),
                    workouts:       allDates.map(d => detailedWByDate[d] || []),
                };

                try {
                    // Return the FLAT raw object for storage. 
                    // The UI will call buildFromServerParsed() on this when needed.
                    console.log("[Parser] Stream Parse Success:", { 
                        totalTags: recordCount,
                        daysRecovered: allDates.length,
                        anchorDate: allDates[0]
                    });
                    resolve(raw);
                } catch (err) {
                    console.error("[Parser] Assembly Error:", err);
                    resolve({ dates: [] });
                }
            }

            readNextChunk();
        });
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
            circadian: HealthParser._estimateCircadian(bedtimes, wakeups, null),
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

        // Normalise against the user's own trailing 30-day window (personalized)
        // Falls back to population range when data is sparse (<7 days)
        const window = Math.min(30, idx + 1);
        const hrvWindow = hrv.slice(Math.max(0, idx - window + 1), idx + 1).filter(Boolean);
        const rhrWindow = rhr.slice(Math.max(0, idx - window + 1), idx + 1).filter(Boolean);

        let hScore, rScore;
        if (hrvWindow.length >= 7) {
            const hMin = Math.min(...hrvWindow);
            const hMax = Math.max(...hrvWindow);
            const hRange = hMax - hMin || 1;
            hScore = Math.min(100, Math.max(0, ((h - hMin) / hRange) * 100));
        } else {
            // Population fallback: HRV 20–100ms → 0–100
            hScore = Math.min(100, Math.max(0, (h - 20) / 80 * 100));
        }

        if (rhrWindow.length >= 7) {
            const rMin = Math.min(...rhrWindow);
            const rMax = Math.max(...rhrWindow);
            const rRange = rMax - rMin || 1;
            // Lower RHR is better, so invert
            rScore = Math.min(100, Math.max(0, ((rMax - r) / rRange) * 100));
        } else {
            // Population fallback: RHR 80–40bpm → 0–100
            rScore = Math.min(100, Math.max(0, (80 - r) / 40 * 100));
        }

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
            if (typeof bedtimes[i] !== 'string' || typeof wakeups[i] !== 'string') continue;
            validSleepNights++;

            // Handle both short "HH:MM" (demo) and full ISO "2024-03-20 22:45:00 +0530" (real XML)
            const extractHM = (str) => {
                const parts = str.trim().split(' ');
                // parts[1] is the time portion for ISO strings; parts[0] for plain HH:MM
                const timePart = parts.length > 1 ? parts[1] : parts[0];
                const [hh, mm] = timePart.split(':').map(Number);
                return [isNaN(hh) ? 0 : hh, isNaN(mm) ? 0 : mm];
            };

            const [bH, bM] = extractHM(bedtimes[i]);
            const [wH, wM] = extractHM(wakeups[i]);

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
