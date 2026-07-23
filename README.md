# @strudel-daw/engine 🎵

**Open Source AGPLv3 Core Audio Engine & Message Protocol Driver for Strudel Live Coding DAW Integration.**

Based on [Strudel.cc](https://strudel.cc) by Felix Roos & Contributors.

---

## 📜 License & AGPLv3 Compliance Notice

This package is licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**.

In compliance with **Section 13 of AGPLv3 (Remote Network Interaction)**, the complete source code of this audio engine, pattern evaluator, and WebAudio bridge is made available publicly under AGPLv3.

- **Upstream Repository**: [https://github.com/tidalcycles/strudel](https://github.com/tidalcycles/strudel)
- **Official Strudel Site**: [https://strudel.cc](https://strudel.cc)

---

## 🚀 Features

- 🎹 **Isolated Audio Execution**: Prebakes sample banks (Tidal drum machines, dirt samples, soundfonts) in a clean WebAudio graph tap.
- 📡 **IPC / Event Protocol Driver**: Exposes serializable JSON RPC action types (`INIT`, `EVALUATE`, `EVALUATE_ALL`, `STOP`, `PREVIEW_SOUND`) over async message dispatchers.
- 📊 **Analyser & Master Tap**: Provides zero-latency `AnalyserNode` and master gain tap hooks for DAW visualizers and PCM export.

---

## 🛠️ Usage

```js
import { init, evaluate, evaluateAll, stop } from '@strudel-daw/engine';

// Initialize audio context after user gesture
await init();

// Evaluate Strudel live coding pattern
await evaluate('sound("bd sd, hh*4")');
```

---

## 📄 License

[GNU AGPLv3 License](./LICENSE) - Copyright (C) 2026 Felix Roos & Contributors.
