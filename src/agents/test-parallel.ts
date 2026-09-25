/**
 * 并行测试脚本 - 同时运行多个生成管线
 * 用于验证并发生成的稳定性
 */

import { runMasterWorkflow, MasterWorkflowResult } from "./workflow-master.js";

const PARALLEL_COUNT = 3; // 可调整并行数量

async function runParallelTest() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║          并行生成测试 - ${PARALLEL_COUNT}个实例同时运行                      ║
╚════════════════════════════════════════════════════════════╝
`);

  const startTime = Date.now();
  
  // 并行启动管线
  const tasks = Array.from({ length: PARALLEL_COUNT }, (_, i) =>
    runMasterWorkflow().then(r => ({ id: i + 1, ...r }))
  );
  
  console.log(`🚀 已启动 ${PARALLEL_COUNT} 个并行任务...\n`);
  
  // 等待所有完成
  const results = await Promise.allSettled(tasks);
  
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000 / 60).toFixed(1);
  
  // 统计结果
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    并行测试结果                              ║
╚════════════════════════════════════════════════════════════╝

⏱️  总耗时: ${duration} 分钟
`);

  let successCount = 0;
  let failCount = 0;
  
  results.forEach((result, index) => {
    const taskId = index + 1;
    
    if (result.status === "fulfilled") {
      const r = result.value as MasterWorkflowResult & { id: number };
      if (r.success) {
        successCount++;
        console.log(`✅ 任务 ${taskId}: 成功`);
        console.log(`   世界ID: ${r.worldId}`);
        console.log(`   路径: ${r.worldPath}`);
      } else {
        failCount++;
        console.log(`❌ 任务 ${taskId}: 失败`);
        console.log(`   错误: ${r.error}`);
      }
    } else {
      failCount++;
      console.log(`❌ 任务 ${taskId}: 异常`);
      console.log(`   错误: ${result.reason}`);
    }
    console.log();
  });
  
  console.log(`
────────────────────────────────────────────────────────────
📊 统计: ${successCount}/${PARALLEL_COUNT} 成功, ${failCount}/${PARALLEL_COUNT} 失败
────────────────────────────────────────────────────────────
`);
}

runParallelTest().catch(console.error);
