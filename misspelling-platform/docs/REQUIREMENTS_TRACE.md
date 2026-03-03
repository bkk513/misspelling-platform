# REQUIREMENTS_TRACE.md

> 状态定义：`DONE` 已实现，`PARTIAL` 已有骨架待补全，`TODO` 未实现。

## M13 需求映射（算法服务化）

| 需求 | API | 任务类型 | 关键表 | 前端页面 | 状态 |
|---|---|---|---|---|---|
| 接入 PCMCI 因果分析 | `/api/tasks/pcmci-causal` | `pcmci-causal` | `tasks`, `task_events`, `task_artifacts` | `Causal Network` | TODO |
| 接入 MR/NMR 稳态分析 | `/api/tasks/mrnmr-steady` | `mrnmr-steady` | `tasks`, `task_events`, `task_artifacts` | `Steady State` | TODO |
| 接入 Δt 偏差分析 | `/api/tasks/deltaT-null` | `deltaT-null` | `tasks`, `task_events`, `task_artifacts` | `DeltaT Bias` | TODO |
| 统一算法输入（word/variants/time-window/corpus） | 以上 3 个接口 | 以上 3 个任务 | `tasks.params_json` | 3 个算法页参数面板 | TODO |
| 统一结果与追溯（summary/provenance/warnings） | `GET /api/tasks/{task_id}` | 全任务 | `tasks.result_json`, `audit_logs` | Task Detail 算法面板 | TODO |
| 复用产物下载链路 | `GET /api/files/{task_id}/{filename}` | 全任务 | `task_artifacts` | Task Detail / 算法页 | PARTIAL |
| fallback 可演示策略 | 任务创建 + 查询 | 全任务 | `tasks`, `audit_logs` | Task Detail warning 展示 | TODO |
| 验收脚本算法 smoke（非强制） | `scripts/check.ps1` | `pcmci-causal` | - | - | TODO |

## 已有能力（M13 前置）

| 能力 | 对应模块 | 状态 |
|---|---|---|
| 任务闭环（创建-执行-落库-查询-下载） | `routes_tasks.py`, `tasks/__init__.py` | DONE |
| 任务生命周期事件 | `task_events` + `task_event_service.py` | DONE |
| 产物落库与下载 | `artifact_service.py`, `/api/files/*` | DONE |
| GBNC 拉取与时序落库 | `gbnc_service.py`, `gbnc_data_service.py`, `time_series*` | DONE |
| 多租户 owner 过滤 | `task_service.py`, `timeseries_service.py` | DONE |

