export const MAX_BACKGROUND_BYTES = 5 * 1024 * 1024;
export const DEFAULT_ACCENT_COLOR = '#c5e36b';

export function validateBackgroundFile(file) {
  if (!file) return '请选择图片。';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return '仅支持 PNG、JPEG 或 WebP 图片。';
  if (file.size > MAX_BACKGROUND_BYTES) return '背景图片不能超过 5 MB。';
  return null;
}

export function normalizeAccentColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : DEFAULT_ACCENT_COLOR;
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

export function accentInkColor(value) {
  return relativeLuminance(normalizeAccentColor(value)) > 0.45 ? '#19200e' : '#f5f4ee';
}
