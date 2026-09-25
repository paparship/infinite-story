import { ScriptParser, type ParseDiagnostic, type ParserSpecVersion } from "./ScriptParser";

export interface ScriptLintResult {
  ok: boolean;
  diagnostics: ParseDiagnostic[];
  errors: ParseDiagnostic[];
  warnings: ParseDiagnostic[];
  normalizedText: string;
}

export function lintScript(
  scriptText: string,
  specVersion: ParserSpecVersion = "v1_compat"
): ScriptLintResult {
  const result = ScriptParser.parse(scriptText, {
    specVersion,
    normalize: true,
  });

  const errors = result.diagnostics.filter(d => d.severity === "error");
  const warnings = result.diagnostics.filter(d => d.severity === "warning");
  return {
    ok: errors.length === 0,
    diagnostics: result.diagnostics,
    errors,
    warnings,
    normalizedText: result.normalizedText,
  };
}

