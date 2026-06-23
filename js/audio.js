const DEFAULT_AUDIO_URL = "audio/ambulance-siren.wav";
const DEFAULT_AUDIO_NAME = "ambulance-siren.wav";
const AUDIO_CONTEXT_RESUME_TIMEOUT_MS = 2500;

function isDefaultAudioLoaded() {
  return audioState.isDefaultAudio;
}

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
  const hasAudio = Boolean(audioState.uploadedBuffer);

  filePicker.hidden = hasAudio;
  uploadedAudio.hidden = !hasAudio;
  uploadedAudioName.textContent = hasAudio ? audioState.sourceName : "";
  liveSourceSongInput.disabled = !hasAudio;
  removeAudioButton.hidden = !hasAudio;
}

function updateLiveMonitorToggleUI() {
  liveAudioToggles.forEach((toggle) => {
    toggle.checked = audioState.live.active;
    toggle.disabled = audioState.live.starting;
  });
}

function fetchDefaultAudioData() {
  if (audioState.defaultAudioArrayBuffer) {
    return Promise.resolve(audioState.defaultAudioArrayBuffer.slice(0));
  }

  if (!audioState.defaultAudioFetchPromise) {
    audioState.defaultAudioFetchPromise = fetch(DEFAULT_AUDIO_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`fetch failed: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => {
        audioState.defaultAudioArrayBuffer = arrayBuffer;
        return arrayBuffer.slice(0);
      })
      .catch((error) => {
        audioState.defaultAudioFetchPromise = null;
        throw error;
      });
  }

  return audioState.defaultAudioFetchPromise.then((arrayBuffer) => arrayBuffer.slice(0));
}

function preloadDefaultAudio() {
  void fetchDefaultAudioData().catch(() => {
    audioState.defaultAudioArrayBuffer = null;
  });
}

async function resumeAudioContext(context) {
  if (context.state === "running") {
    return;
  }

  const didResume = await Promise.race([
    context.resume().then(
      () => true,
      () => false,
    ),
    new Promise((resolve) => {
      window.setTimeout(() => resolve(false), AUDIO_CONTEXT_RESUME_TIMEOUT_MS);
    }),
  ]);

  if (!didResume || context.state !== "running") {
    throw new Error("audio-context-blocked");
  }
}

function resetControlsToDefaults() {
  Object.entries(initialControlState).forEach(([key, value]) => {
    state[key] = value;
  });
}

async function resetAudioState() {
  audioState.uploadRequestId += 1;
  audioUpload.value = "";
  audioState.uploadedBuffer = null;
  audioState.sourceName = "";
  updateUploadUI();
  updateAudioStatus("");

  if (getLiveSourceMode() === "song") {
    setCheckedRadioValue("live-source-mode", "siren");
    if (audioState.live.active) {
      const requestId = audioState.live.requestId + 1;
      audioState.live.requestId = requestId;
      await setLiveMonitorSourceMode("siren", requestId);
      syncLiveMonitor(true);
    } else {
      audioState.live.sourceMode = "siren";
    }
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
  stopFallbackSongSource();
  audioState.live.songBufferVersion += 1;
  audioState.live.songLoadedBufferVersion = 0;
  audioState.live.songWorkletReady = false;
  audioState.live.songFallbackReady = false;
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
    stopFallbackSongSource();
    return;
  }

  audioState.live.songWorkletNode.port.postMessage({ type: "reset" });
  audioState.live.lastSongTransportKey = "";
  stopFallbackSongSource();
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
      .addModule("live-song-processor.js?v=3")
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

function updateFallbackSongPosition(context = getAudioContext()) {
  const buffer = audioState.sourceBuffer;
  if (!buffer || !buffer.duration) {
    audioState.live.songPositionFraction = 0;
    return;
  }

  if (audioState.live.songFallbackPlaying && audioState.live.songFallbackSource) {
    const elapsed = Math.max(0, context.currentTime - audioState.live.songFallbackStartedAt);
    const position = (
      audioState.live.songFallbackOffset
      + elapsed * audioState.live.songFallbackRate
    ) % buffer.duration;
    audioState.live.songPositionFraction = position / buffer.duration;
    return;
  }

  audioState.live.songPositionFraction =
    (audioState.live.songFallbackOffset % buffer.duration) / buffer.duration;
}

function stopFallbackSongSource({ keepPosition = false } = {}) {
  if (audioState.live.songFallbackSource) {
    if (keepPosition) {
      updateFallbackSongPosition();
      if (audioState.sourceBuffer?.duration) {
        audioState.live.songFallbackOffset =
          audioState.live.songPositionFraction * audioState.sourceBuffer.duration;
      }
    }

    try {
      audioState.live.songFallbackSource.stop();
    } catch (_error) {
      // Already stopped.
    }
    audioState.live.songFallbackSource.disconnect();
  }

  audioState.live.songFallbackSource = null;
  audioState.live.songFallbackStartedAt = 0;
  audioState.live.songFallbackPlaying = false;

  if (!keepPosition) {
    audioState.live.songFallbackOffset = 0;
    audioState.live.songPositionFraction = 0;
  }
}

function startFallbackSongSource(context, playbackRate) {
  if (!audioState.sourceBuffer) {
    throw new Error("missing-song");
  }

  stopFallbackSongSource({ keepPosition: true });

  const source = context.createBufferSource();
  const duration = audioState.sourceBuffer.duration || 0;
  const offset = duration
    ? audioState.live.songFallbackOffset % duration
    : 0;

  source.buffer = audioState.sourceBuffer;
  source.loop = true;
  source.playbackRate.setValueAtTime(playbackRate, context.currentTime);
  source.connect(audioState.live.songGain);
  source.start(context.currentTime, offset);

  audioState.live.songFallbackSource = source;
  audioState.live.songFallbackStartedAt = context.currentTime;
  audioState.live.songFallbackOffset = offset;
  audioState.live.songFallbackRate = playbackRate;
  audioState.live.songFallbackPlaying = true;
  audioState.live.songFallbackReady = true;
}

function syncFallbackSongTransport(context, playbackRate, force = false) {
  if (!audioState.live.songFallbackReady || !audioState.sourceBuffer) {
    return false;
  }

  if (!state.playing) {
    if (audioState.live.songFallbackPlaying) {
      stopFallbackSongSource({ keepPosition: true });
    }
    updateFallbackSongPosition(context);
    return true;
  }

  if (!audioState.live.songFallbackSource) {
    startFallbackSongSource(context, playbackRate);
    updateFallbackSongPosition(context);
    return true;
  }

  if (force || Math.abs(audioState.live.songFallbackRate - playbackRate) > 0.001) {
    updateFallbackSongPosition(context);
    if (audioState.sourceBuffer?.duration) {
      audioState.live.songFallbackOffset =
        audioState.live.songPositionFraction * audioState.sourceBuffer.duration;
    }
    audioState.live.songFallbackStartedAt = context.currentTime;
    audioState.live.songFallbackSource.playbackRate.cancelScheduledValues(context.currentTime);
    audioState.live.songFallbackSource.playbackRate.setTargetAtTime(
      playbackRate,
      context.currentTime,
      0.02,
    );
    audioState.live.songFallbackRate = playbackRate;
  }

  updateFallbackSongPosition(context);
  return true;
}

async function ensureBufferedSongMonitorNode() {
  const context = ensureLiveMonitorBus();

  if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") {
    audioState.live.songWorkletReady = false;
    audioState.live.songFallbackReady = true;
    return "fallback";
  }

  try {
    await ensureSongWorkletNode();
    audioState.live.songFallbackReady = false;
    return "worklet";
  } catch (error) {
    console.warn("[audio] AudioWorklet unavailable; using buffer-source fallback.", error);
    audioState.live.songWorkletReady = false;
    audioState.live.songFallbackReady = true;
    return "fallback";
  }
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
  if (mode === "siren") {
    return "ambulance siren";
  }

  if (mode === "song") {
    return "uploaded song";
  }

  return "synth tone";
}

function getLiveSourceMode() {
  return getCheckedRadioValue("live-source-mode") || "siren";
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

  if (mode !== "synth") {
    const nextBuffer = mode === "siren" ? audioState.sirenBuffer : audioState.uploadedBuffer;
    if (!nextBuffer) {
      throw new Error("missing-song");
    }

    if (audioState.sourceBuffer !== nextBuffer) {
      audioState.sourceBuffer = nextBuffer;
      stageLiveSongBuffer(nextBuffer);
    }
    const songBackend = await ensureBufferedSongMonitorNode();
    if (requestId !== audioState.live.requestId) {
      return false;
    }
    if (songBackend === "worklet") {
      await pushSongBufferToWorklet();
      if (requestId !== audioState.live.requestId) {
        return false;
      }
    } else {
      audioState.live.songFallbackReady = true;
    }
    audioState.live.synthGain.gain.setValueAtTime(0, context.currentTime);
    audioState.live.songGain.gain.setValueAtTime(1, context.currentTime);
    requestLiveSongHardSync(`source mode switched to ${mode}`);
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
  if (sourceMode !== "synth") {
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
    } else if (!workletReady && audioState.live.songFallbackReady) {
      syncFallbackSongTransport(context, playbackRate, force);
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
      sourceMode !== "synth"
        ? `Live monitor: the ${liveSourceLabel(sourceMode)} is tracking ${perspectiveLabel(perspective)} with ${effectModeLabel(state.audioEffectMode)} at ${formatFrequency(frequency)} with the car at ${source.x.toFixed(1)} m.`
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
  updateLiveAudioStatus("Starting live monitor...");
  await resumeAudioContext(context);
  if (requestId !== audioState.live.requestId) {
    return false;
  }

  if (getLiveSourceMode() === "siren" && !audioState.sirenBuffer) {
    updateLiveAudioStatus(`Loading ${DEFAULT_AUDIO_NAME} before starting live monitoring...`);
    const loadedDefaultAudio = await loadDefaultAudio();
    if (requestId !== audioState.live.requestId) {
      return false;
    }
    if (!loadedDefaultAudio || !audioState.sirenBuffer) {
      throw new Error("missing-default-siren");
    }
  }

  const didSwitchSource = await setLiveMonitorSourceMode(getLiveSourceMode(), requestId);
  if (!didSwitchSource || requestId !== audioState.live.requestId) {
    return false;
  }

  audioState.live.active = true;
  updateLiveMonitorToggleUI();
  syncLiveMonitorPlaybackState();
  syncLiveMonitor(true);
  updateSongProgressUI();
  return true;
}

function stopLiveMonitor() {
  audioState.live.requestId += 1;
  audioState.live.active = false;
  audioState.live.starting = false;
  audioState.live.lastStatusKey = "";
  audioState.live.lastSongTransportKey = "";
  audioState.live.resumeNeedsHardSync = false;
  updateLiveMonitorToggleUI();

  if (!audioState.live.masterGain) {
    updateLiveAudioStatus(
      "Live monitor stopped. Start it again to hear the current graph position.",
    );
    updateSongProgressUI();
    return;
  }

  const context = getAudioContext();
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
      sourceMode === "song" && !audioState.uploadedBuffer
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
    if (sourceMode !== "synth") {
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

async function toggleLiveMonitor(nextChecked = liveAudioToggle.checked) {
  if (audioState.live.starting) {
    updateLiveMonitorToggleUI();
    return;
  }

  if (nextChecked) {
    const requestId = audioState.live.requestId + 1;
    audioState.live.requestId = requestId;
    audioState.live.starting = true;
    updateLiveMonitorToggleUI();

    try {
      const started = await startLiveMonitor(requestId);
      if (!started) {
        return;
      }
    } catch (error) {
      if (requestId !== audioState.live.requestId) {
        return;
      }
      updateLiveAudioStatus(
        error.message === "missing-song"
          ? "Upload a clip first, or switch the live monitor back to the synth tone."
          : error.message === "missing-default-siren"
            ? "Couldn't load the default siren. Switch the live source to Tone, then try again."
          : error.message === "audio-context-blocked"
            ? "This browser did not allow audio to start. Try the live monitor again."
          : error.message === "unsupported-live-song"
            ? "Live uploaded-song monitoring needs a modern desktop browser with AudioWorklet support."
          : "This browser blocked live audio startup. Try turning the live monitor on again.",
      );
      updateSongProgressUI();
    } finally {
      if (requestId === audioState.live.requestId) {
        audioState.live.starting = false;
        updateLiveMonitorToggleUI();
      }
    }
    return;
  }

  stopLiveMonitor();
}

async function applySourceBuffer(decodedBuffer, name, requestId = null, isDefault = false) {
  if (requestId !== null && requestId !== audioState.uploadRequestId) {
    return false;
  }

  if (isDefault) {
    audioState.sirenBuffer = decodedBuffer;
    audioState.isDefaultAudio = true;
  } else {
    audioState.uploadedBuffer = decodedBuffer;
    audioState.sourceName = name;
  }
  updateUploadUI();
  updateSongProgressUI();

  const sourceMode = audioState.live.sourceMode;
  const shouldActivate = (isDefault && sourceMode === "siren") || (!isDefault && sourceMode === "song");
  if (shouldActivate) {
    audioState.sourceBuffer = decodedBuffer;
    stageLiveSongBuffer(decodedBuffer);
  }

  if (shouldActivate && audioState.live.songWorkletNode) {
    await pushSongBufferToWorklet();
    if (requestId !== null && requestId !== audioState.uploadRequestId) {
      return false;
    }
  }

  if (shouldActivate && audioState.live.active) {
    requestLiveSongHardSync("song buffer reloaded");
    syncLiveMonitor(true);
  }

  return true;
}

async function loadDefaultAudio({ statusMessage } = {}) {
  if (audioState.defaultAudioPromise) {
    return audioState.defaultAudioPromise;
  }

  audioState.isDefaultAudioLoading = true;
  updateAudioStatus(`Loading ${DEFAULT_AUDIO_NAME}...`);

  audioState.defaultAudioPromise = (async () => {
    try {
      const arrayBuffer = await fetchDefaultAudioData();
      const context = getAudioContext();
      const decodedBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
      const applied = await applySourceBuffer(decodedBuffer, DEFAULT_AUDIO_NAME, null, true);
      if (applied) {
        updateAudioStatus(
          statusMessage || `${DEFAULT_AUDIO_NAME} is ready for live monitoring.`,
        );
      }
      return applied;
    } catch (_error) {
      audioState.sirenBuffer = null;
      audioState.isDefaultAudio = false;
      updateUploadUI();
      updateSongProgressUI();
      setCheckedRadioValue("live-source-mode", "synth");
      audioState.live.sourceMode = "synth";
      if (audioState.live.active) {
        stopLiveMonitor();
        updateLiveAudioStatus("Couldn't load the default audio, so live monitoring was stopped.");
      }
      updateAudioStatus("Couldn't load the default siren audio.");
      return false;
    } finally {
      audioState.isDefaultAudioLoading = false;
      audioState.defaultAudioPromise = null;
    }
  })();

  return audioState.defaultAudioPromise;
}

async function handleAudioUpload(event) {
  const [file] = event.target.files || [];
  const requestId = audioState.uploadRequestId + 1;
  audioState.uploadRequestId = requestId;

  if (!file) {
    await resetAudioState();
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

    const applied = await applySourceBuffer(decodedBuffer, file.name, requestId);
    if (!applied) {
      return;
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
    audioState.uploadedBuffer = null;
    audioState.sourceName = "";
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
  setCheckedRadioValue("live-source-mode", "siren");
  setCheckedRadioValue("live-perspective", "target");
  showNormalLocusToggle.checked = false;
  circularTrackToggle.checked = false;

  if (!isDefaultAudioLoaded()) {
    await loadDefaultAudio();
  }

  if (audioState.live.active) {
    const requestId = audioState.live.requestId + 1;
    audioState.live.requestId = requestId;
    await setLiveMonitorSourceMode(getLiveSourceMode(), requestId);
    syncLiveMonitor(true);
  } else {
    audioState.live.sourceMode = getLiveSourceMode();
    audioState.live.perspective = "target";
  }

  buildControls();
  render();
}
