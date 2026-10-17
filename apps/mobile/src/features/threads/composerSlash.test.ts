import { describe, expect, it } from "vite-plus/test";

import { insertSlashCommand } from "./composerSlash";

describe("insertSlashCommand", () => {
  it("starts an empty draft with a slash", () => {
    expect(insertSlashCommand("", { start: 0, end: 0 })).toEqual({ value: "/", cursor: 1 });
  });

  it("inserts at the cursor after whitespace", () => {
    expect(insertSlashCommand("fix this ", { start: 9, end: 9 })).toEqual({
      value: "fix this /",
      cursor: 10,
    });
    expect(insertSlashCommand("a\nb", { start: 2, end: 2 })).toEqual({
      value: "a\n/b",
      cursor: 3,
    });
  });

  it("adds a space when the cursor sits right after a word", () => {
    expect(insertSlashCommand("fix this", { start: 8, end: 8 })).toEqual({
      value: "fix this /",
      cursor: 10,
    });
  });

  it("replaces a selection and clamps a stale cursor", () => {
    expect(insertSlashCommand("one two", { start: 4, end: 7 })).toEqual({
      value: "one /",
      cursor: 5,
    });
    expect(insertSlashCommand("hi ", { start: 40, end: 40 })).toEqual({
      value: "hi /",
      cursor: 4,
    });
  });
});
