function getAudioContext() {
  if (!audioState.context) {
    const Context = window.AudioContext || window.webkitAudioContext;
    audioState.context = new Context();
  }

  return audioState.context;
}

function updateAudioStatus(message) {
  audioStatus.textContent = message;
  audioStatus.hidden = !message;
}

function updateLiveAudioStatus(message) {
  if (!liveAudioStatus) {
    return;
  }

  liveAudioStatus.textContent = message;
}

function updateUploadUI() {
  const hasAudio = Boolean(audioState.sourceName);

  filePicker.hidden = hasAudio;
  uploadedAudio.hidden = !hasAudio;
  uploadedAudioName.textContent = hasAudio ? audioState.sourceName : "";
  liveSourceSongInput.disabled = !hasAudio;

  if (!hasAudio && getLiveSourceMode() === "song") {
    setCheckedRadioValue("live-source-mode", "synth");
  }
}

function resetControlsToDefaults() {
  Object.entries(initialControlState).forEach(([key, value]) => {
    state[key] = value;
  });
}

function resetAudioState() {
  audioState.uploadRequestId += 1;
  audioState.sourceBuffer = null;
  audioState.sourceName = "";
  audioState.live.songAudioData = null;
  audioState.live.songBufferVersion += 1;
  audioState.live.songLoadedBufferVersion = 0;
  audioState.live.songWorkletReady = false;
  audioState.live.lastSongTransportKey = "";
  audioState.live.resumeNeedsHardSync = false;
  audioState.live.songPositionFraction = 0;
  audioUpload.value = "";
  updateUploadUI();
  updateAudioStatus("");
  updateSongProgressUI();

  if (audioState.live.songWorkletNode) {
    audioState.live.songWorkletNode.port.postMessage({ type: "reset" });
  }

  if (audioState.live.active && audioState.live.sourceMode === "song") {
    stopLiveMonitor();
    updateLiveAudioStatus(
      "The uploaded song was removed, so live monitoring switched off.",
    );
  }
}

function syncLiveMonitorPlaybackState() {
  if (!audioState.live.masterGain) {
    return;
  }

  const context = getAudioContext();
  const targetGain = audioState.live.active && state.playing ? 1 : 0;
  audioState.live.masterGain.gain.cancelScheduledValues(context.currentTime);
  audioState.live.masterGain.gain.setValueAtTime(
    audioState.live.masterGain.gain.value,
    context.currentTime,
  );
  audioState.live.masterGain.gain.setTargetAtTime(targetGain, context.currentTime, 0.005);
}

function setPlaybackState(playing) {
  const willPlay = Boolean(playing);
  if (willPlay && !state.playing) {
    resetTickClock();
  }
  state.playing = willPlay;
  playToggle.textContent = willPlay ? "Pause" : "Play";

  syncLiveMonitorPlaybackState();

  if (audioState.live.active) {
    // When pausing or resuming, don't hard-seek — let the worklet maintain
    // its own playhead position. We only hard-seek on explicit car scrubs.
    syncLiveMonitor(true, false);
  }
}

function togglePlayback() {
  setPlaybackState(!state.playing);
}

function serializeSourceBuffer(buffer) {
  return {
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
    length: buffer.length,
    channels: Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
      buffer.getChannelData(channel).slice(),
    ),
  };
}

function resetLiveSongLoadResolvers(reason = "Live song buffer load was interrupted.") {
  audioState.live.songBufferLoadResolvers.forEach(({ reject, timeoutId }) => {
    window.clearTimeout(timeoutId);
    reject(new Error(reason));
  });
  audioState.live.songBufferLoadResolvers.clear();
}

function stageLiveSongBuffer(buffer) {
  audioState.live.songBufferVersion += 1;
  audioState.live.songLoadedBufferVersion = 0;
  audioState.live.songWorkletReady = false;
  audioState.live.songAudioData = buffer ? serializeSourceBuffer(buffer) : null;
  audioState.live.lastSongTransportKey = "";
  audioState.live.resumeNeedsHardSync = true;
  audioState.live.songPositionFraction = 0;
  resetLiveSongLoadResolvers("Live song buffer was replaced.");
}

function requestLiveSongHardSync(reason = "unknown") {
  console.log(`[audio] requestLiveSongHardSync — reason: ${reason}`);
  audioState.live.resumeNeedsHardSync = true;
  audioState.live.lastSongTransportKey = "";
}

function resetLiveSongProcessor() {
  if (!audioState.live.songWorkletNode) {
    return;
  }

  audioState.live.songWorkletNode.port.postMessage({ type: "reset" });
  audioState.live.lastSongTransportKey = "";
}

function handleLiveSongProcessorMessage(event) {
  const message = event.data;

  if (message.type === "buffer-ready") {
    const resolver = audioState.live.songBufferLoadResolvers.get(message.bufferVersion);
    if (resolver) {
      window.clearTimeout(resolver.timeoutId);
      resolver.resolve();
      audioState.live.songBufferLoadResolvers.delete(message.bufferVersion);
    }

    if (message.bufferVersion === audioState.live.songBufferVersion) {
      audioState.live.songLoadedBufferVersion = message.bufferVersion;
      audioState.live.songWorkletReady = true;
    }
    return;
  }

  if (message.type === "position") {
    audioState.live.songPositionFraction = message.fraction;
    updateSongProgressUI();
    return;
  }

  if (message.type === "error") {
    if (typeof message.bufferVersion === "number") {
      const resolver = audioState.live.songBufferLoadResolvers.get(message.bufferVersion);
      if (resolver) {
        window.clearTimeout(resolver.timeoutId);
        resolver.reject(new Error(message.message || "Live song DSP failed."));
        audioState.live.songBufferLoadResolvers.delete(message.bufferVersion);
      }
    } else {
      resetLiveSongLoadResolvers(message.message || "Live song DSP failed.");
    }

    audioState.live.songWorkletReady = false;
    return;
  }
}

async function ensureSongWorkletNode() {
  const context = ensureLiveMonitorBus();

  if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") {
    throw new Error("unsupported-live-song");
  }

  if (!audioState.live.songWorkletModulePromise) {
    audioState.live.songWorkletModulePromise = context.audioWorklet
      .addModule("live-song-processor.js?v=2")
      .catch((error) => {
        audioState.live.songWorkletModulePromise = null;
        throw error;
      });
  }

  await audioState.live.songWorkletModulePromise;

  if (!audioState.live.songWorkletNode) {
    const node = new AudioWorkletNode(context, "live-song-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.port.addEventListener("message", handleLiveSongProcessorMessage);
    if (typeof node.port.start === "function") {
      node.port.start();
    }
    node.connect(audioState.live.songGain);
    audioState.live.songWorkletNode = node;
  }

  return context;
}

async function pushSongBufferToWorklet() {
  if (!audioState.sourceBuffer) {
    throw new Error("missing-song");
  }

  if (!audioState.live.songWorkletNode) {
    throw new Error("missing-song-worklet");
  }

  const version = audioState.live.songBufferVersion;
  if (audioState.live.songLoadedBufferVersion === version && audioState.live.songWorkletReady) {
    return;
  }

  const audioData = audioState.live.songAudioData || serializeSourceBuffer(audioState.sourceBuffer);
  audioState.live.songAudioData = null;
  audioState.live.songWorkletReady = false;

  const timeoutId = window.setTimeout(() => {
    const resolver = audioState.live.songBufferLoadResolvers.get(version);
    if (!resolver) {
      return;
    }

    resolver.reject(new Error("Live song buffer load timed out."));
    audioState.live.songBufferLoadResolvers.delete(version);
  }, 2000);

  const loadPromise = new Promise((resolve, reject) => {
    audioState.live.songBufferLoadResolvers.set(version, {
      resolve,
      reject,
      timeoutId,
    });
  });

  const transferList = audioData.channels.map((channel) => channel.buffer);
  audioState.live.songWorkletNode.port.postMessage(
    {
      type: "load-buffer",
      bufferVersion: version,
      audioData,
    },
    transferList,
  );

  await loadPromise;
}

function perspectiveLabel(mode) {
  if (mode === "car") {
    return "the car";
  }

  if (mode === "bystander") {
    return "the bystander";
  }

  return "the target";
}

function liveSourceLabel(mode) {
  if (mode === "song") {
    return "uploaded song";
  }

  return "synth tone";
}

function getLiveSourceMode() {
  return getCheckedRadioValue("live-source-mode") || "synth";
}

function getLivePerspective() {
  return getCheckedRadioValue("live-perspective") || "target";
}

function ensureLiveMonitorBus() {
  const context = getAudioContext();

  if (audioState.live.masterGain) {
    return context;
  }

  const masterGain = context.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(context.destination);

  const synthGain = context.createGain();
  synthGain.gain.value = 0;
  synthGain.connect(masterGain);

  const songGain = context.createGain();
  songGain.gain.value = 0;
  songGain.connect(masterGain);

  audioState.live.masterGain = masterGain;
  audioState.live.synthGain = synthGain;
  audioState.live.songGain = songGain;
  return context;
}

function ensureSynthMonitorNodes() {
  const context = ensureLiveMonitorBus();

  if (audioState.live.oscillators.length) {
    return context;
  }

  const oscillatorSettings = [
    { type: "triangle", ratio: 1, level: 0.07 },
    { type: "sine", ratio: 2, level: 0.028 },
  ];

  audioState.live.oscillators = oscillatorSettings.map((settings) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = settings.type;
    oscillator.frequency.value = state.baseFrequency * settings.ratio;
    gain.gain.value = settings.level;

    oscillator.connect(gain);
    gain.connect(audioState.live.synthGain);
    oscillator.start();

    return {
      oscillator,
      ratio: settings.ratio,
    };
  });

  return context;
}

async function setLiveMonitorSourceMode(mode, requestId = audioState.live.requestId) {
  const context = ensureLiveMonitorBus();

  if (mode === "song") {
    if (!audioState.sourceBuffer) {
      throw new Error("missing-song");
    }

    await ensureSongWorkletNode();
    if (requestId !== audioState.live.requestId) {
      return false;
    }
    await pushSongBufferToWorklet();
    if (requestId !== audioState.live.requestId) {
      return false;
    }
    audioState.live.synthGain.gain.setValueAtTime(0, context.currentTime);
    audioState.live.songGain.gain.setValueAtTime(1, context.currentTime);
    requestLiveSongHardSync("source mode switched to song");
    audioState.live.sourceMode = mode;
    updateSongProgressUI();
    return true;
  }

  ensureSynthMonitorNodes();
  if (requestId !== audioState.live.requestId) {
    return false;
  }
  audioState.live.synthGain.gain.setValueAtTime(1, context.currentTime);
  audioState.live.songGain.gain.setValueAtTime(0, context.currentTime);
  resetLiveSongProcessor();

  audioState.live.sourceMode = mode;
  updateSongProgressUI();
  return true;
}

function syncLiveMonitor(force = false, hardSeekOverride = null) {
  if (!audioState.live.active || !audioState.live.masterGain) {
    return;
  }

  const context = getAudioContext();
  const sourceMode = audioState.live.sourceMode;
  const perspective = getLivePerspective();
  const source = getSourcePosition(state.progress);
  const rawFrequencies = getPerspectiveFrequencies(state.progress);
  const rawFrequency = rawFrequencies[perspective];
  const frequency = clamp(rawFrequency, 40, 2400);
  const playbackRate = clamp(
    frequency / Math.max(state.baseFrequency, 1),
    0.35,
    3.5,
  );

  audioState.live.perspective = perspective;
  if (sourceMode === "song") {
    const transportKey = [
      audioState.live.songBufferVersion,
      perspective,
      state.playing ? "1" : "0",
      playbackRate.toFixed(3),
    ].join(":");

    const workletReady =
      audioState.live.songWorkletNode
      && audioState.live.songWorkletReady
      && audioState.live.songLoadedBufferVersion === audioState.live.songBufferVersion;

    if (workletReady && (force || transportKey !== audioState.live.lastSongTransportKey)) {
      console.log(
        `[audio] transport sent | rate=${playbackRate.toFixed(3)} freq=${frequency.toFixed(1)}Hz (raw=${rawFrequency.toFixed(1)}) base=${state.baseFrequency}Hz playing=${state.playing} ctxTime=${context.currentTime.toFixed(3)}s`,
      );
      audioState.live.songWorkletNode.port.postMessage({
        type: "transport",
        bufferVersion: audioState.live.songBufferVersion,
        playbackRate,
        playing: state.playing,
        perspective,
        contextTime: context.currentTime,
      });
      audioState.live.lastSongTransportKey = transportKey;
      audioState.live.resumeNeedsHardSync = false;
    } else if (!workletReady) {
      console.log(
        `[audio] transport DROPPED — worklet not ready | node=${!!audioState.live.songWorkletNode} workletReady=${audioState.live.songWorkletReady} loadedVer=${audioState.live.songLoadedBufferVersion} bufVer=${audioState.live.songBufferVersion}`,
      );
    }
  } else {
    audioState.live.oscillators.forEach(({ oscillator, ratio }) => {
      oscillator.frequency.cancelScheduledValues(context.currentTime);
      oscillator.frequency.setTargetAtTime(
        frequency * ratio,
        context.currentTime,
        0.02,
      );
    });
  }

  const statusKey = [
    state.audioEffectMode,
    sourceMode,
    perspective,
    frequency.toFixed(1),
    playbackRate.toFixed(2),
    source.x.toFixed(1),
  ].join(":");
  if (force || statusKey !== audioState.live.lastStatusKey) {
    const message =
      sourceMode === "song"
        ? `Live monitor: uploaded song DSP is tracking ${perspectiveLabel(perspective)} with ${effectModeLabel(state.audioEffectMode)} at ${formatFrequency(frequency)} with the car at ${source.x.toFixed(1)} m.`
        : `Live monitor: ${perspectiveLabel(perspective)} hears ${formatFrequency(frequency)} from the ${liveSourceLabel(sourceMode)} with ${effectModeLabel(state.audioEffectMode)} and the car at ${source.x.toFixed(1)} m.`;
    updateLiveAudioStatus(message);
    audioState.live.lastStatusKey = statusKey;
  }
}

async function handleAudioEffectModeChange() {
  state.audioEffectMode = getCheckedRadioValue("audio-effect-mode") || "prank";
  buildControls();
  render();

  if (audioState.live.active) {
    syncLiveMonitor(true, false);
    return;
  }

  updateLiveAudioStatus(
    `Live monitor is armed for ${perspectiveLabel(getLivePerspective())} using the ${liveSourceLabel(getLiveSourceMode())} with ${effectModeLabel(state.audioEffectMode)}.`,
  );
}

async function startLiveMonitor(requestId) {
  const context = ensureLiveMonitorBus();
  await context.resume();
  if (requestId !== audioState.live.requestId) {
    return false;
  }

  const didSwitchSource = await setLiveMonitorSourceMode(getLiveSourceMode(), requestId);
  if (!didSwitchSource || requestId !== audioState.live.requestId) {
    return false;
  }

  audioState.live.active = true;
  liveAudioToggle.checked = true;
  syncLiveMonitorPlaybackState();
  syncLiveMonitor(true);
  updateSongProgressUI();
  return true;
}

function stopLiveMonitor() {
  if (!audioState.live.masterGain) {
    return;
  }

  const context = getAudioContext();
  audioState.live.requestId += 1;
  audioState.live.active = false;
  audioState.live.lastStatusKey = "";
  audioState.live.lastSongTransportKey = "";
  audioState.live.resumeNeedsHardSync = false;
  liveAudioToggle.checked = false;
  audioState.live.masterGain.gain.cancelScheduledValues(context.currentTime);
  audioState.live.masterGain.gain.setValueAtTime(
    audioState.live.masterGain.gain.value,
    context.currentTime,
  );
  audioState.live.masterGain.gain.setTargetAtTime(0, context.currentTime, 0.04);
  resetLiveSongProcessor();
  updateLiveAudioStatus(
    "Live monitor stopped. Start it again to hear the current graph position.",
  );
  updateSongProgressUI();
}

async function handleLiveSourceModeChange() {
  const sourceMode = getLiveSourceMode();
  const previousMode = audioState.live.sourceMode;

  if (!audioState.live.active) {
    const message =
      sourceMode === "song" && !audioState.sourceBuffer
        ? "Upload a clip first, then start live monitoring to hear the song follow the graph."
        : `Live monitor is armed for the ${liveSourceLabel(sourceMode)} with ${effectModeLabel(state.audioEffectMode)}. Start it to hear the current graph position.`;
    updateLiveAudioStatus(message);
    return;
  }

  const requestId = audioState.live.requestId + 1;
  audioState.live.requestId = requestId;

  try {
    const didSwitchSource = await setLiveMonitorSourceMode(sourceMode, requestId);
    if (!didSwitchSource || requestId !== audioState.live.requestId) {
      return;
    }
    if (sourceMode === "song") {
      requestLiveSongHardSync("start live monitor");
    }
    syncLiveMonitor(true);
    updateSongProgressUI();
  } catch (error) {
    if (requestId !== audioState.live.requestId) {
      return;
    }
    setCheckedRadioValue("live-source-mode", previousMode);
    syncLiveMonitor(true);
    updateSongProgressUI();
    updateLiveAudioStatus(
      error.message === "unsupported-live-song"
        ? "Live uploaded-song monitoring needs a modern desktop browser with AudioWorklet support."
        : "Upload a clip first before switching the live monitor to the song.",
    );
  }
}

async function toggleLiveMonitor() {
  if (liveAudioToggle.checked) {
    const requestId = audioState.live.requestId + 1;
    audioState.live.requestId = requestId;
    try {
      const started = await startLiveMonitor(requestId);
      if (!started) {
        return;
      }
    } catch (error) {
      if (requestId !== audioState.live.requestId) {
        return;
      }
      liveAudioToggle.checked = false;
      updateLiveAudioStatus(
        error.message === "missing-song"
          ? "Upload a clip first, or switch the live monitor back to the synth tone."
          : error.message === "unsupported-live-song"
            ? "Live uploaded-song monitoring needs a modern desktop browser with AudioWorklet support."
          : "This browser blocked live audio startup. Try turning the live monitor on again.",
      );
      updateSongProgressUI();
    }
    return;
  }

  stopLiveMonitor();
}

async function handleAudioUpload(event) {
  const [file] = event.target.files || [];
  const requestId = audioState.uploadRequestId + 1;
  audioState.uploadRequestId = requestId;

  if (!file) {
    resetAudioState();
    return;
  }

  updateAudioStatus(`Loading ${file.name}...`);

  try {
    const arrayBuffer = await file.arrayBuffer();
    if (requestId !== audioState.uploadRequestId) {
      return;
    }
    const context = getAudioContext();
    const decodedBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
    if (requestId !== audioState.uploadRequestId) {
      return;
    }

    audioState.sourceBuffer = decodedBuffer;
    audioState.sourceName = file.name;
    stageLiveSongBuffer(decodedBuffer);
    updateUploadUI();
    updateSongProgressUI();

    if (audioState.live.songWorkletNode) {
      await pushSongBufferToWorklet();
      if (requestId !== audioState.uploadRequestId) {
        return;
      }
    }

    if (audioState.live.active && audioState.live.sourceMode === "song") {
      requestLiveSongHardSync("song buffer reloaded");
      syncLiveMonitor(true);
    }
    updateAudioStatus(`${file.name} is ready for live song monitoring.`);
  } catch (error) {
    if (requestId !== audioState.uploadRequestId) {
      return;
    }
    if (audioState.live.active && audioState.live.sourceMode === "song") {
      stopLiveMonitor();
      updateLiveAudioStatus(
        "That upload could not be used for live song monitoring, so the live monitor was stopped.",
      );
    }
    audioState.sourceBuffer = null;
    audioState.sourceName = "";
    stageLiveSongBuffer(null);
    updateUploadUI();
    updateSongProgressUI();
    audioUpload.value = "";
    updateAudioStatus("Couldn't load audio.");
  }
}

async function resetSimulation() {
  resetControlsToDefaults();
  state.progress = 0.5;
  state.audioEffectMode = "prank";
  state.showNormalLocus = false;
  state.circularTrack = false;
  setPlaybackState(true);

  setCheckedRadioValue("audio-effect-mode", "prank");
  setCheckedRadioValue("live-source-mode", "synth");
  setCheckedRadioValue("live-perspective", "target");
  showNormalLocusToggle.checked = false;
  circularTrackToggle.checked = false;

  if (audioState.live.active) {
    const requestId = audioState.live.requestId + 1;
    audioState.live.requestId = requestId;
    await setLiveMonitorSourceMode("synth", requestId);
    syncLiveMonitor(true);
  } else {
    audioState.live.sourceMode = "synth";
    audioState.live.perspective = "target";
  }

  buildControls();
  render();
}
