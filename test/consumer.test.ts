import { describe, expect, it } from "vitest";

import { locateOrphanMarker } from "../src/consumer";

const BEGIN = "<!-- BEGIN @wisniewskikr/ai-toolkit -->";
const END = "<!-- END @wisniewskikr/ai-toolkit -->";

describe("locateOrphanMarker", () => {
  it("returns null for a well-formed block (BEGIN before END)", () => {
    const raw = `# Header\n\n${BEGIN}\nrules\n${END}\n\n## Footer\n`;
    expect(locateOrphanMarker(raw)).toBeNull();
  });

  it("returns null when neither marker is present", () => {
    expect(locateOrphanMarker("# just my notes\n\nnothing here\n")).toBeNull();
  });

  it("locates a lone BEGIN with its 1-based line", () => {
    const raw = `# Mine\n\n${BEGIN}\nhalf a block, no END\n`;
    expect(locateOrphanMarker(raw)).toEqual({ marker: "BEGIN", line: 3 });
  });

  it("locates a lone END with its 1-based line", () => {
    const raw = `line one\nline two\nline three\n${END}\n`;
    expect(locateOrphanMarker(raw)).toEqual({ marker: "END", line: 4 });
  });

  it("reports the END when the markers are in the wrong order", () => {
    const raw = `${END}\nsome text\n${BEGIN}\n`;
    expect(locateOrphanMarker(raw)).toEqual({ marker: "END", line: 1 });
  });

  it("counts lines correctly for CRLF input", () => {
    const raw = `# Mine\r\n\r\n${BEGIN}\r\nno end here\r\n`;
    expect(locateOrphanMarker(raw)).toEqual({ marker: "BEGIN", line: 3 });
  });
});
