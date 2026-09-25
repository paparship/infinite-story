/**
 * 回译脚本 - 将英文剧本翻译回中文
 * 用法: npx tsx src/agents/back-translate.ts --world-id <world_id>
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { HumanMessage } from "@langchain/core/messages";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ 配置 ============
const configPath = path.join(__dirname, "config/api-config.json");
const API_CONFIG = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const VERTEX_CONFIG = {
  project: API_CONFIG["vertex-chat"].api_key,
  location: API_CONFIG["vertex-chat"].location,
};

const CREDENTIALS_PATH = "/path/to/local-resource";
process.env.GOOGLE_APPLICATION_CREDENTIALS = CREDENTIALS_PATH;

const TEXT_MODEL_VERTEX = "gemini-3-pro-preview";

function createTextModel(options: { temperature?: number; maxOutputTokens?: number } = {}) {
  const { temperature = 0.3, maxOutputTokens = 8192 } = options;
  
  console.log(`   📡 使用 Vertex AI (${TEXT_MODEL_VERTEX})`);
  return new ChatVertexAI({
    model: TEXT_MODEL_VERTEX,
    location: VERTEX_CONFIG.location,
    temperature,
    maxOutputTokens,
  });
}

// 回译prompt模板
const BACK_TRANSLATE_PROMPT = `现在，我需要将以下剧本内容翻译成【简体中文】。
请将下文中的英文剧本内容翻译成简体中文。

【重要】翻译时必须严格保留以下内容，不得修改：

1. 所有 @ 开头的英文指令（如 @bg, @char, @cg, @effect, @shake, @end_chapter, @end_game, @hide 等）
2. 所有【】标记必须保持原样：
   - 【章节标题】【对话】【旁白】【系统】【选项】【关键选择】
   - 【背景】【角色】【特效】【震动】【CG】【章节结束】
3. 引号格式必须保持 「」 不变（不要改成 ""、'' 或其他引号）
4. 选项格式 "1. 「文本」（提示）" 中的数字序号和格式结构
5. @ 指令的参数（如角色名、背景ID、表情名等保持原样）

【只翻译】以下内容：
- 对话文本（「」内的内容）
- 旁白文本（（）内的内容）
- 系统提示文本
- 章节标题文本
- 选项文本和括号内的提示
- @game_title 后的标题

【禁止】：
- 禁止添加任何原文中不存在的内容
- 禁止添加场景描述（Scene description）、注释或解释
- 禁止修改脚本结构或添加新行
- 输出必须与输入行数完全一致

需要翻译的内容：
{{CONTENT}}
`;

async function translateContent(content: string, label: string): Promise<string> {
  const prompt = BACK_TRANSLATE_PROMPT.replace("{{CONTENT}}", content);
  
  const model = createTextModel({ temperature: 0.3, maxOutputTokens: 8192 });
  
  console.log(`   ⏳ 回译 ${label}...`);
  const startTime = Date.now();
  
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 5000;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await model.invoke([
        new HumanMessage(prompt),
      ]);
      
      if (!response || !response.content) {
        if (attempt < MAX_RETRIES) {
          console.warn(`   ⚠️ ${label} 返回空内容，${RETRY_DELAY/1000}秒后重试 (${attempt}/${MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          continue;
        }
        console.warn(`   ⚠️ ${label} 回译返回空内容，使用原文`);
        return content;
      }
      
      const result = response.content as string;
      const endTime = Date.now();
      
      console.log(`   ✅ ${label} 回译完成 (${((endTime - startTime) / 1000).toFixed(1)}s, ${result.length} 字符)`);
      
      return result;
    } catch (error: any) {
      const errorMsg = error?.message || String(error) || "未知错误";
      
      if (attempt < MAX_RETRIES) {
        console.warn(`   ⚠️ ${label} 回译失败: ${errorMsg}，${RETRY_DELAY/1000}秒后重试 (${attempt}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        continue;
      }
      
      console.error(`   ❌ ${label} 回译失败（已重试${MAX_RETRIES}次）: ${errorMsg}，使用原文`);
      return content;
    }
  }
  
  return content;
}

async function backTranslateWorld(worldId: string) {
  const assetsDir = path.resolve(__dirname, "../..", "assets/worlds", worldId);
  const storyDir = path.join(assetsDir, "story");
  const outputDir = path.join(assetsDir, "story_zh"); // 输出到新目录，不覆盖原文件
  
  if (!fs.existsSync(storyDir)) {
    console.error(`❌ 故事目录不存在: ${storyDir}`);
    process.exit(1);
  }
  
  // 创建输出目录
  fs.mkdirSync(outputDir, { recursive: true });
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    剧本回译工具                             ║
╚════════════════════════════════════════════════════════════╝

🌍 世界 ID: ${worldId}
📁 输入目录: ${storyDir}
📁 输出目录: ${outputDir}
`);

  // 需要翻译的文件列表
  const filesToTranslate = [
    "chapter1.txt",
    "route_a/chapter2.txt",
    "route_a/chapter3.txt",
    "route_b/chapter2.txt",
    "route_b/chapter3.txt",
    "route_c/chapter2.txt",
    "route_c/chapter3.txt",
  ];
  
  let successCount = 0;
  let failCount = 0;
  
  for (const relativePath of filesToTranslate) {
    const inputPath = path.join(storyDir, relativePath);
    const outputPath = path.join(outputDir, relativePath);
    
    if (!fs.existsSync(inputPath)) {
      console.log(`   ⏭️ 跳过（不存在）: ${relativePath}`);
      continue;
    }
    
    // 创建输出子目录
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    
    const content = fs.readFileSync(inputPath, "utf-8");
    const translated = await translateContent(content, relativePath);
    
    fs.writeFileSync(outputPath, translated, "utf-8");
    successCount++;
    
    console.log(`   📝 已保存: ${relativePath}`);
  }
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    回译完成报告                             ║
╚════════════════════════════════════════════════════════════╝

📊 统计:
   ✅ 成功: ${successCount}
   ❌ 失败: ${failCount}

📁 输出目录: ${outputDir}
`);
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  let worldId = "";
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--world-id" && args[i + 1]) {
      worldId = args[i + 1];
      break;
    }
  }
  
  if (!worldId) {
    console.log(`
用法: npx tsx src/agents/back-translate.ts --world-id <world_id>

示例:
  npx tsx src/agents/back-translate.ts --world-id world_1770987704979_rowimx2z
`);
    process.exit(1);
  }
  
  await backTranslateWorld(worldId);
}

main().catch(console.error);
