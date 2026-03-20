const controls = [
  {
    title: "Pass",
    items: [
      {
        key: "speedOfSound",
        label: "Speed of sound",
        min: 300,
        max: 360,
        step: 1,
        value: 343,
        unit: "m/s",
      },
      {
        key: "carSpeed",
        label: "Car speed",
        min: 5,
        max: 45,
        step: 0.5,
        value: 18,
        unit: "m/s",
      },
      {
        key: "travelSpan",
        label: "Half-length of pass",
        min: 30,
        max: 220,
        step: 1,
        value: 120,
        unit: "m",
      },
    ],
  },
  {
    title: "Siren",
    items: [
      {
        key: "baseFrequency",
        label: "Normal siren pitch",
        min: 200,
        max: 1200,
        step: 1,
        value: 700,
        unit: "Hz",
      },
      {
        key: "targetFrequency",
        label: "Desired heard pitch",
        min: 200,
        max: 1200,
        step: 1,
        value: 700,
        unit: "Hz",
      },
    ],
  },
  {
    title: "Target",
    items: [
      {
        key: "targetX",
        label: "Position along road",
        min: -40,
        max: 40,
        step: 1,
        value: 0,
        unit: "m",
      },
      {
        key: "targetY",
        label: "Distance from road",
        min: 2,
        max: 40,
        step: 0.5,
        value: 10,
        unit: "m",
      },
    ],
  },
  {
    title: "Bystander",
    items: [
      {
        key: "bystanderX",
        label: "Position along road",
        min: -40,
        max: 40,
        step: 1,
        value: 16,
        unit: "m",
      },
      {
        key: "bystanderY",
        label: "Distance from road",
        min: 2,
        max: 40,
        step: 0.5,
        value: 16,
        unit: "m",
      },
    ],
  },
];

const initialControlState = Object.fromEntries(
  controls.flatMap((group) => group.items.map((item) => [item.key, item.value])),
);

const state = { ...initialControlState };

state.progress = 0.5;
state.playing = true;

const progressInput = document.getElementById("progress");
const playToggle = document.getElementById("play-toggle");
const resetButton = document.getElementById("reset");
const controlGroups = document.getElementById("control-groups");
const statsGrid = document.getElementById("stats-grid");
const sceneCanvas = document.getElementById("scene-canvas");
const chartCanvas = document.getElementById("chart-canvas");
const audioUpload = document.getElementById("audio-upload");
const audioStatus = document.getElementById("audio-status");
const filePicker = document.getElementById("file-picker");
const uploadedAudio = document.getElementById("uploaded-audio");
const uploadedAudioName = document.getElementById("uploaded-audio-name");
const removeAudioButton = document.getElementById("remove-audio");
const previewsBox = document.getElementById("previews-box");
const liveAudioToggle = document.getElementById("live-audio-toggle");
const liveSourceSongInput = document.getElementById("live-source-song");
const liveAudioStatus = document.getElementById("live-audio-status");
const audioPlayers = {
  original: document.getElementById("audio-original"),
  car: document.getElementById("audio-car"),
  target: document.getElementById("audio-target"),
  bystander: document.getElementById("audio-bystander"),
};

const sceneContext = sceneCanvas.getContext("2d");
const chartContext = chartCanvas.getContext("2d");

const audioState = {
  context: null,
  sourceBuffer: null,
  sourceName: "",
  rendering: false,
  renderJobId: 0,
  renderDebounceId: null,
  renderWorker: null,
  originalUrl: null,
  previewUrls: {
    car: null,
    target: null,
    bystander: null,
  },
  live: {
    active: false,
    perspective: "target",
    sourceMode: "synth",
    masterGain: null,
    synthGain: null,
    songGain: null,
    oscillators: [],
    songElement: null,
    songNode: null,
    lastStatusKey: "",
  },
};

const sceneDragState = {
  active: false,
  pointerId: null,
  wasPlaying: false,
};

function formatNumber(value, unit, digits = 1) {
  return `${value.toFixed(digits)} ${unit}`;
}

function formatFrequency(value) {
  return `${value.toFixed(1)} Hz`;
}

function getCheckedRadioValue(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : "";
}

function setCheckedRadioValue(name, value) {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) {
    radio.checked = true;
  }
}

function getAudioContext() {
  if (!audioState.context) {
    const Context = window.AudioContext || window.webkitAudioContext;
    audioState.context = new Context();
  }

  return audioState.context;
}

function clearAudioPreviews() {
  Object.entries(audioState.previewUrls).forEach(([key, url]) => {
    if (url) {
      URL.revokeObjectURL(url);
      audioState.previewUrls[key] = null;
    }

    audioPlayers[key].removeAttribute("src");
    audioPlayers[key].load();
  });

  updatePreviewsVisibility();
}

function cancelPendingPreviewRender() {
  if (audioState.renderDebounceId) {
    clearTimeout(audioState.renderDebounceId);
    audioState.renderDebounceId = null;
  }

  if (audioState.renderWorker) {
    audioState.renderJobId += 1;
    audioState.renderWorker.terminate();
    audioState.renderWorker = null;
  }

  audioState.rendering = false;
}

function clearOriginalPreview() {
  if (audioState.originalUrl) {
    URL.revokeObjectURL(audioState.originalUrl);
    audioState.originalUrl = null;
  }

  if (audioState.live.songElement) {
    audioState.live.songElement.pause();
    audioState.live.songElement.removeAttribute("src");
    audioState.live.songElement.load();
  }

  audioPlayers.original.removeAttribute("src");
  audioPlayers.original.load();
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

function updatePreviewsVisibility() {
  const hasPreviews = Object.values(audioState.previewUrls).some(Boolean);
  previewsBox.hidden = !hasPreviews;
}

function resetControlsToDefaults() {
  Object.entries(initialControlState).forEach(([key, value]) => {
    state[key] = value;
  });
}

function resetAudioState() {
  cancelPendingPreviewRender();
  clearOriginalPreview();
  clearAudioPreviews();
  audioState.sourceBuffer = null;
  audioState.sourceName = "";
  audioUpload.value = "";
  updateUploadUI();
  updateAudioStatus("");

  if (audioState.live.active && audioState.live.sourceMode === "song") {
    stopLiveMonitor();
    updateLiveAudioStatus(
      "The uploaded song was removed, so live monitoring switched off.",
    );
  }
}

function markAudioDirty() {
  if (!audioState.sourceBuffer) {
    return;
  }

  clearAudioPreviews();
  schedulePreviewRender(
    "Updating previews...",
  );
}

function buildControls() {
  controlGroups.innerHTML = "";

  controls.forEach((group) => {
    const groupElement = document.createElement("section");
    groupElement.className = "control-group";

    const title = document.createElement("h3");
    title.textContent = group.title;
    groupElement.appendChild(title);

    group.items.forEach((item) => {
      const row = document.createElement("label");
      row.className = "control";

      const header = document.createElement("div");
      header.className = "control-header";

      const label = document.createElement("span");
      label.textContent = item.label;

      const value = document.createElement("span");
      value.id = `${item.key}-value`;
      value.textContent = formatNumber(state[item.key], item.unit, item.step < 1 ? 1 : 0);

      header.append(label, value);

      const input = document.createElement("input");
      input.type = "range";
      input.min = String(item.min);
      input.max = String(item.max);
      input.step = String(item.step);
      input.value = String(state[item.key]);
      input.id = item.key;
      input.addEventListener("input", () => {
        state[item.key] = Number(input.value);
        value.textContent = formatNumber(
          state[item.key],
          item.unit,
          item.step < 1 ? 1 : 0,
        );
        markAudioDirty();
        render();
      });

      row.append(header, input);
      groupElement.appendChild(row);
    });

    controlGroups.appendChild(groupElement);
  });
}

function resizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.floor(canvas.clientWidth * ratio);
  const height = Math.floor(canvas.clientHeight * ratio);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function getSourcePosition(progress) {
  return {
    x: -state.travelSpan + 2 * state.travelSpan * progress,
    y: 0,
  };
}

function getListener(name) {
  return {
    x: state[`${name}X`],
    y: state[`${name}Y`],
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dopplerObservedFrequency(emittedFrequency, source, listener) {
  const separation = distance(source, listener);
  const towardComponent = (state.carSpeed * (listener.x - source.x)) / separation;
  const safeDenominator = Math.max(state.speedOfSound - towardComponent, 1e-6);

  return {
    observed: emittedFrequency * (state.speedOfSound / safeDenominator),
    towardComponent,
    separation,
  };
}

function prankEmissionForTarget(source, target) {
  const { towardComponent } = dopplerObservedFrequency(state.baseFrequency, source, target);
  return state.targetFrequency * ((state.speedOfSound - towardComponent) / state.speedOfSound);
}

function getPerspectiveFrequencies(progress) {
  const source = getSourcePosition(progress);
  const target = getListener("target");
  const bystander = getListener("bystander");
  const prankEmission = prankEmissionForTarget(source, target);

  return {
    car: prankEmission,
    target: dopplerObservedFrequency(prankEmission, source, target).observed,
    bystander: dopplerObservedFrequency(prankEmission, source, bystander).observed,
  };
}

function sampleSeries(sampleCount = 220) {
  const target = getListener("target");
  const bystander = getListener("bystander");

  const samples = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / (sampleCount - 1);
    const source = getSourcePosition(progress);
    const normalTarget = dopplerObservedFrequency(state.baseFrequency, source, target);
    const prankEmission = prankEmissionForTarget(source, target);
    const prankTarget = dopplerObservedFrequency(prankEmission, source, target);
    const prankBystander = dopplerObservedFrequency(prankEmission, source, bystander);

    samples.push({
      progress,
      source,
      normalTarget: normalTarget.observed,
      prankTarget: prankTarget.observed,
      prankBystander: prankBystander.observed,
      prankEmission,
    });
  }

  return samples;
}

function currentSnapshot() {
  const source = getSourcePosition(state.progress);
  const target = getListener("target");
  const bystander = getListener("bystander");
  const normalTarget = dopplerObservedFrequency(state.baseFrequency, source, target);
  const prankEmission = prankEmissionForTarget(source, target);
  const prankTarget = dopplerObservedFrequency(prankEmission, source, target);
  const prankBystander = dopplerObservedFrequency(prankEmission, source, bystander);

  return {
    source,
    target,
    bystander,
    normalTarget,
    prankEmission,
    prankTarget,
    prankBystander,
  };
}

function updateStats(snapshot) {
  const cards = [
    {
      label: "Natural pitch at target",
      value: formatFrequency(snapshot.normalTarget.observed),
    },
    {
      label: "Prank emission right now",
      value: formatFrequency(snapshot.prankEmission),
    },
    {
      label: "Target hears with prank",
      value: formatFrequency(snapshot.prankTarget.observed),
    },
    {
      label: "Bystander hears with prank",
      value: formatFrequency(snapshot.prankBystander.observed),
    },
  ];

  statsGrid.innerHTML = "";
  cards.forEach((card) => {
    const element = document.createElement("article");
    element.className = "stat-card";
    element.innerHTML = `<span class="label">${card.label}</span><span class="value">${card.value}</span>`;
    statsGrid.appendChild(element);
  });
}

function worldBounds() {
  const left = -state.travelSpan;
  const right = state.travelSpan;
  const top = Math.max(state.targetY, state.bystanderY) + 12;
  return { left, right, top };
}

function scenePadding() {
  const ratio = window.devicePixelRatio || 1;

  return {
    x: 48 * ratio,
    top: 34 * ratio,
    bottom: 16 * ratio,
  };
}

function sceneLayout() {
  return {
    width: sceneCanvas.width,
    height: sceneCanvas.height,
    bounds: worldBounds(),
    padding: scenePadding(),
  };
}

function mapPoint(point, bounds, width, height, padding) {
  const xPadding = typeof padding === "number" ? padding : padding.x;
  const topPadding = typeof padding === "number" ? padding : padding.top;
  const bottomPadding = typeof padding === "number" ? padding : padding.bottom;
  const usableWidth = width - xPadding * 2;
  const usableHeight = height - topPadding - bottomPadding;
  const x = xPadding + ((point.x - bounds.left) / (bounds.right - bounds.left)) * usableWidth;
  const y = height - bottomPadding - (point.y / bounds.top) * usableHeight;
  return { x, y };
}

function drawDot(context, point, radius, color, label) {
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();

  context.font = "600 13px Avenir Next, Segoe UI, sans-serif";
  context.fillStyle = "#22170d";
  context.fillText(label, point.x + radius + 8, point.y - radius - 4);
}

function drawScene(snapshot) {
  resizeCanvas(sceneCanvas);

  const { width, height, bounds, padding } = sceneLayout();

  sceneContext.clearRect(0, 0, width, height);

  sceneContext.fillStyle = "#fbf6ef";
  sceneContext.fillRect(0, 0, width, height);

  const roadY = mapPoint({ x: 0, y: 0 }, bounds, width, height, padding).y;

  sceneContext.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--road");
  sceneContext.fillRect(0, roadY - 34, width, 68);

  sceneContext.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--road-edge");
  sceneContext.lineWidth = 2;
  sceneContext.setLineDash([10, 12]);
  sceneContext.beginPath();
  sceneContext.moveTo(0, roadY);
  sceneContext.lineTo(width, roadY);
  sceneContext.stroke();
  sceneContext.setLineDash([]);

  const sourcePoint = mapPoint(snapshot.source, bounds, width, height, padding);
  const targetPoint = mapPoint(snapshot.target, bounds, width, height, padding);
  const bystanderPoint = mapPoint(snapshot.bystander, bounds, width, height, padding);

  sceneContext.strokeStyle = "rgba(177, 137, 18, 0.75)";
  sceneContext.lineWidth = 3;
  sceneContext.beginPath();
  sceneContext.moveTo(sourcePoint.x, sourcePoint.y);
  sceneContext.lineTo(targetPoint.x, targetPoint.y);
  sceneContext.stroke();

  sceneContext.strokeStyle = "rgba(52, 88, 184, 0.35)";
  sceneContext.lineWidth = 2;
  sceneContext.beginPath();
  sceneContext.moveTo(sourcePoint.x, sourcePoint.y);
  sceneContext.lineTo(bystanderPoint.x, bystanderPoint.y);
  sceneContext.stroke();

  sceneContext.fillStyle = "rgba(216, 93, 60, 0.14)";
  for (let ring = 1; ring <= 3; ring += 1) {
    sceneContext.beginPath();
    sceneContext.arc(sourcePoint.x, sourcePoint.y, ring * 24, 0, Math.PI * 2);
    sceneContext.fill();
  }

  drawDot(
    sceneContext,
    sourcePoint,
    10,
    getComputedStyle(document.documentElement).getPropertyValue("--car"),
    "car",
  );
  drawDot(
    sceneContext,
    targetPoint,
    9,
    getComputedStyle(document.documentElement).getPropertyValue("--target"),
    "target",
  );
  drawDot(
    sceneContext,
    bystanderPoint,
    9,
    getComputedStyle(document.documentElement).getPropertyValue("--bystander"),
    "bystander",
  );

  sceneContext.fillStyle = "rgba(255, 255, 255, 0.85)";
  sceneContext.strokeStyle = "rgba(34, 23, 13, 0.1)";
  sceneContext.lineWidth = 1;
  sceneContext.beginPath();
  sceneContext.roundRect(20, 20, 310, 104, 18);
  sceneContext.fill();
  sceneContext.stroke();

  sceneContext.fillStyle = "#22170d";
  sceneContext.font = "700 15px Avenir Next, Segoe UI, sans-serif";
  sceneContext.fillText("Current pass snapshot", 40, 48);
  sceneContext.font = "500 13px Avenir Next, Segoe UI, sans-serif";
  sceneContext.fillStyle = "#6b5948";
  sceneContext.fillText(`source x: ${snapshot.source.x.toFixed(1)} m`, 40, 74);
  sceneContext.fillText(
    `target delta: ${(snapshot.prankTarget.observed - snapshot.normalTarget.observed).toFixed(1)} Hz`,
    40,
    94,
  );
  sceneContext.fillText(
    `bystander mismatch: ${(snapshot.prankBystander.observed - state.targetFrequency).toFixed(1)} Hz`,
    40,
    114,
  );
}

function sceneEventPoint(event) {
  const rect = sceneCanvas.getBoundingClientRect();
  const scaleX = sceneCanvas.width / Math.max(rect.width, 1);
  const scaleY = sceneCanvas.height / Math.max(rect.height, 1);

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function isScenePointNearCar(point) {
  const { width, height, bounds, padding } = sceneLayout();
  const carPoint = mapPoint(getSourcePosition(state.progress), bounds, width, height, padding);
  const ratio = window.devicePixelRatio || 1;

  return Math.hypot(point.x - carPoint.x, point.y - carPoint.y) <= 24 * ratio;
}

function setProgressFromScenePoint(point) {
  const { width, padding } = sceneLayout();
  const usableWidth = Math.max(width - padding.x * 2, 1);
  const normalized = (point.x - padding.x) / usableWidth;
  state.progress = clamp(normalized, 0, 1);
}

function finishSceneDrag() {
  if (!sceneDragState.active) {
    return;
  }

  sceneDragState.active = false;
  sceneDragState.pointerId = null;
  sceneCanvas.classList.remove("dragging");
  state.playing = sceneDragState.wasPlaying;
  playToggle.textContent = state.playing ? "Pause" : "Play";
}

function drawAxes(context, width, height, padding, minY, maxY) {
  context.strokeStyle = "rgba(34, 23, 13, 0.16)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(padding, padding);
  context.lineTo(padding, height - padding);
  context.lineTo(width - padding, height - padding);
  context.stroke();

  context.font = "500 12px Avenir Next, Segoe UI, sans-serif";
  context.fillStyle = "#6b5948";

  for (let tick = 0; tick <= 4; tick += 1) {
    const y = padding + ((height - padding * 2) * tick) / 4;
    const ratio = tick / 4;
    const value = maxY - (maxY - minY) * ratio;
    context.strokeStyle = "rgba(34, 23, 13, 0.08)";
    context.beginPath();
    context.moveTo(padding, y);
    context.lineTo(width - padding, y);
    context.stroke();
    context.fillText(`${value.toFixed(0)} Hz`, 16, y + 4);
  }

  for (let tick = 0; tick <= 4; tick += 1) {
    const x = padding + ((width - padding * 2) * tick) / 4;
    const ratio = tick / 4;
    const value = -state.travelSpan + ratio * state.travelSpan * 2;
    context.fillText(`${value.toFixed(0)} m`, x - 14, height - padding + 22);
  }

  context.save();
  context.translate(18, height / 2);
  context.rotate(-Math.PI / 2);
  context.fillText("Observed frequency", 0, 0);
  context.restore();

  context.fillText("Car position along road", width / 2 - 60, height - 18);
}

function drawSeries(context, samples, key, color, width, height, padding, minY, maxY) {
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.beginPath();

  samples.forEach((sample, index) => {
    const x = padding + sample.progress * (width - padding * 2);
    const yRatio = (sample[key] - minY) / (maxY - minY || 1);
    const y = height - padding - yRatio * (height - padding * 2);

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();
}

function drawChart(snapshot, samples) {
  resizeCanvas(chartCanvas);

  const width = chartCanvas.width;
  const height = chartCanvas.height;
  const padding = 52 * (window.devicePixelRatio || 1);

  chartContext.clearRect(0, 0, width, height);
  chartContext.fillStyle = "#fbf6ef";
  chartContext.fillRect(0, 0, width, height);

  const allValues = samples.flatMap((sample) => [
    sample.normalTarget,
    sample.prankTarget,
    sample.prankBystander,
  ]);
  const minY = Math.min(...allValues) - 20;
  const maxY = Math.max(...allValues) + 20;

  drawAxes(chartContext, width, height, padding, minY, maxY);
  drawSeries(chartContext, samples, "normalTarget", "#d85d3c", width, height, padding, minY, maxY);
  drawSeries(chartContext, samples, "prankTarget", "#b18912", width, height, padding, minY, maxY);
  drawSeries(chartContext, samples, "prankBystander", "#3458b8", width, height, padding, minY, maxY);

  const cursorX = padding + state.progress * (width - padding * 2);
  chartContext.strokeStyle = "rgba(34, 23, 13, 0.22)";
  chartContext.lineWidth = 2;
  chartContext.beginPath();
  chartContext.moveTo(cursorX, padding);
  chartContext.lineTo(cursorX, height - padding);
  chartContext.stroke();

  const legendItems = [
    ["Target without prank", "#d85d3c"],
    ["Target with prank", "#b18912"],
    ["Bystander with prank", "#3458b8"],
  ];

  legendItems.forEach(([label, color], index) => {
    const y = 24 + index * 22;
    chartContext.fillStyle = color;
    chartContext.fillRect(width - 240, y - 10, 18, 10);
    chartContext.fillStyle = "#6b5948";
    chartContext.font = "500 13px Avenir Next, Segoe UI, sans-serif";
    chartContext.fillText(label, width - 214, y);
  });

  chartContext.fillStyle = "#22170d";
  chartContext.font = "700 14px Avenir Next, Segoe UI, sans-serif";
  chartContext.fillText(
    `Current bystander error: ${(snapshot.prankBystander.observed - state.targetFrequency).toFixed(1)} Hz`,
    20,
    28,
  );
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function captureRenderSettings() {
  return {
    speedOfSound: state.speedOfSound,
    carSpeed: state.carSpeed,
    travelSpan: state.travelSpan,
    baseFrequency: state.baseFrequency,
    targetFrequency: state.targetFrequency,
    targetX: state.targetX,
    targetY: state.targetY,
    bystanderX: state.bystanderX,
    bystanderY: state.bystanderY,
  };
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
    oscillator.frequency.value = state.targetFrequency * settings.ratio;
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

function ensureSongMonitorNode() {
  const context = ensureLiveMonitorBus();

  if (audioState.live.songElement && audioState.live.songNode) {
    return context;
  }

  const songElement = new Audio();
  songElement.loop = true;
  songElement.preload = "auto";

  if ("preservesPitch" in songElement) {
    songElement.preservesPitch = false;
  }
  if ("webkitPreservesPitch" in songElement) {
    songElement.webkitPreservesPitch = false;
  }
  if ("mozPreservesPitch" in songElement) {
    songElement.mozPreservesPitch = false;
  }

  if (audioState.originalUrl) {
    songElement.src = audioState.originalUrl;
  }

  const songNode = context.createMediaElementSource(songElement);
  songNode.connect(audioState.live.songGain);

  audioState.live.songElement = songElement;
  audioState.live.songNode = songNode;
  return context;
}

function syncSongMonitorSource() {
  if (!audioState.live.songElement) {
    return;
  }

  if (!audioState.originalUrl) {
    audioState.live.songElement.pause();
    audioState.live.songElement.removeAttribute("src");
    audioState.live.songElement.load();
    return;
  }

  if (audioState.live.songElement.src !== audioState.originalUrl) {
    audioState.live.songElement.src = audioState.originalUrl;
    audioState.live.songElement.load();
  }
}

async function setLiveMonitorSourceMode(mode) {
  const context = ensureLiveMonitorBus();
  audioState.live.synthGain.gain.setValueAtTime(0, context.currentTime);
  audioState.live.songGain.gain.setValueAtTime(0, context.currentTime);

  if (mode === "song") {
    if (!audioState.originalUrl) {
      throw new Error("missing-song");
    }

    ensureSongMonitorNode();
    syncSongMonitorSource();
    audioState.live.songGain.gain.setValueAtTime(1, context.currentTime);

    if (audioState.live.songElement.paused) {
      audioState.live.songElement.currentTime = 0;
      await audioState.live.songElement.play();
    }

    audioState.live.sourceMode = mode;
    return;
  }

  ensureSynthMonitorNodes();
  audioState.live.synthGain.gain.setValueAtTime(1, context.currentTime);

  if (audioState.live.songElement && !audioState.live.songElement.paused) {
    audioState.live.songElement.pause();
    audioState.live.songElement.currentTime = 0;
  }

  audioState.live.sourceMode = mode;
}

function syncLiveMonitor(force = false) {
  if (!audioState.live.active || !audioState.live.masterGain) {
    return;
  }

  const context = getAudioContext();
  const sourceMode = audioState.live.sourceMode;
  const perspective = getLivePerspective();
  const source = getSourcePosition(state.progress);
  const frequency = clamp(
    getPerspectiveFrequencies(state.progress)[perspective],
    40,
    2400,
  );
  const playbackRate = clamp(
    frequency / Math.max(state.baseFrequency, 1),
    0.35,
    3.5,
  );

  audioState.live.perspective = perspective;
  if (sourceMode === "song" && audioState.live.songElement) {
    audioState.live.songElement.playbackRate = playbackRate;
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
    sourceMode,
    perspective,
    frequency.toFixed(1),
    playbackRate.toFixed(2),
    source.x.toFixed(1),
  ].join(":");
  if (force || statusKey !== audioState.live.lastStatusKey) {
    const message =
      sourceMode === "song"
        ? `Live monitor: ${liveSourceLabel(sourceMode)} is running at ${playbackRate.toFixed(2)}x for ${perspectiveLabel(perspective)} (${formatFrequency(frequency)} at x = ${source.x.toFixed(1)} m).`
        : `Live monitor: ${perspectiveLabel(perspective)} hears ${formatFrequency(frequency)} from the ${liveSourceLabel(sourceMode)} with the car at ${source.x.toFixed(1)} m.`;
    updateLiveAudioStatus(message);
    audioState.live.lastStatusKey = statusKey;
  }
}

async function startLiveMonitor() {
  const context = ensureLiveMonitorBus();
  await context.resume();
  await setLiveMonitorSourceMode(getLiveSourceMode());

  audioState.live.active = true;
  liveAudioToggle.checked = true;
  audioState.live.masterGain.gain.cancelScheduledValues(context.currentTime);
  audioState.live.masterGain.gain.setValueAtTime(
    audioState.live.masterGain.gain.value,
    context.currentTime,
  );
  audioState.live.masterGain.gain.setTargetAtTime(1, context.currentTime, 0.04);
  syncLiveMonitor(true);
}

function stopLiveMonitor() {
  if (!audioState.live.masterGain) {
    return;
  }

  const context = getAudioContext();
  audioState.live.active = false;
  audioState.live.lastStatusKey = "";
  liveAudioToggle.checked = false;
  audioState.live.masterGain.gain.cancelScheduledValues(context.currentTime);
  audioState.live.masterGain.gain.setValueAtTime(
    audioState.live.masterGain.gain.value,
    context.currentTime,
  );
  audioState.live.masterGain.gain.setTargetAtTime(0, context.currentTime, 0.04);
  if (audioState.live.songElement && !audioState.live.songElement.paused) {
    audioState.live.songElement.pause();
    audioState.live.songElement.currentTime = 0;
  }
  updateLiveAudioStatus(
    "Live monitor stopped. Start it again to hear the current graph position.",
  );
}

async function handleLiveSourceModeChange() {
  const sourceMode = getLiveSourceMode();
  const previousMode = audioState.live.sourceMode;

  if (!audioState.live.active) {
    const message =
      sourceMode === "song" && !audioState.originalUrl
        ? "Upload a clip first, then start live monitoring to hear the song follow the graph."
        : `Live monitor is armed for the ${liveSourceLabel(sourceMode)}. Start it to hear the current graph position.`;
    updateLiveAudioStatus(message);
    return;
  }

  try {
    await setLiveMonitorSourceMode(sourceMode);
    syncLiveMonitor(true);
  } catch (error) {
    setCheckedRadioValue("live-source-mode", previousMode);
    updateLiveAudioStatus(
      "Upload a clip first before switching the live monitor to the song.",
    );
  }
}

async function toggleLiveMonitor() {
  if (liveAudioToggle.checked) {
    try {
      await startLiveMonitor();
    } catch (error) {
      liveAudioToggle.checked = false;
      updateLiveAudioStatus(
        error.message === "missing-song"
          ? "Upload a clip first, or switch the live monitor back to the synth tone."
          : "This browser blocked live audio startup. Try turning the live monitor on again.",
      );
    }
    return;
  }

  stopLiveMonitor();
}

function applyRenderedPreview(mode, wavBuffer) {
  const blob = new Blob([wavBuffer], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  audioState.previewUrls[mode] = url;
  audioPlayers[mode].src = url;
  audioPlayers[mode].load();
  updatePreviewsVisibility();
}

function startPreviewRender(statusMessage) {
  if (!audioState.sourceBuffer) {
    return;
  }

  cancelPendingPreviewRender();
  clearAudioPreviews();
  audioState.rendering = true;

  const jobId = audioState.renderJobId + 1;
  audioState.renderJobId = jobId;
  const worker = new Worker("audio-render-worker.js");
  audioState.renderWorker = worker;

  worker.addEventListener("message", (event) => {
    const message = event.data;

    if (message.jobId !== audioState.renderJobId) {
      return;
    }

    if (message.type === "progress") {
      updateAudioStatus(`Rendering ${message.mode}...`);
      return;
    }

    if (message.type === "preview") {
      applyRenderedPreview(message.mode, message.wavBuffer);
      return;
    }

    if (message.type === "done") {
      audioState.rendering = false;
      audioState.renderWorker = null;
      updateAudioStatus("");
      return;
    }

    if (message.type === "error") {
      audioState.rendering = false;
      audioState.renderWorker = null;
      clearAudioPreviews();
      updateAudioStatus(message.message || "Render failed.");
    }
  });

  worker.addEventListener("error", () => {
    if (jobId !== audioState.renderJobId) {
      return;
    }

    audioState.rendering = false;
    audioState.renderWorker = null;
    clearAudioPreviews();
    updateAudioStatus("Render failed.");
  });

  updateAudioStatus(statusMessage);

  const audioData = serializeSourceBuffer(audioState.sourceBuffer);
  const transferList = audioData.channels.map((channel) => channel.buffer);
  worker.postMessage(
    {
      type: "render",
      jobId,
      audioData,
      simulation: captureRenderSettings(),
    },
    transferList,
  );
}

function schedulePreviewRender(statusMessage, delay = 220) {
  if (!audioState.sourceBuffer) {
    return;
  }

  if (audioState.renderDebounceId) {
    clearTimeout(audioState.renderDebounceId);
  }

  if (audioState.renderWorker) {
    audioState.renderJobId += 1;
    audioState.renderWorker.terminate();
    audioState.renderWorker = null;
  }

  audioState.rendering = false;
  updateAudioStatus(statusMessage);

  audioState.renderDebounceId = window.setTimeout(() => {
    audioState.renderDebounceId = null;
    startPreviewRender(statusMessage);
  }, delay);
}

async function handleAudioUpload(event) {
  const [file] = event.target.files || [];

  if (!file) {
    resetAudioState();
    return;
  }

  cancelPendingPreviewRender();
  clearOriginalPreview();
  clearAudioPreviews();

  updateAudioStatus(`Loading ${file.name}...`);

  try {
    const originalUrl = URL.createObjectURL(file);
    const arrayBuffer = await file.arrayBuffer();
    const context = getAudioContext();
    const decodedBuffer = await context.decodeAudioData(arrayBuffer.slice(0));

    audioState.originalUrl = originalUrl;
    audioState.sourceBuffer = decodedBuffer;
    audioState.sourceName = file.name;
    updateUploadUI();
    audioPlayers.original.src = originalUrl;
    audioPlayers.original.load();

    if (audioState.live.songElement) {
      syncSongMonitorSource();
      if (audioState.live.active && audioState.live.sourceMode === "song") {
        audioState.live.songElement.currentTime = 0;
        try {
          await audioState.live.songElement.play();
        } catch (error) {
          updateLiveAudioStatus(
            "The new upload is loaded, but the browser blocked live song playback until you turn the live monitor on again.",
          );
        }
        syncLiveMonitor(true);
      }
    }

    schedulePreviewRender(
      "Rendering previews...",
      10,
    );
  } catch (error) {
    clearOriginalPreview();
    if (audioState.live.active && audioState.live.sourceMode === "song") {
      stopLiveMonitor();
      updateLiveAudioStatus(
        "That upload could not be used for live song monitoring, so the live monitor was stopped.",
      );
    }
    audioState.sourceBuffer = null;
    audioState.sourceName = "";
    updateUploadUI();
    audioUpload.value = "";
    updateAudioStatus("Couldn't load audio.");
  }
}

async function resetSimulation() {
  resetControlsToDefaults();
  state.progress = 0.5;
  state.playing = true;
  playToggle.textContent = "Pause";

  setCheckedRadioValue("live-source-mode", "synth");
  setCheckedRadioValue("live-perspective", "target");

  if (audioState.live.active) {
    await setLiveMonitorSourceMode("synth");
    syncLiveMonitor(true);
  } else {
    audioState.live.sourceMode = "synth";
    audioState.live.perspective = "target";
  }

  buildControls();
  render();

  if (audioState.sourceBuffer) {
    markAudioDirty();
  }
}

function render() {
  progressInput.value = String(Math.round(state.progress * 1000));
  const snapshot = currentSnapshot();
  const samples = sampleSeries();

  updateStats(snapshot);
  drawScene(snapshot);
  drawChart(snapshot, samples);
  syncLiveMonitor();
}

function tick() {
  if (state.playing) {
    const durationSeconds = (state.travelSpan * 2) / state.carSpeed;
    const delta = 1 / Math.max(durationSeconds * 60, 1);
    state.progress += delta;

    if (state.progress >= 1) {
      state.progress = 0;
    }

    render();
  }

  requestAnimationFrame(tick);
}

progressInput.addEventListener("input", () => {
  state.progress = Number(progressInput.value) / 1000;
  render();
});

sceneCanvas.addEventListener("pointerdown", (event) => {
  resizeCanvas(sceneCanvas);

  const point = sceneEventPoint(event);
  if (!isScenePointNearCar(point)) {
    return;
  }

  sceneDragState.active = true;
  sceneDragState.pointerId = event.pointerId;
  sceneDragState.wasPlaying = state.playing;
  sceneCanvas.classList.add("dragging");
  state.playing = false;
  playToggle.textContent = "Play";
  sceneCanvas.setPointerCapture(event.pointerId);
  setProgressFromScenePoint(point);
  render();
  event.preventDefault();
});

sceneCanvas.addEventListener("pointermove", (event) => {
  if (!sceneDragState.active || event.pointerId !== sceneDragState.pointerId) {
    return;
  }

  setProgressFromScenePoint(sceneEventPoint(event));
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
  state.playing = !state.playing;
  playToggle.textContent = state.playing ? "Pause" : "Play";
});

resetButton.addEventListener("click", () => {
  void resetSimulation();
});

audioUpload.addEventListener("change", handleAudioUpload);
removeAudioButton.addEventListener("click", resetAudioState);
liveAudioToggle.addEventListener("change", () => {
  void toggleLiveMonitor();
});
document.querySelectorAll('input[name="live-source-mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    void handleLiveSourceModeChange();
  });
});
document.querySelectorAll('input[name="live-perspective"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (audioState.live.active) {
      syncLiveMonitor(true);
      return;
    }

    updateLiveAudioStatus(
      `Live monitor is armed for ${perspectiveLabel(getLivePerspective())} using the ${liveSourceLabel(getLiveSourceMode())}.`,
    );
  });
});

window.addEventListener("resize", render);

buildControls();
updateUploadUI();
updatePreviewsVisibility();
render();
tick();
