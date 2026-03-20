# Doppler Prank Lab

This project is now a small browser-based simulator for the original joke:
driving past someone while changing a siren pitch to cancel out the Doppler
shift at one specific listening position.

The app lets you experiment with:

- car speed
- source frequency
- desired heard frequency
- speed of sound
- target position
- bystander position
- drive-by span

It visualizes:

- the car moving past the listeners
- the target and bystander positions
- the current Doppler-shifted frequency at each position
- the "prank" emission frequency needed to keep the target hearing a constant
  pitch
- how the same prank affects someone standing somewhere else

It also lets you upload an audio clip and use it as the source for the live
song monitor, so you can hear the pass from the car, target, or bystander
perspective in real time.

## Run it

From this directory:

```bash
python3 -m http.server 8000
```

Then open:

[http://localhost:8000](http://localhost:8000)

## Files

- `index.html` - app shell and controls
- `styles.css` - layout and visual styling
- `js/` - vanilla app logic (config, state, DOM refs, simulation, audio, rendering, events); loaded in order by `index.html`
- `main.py` - original Doppler prototype
- `pitch_shift.py` - original audio pitch-shifting experiment

## Notes

The web app uses the classical instantaneous Doppler approximation for a moving
source and stationary listeners. It is meant as an interactive visualization,
not a high-precision acoustics model. The live uploaded-song monitor is a
qualitative browser-based effect rather than a studio-grade audio processor.
