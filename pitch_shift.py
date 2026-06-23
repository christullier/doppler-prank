"""Legacy prototype.

This file is not used by the browser app. It experiments with a fixed FFT-bin
shift on a WAV file, which does not match the web app's real-time rate-based
AudioWorklet processing.
"""

import wave

import numpy as np

wr = wave.open("audio/sine.wav", "r")
# Set the parameters for the output file.
par = list(wr.getparams())
par[3] = 0  # The number of samples will be set by writeframes.
par = tuple(par)
ww = wave.open("audio/pitch1.wav", "w")
ww.setparams(par)

# The sound should be processed in small fractions of a second.
fr = 20
sz = wr.getframerate() // fr  # Read and process 1/fr second at a time.
c = int(wr.getnframes() / sz)  # Count of the whole file
shift = 100 // fr  # Shifting 100 Hz

for _ in range(c):
    da = np.frombuffer(wr.readframes(sz), dtype=np.int16)
    if len(da) == 0:
        break  # Prevents processing empty frames

    left, right = da[0::2], da[1::2]  # Left and right channels

    lf, rf = np.fft.rfft(left), np.fft.rfft(right)
    lf, rf = np.roll(lf, shift), np.roll(rf, shift)

    # Zero out the highest frequencies to prevent roll-over
    lf[:shift], rf[:shift] = 0, 0

    # Inverse Fourier transform to convert back into amplitude
    nl, nr = np.fft.irfft(lf), np.fft.irfft(rf)

    # Combine the two channels
    ns = np.column_stack((nl, nr)).ravel().astype(np.int16)

    # Write the output data
    ww.writeframes(ns.tobytes())

# Close the files
wr.close()
ww.close()
