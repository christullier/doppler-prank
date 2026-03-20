# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). No build step or dependencies required.

## Architecture

This is a single-page, no-framework web app. All logic lives in `app.js` and is loaded directly by `index.html` via a `<script>` tag.

**`app.js` structure:**
- **`controls` array** (top of file) — declarative config for all sliders (key, label, min/max/step/default, unit). The global `state` object is derived from this array's default values.
- **Simulation math** — `dopplerFrequency(f, v, c, cosTheta)` computes instantaneous Doppler shift for a moving source. `prankEmissionFrequency(...)` inverts this to find what the car must emit so the target hears a constant pitch. These are pure functions called per-frame.
- **Canvas rendering** — `drawScene()` draws the top-down animated view on `#scene-canvas`; `drawChart()` draws the frequency-over-time plot on `#chart-canvas`. Both are called from the animation loop.
- **Audio pipeline** — Two separate concerns share `audioState`:
  - *Offline render*: `renderAudioPreviews()` uses `OfflineAudioContext` to bake three WAV blobs (car / target / bystander perspective) via windowed resampling.
  - *Live monitor*: Web Audio nodes (oscillator + gain) whose playback rate is updated each animation frame based on the current scrub position and selected perspective.
- **UI wiring** — `buildControls()` dynamically creates slider rows from the `controls` array; input events write back to `state` and call `markAudioDirty()` so stale audio previews are cleared.

**Python files** (`main.py`, `pitch_shift.py`) are standalone prototypes/experiments — they are not used by the web app. `main.py` uses the relativistic Doppler formula (speed of light); the web app uses the acoustic approximation.

## Key simulation notes

- The Doppler model is the classical instantaneous approximation for a moving source with stationary listeners; it is not a propagation-delay / wavefront model.
- Prank compensation works by solving the Doppler equation for emission frequency given a desired received frequency at the target position. The bystander then hears whatever that emission frequency produces at their position.
- Audio previews are qualitative (windowed resampling, not physical simulation).
