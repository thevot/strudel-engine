# strudel-engine 🎵

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?style=flat&logo=github-sponsors)](https://github.com/sponsors/thevot)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Powered in Production](https://img.shields.io/badge/Powered%20in%20Production-StruDAW-blueviolet)](https://strudaw.com)
[![ECMAScript Modules](https://img.shields.io/badge/ESM-JavaScript-yellow.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)

**High-Performance Open Source AGPLv3 Audio Engine & IPC Protocol Driver for Strudel Live Coding DAW Systems.**

> 🌐 **Powered in Production**: `strudel-engine` is the core audio engine driving **[StruDAW (strudaw.com)](https://strudaw.com)** — the browser-based Digital Audio Workstation for Strudel live coding.

Based on the revolutionary [Strudel.cc](https://strudel.cc) ecosystem created by Felix Roos & Contributors.

---

## 🌟 Why `strudel-engine`? Key Advantages & Features

`strudel-engine` bridges the gap between raw live coding pattern evaluation and full-featured Digital Audio Workstations. Built for maximum performance, legal clarity, and professional audio stability:

- ⚡ **Ultra-Fast IPC Message Protocol**: Fully decouples audio evaluation from host UI rendering via asynchronous JSON-RPC-style action dispatchers (`INIT`, `EVALUATE`, `EVALUATE_ALL`, `STOP`, `PREVIEW_SOUND`, `SET_CPS`). Keeps the UI silky-smooth at 60 FPS without main-thread jank.
- 🎛️ **Zero-Latency WebAudio Tap & Metering**: Features a scoped destination tap intercepting AudioNode graphs cleanly. Feeds real-time `AnalyserNode` FFT visualizers, oscilloscope waveforms (Hydra, Canvas), VU meters, and lossless PCM audio export without master output distortion.
- 🥁 **Smart Two-Tier Sample Prebaking**: Immediate access for core rhythm kits (Roland TR-808, TR-909, Dirt samples) for instantaneous first-paint playback, while extensive soundfonts (GM Soundfonts, VCSL, Uzu) are deferred to idle windows (`requestIdleCallback`).
- 🎼 **Advanced Multi-Track Mixing & Stack Engine**: Evaluates complex multi-track DAW arrangements with per-channel volume gain, stereo panning, mute/solo gating, insert/send effects, metronome tick overlays, and dynamic CPS/BPM tempo synchronization.
- 🔊 **True One-Shot Preview System**: Dedicated preview engine for sample browsers, piano rolls, and tracker views that avoids global scheduler pollution and never interrupts active live jams.
- 📦 **Dynamic Runtime Sample Registration**: Easily register user-uploaded samples, recorded clips, or remote audio URLs into the sound map at runtime.
- 🛡️ **100% AGPLv3 Compliant Open-Core**: Complete legal transparency under AGPLv3 Section 13 (Remote Network Interaction) with isolated architectural boundaries.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Host Application / DAW UI                   │
│   (Arrangement Timeline, CodeMirror, Mixer, Piano Roll)     │
└──────────────────────────────┬──────────────────────────────┘
                               │
            Direct Calls       │       Async IPC Protocol
            or Web Worker      ▼      (ENGINE_ACTIONS / EVENTS)
┌─────────────────────────────────────────────────────────────┐
│                        strudel-engine                       │
│  ┌───────────────────────┐      ┌─────────────────────────┐ │
│  │     protocol.js       │      │     workerDriver.js     │ │
│  │ (createRequest/Event) │      │ (engineDispatcher/IPC)  │ │
│  └───────────┬───────────┘      └────────────┬────────────┘ │
│              └───────────────────────────────┘              │
│                              │                              │
│                              ▼                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    agpl-bridge.js                      │ │
│  │  - Multi-track AST Stack Compilation                   │ │
│  │  - Two-Tier Sample Prebaking (Core + Idle Deferred)    │ │
│  │  - Isolated Preview Engine (Buffers + Superdough)      │ │
│  │  - Scoped Master Tap & AnalyserNode Hooks              │ │
│  └───────────────────────────┬────────────────────────────┘ │
└──────────────────────────────┼──────────────────────────────┘
                               │
         AudioNode Graph       ▼      Pattern Evaluation
┌─────────────────────────────────────────────────────────────┐
│                    Web Audio / Strudel                      │
│   @strudel/web ──► superdough ──► masterTap ──► Analyser    │
│                                       └──► ctx.destination  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Quick Start & Installation

### Install via GitHub or NPM

```bash
# Install directly from the public GitHub repository
npm install github:thevot/strudel-engine

# Or via npm
npm install strudel-engine
```

### Clone for Local Development & Audit

```bash
git clone https://github.com/thevot/strudel-engine.git
cd strudel-engine
npm install
```

---

## 💻 Usage Recipes & Code Examples

### 1. Basic Pattern Evaluation

```js
import { init, evaluate, setCps, stop } from 'strudel-engine';

// Initialize audio context after user gesture (browser autoplay compliance)
await init();

// Evaluate a Strudel live coding pattern
await evaluate('sound("bd sd, hh*4").bank("RolandTR808")');

// Set tempo (120 BPM = 0.5 CPS)
await setCps(0.5);

// Stop playback safely
await stop();
```

### 2. Multi-Track DAW Arrangement Evaluation

Evaluate multiple tracks stacked simultaneously with individual channel volumes, stereo panning, solo/mute gating, and synchronized metronome:

```js
import { evaluateAll } from 'strudel-engine';

const tracks = [
  {
    code: 's("bd sd")',
    volume: 0.9,
    pan: 0,
    muted: false,
    solo: false,
  },
  {
    code: 's("hh*8")',
    volume: 0.6,
    pan: 0.35, // Panned right
    muted: false,
    solo: false,
    inserts: ['HPF'], // High-pass filter insert
  },
  {
    code: 'note("c3 e3 g3 b3").sound("sawtooth")',
    volume: 0.75,
    pan: -0.25, // Panned left
    muted: false,
    solo: false,
    sends: [0.3, 0.2], // [room, delay]
  },
];

// Stacks all active tracks, sets BPM to 124, and enables audio metronome ticks
await evaluateAll(tracks, 124, { metronome: true });
```

### 3. Isolated One-Shot Sample & Note Previews

Preview samples or synthesizer notes in browser lists or piano rolls without interrupting the running pattern or polluting the global scheduler:

```js
import { previewSound, previewNote, previewDrum, stopPreview } from 'strudel-engine';

// Preview a specific drum sample index (e.g., TR-808 snare 2)
const handle = await previewSound('sd:2');

// Prematurely stop preview if needed
handle.stop();

// Preview an acoustic note (MIDI pitch 60 = Middle C for 400ms)
previewNote(60, 0.4);

// Preview a drum hit with subtle room reverberation
await previewDrum('bd');
```

### 4. Real-Time Visualizer & Audio Analysis Hooks

Hook directly into the scoped `AnalyserNode` for FFT spectrum visualizers, oscilloscope displays (Hydra / Canvas / WebGL), and master metering:

```js
import { init, getAnalyser, getAudioContext } from 'strudel-engine';

await init();

const analyser = getAnalyser();
const audioCtx = getAudioContext();

if (analyser) {
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function renderVisualizer() {
    requestAnimationFrame(renderVisualizer);
    analyser.getByteFrequencyData(dataArray);
    // Draw spectrum or feed Hydra canvas...
  }
  renderVisualizer();
}
```

### 5. Registering Custom User Samples

Register uploaded WAV/MP3 files or remote CDN samples dynamically at runtime:

```js
import { registerSample, evaluate } from 'strudel-engine';

// Register sample from URL or ArrayBuffer/Blob URL
await registerSample('myVocal', 'https://example.com/audio/vocal_chop.wav');

// Immediately use in patterns
await evaluate('s("myVocal").speed(1.2)');
```

### 6. Decoupled Web Worker & IPC Protocol Dispatcher

Run `strudel-engine` inside a dedicated Web Worker or communicate using structured JSON-RPC-style IPC messages to maintain guaranteed 60 FPS UI performance:

```js
import {
  engineDispatcher,
  createRequest,
  ENGINE_ACTIONS,
} from 'strudel-engine';

// Dispatch an action via the unified protocol
const response = await engineDispatcher.handleRequest(
  createRequest(ENGINE_ACTIONS.EVALUATE, {
    code: 'sound("bd [~ cp] bd [~ cp]")',
  })
);

console.log('Evaluation response:', response);
```

---

## 📖 API Reference

### Core Playback & Evaluation

| Function | Signature | Description |
| :--- | :--- | :--- |
| `init()` | `async () => Promise<void>` | Initializes Web Audio context and triggers two-tier sample prebaking. |
| `evaluate(code)` | `async (code: string) => Promise<{ error: string \| null }>` | Evaluates and plays a single Strudel live-coding pattern. |
| `evaluateAll(tracks, bpm, options)` | `async (tracks: Array, bpm: number, options?: object) => Promise<{ error: string \| null }>` | Stacks and plays multi-track DAW arrangements with per-channel gain, pan, mute/solo, and metronome. |
| `stop()` | `async () => Promise<void>` | Safely halts pattern evaluation and silences audio output. |
| `setCps(cps)` | `async (cps: number) => Promise<void>` | Sets playback speed in Cycles Per Second (CPS). |

### Sound & Note Previews

| Function | Signature | Description |
| :--- | :--- | :--- |
| `previewSound(sampleName)` | `async (sampleName: string) => Promise<{ stop: Function, ended: Promise }>` | One-shot sample audition that bypasses pattern scheduler. |
| `stopPreview()` | `() => void` | Halts any currently active preview playback. |
| `previewNote(midiNote, durationSec)` | `(midiNote: number, durationSec?: number) => void` | Synthesizes a clean triangle-wave note audition. |
| `previewDrum(sampleName, bank?, note?)` | `async (sampleName: string, bank?: string, note?: number) => Promise<void>` | Auditions a drum hit. `bank` defaults to `RolandTR808`; both values must be plain identifiers. With `note` (MIDI 0–127) and a waveform name (`sawtooth`, `square`, `triangle`, `sine`) it plays that pitch on the synth. It is always an immediate one-shot on the audio graph: nothing is evaluated, so nothing loops and the running song is never replaced. |
| `preloadDrums(sounds)` | `async (sounds: { sample: string, bank: string }[]) => Promise<void>` | Downloads and decodes drum samples ahead of time so their first audition is immediate. |

### WebAudio Graph & Visualizer Hooks

| Function | Signature | Description |
| :--- | :--- | :--- |
| `getAudioContext()` | `() => AudioContext \| null` | Returns the shared `AudioContext` instance. |
| `getAnalyser()` | `() => AnalyserNode \| null` | Returns the scoped `AnalyserNode` (2048 FFT) for spectrum and oscilloscopes. |
| `getMasterTap()` | `() => GainNode \| null` | Returns the non-destructive master tap node for audio metering and recording. |
| `isInitialized()` | `() => boolean` | Checks if the engine and audio context are ready. |
| `getCyclePosition()` | `() => number \| null` | Cycle position currently **audible** (scheduler latency and device output latency included), or `null` when stopped. Drive playheads from this. |
| `getPatternVersion()` | `() => number` | Changes whenever new code takes over playback. |
| `getCurrentCps()` | `() => number` | Returns the current tempo in Cycles Per Second. |
| `setEnginePlayState(playing)` | `(playing: boolean) => void` | Synchronizes engine play state flags with host DAW transport. |

### Tempo & Sample Utilities

| Function | Signature | Description |
| :--- | :--- | :--- |
| `bpmToCps(bpm)` | `(bpm: number) => number` | Converts Beats Per Minute (BPM) to Cycles Per Second (`bpm / 60 / 4`). |
| `cpsToBpm(cps)` | `(cps: number) => number` | Converts Cycles Per Second to Beats Per Minute (`cps * 60 * 4`). |
| `registerSample(name, urlOrData)` | `async (name: string, urlOrData: string \| object) => Promise<object>` | Dynamically registers an audio asset in the Strudel sample map. |

### IPC Protocol & Worker Driver

| Export | Type | Description |
| :--- | :--- | :--- |
| `engineDispatcher` | `EngineMessageDispatcher` | Handles asynchronous protocol actions with standard response envelopes. |
| `createRequest(action, payload)` | `Function` | Constructs a structured request message object with unique ID and timestamp. |
| `createResponse(reqId, action, result, error)` | `Function` | Constructs a standardized response envelope. |
| `createEvent(event, payload)` | `Function` | Constructs an event notification object. |
| `ENGINE_ACTIONS` | `object` | Action constants (`INIT`, `EVALUATE`, `EVALUATE_ALL`, `STOP`, `PREVIEW_SOUND`, `SET_CPS`, etc.). |
| `ENGINE_EVENTS` | `object` | Event constants (`READY`, `STATE_CHANGE`, `ERROR`, `PREVIEW_ENDED`). |

---

## 💖 Support & Sponsorship

`strudel-engine` and StruDAW are developed and maintained independently by **Nicola Selenu ([@thevot](https://github.com/thevot))**.

If this open-source engine powers your live coding workflow, DAW application, or audio research, consider supporting ongoing maintenance via **[GitHub Sponsors](https://github.com/sponsors/thevot)**:

- ☕ **Support on GitHub Sponsors**: [github.com/sponsors/thevot](https://github.com/sponsors/thevot)

Every contribution helps maintain dependencies, improve audio algorithms, and keep the engine free of paywalls.

---

## 📜 License & AGPLv3 Compliance Notice

This package is licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**.

In strict compliance with **Section 13 of AGPLv3 (Remote Network Interaction)**, the complete source code of this audio engine, pattern evaluator, WebAudio bridge, and message protocol driver is made available publicly under AGPLv3 for the community.

- **Production Platform**: [strudaw.com](https://strudaw.com)
- **Engine Source**: [github.com/thevot/strudel-engine](https://github.com/thevot/strudel-engine)
- **Upstream Strudel Core**: [github.com/tidalcycles/strudel](https://github.com/tidalcycles/strudel)
- **Official Strudel Site**: [strudel.cc](https://strudel.cc)

---

## 📄 License

[GNU AGPLv3 License](./LICENSE)  
Copyright (C) 2026 Nicola Selenu ([@thevot](https://github.com/thevot)) & Contributors.  
Portions Copyright (C) Felix Roos & Strudel Contributors (https://strudel.cc).
