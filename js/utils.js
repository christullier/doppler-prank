function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

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

function effectModeLabel(mode) {
  return mode === "normal" ? "normal Doppler" : "prank compensation";
}

function effectModeVerb(mode) {
  return mode === "normal" ? "normally" : "with prank";
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function shouldIgnoreSpacebarToggle(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.closest("[contenteditable='true']")) {
    return true;
  }

  const field = target.closest("textarea, select, audio, summary, input, button");
  if (!(field instanceof HTMLElement)) {
    return false;
  }

  if (
    field instanceof HTMLTextAreaElement
    || field instanceof HTMLSelectElement
    || field instanceof HTMLAudioElement
    || field instanceof HTMLButtonElement
  ) {
    return true;
  }

  if (field instanceof HTMLInputElement) {
    return true;
  }

  return false;
}
