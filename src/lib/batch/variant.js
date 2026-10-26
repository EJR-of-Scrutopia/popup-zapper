// Telling one kind of icon or button from its look-alikes. A picked item is
// found by its tag and a short path of tags and classes (target.js), and on a
// card with a PDF, a DWG and an RVT icon that path matches all three. The kind
// is in what differs between them (target.js reads it as traits): an extra
// class, the icon or picture inside, the words or label, a data- value, the
// file it links to, or failing all of those, where it sits in its card.

import { traitsOf, hasTraits } from "./target.js";

// Where a node sits among its look-alikes, in the smallest box above it that
// holds more than one of them, counted in page order.
export function slotOf(node, alike, depth = 8) {
  let at = node;
  for (let step = 0; step < depth && at; step++) {
    at = at.parentElement;
    if (!at) break;
    const inside = alike.filter((each) => at.contains(each));
    if (inside.length > 1) return { box: at, index: inside.indexOf(node), size: inside.length };
  }
  return null;
}

// The kind, from the look-alikes on the page (`alike`), the traits of the
// examples the person wants (`yes`, a list of Sets) and of those they do not
// (`no`). A trait counts when every wanted example has it, it recurs (an
// item's own name is no kind), and not every look-alike has it (else it tells
// nothing apart). A trait of an unwanted example that no wanted one has rules
// out whatever holds it.
export function workOutVariant(alike, yes, no = []) {
  if (!yes.length) return null;
  const count = new Map();
  for (const node of alike) for (const trait of traitsOf(node)) count.set(trait, (count.get(trait) || 0) + 1);
  let common = null;
  for (const own of yes) common = common ? new Set([...common].filter((trait) => own.has(trait))) : new Set(own);
  const all = [...common].filter((trait) => (count.get(trait) || 0) >= 2 && count.get(trait) < alike.length).sort();
  const wanted = new Set();
  for (const own of yes) for (const trait of own) wanted.add(trait);
  const none = [];
  for (const own of no) for (const trait of own) if (!wanted.has(trait) && none.indexOf(trait) < 0) none.push(trait);
  return { all, none: none.sort(), slot: null };
}

// When the kind still leaves several side by side in a wanted node's own card
// (three icons drawn alike), the place it holds there is the kind.
export function slotFor(kept, wantedNodes) {
  const first = wantedNodes.length ? slotOf(wantedNodes[0], kept) : null;
  if (!first || first.size >= kept.length) return null;
  const same = wantedNodes.every((node) => { const at = slotOf(node, kept); return at && at.index === first.index; });
  return same ? first.index : null;
}

// Of nodes already matched by traits, those in the remembered place. Across a
// page, a node alone in its box (or in a box holding every match, the list
// itself) is in no card and so in no place; within one row, the row is the card.
export function bySlot(matched, variant, { inRow = false } = {}) {
  if (!variant || variant.slot === null || variant.slot === undefined) return matched;
  return matched.filter((node) => {
    const at = slotOf(node, matched);
    if (!at) return inRow && variant.slot === 0;
    if (!inRow && at.size === matched.length) return false;
    return at.index === variant.slot;
  });
}

// The look-alikes of the kind, in page order.
export function ofVariant(alike, variant, options) {
  if (!variant) return alike.slice();
  return bySlot(alike.filter((node) => hasTraits(node, variant)), variant, options);
}

export function isNarrowing(variant) {
  return !!variant && ((variant.all && variant.all.length > 0) || (variant.none && variant.none.length > 0)
    || (variant.slot !== null && variant.slot !== undefined));
}

// A picked item's record, narrowed to the picked one's kind: `alike` is every
// look-alike on the page (the picked one among them). The examples are kept
// as traits, so the kind can be put right later, on another visit.
export function narrowRecord(record, picked, alike) {
  const yes = [traitsOf(picked)];
  const variant = workOutVariant(alike, yes, []);
  const kept = alike.filter((node) => hasTraits(node, variant));
  variant.slot = slotFor(kept, [picked]);
  return Object.assign({}, record, {
    variant: isNarrowing(variant) ? variant : null,
    variantOn: true,
    examples: { yes: yes.map((set) => [...set]), no: [] },
  });
}

// The record after the person says "this one too" or "not this one".
export function refineRecord(record, node, wanted, alike, wantedNodes = []) {
  const examples = record.examples || { yes: [], no: [] };
  const yes = examples.yes.map((list) => new Set(list));
  const no = examples.no.map((list) => new Set(list));
  (wanted ? yes : no).push(traitsOf(node));
  const variant = workOutVariant(alike, yes, no) || { all: [], none: [], slot: null };
  const kept = alike.filter((each) => hasTraits(each, variant));
  const nodes = wanted ? wantedNodes.concat([node]) : wantedNodes;
  variant.slot = nodes.length ? slotFor(kept, nodes) : (record.variant ? record.variant.slot : null);
  return Object.assign({}, record, {
    variant: isNarrowing(variant) ? variant : null,
    variantOn: true,
    examples: { yes: yes.map((set) => [...set]), no: no.map((set) => [...set]) },
  });
}
