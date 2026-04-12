const parseDateSafe = (dStr) => {
    if (!dStr) return new Date("");
    return new Date(dStr.trim().replace(' ', 'T').replace(/\s([+-])/, '').replace(/([+-]\d{2})(\d{2})$/, ":"));
};

const segments = [
    { start: "2023-10-03 14:00:00 +0530", end: "2023-10-03 15:00:00 +0530", val: "AsleepCore" }, // Nap
    { start: "2023-10-03 23:00:00 +0530", end: "2023-10-04 02:00:00 +0530", val: "AsleepCore" }, // Part 1 Night
    { start: "2023-10-04 02:15:00 +0530", end: "2023-10-04 07:00:00 +0530", val: "AsleepDeep" }  // Part 2 Night
];

function cluster(segs) {
    const sorted = [...segs].sort((a,b) => parseDateSafe(a.start) - parseDateSafe(b.start));
    const clusters = [];
    if (sorted.length === 0) return [];
    
    let current = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const prevEnd = parseDateSafe(sorted[i-1].end);
        const currStart = parseDateSafe(sorted[i].start);
        const gap = (currStart - prevEnd) / 60000;
        if (gap < 60) {
            current.push(sorted[i]);
        } else {
            clusters.push(current);
            current = [sorted[i]];
        }
    }
    clusters.push(current);
    return clusters;
}

const sessions = cluster(segments);
sessions.forEach((s, i) => {
    const total = s.reduce((sum, seg) => sum + (parseDateSafe(seg.end) - parseDateSafe(seg.start))/60000, 0);
    console.log(`Session ${i+1}: ${total} mins, Count: ${s.length}`);
});
