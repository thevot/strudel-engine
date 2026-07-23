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
  superdough,
  samples,
  aliasBank,
  getAudioContext as getStrudelCtx,
} from '@strudel/web';
import { registerSoundfonts } from '@strudel/soundfonts';

let initialized = false;
let ctx = null;       // AudioContext
let analyser = null;  // AnalyserNode for visualizations
let masterTap = null; // GainNode mirroring the master bus
let playbackStartTime = 0;
let currentCps = 0.5;
let engineIsPlaying = false;
let activePreviewHandle = null;
const previewBufferCache = new Map();

export async function init() {
  if (initialized) return;

  const STRUDEL_CDN = 'https://strudel.b-cdn.net';

  await initStrudel({
    prebake: async () => {
      const optional = (label, promise) =>
        promise.catch((err) => console.warn(`[AGPLBridge] ${label} unavailable:`, err.message));

      await Promise.all([
        samples(`${STRUDEL_CDN}/tidal-drum-machines.json`, `${STRUDEL_CDN}/tidal-drum-machines/machines/`),
        samples('github:tidalcycles/dirt-samples'),
      ]);

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
          optional('piano samples', samples(`${STRUDEL_CDN}/piano.json`, `${STRUDEL_CDN}/piano/`)),
          optional('VCSL samples', samples(`${STRUDEL_CDN}/vcsl.json`, `${STRUDEL_CDN}/VCSL/`)),
          optional('uzu drumkit', samples(`${STRUDEL_CDN}/uzu-drumkit.json`, `${STRUDEL_CDN}/uzu-drumkit/`)),
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

export async function evaluate(code) {
  try {
    if (!initialized) await init();
    await strudelEvaluate(code);
    if (ctx) playbackStartTime = ctx.currentTime;
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
    let wrapped = `(${code}).gain(${vol.toFixed(2)})`;
    if (pan !== 0) {
      wrapped += `.pan(${pan.toFixed(2)})`;
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
    await strudelEvaluate(combined);
    if (ctx) playbackStartTime = ctx.currentTime;
    currentCps = bpmToCps(bpm || 120);
    return { error: null };
  } catch (err) {
    console.error('[AGPLBridge] Multi-track evaluation error:', err);
    return { error: `Evaluation failed: ${err.message || String(err)}` };
  }
}

export async function stop() {
  try {
    await strudelEvaluate('hush()');
  } catch (err) {
    console.error('[AGPLBridge] Stop error:', err);
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
    await strudelEvaluate(`setcps(${cps})`);
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
export function getPlaybackStartTime() { return playbackStartTime; }
export function getCurrentCps() { return currentCps; }
export function setEnginePlayState(playing) { engineIsPlaying = playing; }

export function previewNote(midiNote, durationSec = 0.35) {
  if (!ctx || ctx.state === 'suspended') return;
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

export async function previewDrum(sampleName) {
  if (engineIsPlaying || !initialized) return;
  try {
    await strudelEvaluate(`sound("${sampleName}").bank("RolandTR808").room(0.1)`);
  } catch { /* ignore */ }
}
