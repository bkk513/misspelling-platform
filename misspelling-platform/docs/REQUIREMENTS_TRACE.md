# REQUIREMENTS_TRACE.md

状态定义：

- `DONE`: 已实现并可通过现有验收
- `PARTIAL`: 已有骨架但需增强
- `TODO`: 未实现

## M13 需求映射（算法服务化）

| 需求 | API | 任务类型 | 关键表 | 前端页面 | 状态 |
|---|---|---|---|---|---|
| 接入 PCMCI 因果分析 | `POST /api/tasks/pcmci-causal` | `pcmci-causal` | `tasks`, `task_events`, `task_artifacts` | `/app/causal-network` | DONE |
| 接入 MR/NMR 稳态分析 | `POST /api/tasks/mrnmr-steady` | `mrnmr-steady` | `tasks`, `task_events`, `task_artifacts` | `/app/steady-state` | DONE |
| 接入 Δt 偏差分析 | `POST /api/tasks/deltaT-null` | `deltaT-null` | `tasks`, `task_events`, `task_artifacts` | `/app/delta-t-bias` | DONE |
| 三任务统一输入基线（word/variants/time-window/corpus/smoothing） | 同上 | 同上 | `tasks.params_json` | 三个算法页面参数表单 | DONE |
| 统一输出 envelope（summary/provenance/artifacts/warnings） | `GET /api/tasks/{task_id}` | 同上 | `tasks.result_json` | `TaskDetail` 算法面板 | DONE |
| 产物下载复用旧链路 | `GET /api/files/{task_id}/{filename}` | 同上 | `task_artifacts` | `TaskDetail` 下载区 | DONE |
| fallback 可演示（stub + warning） | 同上 | 同上 | `tasks`, `task_events` | `TaskDetail` warnings | DONE |
| `check.ps1` 算法 smoke（非强制） | `scripts/check.ps1` | `pcmci-causal` | - | - | DONE |

## 前置能力复用（M13 依赖）

| 能力 | 位置 | 状态 |
|---|---|---|
| 任务闭环（创建-执行-落库-查询-下载） | `routes_tasks.py`, `tasks/__init__.py` | DONE |
| 生命周期事件追踪 | `task_events`, `task_event_service.py` | DONE |
| 产物落库与下载 | `artifact_service.py`, `/api/files/*` | DONE |
| GBNC 拉取与时序落库 | `gbnc_service.py`, `time_series*` | DONE |
| 多租户 owner 过滤 | `task_service.py`, `timeseries_service.py` | DONE |
