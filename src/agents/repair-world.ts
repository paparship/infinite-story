/**
 * World 资产修复脚本
 *
 * 功能：
 * 1) 检查 world.json 定义的角色/CG 资源是否缺失
 * 2) 自动找回上下文并重试生成缺失资源
 *
 * 用法：
 *   npx tsx src/agents/repair-world.ts --world-id <world_id>
 *   npx tsx src/agents/repair-world.ts --world-id <world_id> --dry-run
 */

import * as fs from "fs";
import * as path from "path";
import { generateCharacterSprite, type CharacterInput } from "./character-sprite-agent.js";
import { generateCG } from "./cg-agent.js";
import { createWorldPaths } from "./utils/world-paths.js";

type RouteLetter = "a" | "b" | "c";
type CGSource =
  | "chapter1"
  | "chapter2_route_a"
  | "chapter2_route_b"
  | "chapter2_route_c"
  | "chapter3_route_a"
  | "chapter3_route_b"
  | "chapter3_route_c";

interface WorldConfigLite {
  uid: string;
  game: {
    title: string;
    characters: Array<{ id: string; name: string; folder?: string }>;
    chapters?: {
      routes?: Record<string, Array<{ script?: string }>>;
    };
    cgs: Array<{ id: string; title?: string; path: string }>;
  };
  assets?: {
    characters?: Record<
      string,
      {
        name?: string;
        folder?: string;
        sprites?: Record<string, string>;
        portrait?: string;
      }
    >;
  };
}

interface MissingCharacterReport {
  charId: string;
  name: string;
  missingPaths: string[];
}

interface MissingCGReport {
  id: string;
  title?: string;
  expectedPath: string;
  source: CGSource | null;
}

const ALL_CG_SOURCES: CGSource[] = [
  "chapter1",
  "chapter2_route_a",
  "chapter2_route_b",
  "chapter2_route_c",
  "chapter3_route_a",
  "chapter3_route_b",
  "chapter3_route_c",
];

function parseArgs(argv: string[]): { worldId: string | null; dryRun: boolean } {
  const worldIdIndex = argv.indexOf("--world-id");
  const worldId = worldIdIndex >= 0 ? argv[worldIdIndex + 1] || null : null;
  const dryRun = argv.includes("--dry-run");
  return { worldId, dryRun };
}

function parseCharacterDescription(descPath: string, name: string): CharacterInput {
  if (!fs.existsSync(descPath)) {
    return {
      name,
      worldSetting: "",
      appearance: "",
      outfit: "",
      accessories: "",
    };
  }

  const content = fs.readFileSync(descPath, "utf-8");
  const worldMatch =
    content.match(/(?:^|\n)\s*@worldview\b\s*([^\n]+)/i) ||
    content.match(/世界观设定[：:]?\s*([\s\S]*?)(?===|$)/i) ||
    content.match(/===\s*世界观设定\s*===\s*([\s\S]*?)(?===|$)/i);
  const appearanceMatch = content.match(/(?:^|\n)\s*@appearance\b\s*([^\n]+)/i) ||
    content.match(/外貌[描述]*[：:]\s*([^\n]+)/i);
  const outfitMatch = content.match(/(?:^|\n)\s*@outfit\b\s*([^\n]+)/i) ||
    content.match(/服装[设定]*[：:]\s*([^\n]+)/i);
  const accessoriesMatch = content.match(/(?:^|\n)\s*@accessories\b\s*([^\n]+)/i) ||
    content.match(/配饰[：:]\s*([^\n]+)/i);

  let outfit = outfitMatch ? outfitMatch[1].trim() : "";
  let accessories = accessoriesMatch ? accessoriesMatch[1].trim() : "";
  if (!accessories && outfit) {
    const bracketMatch = outfit.match(/\[([^\]]+)\]/);
    if (bracketMatch) {
      accessories = bracketMatch[1].trim();
      outfit = outfit.replace(/\s*\[[^\]]+\]\s*/g, "").trim();
    }
  }

  return {
    name,
    worldSetting: worldMatch ? worldMatch[1].trim() : "",
    appearance: appearanceMatch ? appearanceMatch[1].trim() : "",
    outfit,
    accessories,
  };
}

function mapCgIdToSource(cgId: string): CGSource | null {
  const m = cgId.match(/^cg_ch([123])(?:_([abc]))?$/i);
  if (!m) return null;
  const chapter = Number(m[1]);
  const route = (m[2] || "").toLowerCase() as RouteLetter | "";
  if (chapter === 1) return "chapter1";
  if (!route) return null;
  if (chapter === 2) return `chapter2_route_${route}` as CGSource;
  if (chapter === 3) return `chapter3_route_${route}` as CGSource;
  return null;
}

function settingsPathFromSource(storyDir: string, source: CGSource): string {
  if (source === "chapter1") return path.join(storyDir, "settings_1.txt");
  const m = source.match(/^chapter([23])_route_([abc])$/);
  if (!m) return path.join(storyDir, "settings_1.txt");
  const chapter = m[1];
  const route = m[2];
  return path.join(storyDir, `route_${route}`, `settings_${chapter}.txt`);
}

function scriptPathFromSource(storyDir: string, source: CGSource): string {
  if (source === "chapter1") return path.join(storyDir, "chapter1.txt");
  const m = source.match(/^chapter([23])_route_([abc])$/);
  if (!m) return path.join(storyDir, "chapter1.txt");
  const chapter = m[1];
  const route = m[2];
  return path.join(storyDir, `route_${route}`, `chapter${chapter}.txt`);
}

function sourceToCgFolder(source: CGSource): string {
  return source.replace("chapter", "ch").replace("_route_", "_");
}

function fallbackCgIdForSource(source: CGSource): string {
  if (source === "chapter1") return "cg_ch1";
  const m = source.match(/^chapter([23])_route_([abc])$/);
  if (!m) return "cg_unknown";
  return `cg_ch${m[1]}_${m[2]}`;
}

function extractCgFromScript(scriptPath: string): { id: string; title?: string } | null {
  if (!fs.existsSync(scriptPath)) return null;
  const content = fs.readFileSync(scriptPath, "utf-8");
  const match = content.match(/@cg\s+([a-zA-Z0-9_-]+)(?:\s+"([^"]*)")?/i);
  if (!match) return null;
  return { id: match[1], title: match[2] || undefined };
}

function getRouteToCharacterFolderMap(world: WorldConfigLite): Record<RouteLetter, string> {
  const map: Partial<Record<RouteLetter, string>> = {};
  const routes = world.game.chapters?.routes || {};
  const assetsChars = world.assets?.characters || {};

  for (const [charId, chapters] of Object.entries(routes)) {
    const asset = assetsChars[charId];
    if (!asset?.folder) continue;
    for (const chapter of chapters) {
      const script = chapter.script || "";
      const match = script.match(/route_([abc])\//i);
      if (match) {
        map[match[1].toLowerCase() as RouteLetter] = asset.folder;
      }
    }
  }

  return {
    a: map.a || "characters/unknown_a",
    b: map.b || "characters/unknown_b",
    c: map.c || "characters/unknown_c",
  };
}

function inspectMissingResources(worldDir: string, world: WorldConfigLite): {
  missingCharacters: MissingCharacterReport[];
  missingCGs: MissingCGReport[];
} {
  const missingCharacters: MissingCharacterReport[] = [];
  const assetsChars = world.assets?.characters || {};

  for (const [charId, asset] of Object.entries(assetsChars)) {
    const charName = asset.name || world.game.characters.find(c => c.id === charId)?.name || charId;
    const requiredRelPaths = [
      ...Object.values(asset.sprites || {}),
      asset.portrait || "",
    ].filter(Boolean);
    const missingPaths = requiredRelPaths.filter(rel => !fs.existsSync(path.join(worldDir, rel)));
    if (missingPaths.length > 0) {
      missingCharacters.push({ charId, name: charName, missingPaths });
    }
  }

  const missingCGs: MissingCGReport[] = [];
  const missingCGKeys = new Set<string>();

  // 1) 从 world.json 已登记的 CG 检查
  for (const cg of world.game.cgs || []) {
    if (!fs.existsSync(path.join(worldDir, cg.path))) {
      const item: MissingCGReport = {
        id: cg.id,
        title: cg.title,
        expectedPath: cg.path,
        source: mapCgIdToSource(cg.id),
      };
      const key = `${item.id}|${item.expectedPath}`;
      if (!missingCGKeys.has(key)) {
        missingCGKeys.add(key);
        missingCGs.push(item);
      }
    }
  }

  // 2) 从脚本 @cg 推导“应有 CG”（防止 world.json 漏登记）
  const storyDir = path.join(worldDir, "story");
  for (const source of ALL_CG_SOURCES) {
    const scriptPath = scriptPathFromSource(storyDir, source);
    const parsed = extractCgFromScript(scriptPath);
    if (!parsed) continue;
    const expectedPath = `cg/${sourceToCgFolder(source)}/${parsed.id}.png`;
    if (!fs.existsSync(path.join(worldDir, expectedPath))) {
      const item: MissingCGReport = {
        id: parsed.id || fallbackCgIdForSource(source),
        title: parsed.title,
        expectedPath,
        source,
      };
      const key = `${item.id}|${item.expectedPath}`;
      if (!missingCGKeys.has(key)) {
        missingCGKeys.add(key);
        missingCGs.push(item);
      }
    }
  }

  return { missingCharacters, missingCGs };
}

async function repairWorld(worldId: string, dryRun: boolean): Promise<void> {
  const worldPaths = createWorldPaths(worldId);
  if (!fs.existsSync(worldPaths.baseDir)) {
    throw new Error(`世界目录不存在: ${worldPaths.baseDir}`);
  }
  if (!fs.existsSync(worldPaths.worldConfigPath)) {
    throw new Error(`world.json 不存在: ${worldPaths.worldConfigPath}`);
  }

  const world = JSON.parse(fs.readFileSync(worldPaths.worldConfigPath, "utf-8")) as WorldConfigLite;
  const { missingCharacters, missingCGs } = inspectMissingResources(worldPaths.baseDir, world);

  console.log(`\n🔍 Repair World: ${worldId}`);
  console.log(`   标题: ${world.game.title}`);
  console.log(`   缺失角色资源: ${missingCharacters.length}`);
  console.log(`   缺失 CG 资源: ${missingCGs.length}`);

  if (missingCharacters.length === 0 && missingCGs.length === 0) {
    console.log("✅ 未发现缺失资源，无需修复");
    return;
  }

  if (dryRun) {
    console.log("\n🧪 dry-run 模式，仅展示缺失项：");
    for (const c of missingCharacters) {
      console.log(` - [角色] ${c.name} (${c.charId}) 缺失 ${c.missingPaths.length} 个文件`);
    }
    for (const cg of missingCGs) {
      console.log(` - [CG] ${cg.id} (${cg.source || "unknown source"}) 缺失: ${cg.expectedPath}`);
    }
    return;
  }

  // 修复角色（按角色粒度整组重生）
  for (const c of missingCharacters) {
    console.log(`\n👤 修复角色资产: ${c.name} (${c.charId})`);
    const descPath = path.join(worldPaths.storyCharactersDir, `character_${c.name}.txt`);
    const input = parseCharacterDescription(descPath, c.name);
    const result = await generateCharacterSprite(input, { outputDir: worldPaths.charactersDir });
    if (!result.success) {
      console.log(`   ❌ 角色修复失败: ${result.error}`);
    } else {
      console.log("   ✅ 角色修复完成");
    }
  }

  // 修复 CG（按缺失条目逐个重生）
  const routeCharFolder = getRouteToCharacterFolderMap(world);
  for (const cg of missingCGs) {
    console.log(`\n🎨 修复 CG: ${cg.id}`);
    if (!cg.source) {
      console.log("   ❌ 无法映射 source，跳过");
      continue;
    }

    const settingsFile = settingsPathFromSource(worldPaths.storyDir, cg.source);
    if (!fs.existsSync(settingsFile)) {
      console.log(`   ❌ settings 不存在，跳过: ${settingsFile}`);
      continue;
    }

    let characterSpritePath: string | undefined;
    const routeMatch = cg.source.match(/^chapter[23]_route_([abc])$/);
    if (routeMatch) {
      // chapter2 或 chapter3，使用对应路线的角色
      const route = routeMatch[1] as RouteLetter;
      const folder = routeCharFolder[route];
      const sprite = path.join(worldPaths.baseDir, folder, "nobg", "polished_sprite.png");
      if (fs.existsSync(sprite)) {
        characterSpritePath = sprite;
      }
    } else if (cg.source === "chapter1") {
      // chapter1 使用路线 A 的角色作为参考图
      const folder = routeCharFolder.a;
      const sprite = path.join(worldPaths.baseDir, folder, "nobg", "polished_sprite.png");
      if (fs.existsSync(sprite)) {
        characterSpritePath = sprite;
      }
    }

    const result = await generateCG(
      {
        source: cg.source,
        settingsFile,
        sceneDescription: "",
        characterDescription: "",
        cgName: cg.id,
        cgTitle: cg.title,
        characterSpritePath,
      },
      { outputDir: worldPaths.cgDir }
    );
    if (!result.success) {
      console.log(`   ❌ CG 修复失败: ${result.error}`);
    } else {
      console.log("   ✅ CG 修复完成");
    }
  }

  const post = inspectMissingResources(worldPaths.baseDir, world);
  console.log("\n📊 修复后检查：");
  console.log(`   缺失角色资源: ${post.missingCharacters.length}`);
  console.log(`   缺失 CG 资源: ${post.missingCGs.length}`);
}

async function main(): Promise<void> {
  const { worldId, dryRun } = parseArgs(process.argv.slice(2));
  if (!worldId) {
    console.log(`
World 资产修复脚本

用法:
  npx tsx src/agents/repair-world.ts --world-id <world_id>
  npx tsx src/agents/repair-world.ts --world-id <world_id> --dry-run
`);
    process.exit(1);
  }
  await repairWorld(worldId, dryRun);
}

main().catch(err => {
  console.error("❌ repair-world 执行失败:", err);
  process.exit(1);
});

