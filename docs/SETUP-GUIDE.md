# Agent Kanban - 部署指南

## 前置要求

- Python 3.11+
- Node.js 20+
- Git

## 快速启动（开发环境）

```bash
# 克隆并启动
git clone <repo-url> agentkanban
cd agentkanban
./dev.sh
```

启动后:
- 后端: http://localhost:8000 (FastAPI + Swagger 文档位于 /docs)
- 前端: http://localhost:3000 (Next.js 开发服务器)

## 手动配置

### 后端
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 前端
```bash
cd frontend
npm install
npm run dev
```

## Claude Code Worker 配置

### 安装 Claude Code CLI
```bash
# 通过 npm 安装
npm install -g @anthropic-ai/claude-code

# 验证
claude --version
```

### 配置 API 密钥
```bash
# 设置 API 密钥
export ANTHROPIC_API_KEY="sk-ant-..."

# 或添加到 ~/.bashrc / ~/.zshrc
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.zshrc
```

### Worker 执行模式
Worker 以非交互模式运行 Claude Code:
```bash
claude --dangerously-skip-permissions \
  --output-format json \
  -p "你的任务提示"
```

关键参数:
- `--dangerously-skip-permissions` — 跳过所有权限提示（自动化必需）
- `--output-format json` — 结构化 JSON 输出，便于解析
- `-p` — 直接传入提示（非交互模式）
- `--model` — 指定模型（默认: claude-sonnet-4-20250514）

## Codex CLI Worker 配置

### 安装 Codex CLI
```bash
# 通过 npm 安装
npm install -g @openai/codex

# 验证
codex --version
```

### 配置 API 密钥
```bash
export OPENAI_API_KEY="sk-..."
```

### Worker 执行模式
```bash
codex --approval-mode full-auto \
  --quiet \
  "审查这段代码的安全问题"
```

关键参数:
- `--approval-mode full-auto` — 自动批准所有操作
- `--quiet` — 最小化输出
- `--model` — 指定模型（默认: o4-mini）

## Git Worktree 配置（并行 Worker）

```bash
# 为每个 Worker 创建隔离的 worktree
cd /opt/agentkanban/main-repo
git worktree add ../worktrees/worker-0 -b worker-0
git worktree add ../worktrees/worker-1 -b worker-1
git worktree add ../worktrees/worker-2 -b worker-2
git worktree add ../worktrees/worker-3 -b worker-3
git worktree add ../worktrees/worker-4 -b worker-4
```

## 生产环境部署

### Docker
```bash
cd deploy
docker compose up -d
```

### Systemd（裸机部署）
```bash
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable agent-kanban-dispatcher agent-kanban-web
sudo systemctl start agent-kanban-dispatcher agent-kanban-web
```

### 自动备份
```bash
# 添加到 crontab（每 6 小时）
crontab -e
0 */6 * * * /opt/agentkanban/main-repo/deploy/backup.sh
```
