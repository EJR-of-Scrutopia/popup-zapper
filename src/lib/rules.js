export function matchesRule(el, rule) {
  if (!el || el.nodeType !== 1) return false;
  switch (rule.type) {
    case "id":
      return el.id === rule.value;
    case "class":
      return el.classList && el.classList.contains(rule.value);
    case "attr":
      return el.hasAttribute(rule.value);
    case "text":
      return (el.textContent || "").toLowerCase().includes(rule.value.toLowerCase());
    case "cmp":
      try { return el.matches(rule.value); } catch { return false; }
    default:
      return false;
  }
}

export function getActiveRules(library, hostname) {
  if (!library.enabled) return [];
  if ((library.disabledDomains || []).includes(hostname)) return [];
  const enabled = (r) => r.enabled !== false;
  const global = (library.global || []).filter(enabled);
  const domain = (((library.domains || {})[hostname] || {}).rules || []).filter(enabled);
  return [...global, ...domain];
}

export function findMatches(root, rules) {
  const out = [];
  const all = root.querySelectorAll("*");
  for (const el of all) {
    for (const rule of rules) {
      if (matchesRule(el, rule)) { out.push(el); break; }
    }
  }
  return out;
}