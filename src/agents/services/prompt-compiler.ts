import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { getPromptContract } from "./prompt-contract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENTS_DIR = path.join(__dirname, "..");

export interface CompiledPromptResult {
  contractId: string;
  contractVersion: string;
  templatePath: string;
  renderedPrompt: string;
  unresolvedVariables: string[];
}

function readTemplate(contractTemplatePath: string): string {
  const absPath = path.join(AGENTS_DIR, contractTemplatePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`提示词模板不存在: ${absPath}`);
  }
  return fs.readFileSync(absPath, "utf-8");
}

function collectTemplateVariables(template: string): string[] {
  const regex = /\{\{([A-Z0-9_]+)\}\}/g;
  const variables = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    variables.add(match[1]);
  }
  return Array.from(variables);
}

export function compilePrompt(
  contractId: string,
  variables: Record<string, string | undefined>
): CompiledPromptResult {
  const contract = getPromptContract(contractId);
  const template = readTemplate(contract.templatePath);
  const templateVariables = collectTemplateVariables(template);

  for (const required of contract.requiredVariables) {
    const value = variables[required];
    if (value === undefined || value === "") {
      throw new Error(`提示词契约缺少必需变量: ${required} (${contractId})`);
    }
  }

  if (contract.strictNoUnknownVariables) {
    for (const key of Object.keys(variables)) {
      if (!contract.allowedVariables.includes(key)) {
        throw new Error(`提示词契约不允许的变量: ${key} (${contractId})`);
      }
    }
  }

  let rendered = template;
  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined) {
      rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }
  }

  const unresolvedVariables = collectTemplateVariables(rendered);
  for (const variable of templateVariables) {
    if (!variables[variable] && contract.requiredVariables.includes(variable)) {
      unresolvedVariables.push(variable);
    }
  }
  const uniqueUnresolved = Array.from(new Set(unresolvedVariables));

  if (uniqueUnresolved.length > 0) {
    throw new Error(
      `提示词渲染后仍存在未替换占位符: ${uniqueUnresolved.join(", ")} (${contractId})`
    );
  }

  return {
    contractId: contract.id,
    contractVersion: contract.version,
    templatePath: contract.templatePath,
    renderedPrompt: rendered,
    unresolvedVariables: uniqueUnresolved,
  };
}

