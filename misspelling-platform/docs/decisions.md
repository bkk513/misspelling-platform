# decisions.md

## 2026-03-03: M13 算法模块服务化策略

### 决策

- 采用“内部重写 + 来源追溯”接入算法，不直接拷贝外部仓库大段实现。
- 在 `app/algos` 建立适配层，统一输入/输出 schema。
- 新增三类任务：`pcmci-causal`、`mrnmr-steady`、`deltaT-null`。
- 复用现有任务闭环（`tasks/task_events/task_artifacts`），不新增表。
- 默认降级策略：算法异常时 `SUCCESS + warnings + provenance.mode=stub`；仅 `ALGO_STRICT_MODE=true` 时转 `FAILURE`。

### 原因

- 外部仓库偏 notebook/脚本形态，不适合直接 import 到生产服务。
- 当前系统已有稳定任务与追溯链路，复用可降低改造风险。
- 验收脚本要求稳定，不能因外网或可选依赖抖动导致主流程失败。

### 替代方案

- 直接 vendor 外部仓库代码并调用：开发快，但后续维护、测试和授权风险更高。
- 完全严格失败策略：科研严谨，但会降低演示环境稳定性。

### 影响

- 当前实现可演示、可追溯、可扩展；
- 后续可在不改 API 契约的前提下替换更高精度算法内核。
