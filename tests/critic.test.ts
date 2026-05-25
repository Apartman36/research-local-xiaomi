import { describe, expect, it } from "vitest";
import { parseCritiqueContent } from "../src/agents/critic.js";

describe("critic parsing", () => {
  it("does not throw on malformed JSON", () => {
    expect(() => parseCritiqueContent('{"summary":"broken","weakAreas":["x" "y"]}')).not.toThrow();
  });

  it("returns a valid fallback critique for malformed JSON", () => {
    const result = parseCritiqueContent('{"summary":"broken","weakAreas":["x" "y"]}');

    expect(result.parseFailed).toBe(true);
    expect(result.critique).toEqual({
      summary: "Critic returned malformed JSON; follow-up planning was skipped.",
      weakAreas: ["Critic returned malformed JSON; follow-up planning was skipped."],
      missingCoverage: [],
      duplicateEvidence: [],
      followUpTasks: [],
      needsFollowUp: false
    });
  });

  it("uses valid critic JSON as-is", () => {
    const result = parseCritiqueContent(
      JSON.stringify({
        summary: "Looks usable.",
        weakAreas: ["Thin support"],
        missingCoverage: [],
        duplicateEvidence: [],
        needsFollowUp: true,
        followUpTasks: [
          {
            id: "G001",
            subquestionId: "SQ001",
            query: "follow up",
            rationale: "needed",
            depth: 1,
            focus: "web"
          }
        ]
      })
    );

    expect(result.parseFailed).toBeUndefined();
    expect(result.critique.needsFollowUp).toBe(true);
    expect(result.critique.followUpTasks).toHaveLength(1);
  });
});
