function hintText(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value.text === "string") return value.text.trim();
  return "";
}

function hintValues(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function normalizeStopHints(stop) {
  const authored = hintValues(stop?.hints);
  const source = authored.length > 0 ? authored : [stop?.hint];
  const seen = new Set();
  const hints = [];

  for (const value of source) {
    const text = hintText(value);
    if (!text) continue;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push(text);
    if (hints.length === 2) break;
  }

  if (hints.length === 0 && authored.length > 0) {
    const fallback = hintText(stop?.hint);
    if (fallback) hints.push(fallback);
  }

  return hints;
}

module.exports = {
  normalizeStopHints,
};
