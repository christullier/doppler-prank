let lastTickTimestamp = null;
let playbackJustResumed = false;

function resetTickClock() {
  lastTickTimestamp = null;
  playbackJustResumed = true;
}

function tick(timestamp) {
  if (state.playing) {
    const durationSeconds = (
      state.circularTrack
        ? (Math.PI * 2 * state.travelSpan) / state.carSpeed
        : (state.travelSpan * 2) / state.carSpeed
    );

    if (lastTickTimestamp !== null && !playbackJustResumed) {
      const elapsed = (timestamp - lastTickTimestamp) / 1000;
      state.progress += elapsed / durationSeconds;

      if (state.progress >= 1) {
        state.progress -= Math.floor(state.progress);
      }
    }

    playbackJustResumed = false;
    lastTickTimestamp = timestamp;
    render();
  } else {
    lastTickTimestamp = null;
    playbackJustResumed = false;
  }

  requestAnimationFrame(tick);
}

sceneCanvas.addEventListener("pointerdown", (event) => {
  resizeCanvas(sceneCanvas);

  const point = sceneEventPoint(event);
  const dragTarget = draggableSceneTarget(point);
  if (!dragTarget) {
    return;
  }

  sceneDragState.active = true;
  sceneDragState.pointerId = event.pointerId;
  sceneDragState.wasPlaying = state.playing;
  sceneDragState.mode = dragTarget.mode;
  sceneCanvas.classList.add("dragging");
  setPlaybackState(false);
  sceneCanvas.setPointerCapture(event.pointerId);
  if (dragTarget.mode === "car") {
    setProgressFromScenePoint(point);
  } else {
    updateListenerFromScenePoint(dragTarget.mode, point);
  }
  render();
  event.preventDefault();
});

sceneCanvas.addEventListener("pointermove", (event) => {
  if (!sceneDragState.active || event.pointerId !== sceneDragState.pointerId) {
    return;
  }

  const point = sceneEventPoint(event);
  if (sceneDragState.mode === "car") {
    setProgressFromScenePoint(point);
  } else if (sceneDragState.mode) {
    updateListenerFromScenePoint(sceneDragState.mode, point);
  }
  render();
});

sceneCanvas.addEventListener("pointerup", (event) => {
  if (event.pointerId !== sceneDragState.pointerId) {
    return;
  }

  finishSceneDrag();
});

sceneCanvas.addEventListener("pointercancel", (event) => {
  if (event.pointerId !== sceneDragState.pointerId) {
    return;
  }

  finishSceneDrag();
});

sceneCanvas.addEventListener("lostpointercapture", () => {
  finishSceneDrag();
});

playToggle.addEventListener("click", () => {
  togglePlayback();
});

resetButton.addEventListener("click", () => {
  void resetSimulation();
});

audioUpload.addEventListener("change", handleAudioUpload);
removeAudioButton.addEventListener("click", resetAudioState);
liveAudioToggle.addEventListener("change", () => {
  void toggleLiveMonitor();
});
document.querySelectorAll('input[name="audio-effect-mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    void handleAudioEffectModeChange();
  });
});
showNormalLocusToggle.addEventListener("change", () => {
  state.showNormalLocus = showNormalLocusToggle.checked;
  render();
});
circularTrackToggle.addEventListener("change", () => {
  state.circularTrack = circularTrackToggle.checked;
  render();
});
document.querySelectorAll('input[name="live-source-mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    void handleLiveSourceModeChange();
  });
});
document.querySelectorAll('input[name="live-perspective"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (audioState.live.active) {
      syncLiveMonitor(true, false);
      return;
    }

    updateLiveAudioStatus(
      `Live monitor is armed for ${perspectiveLabel(getLivePerspective())} using the ${liveSourceLabel(getLiveSourceMode())} with ${effectModeLabel(state.audioEffectMode)}.`,
    );
  });
});

window.addEventListener("resize", render);
document.addEventListener("themechange", () => {
  syncThemeUI();
  render();
});

window.addEventListener("keydown", (event) => {
  if (
    (event.code !== "Space" && event.key !== " " && event.key !== "Spacebar")
    || event.repeat
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || shouldIgnoreSpacebarToggle(event.target)
  ) {
    return;
  }

  event.preventDefault();
  togglePlayback();
});

buildControls();
updateUploadUI();
syncThemeUI();
render();
requestAnimationFrame(tick);
