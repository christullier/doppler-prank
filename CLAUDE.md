# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). No build step or dependencies required.

## Architecture

This is a single-page, no-framework web app. Logic is split across plain scripts under `js/` and loaded in order by `index.html` (no bundler, no modules).

**`js/` layout (load order):**
- **`config.js`** — `controls` array (declarative slider config) and `initialControlState`.
- **`state.js`** — `state`, `audioState`, `sceneDragState`, `themeState`, `controlItemsByKey`.
- **`dom.js`** — DOM element references and canvas contexts.
- **`utils.js`** — formatting helpers, `cssVar`, `clamp`, radio helpers, spacebar guard.
- **`simulation.js`** — Doppler math (`dopplerObservedFrequency`, `prankEmissionForTarget`, `sampleSeries`, `currentSnapshot`, etc.).
- **`audio.js`** — Web Audio live monitor bus, uploaded-song worklet path, upload handling, `syncLiveMonitor`, and playback helpers.
- **`render.js`** — `buildControls()`, `drawScene()`, `drawChart()`, stats grid, scene drag math, `render()`.
- **`events.js`** — Event listeners, `requestAnimationFrame` loop, bootstrap (`buildControls()`, initial `render()`).

Shared globals coordinate across files; keep script order stable when adding code.

**Python files** (`main.py`, `pitch_shift.py`) are standalone prototypes/experiments — they are not used by the web app. `main.py` uses the relativistic Doppler formula (speed of light); the web app uses the acoustic approximation.

## Key simulation notes

- The Doppler model is the classical instantaneous approximation for a moving source with stationary listeners; it is not a propagation-delay / wavefront model.
- Prank compensation works by solving the Doppler equation for emission frequency given a desired received frequency at the target position. The bystander then hears whatever that emission frequency produces at their position.
- Live uploaded-song monitoring is qualitative browser DSP, not a physical simulation or studio-grade effect.
