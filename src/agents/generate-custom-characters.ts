/**
 * 临时脚本：生成自定义角色立绘
 */

import { generateCharacterSprite, type CharacterInput } from "./character-sprite-agent.js";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 输出目录
const OUTPUT_DIR = path.resolve(__dirname, "../../_temp_characters");

// 自定义角色列表
const CHARACTERS: { name: string; input: CharacterInput }[] = [
  {
    name: "真白_mashiro",
    input: {
      worldSetting: "modern japanese high school, spring season, cherry blossoms",
      appearance: "17 years old girl, long silver-white hair with straight bangs, long side hair falling down, golden amber eyes, fair pale skin, light pink blush on cheeks, elegant graceful expression",
      outfit: "blue school uniform, white shirt, gold ribbon bow tie, pleated skirt, neat and refined appearance",
    },
  },
  {
    name: "林夏_natsuka",
    input: {
      worldSetting: "modern japanese high school, spring season, cherry blossoms",
      appearance: "17 years old girl, brown hair in side ponytail with red hair ribbon, red crimson eyes, cheerful energetic expression, athletic slim figure",
      outfit: "blue school uniform, white shirt, red ribbon bow tie, pleated skirt, sporty lively appearance",
    },
  },
  {
    name: "雾岛澪_mio",
    input: {
      worldSetting: "modern japanese high school, spring season, cherry blossoms",
      appearance: "17 years old girl, long dark blue-black hair with center parted long bangs, hair falling to waist, pale light blue eyes, very pale skin, mysterious cool expression",
      outfit: "blue school uniform, white shirt, light blue ribbon bow tie, pleated skirt, quiet mysterious appearance",
    },
  },
  {
    name: "小铃_suzu",
    input: {
      worldSetting: "modern japanese high school, spring season, cherry blossoms",
      appearance: "16 years old girl, short pink hair with cute short bangs, pink eyes, gold star-shaped hair clip, small flower hair accessories, bright cheerful smile, petite cute figure",
      outfit: "blue school uniform, white shirt, pink ribbon bow tie, pleated skirt, energetic kawaii appearance",
    },
  },
];

async function main() {
  console.log("🎨 开始生成自定义角色立绘");
  console.log(`📁 输出目录: ${OUTPUT_DIR}`);
  
  // 确保输出目录存在
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (let i = 0; i < CHARACTERS.length; i++) {
    const char = CHARACTERS[i];
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎭 [${i + 1}/${CHARACTERS.length}] 生成角色: ${char.name}`);
    console.log(`${"=".repeat(60)}`);
    console.log(`外貌: ${char.input.appearance}`);
    console.log(`服装: ${char.input.outfit}`);

    const charOutputDir = path.join(OUTPUT_DIR, char.name);
    
    try {
      const result = await generateCharacterSprite(char.input, {
        outputDir: charOutputDir,
        skipExpressions: false,
      });

      if (result.success) {
        console.log(`✅ ${char.name} 生成成功!`);
        console.log(`   立绘: ${result.spritePath}`);
        console.log(`   头像: ${result.portraitPath}`);
      } else {
        console.error(`❌ ${char.name} 生成失败: ${result.error}`);
      }
    } catch (error) {
      console.error(`❌ ${char.name} 生成异常:`, error);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("🎉 所有角色生成完成!");
  console.log(`📁 输出目录: ${OUTPUT_DIR}`);
}

main().catch(console.error);
