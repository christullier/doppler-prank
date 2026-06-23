const state = { ...initialControlState };

state.progress = 0.5;
state.playing = true;
state.showNormalLocus = false;
state.circularTrack = false;
state.audioEffectMode = "prank";

const themeState = {
  current: document.documentElement.dataset.theme || "light",
};

const audioState = {
  context: null,
  sourceBuffer: null,
  sourceName: "",
  sirenBuffer: null,
  uploadedBuffer: null,
  isDefaultAudio: false,
  uploadRequestId: 0,
  live: {
    active: false,
    perspective: "target",
    sourceMode: "siren",
    requestId: 0,
    masterGain: null,
    synthGain: null,
    songGain: null,
    oscillators: [],
    songWorkletNode: null,
    songWorkletReady: false,
    songWorkletModulePromise: null,
    songBufferVersion: 0,
    songLoadedBufferVersion: 0,
    songAudioData: null,
    songBufferLoadResolvers: new Map(),
    lastSongTransportKey: "",
    resumeNeedsHardSync: false,
    lastStatusKey: "",
    songPositionFraction: 0,
  },
};

const sceneDragState = {
  active: false,
  pointerId: null,
  wasPlaying: false,
  mode: null,
};

const controlItemsByKey = Object.fromEntries(
  controls.flatMap((group) => group.items.map((item) => [item.key, item])),
);
