export function normalizeHex(value: unknown) {
  if (typeof value !== "string") return null;
  let digits = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(digits)) digits = digits.replace(/./g, (digit) => digit.repeat(2));
  return /^[0-9a-f]{6}$/i.test(digits) ? `#${digits.toLowerCase()}` : null;
}

export function hexChannels(hex: string) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ] as const;
}

export function rgbToHex(channels: readonly number[]) {
  return "#" + channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("");
}

export function linearChannels(hex: string) {
  return hexChannels(hex).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
}

export function luminance(hex: string) {
  const [r, g, b] = linearChannels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastText(hex: string) {
  return luminance(hex) < Math.sqrt(0.05 * 1.05) - 0.05 ? "#fff" : "#000";
}

export function cssColorToHex(color: string) {
  const hex = normalizeHex(color);
  if (hex) return hex;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return rgbToHex([...context.getImageData(0, 0, 1, 1).data].slice(0, 3));
}
