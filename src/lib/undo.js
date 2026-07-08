// Tracks Block removals so "Revert" can put the element back and undo its rule.
export function createUndoStack() {
  const items = [];
  return {
    record(node, ruleRef) {
      if (!node || !node.parentNode) return;
      items.push({ node, parent: node.parentNode, nextSibling: node.nextSibling, ruleRef: ruleRef || null });
    },
    revertLast() {
      const it = items.pop();
      if (!it) return false;
      try {
        if (it.nextSibling && it.nextSibling.parentNode === it.parent) {
          it.parent.insertBefore(it.node, it.nextSibling);
        } else {
          it.parent.appendChild(it.node);
        }
      } catch { return false; }
      if (it.ruleRef && it.ruleRef.list) {
        const i = it.ruleRef.list.indexOf(it.ruleRef.rule);
        if (i >= 0) it.ruleRef.list.splice(i, 1);
      }
      return true;
    },
    size() { return items.length; },
  };
}