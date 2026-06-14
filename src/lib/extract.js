const MAX_TEXT_LEN = 40;

export function isHashedToken(token) {
  if (!token || token.length < 4) return false;
  if (/^_[a-z0-9]{4,}$/i.test(token)) return true;
  const digits = (token.match(/[0-9]/g) || []).length;
  const hasMix = /[a-z][0-9]|[0-9][a-z]/i.test(token);
  return hasMix && digits >= 2 && token.length >= 5;
}

export function extractKeywords(el) {
  const out = [];
  if (!el || el.nodeType !== 1) return out;

  if (el.id && !isHashedToken(el.id)) {
    out.push({ type: "id", value: el.id, action: "remove" });
  }

  for (const cls of el.classList || []) {
    if (!isHashedToken(cls)) out.push({ type: "class", value: cls, action: "remove" });
  }

  for (const attr of el.attributes || []) {
    if (attr.name.startsWith("data-")) {
      out.push({ type: "attr", value: attr.name, action: "remove" });
    }
  }

  if (out.length === 0) {
    const text = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (text && text.length <= MAX_TEXT_LEN) {
      out.push({ type: "text", value: text, action: "remove" });
    }
  }

  return out;
}