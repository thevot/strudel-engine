/**
 * Sample priming: download the sounds a pattern opens with before the scheduler starts.
 *
 * Strudel fetches a sample when its first event is scheduled, about 100 ms before it
 * has to sound; a download that takes longer drops the note.
 *
 * License: GNU Affero General Public License v3.0 (AGPLv3)
 */
import { getSound, getSampleBuffer } from '@strudel/web';

const CYCLES = 4;
const MAX_SOUNDS = 64;
/** The longest Play waits for downloads; after that the notes arrive as they load. */
export const PRIME_MAX_WAIT_MS = 2500;

/** The distinct sounds of the first cycles, split into the opening cycle and the rest. */
function openingSounds(pattern, cps) {
    const seen = new Set();
    const opening = [];
    const later = [];
    for (let cycle = 0; cycle < CYCLES; cycle++) {
        for (const hap of pattern.queryArc(cycle, cycle + 1, { _cps: cps })) {
            const value = hap.value;
            if (!hap.hasOnset() || typeof value?.s !== 'string' || seen.size >= MAX_SOUNDS) continue;
            const key = JSON.stringify([value.s, value.bank, value.n, value.note, value.freq]);
            if (seen.has(key)) continue;
            seen.add(key);
            (cycle === 0 ? opening : later).push(value);
        }
    }
    return { opening, later };
}

/** Download one sound into the cache playback reads; synths and soundfonts have nothing to fetch. */
async function load(value) {
    try {
        const sound = getSound(value.bank ? `${value.bank}_${value.s}` : value.s);
        if (sound?.data?.type !== 'sample') return;
        await getSampleBuffer(value, sound.data.samples);
    } catch { /* playback reports the sound itself */ }
}

/**
 * Resolve once the opening cycle's samples are ready, or after the time limit.
 * Later cycles keep downloading in the background. Never rejects.
 */
export async function primeSamples(pattern, cps) {
    let sounds;
    try {
        sounds = openingSounds(pattern, cps);
    } catch {
        return;
    }
    const opening = Promise.all(sounds.opening.map(load));
    sounds.later.forEach(load);
    let timer;
    await Promise.race([opening, new Promise((resolve) => { timer = setTimeout(resolve, PRIME_MAX_WAIT_MS); })]);
    clearTimeout(timer);
}
