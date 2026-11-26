/**
 * Arrangement gate: a track that follows the arrangement is heard only where it has a clip.
 *
 * The pattern is filtered, not rebuilt: it keeps counting from the start of the song, so a
 * clip opens a window on the track and never restarts it. The song is `totalBars` cycles
 * long (one cycle per 4/4 bar) and then repeats, like the timeline's playhead.
 *
 * License: GNU Affero General Public License v3.0 (AGPLv3)
 */

const BEATS_PER_CYCLE = 4;
/** Absorbs the rounding of positions such as thirds of a cycle. */
const EPSILON = 1e-9;

/**
 * The parts of the song where a track is heard.
 * @param {Array<{startBeat: number, lengthBeats: number}>|undefined} clips the track's clips
 * @param {number} totalBars length of the song
 * @returns {Array<[number, number]>|null} merged `[from, to)` ranges in cycles; `null` when the
 *   track has no clips and is always heard; empty when every clip lies outside the song
 */
export function audibleIntervals(clips, totalBars) {
    if (!Array.isArray(clips) || clips.length === 0 || !(totalBars > 0)) return null;
    const ranges = clips
        .map((clip) => {
            const start = Number(clip?.startBeat) || 0;
            const end = start + (Number(clip?.lengthBeats) || 0);
            return [Math.max(0, start / BEATS_PER_CYCLE), Math.min(totalBars, end / BEATS_PER_CYCLE)];
        })
        .filter(([from, to]) => to > from)
        .sort((a, b) => a[0] - b[0]);

    const merged = [];
    for (const [from, to] of ranges) {
        const last = merged[merged.length - 1];
        if (last && from <= last[1]) last[1] = Math.max(last[1], to);
        else merged.push([from, to]);
    }
    return merged;
}

/** Whether a note starting at `cycle` of the transport falls inside one of the ranges. */
export function isAudibleAt(cycle, intervals, totalBars) {
    const position = ((cycle % totalBars) + totalBars) % totalBars;
    return intervals.some(([from, to]) => position >= from - EPSILON && position < to - EPSILON);
}

/** Keep the events of `pattern` that start inside the ranges. */
export function gatePattern(pattern, intervals, totalBars) {
    return pattern.filterHaps(
        (hap) => isAudibleAt(Number((hap.whole ?? hap.part).begin.valueOf()), intervals, totalBars),
    );
}
