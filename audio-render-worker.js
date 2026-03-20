function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getSourcePosition(progress, simulation) {
  return {
    x: -simulation.travelSpan + 2 * simulation.travelSpan * progress,
    y: 0,
  };
}

function getListener(simulation, name) {
  return {
    x: simulation[`${name}X`],
    y: simulation[`${name}Y`],
  };
}

function dopplerObservedFrequency(emittedFrequency, source, listener, simulation) {
  const separation = distance(source, listener);
  const towardComponent = (simulation.carSpeed * (listener.x - source.x)) / separation;
  const safeDenominator = Math.max(simulation.speedOfSound - towardComponent, 1e-6);

  return {
    observed: emittedFrequency * (simulation.speedOfSound / safeDenominator),
    towardComponent,
  };
}

function prankEmissionForTarget(source, target, simulation) {
  const { towardComponent } = dopplerObservedFrequency(
    simulation.baseFrequency,
    source,
    target,
    simulation,
  );

  return simulation.targetFrequency * ((simulation.speedOfSound - towardComponent) / simulation.speedOfSound);
}

function getPerspectiveFrequency(progress, simulation, mode) {
  const source = getSourcePosition(progress, simulation);
  const target = getListener(simulation, "target");
  const bystander = getListener(simulation, "bystander");
  const prankEmission = prankEmissionForTarget(source, target, simulation);

  if (mode === "car") {
    return prankEmission;
  }

  if (mode === "bystander") {
    return dopplerObservedFrequency(prankEmission, source, bystander, simulation).observed;
  }

  return dopplerObservedFrequency(prankEmission, source, target, simulation).observed;
}

function readSample(channelData, position) {
  const safePosition = clamp(position, 0, channelData.length - 1);
  const leftIndex = Math.floor(safePosition);
  const rightIndex = Math.min(leftIndex + 1, channelData.length - 1);
  const mix = safePosition - leftIndex;
  return channelData[leftIndex] * (1 - mix) + channelData[rightIndex] * mix;
}

function createHannWindow(length) {
  const windowValues = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    windowValues[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (length - 1 || 1));
  }

  return windowValues;
}

function renderPerspectiveAudio(audioData, simulation, mode) {
  const outputChannels = Array.from(
    { length: audioData.numberOfChannels },
    () => new Float32Array(audioData.length),
  );

  const windowSize = Math.max(1024, Math.floor(audioData.sampleRate * 0.08));
  const hopSize = Math.max(256, Math.floor(windowSize / 4));
  const windowValues = createHannWindow(windowSize);
  const baseFrequency = Math.max(simulation.baseFrequency, 1);

  for (let channel = 0; channel < audioData.numberOfChannels; channel += 1) {
    const sourceData = audioData.channels[channel];
    const outputData = outputChannels[channel];

    for (let start = 0; start < audioData.length; start += hopSize) {
      const progress = start / Math.max(audioData.length - 1, 1);
      const perspectiveFrequency = getPerspectiveFrequency(progress, simulation, mode);
      const rate = clamp(perspectiveFrequency / baseFrequency, 0.35, 3.5);

      for (let index = 0; index < windowSize; index += 1) {
        const outputIndex = start + index;
        if (outputIndex >= audioData.length) {
          break;
        }

        const inputIndex = start + index * rate;
        if (inputIndex >= sourceData.length - 1) {
          break;
        }

        outputData[outputIndex] += readSample(sourceData, inputIndex) * windowValues[index];
      }
    }

    const normalization = new Float32Array(audioData.length);

    for (let start = 0; start < audioData.length; start += hopSize) {
      for (let index = 0; index < windowSize; index += 1) {
        const outputIndex = start + index;
        if (outputIndex >= audioData.length) {
          break;
        }

        normalization[outputIndex] += windowValues[index];
      }
    }

    let peak = 0;
    for (let index = 0; index < audioData.length; index += 1) {
      if (normalization[index] > 1e-6) {
        outputData[index] /= normalization[index];
      }
      peak = Math.max(peak, Math.abs(outputData[index]));
    }

    const peakScale = peak > 0.98 ? 0.98 / peak : 1;
    for (let index = 0; index < audioData.length; index += 1) {
      outputData[index] *= peakScale;
    }
  }

  return {
    numberOfChannels: audioData.numberOfChannels,
    sampleRate: audioData.sampleRate,
    length: audioData.length,
    channels: outputChannels,
  };
}

function audioBufferToWavArrayBuffer(buffer) {
  const bytesPerSample = 2;
  const blockAlign = buffer.numberOfChannels * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset, text) {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, buffer.numberOfChannels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const sample = clamp(buffer.channels[channel][frame], -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return arrayBuffer;
}

self.onmessage = (event) => {
  const { type, jobId, audioData, simulation } = event.data;

  if (type !== "render") {
    return;
  }

  try {
    const modes = ["car", "target", "bystander"];

    for (const mode of modes) {
      self.postMessage({ type: "progress", jobId, mode });
      const rendered = renderPerspectiveAudio(audioData, simulation, mode);
      const wavBuffer = audioBufferToWavArrayBuffer(rendered);
      self.postMessage({ type: "preview", jobId, mode, wavBuffer }, [wavBuffer]);
    }

    self.postMessage({ type: "done", jobId });
  } catch (error) {
    self.postMessage({
      type: "error",
      jobId,
      message: error instanceof Error ? error.message : "Audio rendering failed in the worker.",
    });
  }
};
