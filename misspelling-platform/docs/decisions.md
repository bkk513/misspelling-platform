# decisions.md

## 2026-03-03 M13 算法模块接入策略

- 背景：
  - 目标是在不破坏既有接口和验收脚本的前提下，接入 `pcmci-causal`、`mrnmr-steady`、`deltaT-null` 三类任务。
  - 外部仓库 `bkk513/misspelling_behaviors` 提供论文脚本，但不是可直接服务化的 Python 包。
- 决策：
  - 采用“论文等价重写 + 来源追溯”策略，不直接大段迁移外部脚本代码。
  - 新算法走 `app/algos` 适配层，统一输入输出 schema，并复用现有 `tasks/task_events/task_artifacts` 管道。
  - 依赖或数据失败默认降级为 `SUCCESS + provenance.mode=stub`，仅在 `ALGO_STRICT_MODE=true` 时返回 `FAILURE`。
- 原因：
  - 版权与可维护性风险可控。
  - 与当前分层结构一致，便于后续替换为更高精度实现。
  - 可保持 `scripts/check.ps1` 对外网依赖的稳健性。
- 影响：
  - M13 能交付可演示闭环，但结果精度需在后续论文对齐阶段持续校正。
  - SBS/Physarum 本轮不服务化，留在后续里程碑。

