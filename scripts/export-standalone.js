#!/usr/bin/env node

/**
 * 独立版游戏导出脚本
 * 
 * 用法:
 *   node scripts/export-standalone.js --world=world_xxx --name=my_game
 *   node scripts/export-standalone.js --world=world_xxx --name=my_game --title="我的游戏"
 * 
 * 参数:
 *   --world    源世界 ID（位于 assets/worlds/ 下）
 *   --name     导出名称（用于输出目录和存档 key）
 *   --title    游戏标题（可选，覆盖 world.json 中的标题）
 *   --output   输出目录（默认为 exports/{name}）
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// 解析命令行参数
function parseArgs() {
  const args = {
    world: '',
    name: '',
    title: '',
    output: '',
  };
  
  process.argv.slice(2).forEach(arg => {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) {
      args[match[1]] = match[2];
    }
  });
  
  return args;
}

// 需要排除的文件模式
const EXCLUDE_PATTERNS = [
  /^log\.txt$/,        // 生成日志
  /^\.DS_Store$/,      // macOS 文件
  /^Thumbs\.db$/,      // Windows 缩略图
  /^\.git/,            // Git 文件
  /\.bak$/,            // 备份文件
];

// 按 script_format_v2 的背景枚举约束，仅保留这些背景图
// school_gate, classroom, hallway, rooftop, rooftop_sunset, park, library, cafe, street, courtyard
const REQUIRED_SHARED_BACKGROUND_FILES = [
  'backgrounds/exterior/_school_entrance_1.jpg',      // school_gate
  'backgrounds/interior/_back_of_classroom_1.jpg',    // classroom
  'backgrounds/interior/_2nd_floor_hallway_1.jpg',    // hallway
  'backgrounds/exterior/_school_rooftop_1.jpg',       // rooftop
  'backgrounds/exterior/_school_rooftop_2.jpg',       // rooftop_sunset
  'backgrounds/exterior/_park_in_spring_1.jpg',       // park
  'backgrounds/interior/_archive_room_1.jpg',         // library
  'backgrounds/interior/_cafe_1.jpg',                 // cafe
  'backgrounds/exterior/_shopping_street_3.jpg',      // street
  'backgrounds/exterior/_school_courtyard_bench_1.jpg', // courtyard
];

// 递归复制目录
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`❌ 源目录不存在: ${src}`);
    return false;
  }
  
  fs.mkdirSync(dest, { recursive: true });
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    // 检查是否需要排除
    const shouldExclude = EXCLUDE_PATTERNS.some(pattern => pattern.test(entry.name));
    if (shouldExclude) {
      continue;
    }
    
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  
  return true;
}

function copyRequiredSharedAssets(sharedSourceDir, sharedTargetDir) {
  fs.mkdirSync(sharedTargetDir, { recursive: true });
  let copied = 0;
  for (const relPath of REQUIRED_SHARED_BACKGROUND_FILES) {
    const srcPath = path.join(sharedSourceDir, relPath);
    const destPath = path.join(sharedTargetDir, relPath);
    if (!fs.existsSync(srcPath)) {
      console.warn(`   ⚠️ 缺少共享背景，已跳过: ${relPath}`);
      continue;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    copied++;
  }
  return copied;
}

// 主函数
async function main() {
  console.log('🎮 独立版游戏导出工具\n');
  
  const args = parseArgs();
  
  // 验证参数
  if (!args.world) {
    console.error('❌ 请指定源世界 ID: --world=world_xxx');
    console.log('\n可用的世界:');
    const worldsDir = path.join(projectRoot, 'assets/worlds');
    if (fs.existsSync(worldsDir)) {
      const worlds = fs.readdirSync(worldsDir).filter(f => 
        fs.statSync(path.join(worldsDir, f)).isDirectory() && f.startsWith('world_')
      );
      worlds.forEach(w => console.log(`  - ${w}`));
    }
    process.exit(1);
  }
  
  if (!args.name) {
    // 默认使用世界 ID 的后缀作为名称
    args.name = args.world.replace('world_', '').replace(/_/g, '-');
    console.log(`ℹ️  使用默认名称: ${args.name}`);
  }
  
  // 设置路径
  const sourceWorldDir = path.join(projectRoot, 'assets/worlds', args.world);
  const outputDir = args.output || path.join(projectRoot, 'exports', args.name);
  const distStandaloneDir = path.join(projectRoot, 'dist-standalone');
  
  // 验证源世界存在
  if (!fs.existsSync(sourceWorldDir)) {
    console.error(`❌ 源世界不存在: ${sourceWorldDir}`);
    process.exit(1);
  }
  
  const worldJsonPath = path.join(sourceWorldDir, 'world.json');
  if (!fs.existsSync(worldJsonPath)) {
    console.error(`❌ 世界配置文件不存在: ${worldJsonPath}`);
    process.exit(1);
  }
  
  console.log(`📦 导出配置:`);
  console.log(`   源世界: ${args.world}`);
  console.log(`   导出名称: ${args.name}`);
  console.log(`   输出目录: ${outputDir}`);
  console.log('');
  
  // Step 1: 更新配置文件
  console.log('📝 Step 1: 更新独立版配置...');
  const configPath = path.join(projectRoot, 'standalone/config.ts');
  let configContent = fs.readFileSync(configPath, 'utf-8');
  
  // 备份原配置
  const configBackup = configContent;
  
  // 更新配置
  configContent = configContent.replace(
    /worldPath: '[^']*'/,
    `worldPath: 'game'`
  );
  configContent = configContent.replace(
    /saveKeyPrefix: '[^']*'/,
    `saveKeyPrefix: '${args.name}_save'`
  );
  configContent = configContent.replace(
    /debug: (true|false)/,
    `debug: false`
  );
  
  fs.writeFileSync(configPath, configContent);
  console.log('   ✅ 配置已更新');
  
  // Step 2: 构建独立版
  console.log('\n🔨 Step 2: 构建独立版...');
  try {
    execSync('npm run build:standalone', {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    console.log('   ✅ 构建完成');
  } catch (error) {
    console.error('❌ 构建失败');
    // 恢复配置
    fs.writeFileSync(configPath, configBackup);
    process.exit(1);
  }
  
  // 恢复原配置（用于开发）
  fs.writeFileSync(configPath, configBackup);
  
  // Step 3: 准备输出目录
  console.log('\n📁 Step 3: 准备输出目录...');
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });
  
  // 复制构建产物
  copyDir(distStandaloneDir, outputDir);
  console.log('   ✅ 构建产物已复制');
  
  // Step 4: 复制世界资产
  console.log('\n🎨 Step 4: 复制世界资产...');
  const targetWorldDir = path.join(outputDir, 'assets/worlds/game');
  fs.mkdirSync(path.dirname(targetWorldDir), { recursive: true });
  
  if (!copyDir(sourceWorldDir, targetWorldDir)) {
    console.error('❌ 复制世界资产失败');
    process.exit(1);
  }
  console.log('   ✅ 世界资产已复制');
  
  // Step 4.5: 复制共享资源（背景等）
  console.log('\n🖼️  Step 4.5: 复制共享资源...');
  const sharedSourceDir = path.join(projectRoot, 'assets/shared');
  const sharedTargetDir = path.join(outputDir, 'assets/shared');
  
  if (fs.existsSync(sharedSourceDir)) {
    const copiedCount = copyRequiredSharedAssets(sharedSourceDir, sharedTargetDir);
    if (copiedCount <= 0) {
      console.error('❌ 未复制到任何共享背景资源');
      process.exit(1);
    }
    console.log(`   ✅ 共享资源已精简复制 (${copiedCount} 张背景图)`);
  } else {
    console.log('   ⚠️  未找到共享资源目录，跳过');
  }
  
  // Step 5: 处理 world.json
  console.log('\n📄 Step 5: 处理世界配置...');
  const targetWorldJsonPath = path.join(targetWorldDir, 'world.json');
  const worldConfig = JSON.parse(fs.readFileSync(targetWorldJsonPath, 'utf-8'));
  
  // 更新 UID 为 game
  worldConfig.uid = 'game';
  
  // 如果指定了标题，覆盖
  if (args.title) {
    worldConfig.game.title = args.title;
  }
  
  // 移除可能暴露的元数据
  delete worldConfig.generationParams?.theme;
  delete worldConfig.generationParams?.atmosphere;
  
  fs.writeFileSync(targetWorldJsonPath, JSON.stringify(worldConfig, null, 2));
  console.log('   ✅ 世界配置已处理');
  
  // Step 6: 重命名 HTML 文件
  console.log('\n📄 Step 6: 整理文件...');
  const standaloneHtml = path.join(outputDir, 'standalone.html');
  const indexHtml = path.join(outputDir, 'index.html');
  
  const gameTitle = worldConfig.game.title || '视觉小说';
  
  if (fs.existsSync(standaloneHtml)) {
    // 读取 standalone.html 内容
    let htmlContent = fs.readFileSync(standaloneHtml, 'utf-8');
    
    // 更新标题为游戏标题
    htmlContent = htmlContent.replace(/<title>[^<]*<\/title>/, `<title>${gameTitle}</title>`);
    
    // 写入 index.html
    fs.writeFileSync(indexHtml, htmlContent);
    fs.unlinkSync(standaloneHtml);
  }
  console.log('   ✅ 文件整理完成');
  
  // Step 7: 创建 npm 构建配置文件
  console.log('\n📦 Step 7: 创建 npm 构建配置...');
  
  // 创建 package.json
  const packageJson = {
    name: args.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
    version: '1.0.0',
    description: `${gameTitle} - 视觉小说游戏`,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build && mkdir -p dist/assets && cp -r assets/* dist/assets/',
      preview: 'vite preview',
      serve: 'vite preview --port 8080',
    },
    dependencies: {},
    devDependencies: {
      vite: '^5.2.0',
    },
  };
  fs.writeFileSync(
    path.join(outputDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );
  console.log('   ✅ package.json 已创建');
  
  // 创建 vite.config.js
  const viteConfig = `import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    open: true,
  },
  preview: {
    port: 8080,
    open: true,
  },
  build: {
    outDir: 'dist',
  },
});
`;
  fs.writeFileSync(path.join(outputDir, 'vite.config.js'), viteConfig);
  console.log('   ✅ vite.config.js 已创建');
  
  // 创建 README.md
  const readmeContent = `# ${gameTitle}

一款视觉小说游戏。

## 快速开始

### 方式一：使用 npm（推荐）

\`\`\`bash
# 安装依赖
npm install

# 开发模式运行（支持热更新）
npm run dev

# 或者直接预览
npm run serve
\`\`\`

浏览器会自动打开 http://localhost:3000（dev）或 http://localhost:8080（serve）

### 方式二：使用其他 HTTP 服务器

\`\`\`bash
# 使用 npx serve
npx serve .

# 或使用 Python
python3 -m http.server 8080
\`\`\`

然后在浏览器打开 http://localhost:8080

## 游戏操作

- **点击/空格**：推进对话
- **Ctrl**：快速跳过
- **ESC**：打开菜单

## 目录结构

\`\`\`
├── index.html          # 游戏入口
├── package.json        # npm 配置
├── vite.config.js      # Vite 配置
├── assets/
│   ├── main.js         # 游戏引擎
│   ├── shared/         # 共享资源
│   │   └── backgrounds/  # 背景图片
│   └── worlds/game/    # 游戏资源
│       ├── world.json  # 游戏配置
│       ├── story/      # 剧本文件
│       ├── characters/ # 角色立绘
│       └── cg/         # CG 图片
\`\`\`

## 系统要求

- Node.js 18+（如果使用 npm 运行）
- 现代浏览器（Chrome、Firefox、Edge、Safari）

Enjoy the game! 🎮
`;
  fs.writeFileSync(path.join(outputDir, 'README.md'), readmeContent);
  console.log('   ✅ README.md 已创建');
  
  // 完成
  console.log('\n✨ 导出完成！');
  console.log(`\n📦 输出目录: ${outputDir}`);
  console.log('\n目录结构:');
  console.log('  index.html          - 游戏入口');
  console.log('  package.json        - npm 配置');
  console.log('  vite.config.js      - Vite 配置');
  console.log('  README.md           - 说明文档');
  console.log('  assets/');
  console.log('    main.js           - 游戏代码');
  console.log('    worlds/game/      - 游戏资产');
  console.log('      world.json      - 世界配置');
  console.log('      story/          - 剧本文件');
  console.log('      characters/     - 角色立绘');
  console.log('      cg/             - CG 图片');
  
  console.log('\n💡 使用方法:');
  console.log('   cd ' + outputDir);
  console.log('   npm install');
  console.log('   npm run dev');
}

main().catch(console.error);
