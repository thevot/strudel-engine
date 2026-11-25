/**
 * Pattern preview — the events a track's code will play, WITHOUT executing the code.
 *
 * Track code is arbitrary JavaScript and may come from a shared link, so drawing a
 * clip must never `eval` it. Instead the source is parsed and interpreted over an
 * allow-list: Strudel's own pattern functions and methods, called with literals.
 * The events therefore come from the same engine that plays the track; anything
 * outside the allow-list is reported as unsupported rather than guessed at.
 *
 * License: GNU Affero General Public License v3.0 (AGPLv3)
 */
import * as core from '@strudel/core';
import { mini, miniAllStrings } from '@strudel/mini';
import '@strudel/tonal'; // registers .scale(), .transpose(), .voicing() …
import { parse } from 'acorn';

const MAX_CODE_LENGTH = 20000;
const MAX_EVENTS = 20000;
/** Upper bound on the combined event multiplication (`fast`, `*n`, …) one query may face. */
const MAX_DENSITY = 4096;
/** How far before the range to look for notes that are still sounding when it starts. */
const LOOKBACK_CYCLES = 8;

const FUNCTIONS = new Set([
    'stack', 'cat', 'seq', 'sequence', 'fastcat', 'slowcat', 'arrange', 'timeCat', 'timecat', 'stepcat',
    'note', 'n', 's', 'sound', 'run', 'chord',
    'fast', 'slow', 'rev', 'palindrome', 'ply', 'add', 'sub', 'mul', 'div', 'transpose', 'scale', 'late', 'early', 'struct', 'mask',
]);

const SIGNALS = new Set([
    'silence', 'sine', 'cosine', 'saw', 'isaw', 'tri', 'square', 'sine2', 'cosine2', 'saw2', 'isaw2', 'tri2', 'square2', 'rand', 'rand2', 'perlin',
]);

/** Functions that may be passed by name, as in `.every(4, rev)`. */
const TRANSFORMS = new Set(['rev', 'palindrome', 'brak', 'degrade', 'invert']);

const METHODS = new Set([
    // time and structure
    'fast', 'slow', 'late', 'early', 'struct', 'mask', 'euclid', 'euclidRot', 'euclidLegato', 'swing', 'swingBy',
    'rev', 'palindrome', 'brak', 'iter', 'iterBack', 'ply', 'segment', 'hurry', 'linger', 'zoom', 'compress',
    'fastGap', 'press', 'pressBy', 'inside', 'outside', 'ribbon', 'off', 'jux', 'juxBy', 'superimpose', 'layer',
    'echo', 'stut', 'chop', 'striate', 'slice', 'splice', 'loopAt', 'fit', 'arp',
    // conditional and random (Strudel's randomness is a function of time: same as playback)
    'every', 'firstOf', 'lastOf', 'when', 'chunk', 'sometimes', 'sometimesBy', 'someCycles', 'someCyclesBy',
    'often', 'rarely', 'almostAlways', 'almostNever', 'degrade', 'degradeBy', 'undegradeBy',
    // values
    'add', 'sub', 'mul', 'div', 'set', 'invert', 'range', 'range2', 'rangex', 'round', 'floor', 'ceil',
    'scale', 'scaleTranspose', 'transpose', 'voicing', 'voicings', 'rootNotes', 'adsr',
]);

/** Methods whose numeric arguments multiply the number of events. */
const DENSIFYING = new Set(['fast', 'ply', 'segment', 'hurry', 'chop', 'striate', 'echo', 'stut', 'run']);

class Unsupported extends Error { }

/** How much `*x` (or `/x`, which speeds up when x < 1) multiplies the events. */
const factorOf = (operator, value) => {
    const x = Math.abs(value);
    if (operator === '/') return x > 0 && x < 1 ? 1 / x : 1;
    return Math.max(1, x);
};

/**
 * The largest event multiplication inside a mini-notation string: factors multiply
 * when chained or nested (`[a*8]*8`), not when they sit side by side (`a*8 b*8`).
 * A factor may itself be a pattern (`a*<2 4>`): its largest number counts.
 */
function miniDensity(text) {
    const open = () => ({ max: 1, last: 1, number: 1, operator: null });
    const groups = [open()];
    const tokens = text.match(/[[<{(]|[\]>})]|[*!/]\s*\d*\.?\d+(?:e\d+)?|[*!/]|[\s,|]+|[^[\]<>{}()*!/\s,|]+/g) || [];
    for (const token of tokens) {
        const group = groups[groups.length - 1];
        if ('[<{('.includes(token[0])) {
            groups.push(open());
        } else if (']>})'.includes(token[0])) {
            if (groups.length === 1) continue;
            const inner = groups.pop();
            const parent = groups[groups.length - 1];
            if (parent.operator) {
                parent.last *= factorOf(parent.operator, inner.number);
                parent.operator = null;
            } else if (token !== ')') {
                parent.last = inner.max;
            }
            parent.number = Math.max(parent.number, inner.number);
            parent.max = Math.max(parent.max, inner.max, parent.last);
        } else if ('*!/'.includes(token[0])) {
            if (token.length === 1) {
                group.operator = token;
            } else {
                group.last *= factorOf(token[0], Number(token.slice(1)));
                group.max = Math.max(group.max, group.last);
            }
        } else if (/[^\s,|]/.test(token)) {
            const value = Number(token);
            if (Number.isFinite(value)) group.number = Math.max(group.number, Math.abs(value));
            if (group.operator) {
                group.operator = null;
            } else {
                group.last = 1;
            }
        }
    }
    return Math.max(...groups.map(g => g.max));
}

/** The largest number written anywhere in a syntax node, including inside strings. */
function largestNumberIn(node) {
    if (!node || typeof node.type !== 'string') return 0;
    if (node.type === 'Literal' || node.type === 'TemplateElement') {
        const text = String(node.type === 'Literal' ? node.value : node.value.cooked);
        return Math.max(0, ...(text.match(/\d*\.?\d+(?:e\d+)?/g) || []).map(Number));
    }
    // a function argument is interpreted on its own, and pays for its own factors
    if (node.type === 'ArrowFunctionExpression') return 0;
    return Math.max(0, ...Object.values(node).flat()
        .filter(child => child && typeof child.type === 'string')
        .map(largestNumberIn));
}

let stringParserReady = false;

function createInterpreter(cps) {
    // method factors compound; mini-notation strings contribute their densest one
    let methodDensity = 1;
    let stringDensity = 1;
    const checkDensity = () => {
        if (!(methodDensity * stringDensity <= MAX_DENSITY)) throw new Unsupported('pattern too dense to preview');
    };
    const spend = (factor) => {
        methodDensity *= Math.max(1, Math.abs(factor));
        checkDensity();
    };
    const measure = (text) => {
        stringDensity = Math.max(stringDensity, miniDensity(text));
        checkDensity();
    };
    const miniPattern = (text) => {
        measure(text);
        return mini(text);
    };

    // a call's factor may be a number, arithmetic, a string or a signal: bound them all
    const spendOnArguments = (name, node, values) => {
        if (name === 'slow') {
            values.filter((v) => typeof v === 'number').forEach((v) => spend(factorOf('/', v)));
        } else if (DENSIFYING.has(name)) {
            const written = node.arguments.map(largestNumberIn);
            spend(Math.max(1, ...written, ...values.filter((v) => typeof v === 'number').map(Math.abs)));
        }
    };

    const evaluate = (node, scope) => {
        switch (node.type) {
            case 'Literal':
                if (typeof node.value === 'number') return node.value;
                if (typeof node.value === 'string') {
                    // like Strudel's transpiler: double quotes are mini-notation
                    if (node.raw.startsWith('"')) return miniPattern(node.value);
                    measure(node.value); // plain strings are still parsed as mini-notation
                    return node.value;
                }
                throw new Unsupported('unsupported literal');
            case 'TemplateLiteral':
                if (node.expressions.length > 0) throw new Unsupported('template expressions');
                return miniPattern(node.quasis[0].value.cooked);
            case 'ArrayExpression':
                return node.elements.map((el) => {
                    if (!el || el.type === 'SpreadElement') throw new Unsupported('array spread');
                    return evaluate(el, scope);
                });
            case 'UnaryExpression': {
                const v = evaluate(node.argument, scope);
                if (node.operator === '-' && typeof v === 'number') return -v;
                throw new Unsupported(`operator ${node.operator}`);
            }
            case 'BinaryExpression': {
                const a = evaluate(node.left, scope);
                const b = evaluate(node.right, scope);
                if (typeof a === 'number' && typeof b === 'number') {
                    if (node.operator === '+') return a + b;
                    if (node.operator === '-') return a - b;
                    if (node.operator === '*') return a * b;
                    if (node.operator === '/') return a / b;
                }
                throw new Unsupported(`operator ${node.operator}`);
            }
            case 'Identifier':
                if (scope.has(node.name)) return scope.get(node.name);
                if (SIGNALS.has(node.name) || TRANSFORMS.has(node.name)) return core[node.name];
                throw new Unsupported(`"${node.name}"`);
            case 'ArrowFunctionExpression': {
                const [param] = node.params;
                if (node.params.length !== 1 || param.type !== 'Identifier' || node.body.type === 'BlockStatement') {
                    throw new Unsupported('this kind of function');
                }
                return (x) => evaluate(node.body, new Map(scope).set(param.name, x));
            }
            case 'CallExpression':
                return call(node, scope);
            default:
                throw new Unsupported(node.type);
        }
    };

    const call = (node, scope) => {
        const { callee } = node;
        const args = () => node.arguments.map((a) => {
            if (a.type === 'SpreadElement') throw new Unsupported('spread arguments');
            return evaluate(a, scope);
        });

        if (callee.type === 'Identifier') {
            const { name } = callee;
            if (name === 'mini' || name === 'm') return core.stack(...args().map((v) => (typeof v === 'string' ? miniPattern(v) : v)));
            if (!FUNCTIONS.has(name) || typeof core[name] !== 'function') throw new Unsupported(`${name}()`);
            const values = args();
            spendOnArguments(name, node, values);
            return core[name](...values);
        }

        if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
            const target = evaluate(callee.object, scope);
            const name = callee.property.name;
            const pattern = typeof target === 'string' ? core.reify(target) : target;
            if (!core.isPattern(pattern)) throw new Unsupported(`.${name}() on a non-pattern`);
            const values = args();
            if (name === 'cpm') {
                const [cpm] = values;
                if (typeof cpm !== 'number' || !(cpm > 0)) throw new Unsupported('.cpm() with a pattern');
                // `.cpm` is relative to the scheduler tempo (registered by the repl)
                spend(cpm / 60 / cps);
                return pattern.fast(cpm / 60 / cps);
            }
            if (!(METHODS.has(name) || core.isControlName(name)) || typeof pattern[name] !== 'function') {
                throw new Unsupported(`.${name}()`);
            }
            spendOnArguments(name, node, values);
            return pattern[name](...values);
        }

        throw new Unsupported('this kind of call');
    };

    return (node) => evaluate(node, new Map());
}

/** The single pattern expression of a track, plus the tempo it sets, if any. */
function readProgram(code) {
    let program;
    try {
        program = parse(code, { ecmaVersion: 2022 });
    } catch {
        throw new Unsupported('syntax error');
    }
    let expression = null;
    let tempo = null;
    for (const statement of program.body) {
        if (statement.type === 'EmptyStatement') continue;
        if (statement.type !== 'ExpressionStatement') throw new Unsupported(statement.type);
        const e = statement.expression;
        const name = e.type === 'CallExpression' && e.callee.type === 'Identifier' ? e.callee.name : null;
        if (/^set(cps|cpm)$/i.test(name || '')) { tempo = { name: name.toLowerCase(), node: e.arguments[0] }; continue; }
        if (name === 'samples') continue; // loads sounds, adds no events
        if (expression) throw new Unsupported('more than one pattern');
        expression = e;
    }
    return { expression, tempo };
}

function describe(value) {
    const v = value && typeof value === 'object' ? value : { value };
    let midi = null;
    if (typeof v.note === 'number') midi = v.note;
    else if (typeof v.note === 'string') {
        try { midi = core.noteToMidi(v.note); } catch { /* not a note name */ }
    }
    const sound = typeof v.s === 'string' ? v.s : null;
    // a bare `n` is a pitch unless it picks a sample of a sound
    if (midi === null && !sound && typeof v.n === 'number') midi = v.n;
    const label = sound
        ? `${sound}${v.n !== undefined && midi === null ? `:${v.n}` : ''}`
        : String(v.note ?? v.n ?? v.value ?? '');
    return { midi, label };
}

/**
 * @param {string} code - track code
 * @param {number} begin - first cycle of the range (one cycle = one 4/4 bar of the DAW)
 * @param {number} end - end of the range, in cycles
 * @param {{ bpm?: number }} [options]
 * @returns {{ supported: true, truncated: boolean,
 *             events: Array<{ begin: number, end: number, midi: number|null, label: string }> }
 *          | { supported: false, reason: string, events: [] }}
 */
export function queryPatternEvents(code, begin, end, { bpm = 120 } = {}) {
    const unsupported = (reason) => ({ supported: false, reason, events: [] });
    const source = String(code ?? '');
    if (source.length > MAX_CODE_LENGTH) return unsupported('code too long to preview');
    if (!(end > begin)) return { supported: true, truncated: false, events: [] };
    if (!stringParserReady) {
        miniAllStrings();
        stringParserReady = true;
    }

    try {
        const { expression, tempo } = readProgram(source);
        if (!expression) return { supported: true, truncated: false, events: [] };
        let cps = (bpm > 0 ? bpm : 120) / 240;
        if (tempo?.node) {
            const v = createInterpreter(cps)(tempo.node);
            if (typeof v === 'number' && v > 0) cps = tempo.name === 'setcpm' ? v / 60 : v;
        }
        const pattern = createInterpreter(cps)(expression);
        if (!core.isPattern(pattern)) return unsupported('not a pattern');

        const events = [];
        let truncated = false;
        const first = Math.max(0, Math.floor(begin) - LOOKBACK_CYCLES);
        for (let cycle = first; cycle < Math.ceil(end) && !truncated; cycle++) {
            // one cycle at a time, so a long range can stop early
            for (const hap of pattern.queryArc(cycle, cycle + 1, { _cps: cps })) {
                if (!hap.hasOnset()) continue;
                const start = Number(hap.whole.begin.valueOf());
                const stop = start + Number(hap.duration.valueOf()); // honours .clip()/.legato()
                if (stop <= begin || start >= end) continue;
                if (events.length >= MAX_EVENTS) { truncated = true; break; }
                events.push({ begin: start, end: stop, ...describe(hap.value) });
            }
        }
        events.sort((a, b) => a.begin - b.begin);
        return { supported: true, truncated, events };
    } catch (err) {
        return unsupported(err instanceof Unsupported ? err.message : (err?.message || String(err)));
    }
}
