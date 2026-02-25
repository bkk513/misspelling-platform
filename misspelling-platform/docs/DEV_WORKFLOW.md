# DEV Workflow (v1 / Milestone 0 baseline)

## 1. 仓库与路径约定

- 外层目录是 Git 仓库根：`C:\Users\Administrator\Desktop\misspelling-platform`
- 内层目录 `misspelling-platform/` 才是实际项目根（包含 `docker-compose.yml`、`backend/`）
- v1 阶段所有代码、脚本、文档都放在内层项目根下
- 外层目录只保留 Git 元数据和少量说明（如有）

## 2. 分支保护规则（必须遵守）

- `main` 已启用 branch protection，禁止直接 push/merge 到 `main`
- 仅允许在工作分支 `codex/scaffold-v2-2026-02-25` 上开发、提交、推送
- 禁止 `checkout main` 做开发
- 禁止绕过保护直接修改 `main`
- 每个 milestone 完成后通过 PR 交付，由用户审核合并

## 3. 每次提交的标准流程（小步可回滚）

- 单次 commit 改动控制在：`<= 10 文件` 或 `<= 300 行`
- 先改代码，再运行验收脚本：`misspelling-platform/scripts/check.ps1`
- 验收通过后再执行 `git add` / `git commit`
- 提交后立即 push 到工作分支
- 任一验收失败：优先回退到上一个通过的 commit，再修复

推荐节奏（每次 commit）：

1. 修改少量文件（保持可运行）
2. 运行 `.\misspelling-platform\scripts\check.ps1`
3. 确认通过
4. `git add <files>`
5. `git commit -m "<message>"`
6. `git push origin codex/scaffold-v2-2026-02-25`

## 4. 验收脚本运行方式（可从任意目录执行）

`misspelling-platform/scripts/check.ps1` 脚本内部会执行：

```powershell
Set-Location (Split-Path $PSScriptRoot -Parent)
```

因此可从任意目录运行。

### 从外层仓库根运行（推荐）

```powershell
powershell -ExecutionPolicy Bypass -File .\misspelling-platform\scripts\check.ps1
```

### 从内层项目根运行

```powershell
Set-Location .\misspelling-platform
powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1
```

### 成功/失败约定

- 成功：退出码 `0`
- 失败：退出码 `1`
- 输出会包含 `[PASS]` / `[FAIL]` 摘要，供 PR 描述复用

## 5. 回滚策略（代码回滚 != 数据回滚）

### 代码回滚（首选）

- 优先使用 `git revert <commit>` 回滚问题提交（保留历史）
- 仅在 `codex/scaffold-v2-2026-02-25` 分支允许重写历史（如确有必要）
- 若需要 `force push`，仅限工作分支，且先与用户确认
- 绝不对 `main` 执行 `force push`

### 数据回滚（与 Git 无关）

- Git 回滚不会自动回滚 MySQL 数据、任务状态、产物文件
- `docker compose down -v` 会清空卷（包括 MySQL 数据和 outputs 产物）
- 执行 `docker compose down -v` 前必须确认数据可丢弃

示例（清空本地数据，慎用）：

```powershell
Set-Location .\misspelling-platform
docker compose down -v
```

## 6. 常见失败与处理

### Docker daemon 未启动

- 现象：`docker info` 或 `docker compose up` 失败
- 处理：先启动 Docker Desktop，等待 engine 就绪，再重试 `check.ps1`

### 端口冲突（8000 / 3306 / 6379）

- 现象：容器启动失败或端口绑定失败
- 处理：停止占用进程，或调整本机端口后再验收（需同步更新文档）

### MySQL 首次启动较慢

- 现象：`/health` 长时间未返回 `db:true`
- 处理：等待 `mysql` healthcheck 通过；必要时查看 `docker compose logs mysql`

### `tasks` 表缺失

- 现象：任务创建接口报表不存在
- 处理：M0 的 `check.ps1` 已内置 `CREATE TABLE IF NOT EXISTS tasks` 临时兜底
- 说明：正式迁移/建表在后续里程碑（M2）落地

### 任务未完成 / 一直非 SUCCESS

- 常见原因：
- worker 未启动或重启中
- worker 数据库连接错误
- Celery broker/result backend 连接异常
- 处理：
- `docker compose ps`
- `docker compose logs api`
- `docker compose logs worker`

## 7. PR 提交流程（无 gh CLI）

本机当前未安装 `gh`，采用 GitHub 网页流程。

1. 推送分支：

```powershell
git push origin codex/scaffold-v2-2026-02-25
```

2. 打开 GitHub 仓库的 Compare / Pull Request 页面（网页）
3. 目标分支选择 `main`
4. 提交 PR，由用户审核合并

### PR 描述必须包含

- 完成内容列表（本次 milestone 做了什么）
- `.\scripts\check.ps1` 输出摘要（必须成功）
- 当前 DB 表数量（`M2+` 开始固定提供 `SHOW TABLES` 统计）
- 关键页面截图（前端阶段可选）

## 8. M0 特别说明（当前阶段）

- `scripts/check.ps1` 会临时 bootstrap `tasks` 表，仅用于验收兜底
- 该方案不替代正式迁移脚本
- 后续 M1+ 继续沿用“小步快跑 + 每步验收 + 文档同步”的方式推进
