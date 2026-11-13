const clamp = value => Math.max(0, Math.min(1, value));
const LOG_BASE = 1000;

export const SCALE_MODES = [
  ['linear', 'Linear'], ['log', 'Log'], ['power', 'Power'], ['sqrt', 'Square root'],
  ['squared', 'Squared'], ['asinh', 'Asinh'], ['sinh', 'Sinh'], ['histogram', 'Histogram equalization'],
];

export function stretch(mode, value) {
  const x = clamp(value);
  switch (mode) {
    case 'linear': return x;
    case 'log': return Math.log1p(LOG_BASE * x) / Math.log1p(LOG_BASE);
    case 'power': return (Math.pow(LOG_BASE, x) - 1) / (LOG_BASE - 1);
    case 'sqrt': return Math.sqrt(x);
    case 'squared': return x * x;
    case 'asinh': return Math.asinh(x / 0.1) / Math.asinh(10);
    case 'sinh': return Math.sinh(x / (1 / 3)) / Math.sinh(3);
    default: throw new Error('Unknown scale mode: ' + mode);
  }
}

function histogram(data) {
  const counts = new Uint32Array(256);
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const value = (data[i] + data[i + 1] + data[i + 2]) / 3;
    counts[Math.round(value)]++;
  }
  const table = new Float64Array(256);
  let cumulative = 0;
  const first = counts.findIndex(value => value > 0);
  const minimum = first < 0 ? 0 : counts[first];
  for (let i = 0; i < table.length; i++) {
    cumulative += counts[i];
    table[i] = clamp((cumulative - minimum) / Math.max(1, count - minimum));
  }
  return table;
}

export function applyScale(data, options) {
  const { mode = 'linear', black = 0, white = 255, brightness = 0,
    contrast = 1, gamma = 1 } = options;
  const range = Math.max(1e-12, white - black);
  const table = mode === 'histogram' ? histogram(data) : null;
  for (let i = 0; i < data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const offset = i + channel;
      const x = clamp((data[offset] - black) / range);
      const scaled = table ? table[Math.max(0, Math.min(255, Math.round(data[offset] - black)))] : stretch(mode, x);
      data[offset] = Math.max(0, Math.min(255, Math.pow(scaled, 1 / gamma) * contrast * 255 + brightness * 2.55));
    }
  }
  return data;
}

function samples(data, limit = 600) {
  const count = data.length / 4;
  const step = Math.max(1, Math.floor(count / limit));
  const values = [];
  for (let pixel = 0; pixel < count; pixel += step) {
    const i = pixel * 4;
    values.push((data[i] + data[i + 1] + data[i + 2]) / 3);
  }
  return values.sort((a, b) => a - b);
}

export function autoLevels(data, method = 'zscale') {
  const values = samples(data, method === 'minmax' ? data.length / 4 : 600);
  const minimum = values[0], maximum = values[values.length - 1];
  if (method === 'minmax' || values.length < 10 || minimum === maximum) {
    return { black: minimum, white: maximum };
  }
  const count = values.length;
  const half = Math.max(2, Math.floor(count / 2));
  let meanX = 0, meanY = 0;
  for (let i = 0; i < half; i++) { meanX += i; meanY += values[i]; }
  meanX /= half;
  meanY /= half;
  let numerator = 0, denominator = 0;
  for (let i = 0; i < half; i++) {
    numerator += (i - meanX) * (values[i] - meanY);
    denominator += (i - meanX) ** 2;
  }
  const slope = denominator ? numerator / denominator : 0;
  if (!(slope > 0)) return { black: minimum, white: maximum };
  const median = count % 2 ? values[(count - 1) / 2] : (values[count / 2 - 1] + values[count / 2]) / 2;
  const width = Math.max(1, count / (2 * 0.25));
  const black = Math.max(minimum, median - width * slope);
  const white = Math.min(maximum, median + width * slope);
  return white > black ? { black, white } : { black: minimum, white: maximum };
}
