# @strudel-daw/engine 🎵

**High-Performance Open Source AGPLv3 Audio Engine & IPC Protocol Driver for Strudel Live Coding DAW Systems.**

> 🌐 **Powered in Production**: `@strudel-daw/engine` is the core audio engine driving **[StruDAW (strudaw.com)](https://strudaw.com)** — the browser-based Digital Audio Workstation for Strudel live coding.

Based on the revolutionary [Strudel.cc](https://strudel.cc) ecosystem created by Felix Roos & Contributors.

---

## 🌟 Why `@strudel-daw/engine`? Key Advantages & Features

`@strudel-daw/engine` bridges the gap between raw live coding pattern evaluation and full-featured Digital Audio Workstations. Built for maximum performance, legal clarity, and professional audio stability:

- ⚡ **Ultra-Fast IPC Message Protocol**: Fully decouples audio evaluation from host UI rendering via asynchronous JSON-RPC action dispatchers (`INIT`, `EVALUATE`, `EVALUATE_ALL`, `STOP`, `PREVIEW_SOUND`, `SET_CPS`). Keeps the UI silky-smooth at 60 FPS without main-thread jank.
- 🎛️ **Zero-Latency WebAudio Tap & Metering**: Features a scoped destination tap intercepting AudioNode graphs cleanly. Feeds real-time `AnalyserNode` FFT visualizers, VU meters, and lossless PCM audio export without master output distortion.
- 🥁 **Smart Multi-Phase Sample Prebaking**: Two-tier async sample prebaking strategy. Core drumkit banks (Roland TR-808, TR-909, Dirt samples, GM Soundfonts) load instantly for first-paint audibility, while secondary soundfonts and wavetables are deferred to idle windows (`requestIdleCallback`).
- 🎼 **Advanced Multi-Track Mixing & Stack Engine**: Evaluates complex multi-track DAW arrangements with per-channel volume gain, spatial panning, mute/solo gating, metronome tick overlays, and dynamic CPS/BPM tempo synchronization.
- 🔊 **True One-Shot Preview System**: Dedicated preview engine for sample browsers, piano rolls, and tracker views that avoids global scheduler pollution and never interrupts active live jams.
- 🛡️ **100% AGPLv3 Compliant Open-Core**: Complete legal transparency under AGPLv3 Section 13 with automated AST compliance auditing tools included.

---

## 🛠️ Quick Start & Usage

### Installation

```bash
npm install @strudel-daw/engine
```

### Basic Pattern Evaluation

```js
import { init, evaluate, evaluateAll, setCps, stop } from '@strudel-daw/engine';

// Initialize audio context after user interaction (browser autoplay policy)
await init();

// Evaluate a single Strudel live coding pattern
await evaluate('sound("bd sd, hh*4").bank("RolandTR808")');

// Set tempo (120 BPM = 0.5 CPS)
await setCps(0.5);

// Stop playback
await stop();
```

### Multi-Track DAW Arrangement Evaluation

```js
import { evaluateAll } from '@strudel-daw/engine';

const tracks = [
  { code: 's("bd sd")', volume: 0.9, pan: 0, muted: false, solo: false },
  { code: 's("hh*8")', volume: 0.6, pan: 0.2, muted: false, solo: false },
  { code: 'note("c3 e3 g3 b3")', volume: 0.8, pan: -0.2, muted: false, solo: false },
];

// Evaluate all active tracks stacked with DAW BPM and metronome tick
await evaluateAll(tracks, 128, { metronome: true });
```

---

## 📜 License & AGPLv3 Compliance Notice

This package is licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**.

In compliance with **Section 13 of AGPLv3 (Remote Network Interaction)**, the complete source code of this audio engine, pattern evaluator, and WebAudio bridge is made available publicly under AGPLv3 for the community.

- **Production Platform**: [strudaw.com](https://strudaw.com)
- **Engine Source**: [github.com/thevot/strudel-engine](https://github.com/thevot/strudel-engine)
- **Upstream Strudel Core**: [github.com/tidalcycles/strudel](https://github.com/tidalcycles/strudel)
- **Official Strudel Site**: [strudel.cc](https://strudel.cc)

---

## 📄 License

[GNU AGPLv3 License](./LICENSE) - Copyright (C) 2026 Felix Roos & Contributors.
