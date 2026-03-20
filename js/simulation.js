function getSourcePosition(progress) {
  if (state.circularTrack) {
    const angle = progress * Math.PI * 2;
    return {
      x: state.travelSpan * Math.cos(angle),
      y: state.travelSpan * Math.sin(angle),
    };
  }

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

function getCarVelocity(progress) {
  if (state.circularTrack) {
    const angle = progress * Math.PI * 2;
    return {
      vx: -state.carSpeed * Math.sin(angle),
      vy: state.carSpeed * Math.cos(angle),
    };
  }

  return {
    vx: state.carSpeed,
    vy: 0,
  };
}

function dopplerObservedFrequency(emittedFrequency, source, listener, velocity = null) {
  const separation = distance(source, listener);
  const effectiveVelocity = velocity || { vx: state.carSpeed, vy: 0 };
  if (separation <= 1e-6) {
    return {
      observed: emittedFrequency,
      towardComponent: 0,
      separation,
    };
  }
  const towardComponent = (
    (effectiveVelocity.vx * (listener.x - source.x))
    + (effectiveVelocity.vy * (listener.y - source.y))
  ) / separation;
  const safeDenominator = Math.max(state.speedOfSound - towardComponent, 1e-6);

  return {
    observed: emittedFrequency * (state.speedOfSound / safeDenominator),
    towardComponent,
    separation,
  };
}

function prankEmissionForTarget(source, target) {
  const sourceVelocity = getCarVelocity(state.progress);
  const { towardComponent } = dopplerObservedFrequency(state.baseFrequency, source, target, sourceVelocity);
  return state.targetFrequency * ((state.speedOfSound - towardComponent) / state.speedOfSound);
}

function getModeOutputs(source, target, bystander, sourceVelocity, mode = state.audioEffectMode) {
  if (mode === "normal") {
    const emission = state.baseFrequency;
    return {
      emission,
      target: dopplerObservedFrequency(emission, source, target, sourceVelocity).observed,
      bystander: dopplerObservedFrequency(emission, source, bystander, sourceVelocity).observed,
    };
  }

  const normalTarget = dopplerObservedFrequency(state.baseFrequency, source, target, sourceVelocity);
  const emission = state.targetFrequency * ((state.speedOfSound - normalTarget.towardComponent) / state.speedOfSound);
  return {
    emission,
    target: dopplerObservedFrequency(emission, source, target, sourceVelocity).observed,
    bystander: dopplerObservedFrequency(emission, source, bystander, sourceVelocity).observed,
  };
}

function getPerspectiveFrequencies(progress) {
  const source = getSourcePosition(progress);
  const sourceVelocity = getCarVelocity(progress);
  const target = getListener("target");
  const bystander = getListener("bystander");
  const outputs = getModeOutputs(source, target, bystander, sourceVelocity);

  return {
    car: outputs.emission,
    target: outputs.target,
    bystander: outputs.bystander,
  };
}

function sampleSeries(sampleCount = 220) {
  const target = getListener("target");
  const bystander = getListener("bystander");

  const samples = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / (sampleCount - 1);
    const source = getSourcePosition(progress);
    const sourceVelocity = getCarVelocity(progress);
    const normalTarget = dopplerObservedFrequency(state.baseFrequency, source, target, sourceVelocity);
    const prankEmission = state.targetFrequency * ((state.speedOfSound - normalTarget.towardComponent) / state.speedOfSound);
    const prankTarget = dopplerObservedFrequency(prankEmission, source, target, sourceVelocity);
    const prankBystander = dopplerObservedFrequency(prankEmission, source, bystander, sourceVelocity);

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
  const sourceVelocity = getCarVelocity(state.progress);
  const target = getListener("target");
  const bystander = getListener("bystander");
  const normalTarget = dopplerObservedFrequency(state.baseFrequency, source, target, sourceVelocity);
  const prankEmission = state.targetFrequency * ((state.speedOfSound - normalTarget.towardComponent) / state.speedOfSound);
  const prankTarget = dopplerObservedFrequency(prankEmission, source, target, sourceVelocity);
  const prankBystander = dopplerObservedFrequency(prankEmission, source, bystander, sourceVelocity);
  const activeOutputs = getModeOutputs(source, target, bystander, sourceVelocity);

  return {
    source,
    target,
    bystander,
    normalTarget,
    prankEmission,
    prankTarget,
    prankBystander,
    activeMode: state.audioEffectMode,
    activeEmission: activeOutputs.emission,
    activeTarget: activeOutputs.target,
    activeBystander: activeOutputs.bystander,
  };
}
