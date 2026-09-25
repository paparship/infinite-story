import { describe, expect, it } from "vitest";
import { compilePrompt } from "../services/prompt-compiler";

describe("prompt-compiler", () => {
  it("renders chapter1 prompt with required variables", () => {
    const result = compilePrompt("text/chapter1_generation_v2", {
      PREFERRED_EFFECT: "sakura",
    });
    expect(result.renderedPrompt).toContain("@effect sakura");
    expect(result.contractVersion).toBe("v2.0.0");
  });

  it("throws when unknown variables are passed", () => {
    expect(() =>
      compilePrompt("text/chapter1_generation_v2", {
        PREFERRED_EFFECT: "sakura",
        UNKNOWN_VAR: "x",
      } as Record<string, string>)
    ).toThrow(/不允许的变量/);
  });
});

