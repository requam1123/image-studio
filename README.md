# AI Image Studio

AI 图片生成与编辑工具。基于 Next.js 16 + React + TypeScript + SQLite。

**功能亮点：**
- 多张图片同时生成，逐张增量展示（不等全部完成）
- 图生图编辑（上传图片 + 文字描述修改）
- 异步任务队列：提交即返回，后台处理，前端轮询出图
- 切页面 / 锁屏 / 刷新不丢进度
- 历史记录管理（侧面板 + 最近记录），支持缩略图
- API Key 轮转：多 Key 自动切换，均摊消耗
- 多用户登录（与 nginx htpasswd 共用密码）
- 响应式设计，支持移动端保存到相册

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入 API Key 和 JWT 密钥

# 3. 初始化数据库（首次运行自动创建）
npm run dev

# 4. 打开 http://localhost:3000
```

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 16 (App Router) |
| 语言 | TypeScript |
| 样式 | Tailwind CSS v4 |
| 数据库 | SQLite (better-sqlite3) |
| 认证 | JWT (jose) + httpOnly Cookie |
| 图片处理 | sharp (缩略图生成) |
| 图标 | lucide-react |
| 部署 | PM2 + rsync |

## 配置

### 环境变量

| 变量 | 说明 | 必填 |
|---|---|---|
| `API_KEY` | 上游 API Key（多 Key 用换行分隔） | 是 |
| `API_BASE_URL` | 上游 API 地址 | 否 |
| `JWT_SECRET` | JWT 签名密钥（`openssl rand -hex 32` 生成） | 是 |
| `PORT` | 服务端口，默认 3000 | 否 |

### 认证

默认使用 nginx htpasswd 格式的密码文件进行登录验证。
如需自定义认证方式，修改 `lib/htpasswd.ts` 中的 `HTPASSWD_PATH`。

登录后通过 httpOnly Cookie 携带 JWT，30 天免登录。

## 项目结构

```
app/
  api/            # API 路由（tasks / history / auth / users）
  page.tsx        # 主页面
  login/          # 登录页
components/
  ImageGenerator  # 图片生成 Tab
  ImageEditor     # 图片编辑 Tab
  HistoryPanel    # 历史记录侧面板
  RecentResults   # 最近 5 条记录
  ImagePreview    # 大图预览弹窗
  ApiSettings     # API 配置弹窗
lib/
  db.ts           # 数据库初始化 & SQL 快捷操作
  auth.ts         # JWT 签发/验证
  api.ts          # 前端工具函数
  history.ts      # 历史记录 API 封装
```

## API 一览

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/tasks` | POST | 创建图片生成/编辑任务 |
| `/api/tasks` | GET | 当前用户最近的任务列表 |
| `/api/tasks/[id]` | GET | 轮询任务状态（含结果） |
| `/api/history` | GET/POST/DELETE | 历史记录 CRUD |
| `/api/auth/login` | POST | 登录认证 |
| `/api/users` | GET/PATCH | 用户 API 配置管理 |

## 测试

```bash
npm test           # 跑一次
npm run test:watch # 持续监听
```

## 部署

```bash
npm run build
npm start
```

生产环境推荐使用 PM2：
```bash
npm install -g pm2
pm2 start npm --name "image-app" -- start
```

## License

MIT
