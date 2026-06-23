function syncThemeUI() {
  themeState.current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const nextTheme = themeState.current === "dark" ? "light" : "dark";
  const nextLabel = nextTheme === "dark" ? "Dark mode" : "Light mode";

  if (themeToggle) {
    themeToggle.setAttribute("aria-pressed", String(themeState.current === "dark"));
    themeToggle.setAttribute("aria-label", `Switch to ${nextTheme} mode`);
  }

  if (themeToggleLabel) {
    themeToggleLabel.textContent = nextLabel;
  }
}

function updateSongProgressUI() {
  if (!songProgressEl) {
    return;
  }

  const showBar =
    audioState.live.active
    && audioState.live.sourceMode !== "synth"
    && audioState.live.songWorkletReady
    && audioState.sourceBuffer;

  songProgressEl.hidden = !showBar;

  if (!showBar) {
    return;
  }

  const fraction = audioState.live.songPositionFraction;
  const total = audioState.sourceBuffer.duration;
  const current = fraction * total;

  if (songProgressFill) {
    songProgressFill.style.width = `${(fraction * 100).toFixed(2)}%`;
  }
  if (songProgressCurrent) {
    songProgressCurrent.textContent = formatDuration(current);
  }
  if (songProgressTotal) {
    songProgressTotal.textContent = formatDuration(total);
  }
}

function buildControls() {
  controlGroups.innerHTML = "";

  controls.forEach((group) => {
    const visibleItems = group.items.filter((item) => !item.hidden);
    if (visibleItems.length === 0) {
      return;
    }

    const groupElement = document.createElement("section");
    groupElement.className = "control-group";

    const title = document.createElement("h3");
    title.textContent = group.title;
    groupElement.appendChild(title);

    visibleItems.forEach((item) => {
      if (state.audioEffectMode === "normal" && item.key === "targetFrequency") {
        return;
      }

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
        render();
      });

      row.append(header, input);
      groupElement.appendChild(row);
    });

    controlGroups.appendChild(groupElement);
  });
}

function syncControlUI(key) {
  const item = controlItemsByKey[key];
  if (!item) {
    return;
  }

  const input = document.getElementById(key);
  if (input) {
    input.value = String(state[key]);
  }

  const value = document.getElementById(`${key}-value`);
  if (value) {
    value.textContent = formatNumber(
      state[key],
      item.unit,
      item.step < 1 ? 1 : 0,
    );
  }
}

function resizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.floor(canvas.clientWidth * ratio);
  const height = Math.floor(canvas.clientHeight * ratio);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  // Draw in CSS pixels: scaling the context by the device pixel ratio keeps
  // text, lines, and layout offsets crisp and correctly sized on high-DPR
  // (retina / mobile) screens. Reapplied every frame because setting
  // canvas.width above resets the transform.
  canvas.getContext("2d").setTransform(ratio, 0, 0, ratio, 0, 0);
}

function updateStats(snapshot) {
  const emissionLabel = snapshot.activeMode === "normal" ? "Car emission right now" : "Prank emission right now";
  const targetLabel = snapshot.activeMode === "normal" ? "Target hears normally" : "Target hears with prank";
  const bystanderLabel = snapshot.activeMode === "normal" ? "Bystander hears normally" : "Bystander hears with prank";
  const cards = [
    {
      label: "Natural pitch at target",
      value: formatFrequency(snapshot.normalTarget.observed),
    },
    {
      label: emissionLabel,
      value: formatFrequency(snapshot.activeEmission),
    },
    {
      label: targetLabel,
      value: formatFrequency(snapshot.activeTarget),
    },
    {
      label: bystanderLabel,
      value: formatFrequency(snapshot.activeBystander),
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
  if (state.circularTrack) {
    const margin = 12;
    const extent = state.travelSpan + margin;
    return {
      left: -extent,
      right: extent,
      top: extent,
      bottom: -extent,
    };
  }

  const left = -state.travelSpan;
  const right = state.travelSpan;
  const top = Math.max(state.targetY, state.bystanderY, 0) + 12;
  const bottom = Math.min(state.targetY, state.bystanderY, 0) - 12;
  return { left, right, top, bottom };
}

function scenePadding() {
  return {
    x: 48,
    top: 34,
    bottom: 16,
  };
}

function sceneLayout() {
  return {
    width: sceneCanvas.clientWidth,
    height: sceneCanvas.clientHeight,
    bounds: worldBounds(),
    padding: scenePadding(),
  };
}

function unmapPoint(point, bounds, width, height, padding) {
  const xPadding = typeof padding === "number" ? padding : padding.x;
  const topPadding = typeof padding === "number" ? padding : padding.top;
  const bottomPadding = typeof padding === "number" ? padding : padding.bottom;
  const usableWidth = width - xPadding * 2;
  const usableHeight = height - topPadding - bottomPadding;

  const yBottom = bounds.bottom ?? 0;
  const yRange = bounds.top - yBottom;
  return {
    x: bounds.left + ((point.x - xPadding) / Math.max(usableWidth, 1)) * (bounds.right - bounds.left),
    y: yBottom + ((height - bottomPadding - point.y) / Math.max(usableHeight, 1)) * yRange,
  };
}

function mapPoint(point, bounds, width, height, padding) {
  const xPadding = typeof padding === "number" ? padding : padding.x;
  const topPadding = typeof padding === "number" ? padding : padding.top;
  const bottomPadding = typeof padding === "number" ? padding : padding.bottom;
  const usableWidth = width - xPadding * 2;
  const usableHeight = height - topPadding - bottomPadding;
  const x = xPadding + ((point.x - bounds.left) / (bounds.right - bounds.left)) * usableWidth;
  const yBottom = bounds.bottom ?? 0;
  const yRange = bounds.top - yBottom;
  const y = height - bottomPadding - ((point.y - yBottom) / yRange) * usableHeight;
  return { x, y };
}

function drawDot(context, point, radius, color, label) {
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();

  context.font = "600 13px Avenir Next, Segoe UI, sans-serif";
  context.fillStyle = cssVar("--canvas-text");
  context.fillText(label, point.x + radius + 8, point.y - radius - 4);
}

function drawScene(snapshot) {
  resizeCanvas(sceneCanvas);

  const { width, height, bounds, padding } = sceneLayout();

  sceneContext.clearRect(0, 0, width, height);

  sceneContext.fillStyle = cssVar("--scene-bg");
  sceneContext.fillRect(0, 0, width, height);

  if (state.circularTrack) {
    const centerPoint = mapPoint({ x: 0, y: 0 }, bounds, width, height, padding);
    const edgePoint = mapPoint({ x: state.travelSpan, y: 0 }, bounds, width, height, padding);
    const trackRadius = Math.abs(edgePoint.x - centerPoint.x);

    sceneContext.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--road");
    sceneContext.lineWidth = 40;
    sceneContext.beginPath();
    sceneContext.arc(centerPoint.x, centerPoint.y, trackRadius, 0, Math.PI * 2);
    sceneContext.stroke();

    sceneContext.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--road-edge");
    sceneContext.lineWidth = 2;
    sceneContext.setLineDash([10, 12]);
    sceneContext.beginPath();
    sceneContext.arc(centerPoint.x, centerPoint.y, trackRadius, 0, Math.PI * 2);
    sceneContext.stroke();
    sceneContext.setLineDash([]);
  } else {
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
  }

  const sourcePoint = mapPoint(snapshot.source, bounds, width, height, padding);
  const targetPoint = mapPoint(snapshot.target, bounds, width, height, padding);
  const bystanderPoint = mapPoint(snapshot.bystander, bounds, width, height, padding);

  sceneContext.strokeStyle = cssVar("--scene-prank-line");
  sceneContext.lineWidth = 3;
  sceneContext.beginPath();
  sceneContext.moveTo(sourcePoint.x, sourcePoint.y);
  sceneContext.lineTo(targetPoint.x, targetPoint.y);
  sceneContext.stroke();

  sceneContext.strokeStyle = cssVar("--scene-bystander-line");
  sceneContext.lineWidth = 2;
  sceneContext.beginPath();
  sceneContext.moveTo(sourcePoint.x, sourcePoint.y);
  sceneContext.lineTo(bystanderPoint.x, bystanderPoint.y);
  sceneContext.stroke();

  sceneContext.fillStyle = cssVar("--scene-rings");
  for (let ring = 1; ring <= 3; ring += 1) {
    sceneContext.beginPath();
    sceneContext.arc(sourcePoint.x, sourcePoint.y, ring * 24, 0, Math.PI * 2);
    sceneContext.fill();
  }

  if (state.showNormalLocus) {
    const cx = snapshot.source.x;
    const tx = snapshot.target.x;
    const ty = snapshot.target.y;
    const dx = tx - cx;
    const dy = ty;

    // Clip ray P(t) = (cx + t*dx, t*dy) to canvas bounds in world space
    function clipRay(dirX, dirY) {
      const worldLeft = bounds.left;
      const worldRight = bounds.right;
      const worldTop = bounds.top;
      const worldBottom = bounds.bottom;

      let tMin = -Infinity;
      let tMax = Infinity;

      if (Math.abs(dirX) > 1e-9) {
        const t1 = (worldLeft - cx) / dirX;
        const t2 = (worldRight - cx) / dirX;
        tMin = Math.max(tMin, Math.min(t1, t2));
        tMax = Math.min(tMax, Math.max(t1, t2));
      } else if (cx < worldLeft || cx > worldRight) {
        return null;
      }

      if (Math.abs(dirY) > 1e-9) {
        const t1 = worldBottom / dirY;
        const t2 = worldTop / dirY;
        tMin = Math.max(tMin, Math.min(t1, t2));
        tMax = Math.min(tMax, Math.max(t1, t2));
      } else if (0 < worldBottom || 0 > worldTop) {
        return null;
      }

      if (tMin > tMax) return null;
      return { tMin, tMax };
    }

    const clip = clipRay(dx, dy);
    if (clip) {
      const p1World = { x: cx + clip.tMin * dx, y: clip.tMin * dy };
      const p2World = { x: cx + clip.tMax * dx, y: clip.tMax * dy };
      const p1 = mapPoint(p1World, bounds, width, height, padding);
      const p2 = mapPoint(p2World, bounds, width, height, padding);

      sceneContext.save();
      sceneContext.strokeStyle = cssVar("--scene-prank-line");
      sceneContext.globalAlpha = 0.45;
      sceneContext.lineWidth = 2;
      sceneContext.setLineDash([8, 6]);
      sceneContext.beginPath();
      sceneContext.moveTo(p1.x, p1.y);
      sceneContext.lineTo(p2.x, p2.y);
      sceneContext.stroke();
      sceneContext.setLineDash([]);
      sceneContext.restore();

      // Label near target end
      const labelPt = mapPoint({ x: cx + clip.tMax * dx, y: clip.tMax * dy }, bounds, width, height, padding);
      sceneContext.save();
      sceneContext.globalAlpha = 0.8;
      sceneContext.font = "500 11px Avenir Next, Segoe UI, sans-serif";
      sceneContext.fillStyle = cssVar("--scene-prank-line");
      sceneContext.fillText("hears normal →", labelPt.x - 90, labelPt.y - 8);
      sceneContext.restore();
    }

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

  sceneContext.fillStyle = cssVar("--canvas-card");
  sceneContext.strokeStyle = cssVar("--canvas-card-border");
  sceneContext.lineWidth = 1;
  sceneContext.beginPath();
  sceneContext.roundRect(20, 20, 310, 104, 18);
  sceneContext.fill();
  sceneContext.stroke();

  sceneContext.fillStyle = cssVar("--canvas-text");
  sceneContext.font = "700 15px Avenir Next, Segoe UI, sans-serif";
  sceneContext.fillText("Current pass snapshot", 40, 48);
  sceneContext.font = "500 13px Avenir Next, Segoe UI, sans-serif";
  sceneContext.fillStyle = cssVar("--canvas-muted");
  sceneContext.fillText(`source x: ${snapshot.source.x.toFixed(1)} m`, 40, 74);
  sceneContext.fillText(
    `effect mode: ${effectModeLabel(snapshot.activeMode)}`,
    40,
    94,
  );
  sceneContext.fillText(
    `target hears ${effectModeVerb(snapshot.activeMode)}: ${formatFrequency(snapshot.activeTarget)}`,
    40,
    114,
  );
}

function drawAxes(context, width, height, padding, minY, maxY) {
  context.strokeStyle = cssVar("--canvas-axes");
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(padding, padding);
  context.lineTo(padding, height - padding);
  context.lineTo(width - padding, height - padding);
  context.stroke();

  context.font = "500 12px Avenir Next, Segoe UI, sans-serif";
  context.fillStyle = cssVar("--canvas-muted");

  for (let tick = 0; tick <= 4; tick += 1) {
    const y = padding + ((height - padding * 2) * tick) / 4;
    const ratio = tick / 4;
    const value = maxY - (maxY - minY) * ratio;
    context.strokeStyle = cssVar("--canvas-grid");
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

  const width = chartCanvas.clientWidth;
  const height = chartCanvas.clientHeight;
  const padding = 52;

  chartContext.clearRect(0, 0, width, height);
  chartContext.fillStyle = cssVar("--scene-bg");
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
  chartContext.strokeStyle = cssVar("--canvas-cursor");
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

  const errorText = `Current bystander error: ${(snapshot.prankBystander.observed - state.targetFrequency).toFixed(1)} Hz`;

  // On narrow (mobile) charts the top-left error readout and a top-right legend
  // collide, so stack everything into a single legible card in the top-left.
  if (width < 560) {
    const padX = 12;
    const padY = 10;
    const rowH = 18;
    const swatch = 14;

    chartContext.font = "700 13px Avenir Next, Segoe UI, sans-serif";
    let contentW = chartContext.measureText(errorText).width;
    chartContext.font = "500 12px Avenir Next, Segoe UI, sans-serif";
    legendItems.forEach(([label]) => {
      contentW = Math.max(contentW, swatch + 8 + chartContext.measureText(label).width);
    });

    const cardX = 12;
    const cardY = 12;
    const cardW = contentW + padX * 2;
    const cardH = padY * 2 + rowH + legendItems.length * rowH;

    chartContext.fillStyle = cssVar("--canvas-card");
    chartContext.strokeStyle = cssVar("--canvas-card-border");
    chartContext.lineWidth = 1;
    chartContext.beginPath();
    chartContext.roundRect(cardX, cardY, cardW, cardH, 14);
    chartContext.fill();
    chartContext.stroke();

    chartContext.fillStyle = cssVar("--canvas-text");
    chartContext.font = "700 13px Avenir Next, Segoe UI, sans-serif";
    chartContext.fillText(errorText, cardX + padX, cardY + padY + 12);

    legendItems.forEach(([label, color], index) => {
      const rowY = cardY + padY + rowH + index * rowH;
      chartContext.fillStyle = color;
      chartContext.fillRect(cardX + padX, rowY, swatch, 10);
      chartContext.fillStyle = cssVar("--canvas-muted");
      chartContext.font = "500 12px Avenir Next, Segoe UI, sans-serif";
      chartContext.fillText(label, cardX + padX + swatch + 8, rowY + 9);
    });

    return;
  }

  legendItems.forEach(([label, color], index) => {
    const y = 24 + index * 22;
    chartContext.fillStyle = color;
    chartContext.fillRect(width - 240, y - 10, 18, 10);
    chartContext.fillStyle = cssVar("--canvas-muted");
    chartContext.font = "500 13px Avenir Next, Segoe UI, sans-serif";
    chartContext.fillText(label, width - 214, y);
  });

  chartContext.fillStyle = cssVar("--canvas-text");
  chartContext.font = "700 14px Avenir Next, Segoe UI, sans-serif";
  chartContext.fillText(errorText, 20, 28);
}

function sceneEventPoint(event) {
  const rect = sceneCanvas.getBoundingClientRect();
  const scaleX = sceneCanvas.clientWidth / Math.max(rect.width, 1);
  const scaleY = sceneCanvas.clientHeight / Math.max(rect.height, 1);

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function isScenePointNearCar(point) {
  const { width, height, bounds, padding } = sceneLayout();
  const carPoint = mapPoint(getSourcePosition(state.progress), bounds, width, height, padding);

  return Math.hypot(point.x - carPoint.x, point.y - carPoint.y) <= 24;
}

function draggableSceneTarget(point) {
  const { width, height, bounds, padding } = sceneLayout();
  const hitRadius = 24;
  const targets = [
    {
      mode: "car",
      point: mapPoint(getSourcePosition(state.progress), bounds, width, height, padding),
    },
    {
      mode: "target",
      point: mapPoint(getListener("target"), bounds, width, height, padding),
    },
    {
      mode: "bystander",
      point: mapPoint(getListener("bystander"), bounds, width, height, padding),
    },
  ];

  return (
    targets.find((target) => Math.hypot(point.x - target.point.x, point.y - target.point.y) <= hitRadius) || null
  );
}

function setProgressFromScenePoint(point) {
  if (state.circularTrack) {
    const { width, height, bounds, padding } = sceneLayout();
    const worldPoint = unmapPoint(point, bounds, width, height, padding);
    let angle = Math.atan2(worldPoint.y, worldPoint.x);
    if (angle < 0) {
      angle += Math.PI * 2;
    }
    state.progress = angle / (Math.PI * 2);
  } else {
    const { width, padding } = sceneLayout();
    const usableWidth = Math.max(width - padding.x * 2, 1);
    const normalized = (point.x - padding.x) / usableWidth;
    state.progress = clamp(normalized, 0, 1);
  }
}

function updateListenerFromScenePoint(name, point) {
  const { width, height, bounds, padding } = sceneLayout();
  const worldPoint = unmapPoint(point, bounds, width, height, padding);
  const xKey = `${name}X`;
  const yKey = `${name}Y`;
  const xItem = controlItemsByKey[xKey];
  const yItem = controlItemsByKey[yKey];

  state[xKey] = clamp(worldPoint.x, xItem.min, xItem.max);

  let newY = clamp(worldPoint.y, yItem.min, yItem.max);
  if (Math.abs(newY) < 2) {
    newY = newY < 0 ? -2 : 2;
  }
  state[yKey] = newY;
  syncControlUI(xKey);
  syncControlUI(yKey);
}

function finishSceneDrag() {
  if (!sceneDragState.active) {
    return;
  }

  sceneDragState.active = false;
  sceneDragState.pointerId = null;
  sceneDragState.mode = null;
  sceneCanvas.classList.remove("dragging");
  setPlaybackState(sceneDragState.wasPlaying);
}

function render() {
  const snapshot = currentSnapshot();
  const samples = sampleSeries();

  updateStats(snapshot);
  drawScene(snapshot);
  drawChart(snapshot, samples);
  syncLiveMonitor();
  updateSongProgressUI();
}
