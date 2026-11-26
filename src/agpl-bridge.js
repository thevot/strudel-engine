/**
 * Open Source AGPLv3 Strudel Core Bridge Component
 * 
 * License: GNU Affero General Public License v3.0 (AGPLv3)
 * Upstream Project: Strudel (https://strudel.cc) by Felix Roos & Contributors
 */

import {
  initStrudel,
  evaluate as strudelEvaluate,
  getSound,
  Pattern,
  superdough,
  samples,
  aliasBank,
  getAudioContext as getStrudelCtx,
} from '@strudel/web';
import { registerSoundfonts } from '@strudel/soundfonts';
import { createTransportClock } from './transportClock.js';
import { primeSamples } from './samplePriming.js';
import { audibleIntervals, gatePattern } from './arrangementGate.js';

let initialized = false;
let ctx = null;       // AudioContext
let analyser = null;  // AnalyserNode for visualizations
let masterTap = null; // GainNode mirroring the master bus
let repl = null;      // Strudel repl: owns the scheduler
let patternVersion = 0; // bumped whenever new code takes over the scheduler
const transportClock = createTransportClock();
let currentCps = 0.5;
let engineIsPlaying = false;
let activePreviewHandle = null;
let runToken = 0;       // changes when a newer evaluation or Stop overrides a waiting one
let ungatedSources = []; // tracks as written, collected while gated code is evaluated

let gateInstalled = false;

/**
 * Make `.__strudawGate(ranges, totalBars)` available to the code evaluateAll() writes.
 * Installed once per copy of this module: a reloaded module must replace the old method.
 */
function installArrangementGate() {
  if (gateInstalled) return;
  gateInstalled = true;
  Object.defineProperty(Pattern.prototype, '__strudawGate', {
    configurable: true,
    value(intervals, totalBars) {
      ungatedSources.push(this);
      return gatePattern(this, intervals, totalBars);
    },
  });
}

/** The longest init() waits for each optional sample list it needs at the first Play. */
const SAMPLE_LIST_MAX_WAIT_MS = 3000;
const previewBufferCache = new Map();

let initializing = null;

/** Start the engine once; calls made while it starts share the same attempt. */
export function init() {
  if (initialized) return Promise.resolve();
  initializing ??= startEngine().finally(() => { initializing = null; });
  return initializing;
}

async function startEngine() {

  const STRUDEL_CDN = 'https://strudel.b-cdn.net';

  repl = await initStrudel({
    prebake: async () => {
      const optional = (label, promise) =>
        promise.catch((err) => console.warn(`[AGPLBridge] ${label} unavailable:`, err.message));

      // Wait for an optional list, but never let it hold the engine back
      const within = (promise) => {
        let timer;
        const limit = new Promise((resolve) => { timer = setTimeout(resolve, SAMPLE_LIST_MAX_WAIT_MS); });
        return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
      };

      // `piano` is the default instrument of the note editors, so it must exist at the first Play
      const piano = optional('piano samples', samples(`${STRUDEL_CDN}/piano.json`, `${STRUDEL_CDN}/piano/`));

      await Promise.all([
        samples(`${STRUDEL_CDN}/tidal-drum-machines.json`, `${STRUDEL_CDN}/tidal-drum-machines/machines/`),
        samples('github:tidalcycles/dirt-samples'),
        within(piano),
      ]);

      // The uzu kit redefines `bd`, `hh`, `sd` and more: it comes after dirt-samples so that
      // it wins, and before the first Play so that those sounds do not change under the song.
      await within(optional('uzu drumkit', samples(`${STRUDEL_CDN}/uzu-drumkit.json`, `${STRUDEL_CDN}/uzu-drumkit/`)));

      try {
        await aliasBank(`${STRUDEL_CDN}/tidal-drum-machines-alias.json`);
      } catch (err) {
        console.warn('[AGPLBridge] Drum machine aliases unavailable:', err.message);
      }

      try {
        registerSoundfonts();
      } catch (err) {
        console.warn('[AGPLBridge] GM soundfonts unavailable:', err.message);
      }

      const loadExtras = () => {
        Promise.all([
          optional('VCSL samples', samples(`${STRUDEL_CDN}/vcsl.json`, `${STRUDEL_CDN}/VCSL/`)),
          optional('uzu wavetables', samples(`${STRUDEL_CDN}/uzu-wavetables.json`, `${STRUDEL_CDN}/uzu-wavetables/`)),
          optional('mridangam samples', samples(`${STRUDEL_CDN}/mridangam.json`, `${STRUDEL_CDN}/mrid/`)),
        ]);
      };

      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(loadExtras, { timeout: 5000 });
      } else {
        setTimeout(loadExtras, 3000);
      }
    },
  });

  try {
    ctx = getStrudelCtx();
  } catch {
    ctx = window._superdough_ac
      || window._strudelAudioContext
      || new (window.AudioContext || window.webkitAudioContext)();
  }

  if (ctx) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;

    masterTap = ctx.createGain();
    masterTap.gain.value = 1.0;

    if (!AudioNode.prototype.__strudawTapInstalled) {
      const origConnect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (destination, ...args) {
        const result = origConnect.apply(this, [destination, ...args]);
        if (
          this.context === ctx &&
          destination === ctx.destination &&
          this !== analyser &&
          this !== masterTap
        ) {
          try { origConnect.call(this, analyser); } catch { /* noop */ }
          try { origConnect.call(this, masterTap); } catch { /* noop */ }
        }
        return result;
      };
      Object.defineProperty(AudioNode.prototype, '__strudawTapInstalled', {
        value: true,
        writable: false,
        configurable: false,
        enumerable: false,
      });
    }

    console.log('[AGPLBridge] AudioContext and Analyser hooked successfully');
  }

  initialized = true;
  console.log('[AGPLBridge] Strudel Engine AGPL Core Initialized');
}

/**
 * Hand code to the scheduler. While it runs the pattern is swapped at once; when it is
 * stopped, it starts only after the opening samples are downloaded.
 * @returns {Promise<boolean>} false when Stop or newer code arrived during that wait
 */
async function runCode(code) {
  const token = ++runToken;
  patternVersion += 1;
  ungatedSources = [];
  const scheduler = repl?.scheduler;
  // A track that enters later in the arrangement needs its samples by then too
  const primeGatedTracks = () => ungatedSources.splice(0).forEach((track) => primeSamples(track, scheduler?.cps));
  if (scheduler?.started !== false || typeof scheduler.start !== 'function') {
    await strudelEvaluate(code);
    primeGatedTracks();
    return true;
  }
  const pattern = await strudelEvaluate(code, false);
  primeGatedTracks();
  if (pattern && token === runToken) await primeSamples(pattern, scheduler.cps);
  if (token !== runToken) return false;
  if (pattern) scheduler.start();
  return true;
}

export async function evaluate(code) {
  try {
    if (!initialized) await init();
    if (!await runCode(code)) return { error: null, cancelled: true };
    return { error: null };
  } catch (err) {
    console.error('[AGPLBridge] Evaluation error:', err);
    return { error: err.message || String(err) };
  }
}

export async function evaluateAll(tracks, bpm, options = {}) {
  try {
    if (!initialized) await init();
  } catch (err) {
    console.error('[AGPLBridge] Init failed during evaluateAll:', err);
    return { error: `Engine init failed: ${err.message || String(err)}` };
  }

  const hasSolo = tracks.some(t => t.solo);
  const activeTracks = tracks.filter(t => {
    if (hasSolo) return t.solo && !t.muted;
    return !t.muted;
  });

  if (activeTracks.length === 0) {
    return evaluate('silence');
  }

  const tempoRegex = /^\s*set(?:cpm|cps)\s*\([^)]+\)\s*;?\s*$/gm;
  const tempoStatements = [];
  const wrappedParts = activeTracks.map(t => {
    const vol = t.volume !== undefined ? t.volume : 0.8;
    const pan = t.pan !== undefined ? t.pan : 0;
    let code = t.code;

    code = code.replace(tempoRegex, (match) => {
      tempoStatements.push(match.trim());
      return '';
    }).trim();

    code = code.split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n')
      .trim();

    if (!code || code === 'silence') return null;
    // Without an arrangement the code below is the same as for a project that ignores it
    const arrangement = options.arrangement;
    const ranges = arrangement ? audibleIntervals(arrangement.clips?.[t.id], arrangement.totalBars) : null;
    let wrapped = `(${code}).gain(${vol.toFixed(2)})`;
    if (pan !== 0) {
      wrapped += `.pan(${pan.toFixed(2)})`;
    }
    if (Array.isArray(t.sends)) {
      if (t.sends[0] > 0) wrapped += `.room(${t.sends[0].toFixed(2)})`;
      if (t.sends[1] > 0) wrapped += `.delay(${t.sends[1].toFixed(2)})`;
    }
    if (Array.isArray(t.inserts)) {
      const INSERT_EFFECTS = {
        LPF: '.lpf(1000)',
        HPF: '.hpf(500)',
        Room: '.room(0.5)',
        Distort: '.distort(1.5)',
        Delay: '.delay(0.3)',
      };
      for (const ins of t.inserts) {
        if (ins && INSERT_EFFECTS[ins]) {
          wrapped += `${INSERT_EFFECTS[ins]}`;
        }
      }
    }
    if (ranges) {
      installArrangementGate();
      wrapped += `.__strudawGate(${JSON.stringify(ranges)}, ${arrangement.totalBars})`;
    }
    return wrapped;
  }).filter(Boolean);

  if (wrappedParts.length === 0) {
    return evaluate('silence');
  }

  const tempoLine = tempoStatements.length > 0
    ? tempoStatements[tempoStatements.length - 1]
    : `setcps(${bpmToCps(bpm || 120)})`;

  if (options.metronome) {
    wrappedParts.push(`s("hh*4").gain(0.12)`);
  }

  let combined;
  if (wrappedParts.length === 1) {
    combined = `${tempoLine};\n${wrappedParts[0]}`;
  } else {
    combined = `${tempoLine};\nstack(\n  ${wrappedParts.join(',\n  ')}\n)`;
  }

  try {
    if (!await runCode(combined)) return { error: null, cancelled: true };
    currentCps = bpmToCps(bpm || 120);
    return { error: null };
  } catch (err) {
    console.error('[AGPLBridge] Multi-track evaluation error:', err);
    return { error: `Evaluation failed: ${err.message || String(err)}` };
  }
}

export async function stop() {
  try {
    if (!initialized) return;
    runToken += 1; // a Play still waiting for samples must not start afterwards
    // The scheduler itself must stop: `hush()` only swaps in silence and leaves the
    // cycle counter running, so the next Play would start at an arbitrary point.
    if (repl?.stop) repl.stop();
    else await strudelEvaluate('hush()');
    transportClock.reset();
  } catch (err) {
    console.warn('[AGPLBridge] Stop error (safe catch):', err?.message || String(err));
  }
}

function parseSampleId(sampleName) {
  const colon = sampleName.indexOf(':');
  if (colon === -1) return { s: sampleName, n: 0 };
  const head = sampleName.slice(0, colon);
  const tail = sampleName.slice(colon + 1);
  const idx = Number.parseInt(tail, 10);
  return { s: head, n: Number.isFinite(idx) ? idx : 0 };
}

function resolveSampleUrl(sampleName) {
  const { s, n } = parseSampleId(sampleName);
  let entry;
  try { entry = typeof getSound === 'function' ? getSound(s) : null; }
  catch { return { unknown: true }; }
  if (!entry) return { unknown: true };
  const samples = entry.data?.samples;
  if (!samples) return { soundfont: true };

  if (Array.isArray(samples)) {
    return { url: samples[n % samples.length] || samples[0] || null };
  }
  if (typeof samples === 'object') {
    const flat = Object.values(samples).flat();
    return { url: flat[n % flat.length] || flat[0] || null };
  }
  return { unknown: true };
}

async function loadPreviewBuffer(url) {
  if (!ctx) return null;
  if (previewBufferCache.has(url)) return previewBufferCache.get(url);
  const promise = (async () => {
    const safeUrl = url.replace('#', '%23');
    const res = await fetch(safeUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${safeUrl}`);
    const arr = await res.arrayBuffer();
    return await ctx.decodeAudioData(arr);
  })();
  previewBufferCache.set(url, promise);
  promise.catch(() => previewBufferCache.delete(url));
  return promise;
}

export function stopPreview() {
  const h = activePreviewHandle;
  if (h) {
    activePreviewHandle = null;
    try { h.stop(); } catch (err) { console.warn('[AGPLBridge] stopPreview error:', err); }
  }
}

export async function previewSound(sampleName) {
  if (!initialized) await init();

  if (ctx && typeof ctx.resume === 'function' && ctx.state === 'suspended') {
    try { await ctx.resume(); } catch (err) { console.warn('[AGPLBridge] AudioContext resume failed:', err); }
  }

  stopPreview();

  let endedResolve;
  const ended = new Promise((resolve) => { endedResolve = resolve; });

  let stopped = false;
  let cleanup = () => { };
  const handle = {
    stop() {
      if (stopped) return;
      stopped = true;
      try { cleanup(); } catch (err) { console.warn('[AGPLBridge] preview cleanup error:', err); }
      endedResolve();
    },
    ended,
  };
  activePreviewHandle = handle;

  try {
    let buffer = null;
    const resolved = resolveSampleUrl(sampleName);
    const url = resolved?.url || null;
    const isSoundfont = resolved?.soundfont === true;
    if (url) {
      try { buffer = await loadPreviewBuffer(url); }
      catch (err) { console.warn('[AGPLBridge] preview buffer load failed:', err); }
    }

    if (stopped) return handle;

    if (buffer && ctx) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = false;

      const gain = ctx.createGain();
      gain.gain.value = 1;

      source.connect(gain);
      gain.connect(ctx.destination);

      let disconnected = false;
      const disconnectAll = () => {
        if (disconnected) return;
        disconnected = true;
        try { source.disconnect(); } catch { /* noop */ }
        try { gain.disconnect(); } catch { /* noop */ }
      };

      source.onended = () => {
        disconnectAll();
        if (activePreviewHandle === handle) activePreviewHandle = null;
        if (!stopped) { stopped = true; endedResolve(); }
      };

      cleanup = () => {
        try {
          const now = ctx.currentTime;
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0, now + 0.02);
          source.stop(now + 0.03);
        } catch { disconnectAll(); }
        if (activePreviewHandle === handle) activePreviewHandle = null;
      };

      try { source.start(); }
      catch (err) {
        disconnectAll();
        if (activePreviewHandle === handle) activePreviewHandle = null;
        if (!stopped) { stopped = true; endedResolve(); }
      }

      return handle;
    }

    if (typeof superdough === 'function' && ctx) {
      const duration = 1;
      const callOnce = async () => {
        const startedAt = ctx.currentTime;
        let threw = false;
        try { await superdough({ s: sampleName }, startedAt, duration); }
        catch (err) { threw = true; }
        const elapsed = ctx.currentTime - startedAt;
        return { threw, elapsed };
      };
      try {
        let { threw, elapsed } = await callOnce();
        let attempts = 1;
        while ((threw || (isSoundfont && elapsed > 0.05)) && !stopped && attempts < 3) {
          attempts += 1;
          ({ threw, elapsed } = await callOnce());
        }
      } catch (err) {
        console.warn('[AGPLBridge] superdough preview failed:', err);
      }
      const ms = Math.ceil(duration * 1000) + 50;
      const timer = setTimeout(() => {
        if (activePreviewHandle === handle) activePreviewHandle = null;
        if (!stopped) { stopped = true; endedResolve(); }
      }, ms);
      cleanup = () => {
        clearTimeout(timer);
        if (activePreviewHandle === handle) activePreviewHandle = null;
      };
      return handle;
    }

    if (activePreviewHandle === handle) activePreviewHandle = null;
    if (!stopped) { stopped = true; endedResolve(); }
    return handle;
  } catch (err) {
    if (activePreviewHandle === handle) activePreviewHandle = null;
    if (!stopped) { stopped = true; endedResolve(); }
    return handle;
  }
}

export async function setCps(cps) {
  try {
    // Set the tempo on the scheduler: evaluating `setcps()` as code would replace the
    // running pattern with silence (and start a stopped scheduler).
    if (repl?.scheduler) repl.scheduler.setCps(cps);
    else await strudelEvaluate(`setcps(${cps})`);
  } catch (err) {
    console.error('[AGPLBridge] setCps error:', err);
  }
}

export function bpmToCps(bpm) { return bpm / 60 / 4; }
export function cpsToBpm(cps) { return cps * 60 * 4; }
export function getAudioContext() { return ctx; }
export function getAnalyser() { return analyser; }
export function getMasterTap() { return masterTap; }
export function isInitialized() { return initialized; }
export function getCyclePosition() { return transportClock.position(repl?.scheduler, ctx); }
export function getPatternVersion() { return patternVersion; }
export function getCurrentCps() { return repl?.scheduler?.cps ?? currentCps; }
export function setEnginePlayState(playing) { engineIsPlaying = playing; }

export function previewNote(midiNote, durationSec = 0.35) {
  if (!ctx) return;
  if (ctx.state !== 'suspended') {
    playNote(midiNote, durationSec);
    return;
  }
  // A context created after the click that asked for the note may need to be woken.
  const requestedAt = Date.now();
  ctx.resume?.()?.then(() => {
    if (ctx.state !== 'suspended' && Date.now() - requestedAt <= PREVIEW_MAX_WAIT_MS) playNote(midiNote, durationSec);
  }).catch(() => { });
}

function playNote(midiNote, durationSec) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durationSec + 0.05);
  } catch { /* ignore */ }
}

const PREVIEW_WAVEFORMS = ['sawtooth', 'square', 'triangle', 'sine'];
/** superdough drops sounds scheduled in the past: leave it a few ms of headroom. */
const PREVIEW_LEAD_SEC = 0.01;
/** A sample that took longer than this to download is no longer a response to the click. */
const PREVIEW_MAX_WAIT_MS = 1500;
const SAFE_BANK = /^[A-Za-z0-9_]+$/;
const SAFE_SAMPLE = /^[A-Za-z0-9_]+(:[0-9]{1,2})?$/;

/** `bd:3` on bank X → the same sound a pattern's `.bank(X)` would trigger. */
function resolveDrumUrl(sampleName, bank) {
  const { s, n } = parseSampleId(sampleName);
  return resolveSampleUrl(`${bank}_${s}:${n}`);
}

/** Download and decode drum samples ahead of time, so their first audition is immediate. */
export async function preloadDrums(sounds) {
  if (!initialized || !Array.isArray(sounds)) return;
  await Promise.all(sounds.map(async ({ sample, bank } = {}) => {
    if (typeof sample !== 'string' || !SAFE_SAMPLE.test(sample) || !SAFE_BANK.test(bank || '')) return;
    const url = resolveDrumUrl(sample, bank)?.url;
    if (url) await loadPreviewBuffer(url)?.catch(() => { });
  }));
}

function playOneShot(buffer, level) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = level;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.onended = () => {
    try { source.disconnect(); gain.disconnect(); } catch { /* noop */ }
  };
  source.start();
}

/**
 * Audition a drum sample (or, with `note`, a synth waveform at that MIDI pitch) as a
 * one-shot, immediately. Nothing is ever evaluated: an evaluated pattern would loop,
 * replace the running song and only sound on the scheduler's next cycle.
 */
export async function previewDrum(sampleName, bank = 'RolandTR808', note) {
  if (!initialized || !ctx) return;
  if (typeof sampleName !== 'string' || !SAFE_SAMPLE.test(sampleName)) return;
  const safeBank = typeof bank === 'string' && SAFE_BANK.test(bank) ? bank : 'RolandTR808';
  const isSynth = PREVIEW_WAVEFORMS.includes(sampleName) && Number.isFinite(note) && note >= 0 && note <= 127;
  try {
    if (ctx.state === 'suspended') await ctx.resume?.();
    if (!isSynth) {
      const url = resolveDrumUrl(sampleName, safeBank)?.url;
      if (url) {
        const requestedAt = Date.now();
        const buffer = await loadPreviewBuffer(url);
        if (buffer && Date.now() - requestedAt <= PREVIEW_MAX_WAIT_MS) playOneShot(buffer, 0.8);
        return;
      }
    }
    if (typeof superdough !== 'function') return;
    const value = isSynth ? { s: sampleName, note: Math.round(note), gain: 0.5 } : { s: sampleName, bank: safeBank, gain: 0.8 };
    await superdough(value, ctx.currentTime + PREVIEW_LEAD_SEC, isSynth ? 0.3 : 0.5);
  } catch { /* ignore */ }
}

export async function registerSample(name, urlOrData) {
  try {
    await samples({ [name]: urlOrData });
    return { name, registered: true };
  } catch (err) {
    console.warn('[AGPLBridge] Failed to register sample:', name, err);
    throw err;
  }
}

