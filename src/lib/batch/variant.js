// Telling one kind of icon or button from its look-alikes. A picked item is
// found by its tag and a short path of tags and classes (target.js), and on a
// card with a PDF, a DWG and an RVT icon that path matches all three. The kind
// is in what differs between them (target.js reads it as traits): an extra
// class, the icon or picture inside, the words or label, a data- value, the
// file it links to, or failing all of those, where it sits in its card.
//
// A picked item's variant is { kinds, none }: a node is taken when it is of
// any of the kinds (each worked out from one example the person wanted) and
// holds none of the traits of the examples they did not want.

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

// Its place in its card; a box holding every look-alike is the list, no card.
export function cardSlot(node, alike) {
  const at = slotOf(node, alike);
  return at && at.size < alike.length ? at : null;
}

function countTraits(alike) {
  const count = new Map();
  for (const node of alike) for (const trait of traitsOf(node)) count.set(trait, (count.get(trait) || 0) + 1);
  return count;
}

const hasAll = (traits, all) => all.every((trait) => traits.has(trait));

// One example's kind: its traits that recur (an item's own name is no kind)
// and that not every look-alike has (else they tell nothing apart). When
// those still leave several in its card (icons drawn alike), its place there
// is the kind too. `place` is kept either way, for ruling a neighbour out.
export function kindOf(node, alike, count = countTraits(alike)) {
  const own = traitsOf(node);
  const all = [...own].filter((trait) => (count.get(trait) || 0) >= 2 && count.get(trait) < alike.length).sort();
  const card = cardSlot(node, alike);
  let slot = null;
  if (card) {
    const inCard = alike.filter((each) => card.box.contains(each) && hasAll(traitsOf(each), all));
    if (inCard.length > 1) slot = card.index;
  }
  return { all, slot, place: card ? card.index : null };
}

const hasSlot = (variant) => !!variant && (variant.kinds || []).some((kind) => kind.slot !== null && kind.slot !== undefined);
export { hasSlot };

// Of nodes already matched by traits, those in a kind's place where the kind
// has one. Positions are counted among the look-alikes (`alike`).
export function bySlot(matched, variant, alike = matched) {
  if (!hasSlot(variant)) return matched;
  return matched.filter((node) => {
    const traits = traitsOf(node);
    return variant.kinds.some((kind) => {
      if (!hasAll(traits, kind.all)) return false;
      if (kind.slot === null || kind.slot === undefined) return true;
      const card = cardSlot(node, alike);
      return !!card && card.index === kind.slot;
    });
  });
}

function matchesKind(node, kind, alike) {
  if (!hasAll(traitsOf(node), kind.all)) return false;
  if (kind.slot === null || kind.slot === undefined) return true;
  const card = cardSlot(node, alike);
  return !!card && card.index === kind.slot;
}

// The look-alikes of the variant, in page order.
export function ofVariant(alike, variant) {
  if (!variant) return alike.slice();
  return bySlot(alike.filter((node) => hasTraits(node, variant)), variant, alike);
}

export function isNarrowing(variant) {
  return !!variant && ((variant.none || []).length > 0
    || (variant.kinds || []).some((kind) => kind.all.length > 0 || (kind.slot !== null && kind.slot !== undefined)));
}

// A picked item's record, narrowed to the picked one's kind; `alike` is every
// look-alike on the page, the picked one among them. The examples are kept as
// traits, so the kind can be put right later, on another visit.
export function narrowRecord(record, picked, alike) {
  const kind = kindOf(picked, alike);
  const variant = { kinds: [kind], none: [] };
  return Object.assign({}, record, {
    variant: isNarrowing(variant) ? variant : null,
    variantOn: true,
    examples: { yes: [[...traitsOf(picked)]], no: [] },
  });
}

// The record after the person says "this kind too" (wanted) or "not this".
// Not this, on one of a kind taken in earlier: that kind goes again. Else the
// traits of the unwanted one that no wanted example has rule their holders
// out; when there are none (drawn alike), each kind is held to its own place
// in the card, if that leaves the unwanted one out. Kinds and the examples
// they came from stay in step, one for one.
export function refineRecord(record, node, wanted, alike) {
  const examples = record.examples || { yes: [], no: [] };
  const count = countTraits(alike);
  const own = traitsOf(node);
  let variant = record.variant
    ? { kinds: record.variant.kinds.map((kind) => Object.assign({}, kind)), none: record.variant.none.slice() }
    : { kinds: [{ all: [], slot: null, place: null }], none: [] };
  let yes = examples.yes.slice();
  let no = examples.no.slice();
  if (wanted) {
    variant.kinds.push(kindOf(node, alike, count));
    variant.none = variant.none.filter((trait) => !own.has(trait));
    yes = yes.concat([[...own]]);
  } else {
    const matching = variant.kinds.map((kind, at) => (matchesKind(node, kind, alike) ? at : -1)).filter((at) => at >= 0);
    if (matching.length && matching.length < variant.kinds.length) {
      variant.kinds = variant.kinds.filter((kind, at) => matching.indexOf(at) < 0);
      yes = yes.filter((list, at) => matching.indexOf(at) < 0);
      return Object.assign({}, record, { variant, variantOn: true, examples: { yes, no } });
    }
    const wantedTraits = new Set(yes.flat());
    const add = [...own].filter((trait) => !wantedTraits.has(trait) && variant.none.indexOf(trait) < 0);
    if (add.length) {
      variant.none = variant.none.concat(add).sort();
    } else {
      const card = cardSlot(node, alike);
      for (const kind of variant.kinds) {
        if ((kind.slot === null || kind.slot === undefined) && kind.place !== null && kind.place !== undefined
          && (!card || card.index !== kind.place)) {
          kind.slot = kind.place;
        }
      }
    }
    no = no.concat([[...own]]);
  }
  return Object.assign({}, record, { variant, variantOn: true, examples: { yes, no } });
}
