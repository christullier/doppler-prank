const MIN_RATE = 0.35;
const MAX_RATE = 3.5;
const CROSSFADE_FRAMES = 256;
const MAX_PHASE_CORRECTION = 0.35;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function wrapIndex(value, length) {
  if (!length) {
    return 0;
  }

  let wrapped = value % length;
  if (wrapped < 0) {
    wrapped += length;
  }
  return wrapped;
}

function shortestWrappedDelta(target, current, length) {
  if (!length) {
    return 0;
  }

  let delta = target - current;
  if (delta > length / 2) {
    delta -= length;
  } else if (delta < -length / 2) {
    delta += length;
  }
  return delta;
}

function readSample(channelData, position) {
  if (!channelData.length) {
    return 0;
  }

  const safePosition = wrapIndex(position, channelData.length);
  const leftIndex = Math.floor(safePosition);
  const rightIndex = (leftIndex + 1) % channelData.length;
  const mix = safePosition - leftIndex;
  return channelData[leftIndex] * (1 - mix) + channelData[rightIndex] * mix;
}

function zeroOutputs(outputs) {
  outputs.forEach((channels) => {
    channels.forEach((channel) => {
      channel.fill(0);
    });
  });
}

class LiveSongProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.bufferVersion = 0;
    this.channels = [];
    this.length = 0;
    this.currentReadHead = 0;
    this.targetReadHead = 0;
    this.currentRate = 1;
    this.targetRate = 1;
    this.graphPlaying = false;
    this.active = false;
    this.crossfadeRemaining = 0;
    this.crossfadeFromHead = 0;
    this.crossfadeToHead = 0;
    this._driftLogFrames = 0;
    this._progressFrames = 0;

    this.port.onmessage = (event) => {
      try {
        this.handleMessage(event.data);
      } catch (error) {
        this.port.postMessage({
          type: "error",
          bufferVersion: this.bufferVersion,
          message: error instanceof Error ? error.message : "Live song DSP failed.",
        });
      }
    };
  }

  handleMessage(message) {
    if (message.type === "load-buffer") {
      this.loadBuffer(message);
      return;
    }

    if (message.type === "transport") {
      this.applyTransport(message);
      return;
    }

    if (message.type === "reset") {
      this.resetTransport();
    }
  }

  loadBuffer(message) {
    const { bufferVersion, audioData } = message;
    this.channels = (audioData.channels || []).map((channel) =>
      channel instanceof Float32Array ? channel : new Float32Array(channel),
    );
    this.length = audioData.length || 0;
    this.bufferVersion = bufferVersion;
    this.currentReadHead = 0;
    this.targetReadHead = 0;
    this.currentRate = 1;
    this.targetRate = 1;
    this.graphPlaying = false;
    this.active = false;
    this.crossfadeRemaining = 0;
    this.crossfadeFromHead = 0;
    this.crossfadeToHead = 0;

    this.port.postMessage({
      type: "buffer-ready",
      bufferVersion,
    });
  }

  resetTransport() {
    this.active = false;
    this.graphPlaying = false;
    this.currentRate = 1;
    this.targetRate = 1;
    this.crossfadeRemaining = 0;
    this.targetReadHead = this.currentReadHead;
  }

  applyTransport(message) {
    if (!this.channels.length || message.bufferVersion !== this.bufferVersion) {
      console.log(
        `[worklet] transport rejected | hasChannels=${this.channels.length > 0} msgVer=${message.bufferVersion} myVer=${this.bufferVersion}`,
      );
      return;
    }

    const desiredHead = clamp(message.progress || 0, 0, 1) * Math.max(this.length - 1, 0);
    this.targetRate = clamp(message.playbackRate || 1, MIN_RATE, MAX_RATE);
    this.graphPlaying = Boolean(message.playing);
    this.active = true;

    const driftSamples = this.currentReadHead - desiredHead;
    console.log(
      `[worklet] transport applied | progress=${(message.progress || 0).toFixed(4)} desiredHead=${desiredHead.toFixed(1)} currentHead=${this.currentReadHead.toFixed(1)} drift=${driftSamples.toFixed(1)}smpl rate=${this.targetRate.toFixed(3)} hardSeek=${message.hardSeek} playing=${message.playing}`,
    );

    if (!this.graphPlaying) {
      this.currentReadHead = desiredHead;
      this.targetReadHead = desiredHead;
      this.crossfadeRemaining = 0;
      this.port.postMessage({
        type: "position",
        fraction: this.length > 0 ? this.currentReadHead / this.length : 0,
      });
      return;
    }

    if (message.hardSeek) {
      if (!Number.isFinite(this.currentReadHead)) {
        this.currentReadHead = desiredHead;
      }

      if (this.crossfadeRemaining <= 0) {
        this.crossfadeFromHead = this.currentReadHead;
      } else {
        this.crossfadeFromHead = this.crossfadeToHead;
      }
      this.crossfadeToHead = desiredHead;
      this.targetReadHead = desiredHead;
      this.crossfadeRemaining = CROSSFADE_FRAMES;
      console.log(
        `[worklet] hard seek | from=${this.crossfadeFromHead.toFixed(1)} to=${desiredHead.toFixed(1)} crossfadeFrames=${CROSSFADE_FRAMES}`,
      );
      return;
    }

    // During normal playback, don't force the read head to the car position
    // every frame — that couples song position to pass position and causes the
    // phase corrector to constantly pitch-warp the audio. Instead let
    // targetReadHead advance freely at targetRate (handled in writeNormalFrame).
  }

  writeCrossfadeFrame(outputChannels, frame) {
    const mix = 1 - this.crossfadeRemaining / Math.max(CROSSFADE_FRAMES, 1);

    for (let channel = 0; channel < outputChannels.length; channel += 1) {
      const sourceChannel = this.channels[Math.min(channel, this.channels.length - 1)];
      const fromSample = readSample(sourceChannel, this.crossfadeFromHead);
      const toSample = readSample(sourceChannel, this.crossfadeToHead);
      outputChannels[channel][frame] = fromSample * (1 - mix) + toSample * mix;
    }

    this.crossfadeFromHead = wrapIndex(this.crossfadeFromHead + this.currentRate, this.length);
    this.crossfadeToHead = wrapIndex(this.crossfadeToHead + this.targetRate, this.length);
    this.currentReadHead = this.crossfadeToHead;
    this.targetReadHead = this.crossfadeToHead;
    this.crossfadeRemaining -= 1;
  }

  writeNormalFrame(outputChannels, frame, frameCount) {
    const phaseCorrection = this.graphPlaying
      ? clamp(
          shortestWrappedDelta(this.targetReadHead, this.currentReadHead, this.length)
            / Math.max(frameCount, 1),
          -MAX_PHASE_CORRECTION,
          MAX_PHASE_CORRECTION,
        )
      : 0;

    for (let channel = 0; channel < outputChannels.length; channel += 1) {
      const sourceChannel = this.channels[Math.min(channel, this.channels.length - 1)];
      outputChannels[channel][frame] = readSample(sourceChannel, this.currentReadHead);
    }

    this.currentReadHead = wrapIndex(
      this.currentReadHead + this.currentRate + phaseCorrection,
      this.length,
    );
    if (this.graphPlaying) {
      this.targetReadHead = wrapIndex(this.targetReadHead + this.targetRate, this.length);
    }
  }

  process(_inputs, outputs) {
    const outputChannels = outputs[0] || [];
    if (!outputChannels.length) {
      return true;
    }

    if (!this.active || !this.channels.length || !this.length) {
      zeroOutputs(outputs);
      return true;
    }

    if (!this.graphPlaying && this.crossfadeRemaining <= 0) {
      zeroOutputs(outputs);
      return true;
    }

    const frameCount = outputChannels[0].length;
    const rateStep = (this.targetRate - this.currentRate) / Math.max(frameCount, 1);

    this._progressFrames += frameCount;
    if (this._progressFrames >= 11025) {
      this._progressFrames = 0;
      this.port.postMessage({
        type: "position",
        fraction: this.length > 0 ? this.currentReadHead / this.length : 0,
      });
    }

    this._driftLogFrames += frameCount;
    // Log approximately once per second (sample rate ~44100 or ~48000).
    if (this._driftLogFrames >= 44032) {
      this._driftLogFrames = 0;
      const drift = this.currentReadHead - this.targetReadHead;
      const positionSec = this.length > 0 ? this.currentReadHead / this.length : 0;
      console.log(
        `[worklet] drift=${drift.toFixed(1)}smpl currentHead=${this.currentReadHead.toFixed(1)} targetHead=${this.targetReadHead.toFixed(1)} rate=${this.currentRate.toFixed(3)} playing=${this.graphPlaying} crossfade=${this.crossfadeRemaining} pos=${(positionSec * 100).toFixed(1)}%`,
      );
    }

    for (let frame = 0; frame < frameCount; frame += 1) {
      this.currentRate = clamp(this.currentRate + rateStep, MIN_RATE, MAX_RATE);

      if (this.crossfadeRemaining > 0) {
        this.writeCrossfadeFrame(outputChannels, frame);
      } else {
        this.writeNormalFrame(outputChannels, frame, frameCount);
      }
    }

    return true;
  }
}

registerProcessor("live-song-processor", LiveSongProcessor);
