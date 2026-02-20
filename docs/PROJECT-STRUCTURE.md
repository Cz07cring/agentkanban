# Agent Kanban - 项目结构

## 仓库目录

```
agentkanban/
├── backend/                    # FastAPI 后端
│   ├── main.py                # API 端点 + WebSocket
│   ├── dispatcher.py          # Ralph Loop 任务调度器
│   ├── engine_manager.py      # 引擎健康检查 + 故障转移
│   ├── review_manager.py      # 对抗式审查逻辑
│   ├── models.py              # Pydantic 数据模型
│   ├── config.py              # 配置管理
│   ├── notification.py        # Web Push 通知
│   ├── requirements.txt       # Python 依赖
│   └── data/
│       ├── dev-tasks.json     # 任务队列（基于文件存储）
│       └── dev-task.lock      # 并发访问锁
├── frontend/                   # Next.js 15 + React 19
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx     # 根布局（PWA 元数据）
│   │   │   ├── page.tsx       # 主看板页面
│   │   │   └── globals.css    # Tailwind CSS
│   │   ├── components/
│   │   │   ├── KanbanBoard.tsx       # 7 列看板
│   │   │   ├── TaskCard.tsx          # 任务卡片
│   │   │   ├── TaskCreateForm.tsx    # 任务输入 + 语音
│   │   │   ├── TaskDetailPanel.tsx   # 任务详情 + 审查
│   │   │   ├── StatsBar.tsx          # 统计面板
│   │   │   ├── VoiceInput.tsx        # 语音输入组件
│   │   │   ├── WorkerDashboard.tsx   # Worker 监控
│   │   │   └── EngineStatus.tsx      # 引擎健康状态
│   │   └── lib/
│   │       ├── api.ts          # REST + WebSocket 客户端
│   │       ├── types.ts        # TypeScript 类型定义
│   │       ├── speech.ts       # 语音识别
│   │       └── mock-data.ts    # 模拟数据
│   ├── public/
│   │   ├── manifest.json      # PWA 清单
│   │   ├── sw.js              # Service Worker
│   │   └── icons/             # PWA 图标
│   └── next.config.ts         # API 代理重写
├── deploy/                     # 部署配置
│   ├── docker-compose.yml
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   ├── nginx.conf
│   ├── backup.sh
│   └── systemd/
│       ├── agent-kanban-dispatcher.service
│       └── agent-kanban-web.service
├── docs/                       # 项目文档
│   ├── PROJECT-STRUCTURE.md
│   └── SETUP-GUIDE.md
├── dev.sh                      # 一键启动开发环境
├── CLAUDE.md                   # Claude Worker 配置
├── codex.md                    # Codex Worker 配置
├── PROGRESS.md                 # 经验日志
└── SYSTEM.md                   # 系统设计文档
```

## 服务器部署结构

```
/opt/agentkanban/                    # 系统安装目录
├── main-repo/                       # 主仓库
├── worktrees/                       # Worker 隔离工作树
│   ├── worker-0/                    # Claude Worker 0
│   ├── worker-1/                    # Claude Worker 1
│   ├── worker-2/                    # Claude Worker 2
│   ├── worker-3/                    # Codex Worker 3
│   └── worker-4/                    # Codex Worker 4
├── backups/                         # 自动备份
└── logs/                            # 应用日志

/opt/projects/                       # 托管项目（按类别）
├── web/                             # Web 项目
├── api/                             # API/后端项目
├── mobile/                          # 移动端项目
├── lib/                             # 库/包项目
├── infra/                           # 基础设施项目
└── data/                            # 数据/ML 项目
```

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端 | Next.js | 15.x |
| UI 框架 | React | 19.x |
| 样式 | Tailwind CSS | 4.x |
| 后端 | FastAPI | 0.115 |
| 语言 | Python | 3.11+ |
| 存储 | 基于文件的 JSON | - |
| 实时通信 | WebSocket | - |
| 容器 | Docker | - |
| 反向代理 | Nginx | - |
