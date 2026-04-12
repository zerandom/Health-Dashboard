const fs = require('fs');
const path = require('path');

async function diagnoseXML(filePath) {
    console.log(`[Diagnostic] Starting scan of ${filePath}...`);
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    console.log(`[Diagnostic] File size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB`);

    const CHUNK_SIZE = 1024 * 1024; // 1MB
    let offset = 0;
    let tail = '';

    const hrvByDate = {};
    const rhrByDate = {};
    const sleepByDate = {};
    const wByDate = {};

    // EXACT REGEXES FROM parser.js
    const recordRegex = /<(Record|Workout)[^>]+>/g;
    const typeRegex  = /type=['"]([^'"]+)['"]/i;
    const startRegex = /startDate=['"]([^'"]+)['"]/i;
    const valRegex   = /value=['"]([^'"]+)['"]/i;

    let totalTags = 0;
    let hrvTags = 0;
    let rhrTags = 0;
    let sleepTags = 0;

    const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });

    for await (const chunkBuffer of stream) {
        const chunk = tail + chunkBuffer.toString('utf8');
        const lastBoundary = chunk.lastIndexOf('/>');
        
        let processable = '';
        if (lastBoundary !== -1) {
            const splitIdx = lastBoundary + 2;
            processable = chunk.substring(0, splitIdx);
            tail = chunk.substring(splitIdx);
        } else {
            tail = chunk;
            continue;
        }

        let match;
        while ((match = recordRegex.exec(processable)) !== null) {
            totalTags++;
            const tagContent = match[0];
            const typeMatch = typeRegex.exec(tagContent);
            if (!typeMatch) continue;
            
            const type = typeMatch[1];
            if (type === 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN') hrvTags++;
            else if (type === 'HKQuantityTypeIdentifierRestingHeartRate') rhrTags++;
            else if (type === 'HKCategoryTypeIdentifierSleepAnalysis') sleepTags++;

            const startMatch = startRegex.exec(tagContent);
            if (startMatch) {
                const fullDateStr = startMatch[1];
                const d = new Date(fullDateStr);
                if (!isNaN(d.getTime())) {
                    d.setHours(d.getHours() - 12);
                    const lDate = d.toISOString().slice(0, 10);
                    
                    if (type.includes('HeartRateVariability')) hrvByDate[lDate] = true;
                    if (type.includes('RestingHeartRate')) rhrByDate[lDate] = true;
                    if (type.includes('SleepAnalysis')) sleepByDate[lDate] = true;
                }
            }
        }
        
        if (totalTags > 0 && totalTags % 10000 === 0) {
            process.stdout.write(`\r[Diagnostic] Processed ${totalTags} tags... HRV: ${hrvTags}, RHR: ${rhrTags}, Sleep: ${sleepTags}`);
        }
    }

    console.log('\n\n[Diagnostic] FINAL RESULTS:');
    console.log(`Total Tags Found:   ${totalTags}`);
    console.log(`HRV Records:        ${hrvTags}`);
    console.log(`RHR Records:        ${rhrTags}`);
    console.log(`Sleep Records:      ${sleepTags}`);

    const hDates = Object.keys(hrvByDate);
    const rDates = Object.keys(rhrByDate);
    const sDates = Object.keys(sleepByDate);
    const hardwareDates = [...new Set([...hDates, ...rDates, ...sDates])].sort();

    console.log(`\nUnique Dates with Wearable Data: ${hardwareDates.length}`);
    if (hardwareDates.length > 0) {
        console.log(`First Hardware Date: ${hardwareDates[0]}`);
        console.log(`Last Hardware Date:  ${hardwareDates[hardwareDates.length - 1]}`);
    } else {
        console.log('CRITICAL: NO HARDWARE DATES FOUND.');
        console.log('Sample of last processable chunk start (to check for encoding/format):');
        console.log(tail.substring(0, 500));
    }
}

const targetFile = path.join(__dirname, '..', 'data', 'export.xml');
diagnoseXML(targetFile).catch(err => console.error(err));
