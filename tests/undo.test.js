import { describe, it, expect, beforeEach } from "vitest";
import { createUndoStack } from "../src/lib/undo.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("createUndoStack", () => {
  it("re-inserts a removed node at its original position and drops the rule", () => {
    document.body.innerHTML = `<div id="a"></div><div id="b"></div><div id="c"></div>`;
    const b = document.getElementById("b");
    const list = [{ type: "id", value: "b" }];
    const stack = createUndoStack();
    stack.record(b, { list, rule: list[0] });
    b.remove();
    expect(document.getElementById("b")).toBeNull();

    expect(stack.revertLast()).toBe(true);
    const order = [...document.body.children].map((el) => el.id);
    expect(order).toEqual(["a", "b", "c"]); // restored between a and c
    expect(list.length).toBe(0);            // rule removed
  });

  it("returns false when empty", () => {
    expect(createUndoStack().revertLast()).toBe(false);
  });
});