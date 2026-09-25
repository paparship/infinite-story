/**
 * 世界生成服务器
 * 提供 API 接口供游戏前端调用，启动和监控世界生成进度
 */

import express from "express";
import cors from "cors";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.GENERATION_PORT || process.env.PORT || 3002);

app.use(cors());
app.use(express.json());

/** 生成任务状态 */
interface GenerationTask {
  worldId: string;
  status: "pending" | "generating" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  error?: string;
  process?: ChildProcess;
  logs: string[];
}

/** 活跃的生成任务 */
const activeTasks: Map<string, GenerationTask> = new Map();

/** 获取世界目录中已生成的资产 */
function getGeneratedAssets(worldId: string): { type: string; content: string; path?: string }[] {
  const worldDir = path.join(__dirname, "../../assets/worlds", worldId);
  const assets: { type: string; content: string; path?: string }[] = [];

  if (!fs.existsSync(worldDir)) {
    return assets;
  }

  // 检查角色文件
  const charactersDir = path.join(worldDir, "story/characters");
  if (fs.existsSync(charactersDir)) {
    const charFiles = fs.readdirSync(charactersDir).filter((f) => f.endsWith(".txt"));
    for (const file of charFiles.slice(0, 3)) {
      try {
        const content = fs.readFileSync(path.join(charactersDir, file), "utf-8");
        const lines = content.split("\n").filter((l) => l.trim()).slice(0, 5);
        assets.push({ type: "character", content: lines.join("\n") });
      } catch {}
    }
  }

  // 检查剧本文件
  const storyDir = path.join(worldDir, "story");
  if (fs.existsSync(storyDir)) {
    const scriptFiles = ["chapter1.txt", "route_a/chapter2.txt", "route_b/chapter2.txt"];
    for (const file of scriptFiles) {
      const filePath = path.join(storyDir, file);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          // 提取一些对话片段
          const dialogues = content
            .split("\n")
            .filter((l) => l.includes("「") && l.includes("」"))
            .slice(0, 3);
          if (dialogues.length > 0) {
            assets.push({ type: "dialogue", content: dialogues.join("\n") });
          }
        } catch {}
      }
    }
  }

  // 检查角色立绘
  const charImgDir = path.join(worldDir, "characters");
  if (fs.existsSync(charImgDir)) {
    const charFolders = fs.readdirSync(charImgDir);
    for (const char of charFolders.slice(0, 3)) {
      const defaultImg = path.join(charImgDir, char, "default.png");
      if (fs.existsSync(defaultImg)) {
        assets.push({
          type: "character_image",
          content: char,
          path: `/assets/worlds/${worldId}/characters/${char}/default.png`,
        });
      }
    }
  }

  // 检查 CG
  const cgDir = path.join(worldDir, "cg");
  if (fs.existsSync(cgDir)) {
    const cgFiles = fs.readdirSync(cgDir).filter((f) => f.endsWith(".png") || f.endsWith(".jpg"));
    for (const cg of cgFiles.slice(0, 3)) {
      assets.push({
        type: "cg",
        content: cg.replace(/\.(png|jpg)$/, ""),
        path: `/assets/worlds/${worldId}/cg/${cg}`,
      });
    }
  }

  return assets;
}

/** 启动生成世界 */
app.post("/api/generate-world", (req, res) => {
  const { effect, language } = req.body;

  console.log(`[GenerationServer] 收到生成请求: effect=${effect}, language=${language}`);

  // 生成世界 ID
  const worldId = `world_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

  // 创建任务
  const task: GenerationTask = {
    worldId,
    status: "generating",
    startedAt: new Date().toISOString(),
    logs: [],
  };

  // 启动生成进程
  const scriptPath = path.join(__dirname, "workflow-master.ts");
  const args = ["tsx", scriptPath, "--world-id", worldId];

  if (effect) args.push(`--effect=${effect}`);
  if (language) args.push(`--lang=${language}`);

  console.log(`[GenerationServer] 启动命令: npx ${args.join(" ")}`);

  const child = spawn("npx", args, {
    cwd: __dirname,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  task.process = child;

  // 收集输出
  child.stdout?.on("data", (data) => {
    const lines = data.toString().split("\n").filter((l: string) => l.trim());
    task.logs.push(...lines);

    // 只保留最近 100 行日志
    if (task.logs.length > 100) {
      task.logs = task.logs.slice(-100);
    }
  });

  child.stderr?.on("data", (data) => {
    const lines = data.toString().split("\n").filter((l: string) => l.trim());
    task.logs.push(...lines);

    if (task.logs.length > 100) {
      task.logs = task.logs.slice(-100);
    }
  });

  child.on("close", (code) => {
    if (code === 0) {
      task.status = "completed";
    } else {
      task.status = "failed";
      task.error = `进程退出码: ${code}`;
    }
    task.completedAt = new Date().toISOString();
    delete task.process;

    console.log(`[GenerationServer] 生成${task.status === "completed" ? "完成" : "失败"}: ${worldId}`);
  });

  activeTasks.set(worldId, task);

  res.json({
    success: true,
    worldId,
    message: "生成已启动",
  });
});

/** 获取生成状态 */
app.get("/api/generation-status/:worldId", (req, res) => {
  const { worldId } = req.params;
  const task = activeTasks.get(worldId);

  if (!task) {
    // 检查是否是已完成的世界
    const worldDir = path.join(__dirname, "../../assets/worlds", worldId);
    if (fs.existsSync(worldDir)) {
      return res.json({
        worldId,
        status: "completed",
        recentLogs: ["✅ 世界生成完成"],
      });
    }
    return res.status(404).json({ error: "任务不存在" });
  }

  res.json({
    worldId: task.worldId,
    status: task.status,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    error: task.error,
    recentLogs: task.logs.slice(-15),
  });
});

/** 获取生成预览（随机资产片段） */
app.get("/api/generation-preview/:worldId", (req, res) => {
  const { worldId } = req.params;
  const assets = getGeneratedAssets(worldId);

  // 随机选择一些资产
  const shuffled = assets.sort(() => Math.random() - 0.5);
  const preview = shuffled.slice(0, 3);

  res.json({
    worldId,
    assets: preview,
    totalAssets: assets.length,
  });
});

/** 健康检查 */
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    activeTasks: activeTasks.size,
    timestamp: new Date().toISOString(),
  });
});

/** 启动服务器 */
app.listen(PORT, () => {
  console.log(`\n🚀 世界生成服务器已启动`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   API:`);
  console.log(`     POST /api/generate-world - 启动生成`);
  console.log(`     GET  /api/generation-status/:worldId - 查询状态`);
  console.log(`     GET  /api/generation-preview/:worldId - 获取预览`);
  console.log(`     GET  /api/health - 健康检查\n`);
});
