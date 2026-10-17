import { describe, expect, it } from "vite-plus/test";

import {
  applyDictationDictionary,
  formatDictationDictionary,
  parseDictationDictionary,
  withDictationDictionary,
} from "./dictationDictionary";

describe("dictation dictionary", () => {
  it("corrects repeated phrases across capitalization, whitespace and punctuation", () => {
    const dictionary = [{ word: "cloud pewter", replacement: "Claudeputer" }];
    expect(
      applyDictationDictionary("Cloud Pewter, CLOUD  PEWTER! cloud\npewter.", dictionary),
    ).toBe("Claudeputer, Claudeputer! Claudeputer.");
  });

  it("does not replace fragments of names, identifiers, or Unicode words", () => {
    const dictionary = [{ word: "Vic", replacement: "Victor" }];
    expect(
      applyDictationDictionary(
        "Vic Vic, Victoria civic _Vic Vic2 éVic Vicé Vic\u0301 (Vic).",
        dictionary,
      ),
    ).toBe("Victor Victor, Victoria civic _Vic Vic2 éVic Vicé Vic\u0301 (Victor).");
  });

  it("treats dictionary punctuation and replacement dollar signs literally", () => {
    const dictionary = [
      { word: "CLAW.md", replacement: "CLAUDE.md" },
      { word: "cost", replacement: "$& $1" },
    ];
    expect(applyDictationDictionary("CLAW.md, CLAWxmd, cost.", dictionary)).toBe(
      "CLAUDE.md, CLAWxmd, $& $1.",
    );
  });

  it("prefers the longest phrase and never reprocesses a replacement", () => {
    const dictionary = [
      { word: "blue", replacement: "green" },
      { word: "blue bird", replacement: "blue" },
      { word: "green", replacement: "red" },
    ];
    expect(applyDictationDictionary("blue bird, blue, green", dictionary)).toBe("blue, green, red");
  });

  it("preserves conflicting case-specific replacements and uses saved order as fallback", () => {
    const dictionary = [
      { word: "Cloud Word", replacement: "JoinedWord" },
      { word: "Cloud word", replacement: "Joined-Word" },
    ];
    expect(applyDictationDictionary("Cloud Word; Cloud word; CLOUD WORD", dictionary)).toBe(
      "JoinedWord; Joined-Word; JoinedWord",
    );
  });

  it("leaves vocabulary-only entries and empty dictionaries alone", () => {
    expect(applyDictationDictionary("GIT and other words", [{ word: "git" }])).toBe(
      "GIT and other words",
    );
    expect(applyDictationDictionary("Original text", [])).toBe("Original text");
    expect(applyDictationDictionary("Original text", [{ word: " ", replacement: "oops" }])).toBe(
      "Original text",
    );
  });

  it('parses and formats "heard => meant" lines', () => {
    const dictionary = parseDictationDictionary(
      " cloud  pewter => Claudeputer\nno arrow\n => empty\nT3=>T3 Code",
    );
    expect(dictionary).toEqual([
      { word: "cloud pewter", replacement: "Claudeputer" },
      { word: "T3", replacement: "T3 Code" },
    ]);
    expect(formatDictationDictionary(dictionary)).toBe(
      "cloud pewter => Claudeputer\nT3 => T3 Code",
    );
  });

  it("applies the dictionary current at transcription time", async () => {
    let dictionary = [{ word: "cloud pewter", replacement: "Claudeputer" }];
    const transcriber = withDictationDictionary(
      { prepare: async () => ({ locale: "en-US", transcribe: async () => "open cloud pewter" }) },
      () => dictionary,
    );
    const signal = new AbortController().signal;
    const prepared = await transcriber!.prepare({ signal });
    dictionary = [{ word: "cloud pewter", replacement: "Happy" }];
    expect(await prepared.transcribe("file://take.m4a", { signal })).toBe("open Happy");
    expect(withDictationDictionary(null, () => dictionary)).toBeNull();
  });
});
