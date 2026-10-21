// Explicitly synthetic images for mechanism tests and the labelled demo.
// These are not photographs and cannot establish real-world recognition accuracy.
const SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
  5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};
const GEOMETRY = {
  a: [8, 0, 40, 8], b: [48, 8, 8, 40], c: [48, 52, 8, 40],
  d: [8, 92, 40, 8], e: [0, 52, 8, 40], f: [0, 8, 8, 40], g: [8, 46, 40, 8],
};

export function blank(width, height, color = [203, 217, 201]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...color, 255], i * 4);
  return { width, height, data };
}

export function rect(image, x, y, w, h, color) {
  for (let row = Math.max(0, Math.round(y)); row < Math.min(image.height, Math.round(y + h)); row++) {
    for (let col = Math.max(0, Math.round(x)); col < Math.min(image.width, Math.round(x + w)); col++) {
      image.data.set([...color, 255], (row * image.width + col) * 4);
    }
  }
}

export function drawDigits(image, text, x, y, color = [15, 29, 23], scale = 1) {
  for (const char of text) {
    if (char === '.') {
      rect(image, x, y + 91 * scale, 8 * scale, 9 * scale, color);
      x += 22 * scale;
    } else {
      for (const segment of SEGMENTS[char] ?? '') {
        const [dx, dy, w, h] = GEOMETRY[segment];
        rect(image, x + dx * scale, y + dy * scale, w * scale, h * scale, color);
      }
      x += 78 * scale;
    }
  }
}

export function lineFixture(text, { blue = false, scale = 1, light = false } = {}) {
  const width = Math.ceil((text.length * 78 + 40) * scale), height = Math.ceil(132 * scale);
  const image = blank(width, height, blue || light ? [8, 15, 24] : [203, 217, 201]);
  drawDigits(image, text, 12 * scale, 16 * scale, blue ? [40, 170, 255] : light ? [240, 240, 240] : [15, 29, 23], scale);
  return image;
}

export function demoPhoto(step) {
  if (step === 'pump') {
    const image = blank(820, 480);
    drawDigits(image, '287.40', 150, 95);
    drawDigits(image, '40.000', 150, 285);
    return image;
  }
  const image = blank(820, 480, [8, 15, 24]);
  drawDigits(image, '128450', 130, 190, [40, 170, 255]);
  return image;
}
