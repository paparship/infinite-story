import { describe, expect, it } from "vitest";
import { ScriptParser } from "../ScriptParser";
import { lintScript } from "../ScriptLinter";

describe("ScriptParser v2", () => {
  it("normalizes legacy route_end markers in strict mode", () => {
    const script = [
      "@route_start A",
      "【对话】林夏：「测试」",
      "@end_route A",
      "@cg cg_ch3_a \"结局\"",
      "@end_chapter",
    ].join("\n");

    const result = ScriptParser.parse(script, { specVersion: "v2_strict" });
    expect(result.normalizedText).toContain("@route_end A");
    expect(result.specVersion).toBe("v2_strict");
  });

  it("reports invalid cg/effect diagnostics in strict mode", () => {
    const script = [
      "@spec v2",
      "@effect unknown_effect",
      "@cg cg_bad \"oops\"",
    ].join("\n");

    const result = ScriptParser.parse(script, { specVersion: "v2_strict" });
    const codes = result.diagnostics.map(d => d.code);
    expect(codes).toContain("INVALID_EFFECT");
    expect(codes).toContain("INVALID_CG_ID");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("lints and returns normalized content", () => {
    const script = [
      "@spec v2",
      "【游戏标题】@game_title \"测试标题\"",
      "【对话】我：「hello」",
      "@cg cg_ch1 \"标题\"",
    ].join("\n");
    const lint = lintScript(script, "v2_strict");
    expect(lint.normalizedText.length).toBeGreaterThan(0);
    expect(lint.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("parses @choice and @feedback blocks", () => {
    const script = [
      "@spec v2",
      "@choice normal",
      "1. 「去天台」",
      "@feedback 1 「你决定去天台」",
      "2. 「去教室」",
      "@feedback 2 「你决定去教室」",
    ].join("\n");

    const result = ScriptParser.parse(script, { specVersion: "v2_strict" });
    const choice = result.commands.find(c => c.type === "choice");
    const options = (choice?.params.options as Array<{ index: number; feedback?: string }>) || [];
    expect(options.length).toBe(2);
    expect(options[0].feedback).toBe("你决定去天台");
    expect(options[1].feedback).toBe("你决定去教室");
  });
});

