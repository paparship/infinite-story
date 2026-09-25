import * as fs from "fs";
import * as path from "path";

export type CGSource =
  | "chapter1"
  | "chapter2_route_a"
  | "chapter2_route_b"
  | "chapter2_route_c"
  | "chapter3_route_a"
  | "chapter3_route_b"
  | "chapter3_route_c";

export interface SemanticCG {
  id: string;
  title?: string;
  source: CGSource;
  path: string;
  scriptPath: string;
  line: number;
}

export interface WorldSemanticModel {
  expectedCGs: SemanticCG[];
  routeToCharacter: Partial<Record<"a" | "b" | "c", string>>;
}

const SOURCE_TO_SCRIPT: Record<CGSource, string> = {
  chapter1: "chapter1.txt",
  chapter2_route_a: "route_a/chapter2.txt",
  chapter2_route_b: "route_b/chapter2.txt",
  chapter2_route_c: "route_c/chapter2.txt",
  chapter3_route_a: "route_a/chapter3.txt",
  chapter3_route_b: "route_b/chapter3.txt",
  chapter3_route_c: "route_c/chapter3.txt",
};

function sourceToCgFolder(source: CGSource): string {
  return source.replace("chapter", "ch").replace("_route_", "_");
}

function parseCGFromScript(scriptPath: string, source: CGSource): SemanticCG | null {
  if (!fs.existsSync(scriptPath)) return null;
  const content = fs.readFileSync(scriptPath, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/@cg\s+([a-zA-Z0-9_-]+)(?:\s+"([^"]*)")?/i);
    if (match) {
      const id = match[1];
      const title = match[2] || undefined;
      return {
        id,
        title,
        source,
        path: `cg/${sourceToCgFolder(source)}/${id}.png`,
        scriptPath,
        line: i + 1,
      };
    }
  }
  return null;
}

function parseRouteCharacter(scriptPath: string): string | null {
  if (!fs.existsSync(scriptPath)) return null;
  const content = fs.readFileSync(scriptPath, "utf-8");

  const tagMatch = content.match(/@char\s+(\S+)\s+/);
  if (tagMatch) return tagMatch[1].trim();

  const titleMatch = content.match(/===\s*路线[ABC][：:]\s*(\S+)\s*===/);
  if (titleMatch) return titleMatch[1].trim();

  return null;
}

export function buildWorldSemanticModel(storyDir: string): WorldSemanticModel {
  const expectedCGs: SemanticCG[] = [];
  const routeToCharacter: Partial<Record<"a" | "b" | "c", string>> = {};

  for (const source of Object.keys(SOURCE_TO_SCRIPT) as CGSource[]) {
    const scriptPath = path.join(storyDir, SOURCE_TO_SCRIPT[source]);
    const cg = parseCGFromScript(scriptPath, source);
    if (cg) expectedCGs.push(cg);
  }

  const routeScripts: Array<["a" | "b" | "c", string]> = [
    ["a", path.join(storyDir, "route_a/chapter2.txt")],
    ["b", path.join(storyDir, "route_b/chapter2.txt")],
    ["c", path.join(storyDir, "route_c/chapter2.txt")],
  ];
  for (const [route, scriptPath] of routeScripts) {
    const name = parseRouteCharacter(scriptPath);
    if (name) routeToCharacter[route] = name;
  }

  return { expectedCGs, routeToCharacter };
}

