// A small in-memory activity log so the user can see what the zapper did (and
// did not) do on a page. Bounded ring buffer with subscription for live UI.
export function createActivityLog(max = 200) {
  const entries = [];
  const listeners = new Set();
  const notify = () => {
    for (const fn of listeners) { try { fn(entries); } catch { /* ignore */ } }
  };
  return {
    add(action, detail) {
      detail = detail || "";
      const last = entries[entries.length - 1];
      // Collapse identical consecutive events (e.g. a re-detected popup) so the
      // log stays readable instead of flooding.
      if (last && last.action === action && last.detail === detail) {
        last.t = Date.now();
        last.count = (last.count || 1) + 1;
        return;
      }
      entries.push({ t: Date.now(), action, detail });
      if (entries.length > max) entries.shift();
      notify();
    },
    entries() { return entries.slice(); },
    clear() { entries.length = 0; notify(); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}