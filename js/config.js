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
        min: -220,
        max: 220,
        step: 1,
        value: 0,
        unit: "m",
      },
      {
        key: "targetY",
        label: "Offset from road",
        min: -40,
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
        min: -220,
        max: 220,
        step: 1,
        value: 16,
        unit: "m",
      },
      {
        key: "bystanderY",
        label: "Offset from road",
        min: -40,
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
