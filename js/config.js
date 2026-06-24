const KMH_PER_METER_PER_SECOND = 3.6;

// Only the Car speed slider is shown. Every other parameter keeps its metadata
// (so the simulation and scene-drag bounds still work) but is marked `hidden`
// and stays fixed at its default value — buildControls() skips hidden items.
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
        hidden: true,
      },
      {
        key: "carSpeed",
        label: "Car speed",
        min: 5,
        max: 100 / KMH_PER_METER_PER_SECOND,
        step: 1 / KMH_PER_METER_PER_SECOND,
        value: 100 / KMH_PER_METER_PER_SECOND,
        unit: "km/h",
        displayScale: KMH_PER_METER_PER_SECOND,
        displayStep: 1,
      },
      {
        key: "travelSpan",
        label: "Half-length of pass",
        min: 30,
        max: 220,
        step: 1,
        value: 120,
        unit: "m",
        hidden: true,
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
        hidden: true,
      },
      {
        key: "targetFrequency",
        label: "Desired heard pitch",
        min: 200,
        max: 1200,
        step: 1,
        value: 700,
        unit: "Hz",
        hidden: true,
      },
    ],
  },
  {
    title: "Target",
    items: [
      {
        key: "targetX",
        label: "Position along road",
        min: -220,
        max: 220,
        step: 1,
        value: 0,
        unit: "m",
        hidden: true,
      },
      {
        key: "targetY",
        label: "Offset from road",
        min: -40,
        max: 40,
        step: 0.5,
        value: 10,
        unit: "m",
        hidden: true,
      },
    ],
  },
  {
    title: "Bystander",
    items: [
      {
        key: "bystanderX",
        label: "Position along road",
        min: -220,
        max: 220,
        step: 1,
        value: 16,
        unit: "m",
        hidden: true,
      },
      {
        key: "bystanderY",
        label: "Offset from road",
        min: -40,
        max: 40,
        step: 0.5,
        value: 16,
        unit: "m",
        hidden: true,
      },
    ],
  },
];

const initialControlState = Object.fromEntries(
  controls.flatMap((group) => group.items.map((item) => [item.key, item.value])),
);
