# Repository Guidelines

饭饭 · 今天吃啥（fanfan-web）：单文件、纯前端的「今天吃什么」智能体。无框架、无构建、无外链，手机浏览器直接打开 `index.html` 就能用。

> 接手这个项目（尤其是新开会话）请先读 `交接.md`：当前进度、发版流程、环境约束、待办都在里面。

## Project Structure & Module Organization（项目结构）

- `index.html` — **唯一正本**（约 5900 行）：知识库、算法引擎、Agent 工具层、全部 UI 都在里面。改代码只改这个文件。
- `今天吃啥.html` — `index.html` 的逐字节副本，方便直接发微信；改完正本必须同步。
- `data/shops.json` — 采集到的店铺与菜单，**严格 JSON**（不能写注释、不能多逗号）；`新菜记录.json`、`新菜候选.json` 是入库流水账。
- `商家数据库/` — 用户拍的菜单照片（`.jpg/.png` 已被 `.gitignore` 忽略）+ `解析结果/`（要入库）。
- `开发脚本/` — 零依赖 Node ESM 脚本，测试与数据流水线都在这。
- `备用-不含密钥版/`、`分享给朋友/` — 生成物，不要手改。

主程序关键锚点（行号会漂移，用函数名检索）：`DISHES`、`RESTAURANTS`/`SHOP_DB_BUILTIN`、`CITIES`、`DEFAULT_AMAP_KEY`/`DEFAULT_KEY`、`buildCombo`、`renderResult`、`AGENT_TOOLS`、`llmChat`、`agentRun`、`runAgentFlow`。架构上有两条决策链：**算法引擎**（本地打分，离线可用）与 **Agent 模式**（大模型调 12 个工具决策，默认开启，无网/无 Key/失败时自动回退算法引擎）。

## Build, Test, and Development Commands

没有构建步骤、没有 `package.json`、没有 npm 依赖。开发脚本需要 Node，第一个参数是 HTML 路径：

```bash
node 开发脚本/check-syntax.mjs index.html      # 语法 + DOM id + 重复 id（每次必跑）
node 开发脚本/check-structure.mjs index.html   # 标签闭合、手机适配、无外链
node 开发脚本/test-combo.mjs index.html        # 一桌菜组合逻辑
node 开发脚本/test-agent.mjs index.html        # Agent 循环断言 + 真跑
node 开发脚本/smoke-ui.mjs index.html          # 完整交互回归（约 90 秒）
```

改完 `index.html` 后：同步 `今天吃啥.html` 与 `分享给朋友\` 下的两份副本（共 4 个文件），再按正则清空两个 Key 重新生成 `备用-不含密钥版\`。推送用 `开发脚本/push-via-api.mjs`（github.com:443 常被重置，普通 `git push` 会失败），推完轮询 Pages 直到新标记出现。

## Coding Style & Naming Conventions

- 全部代码写在单个内嵌 `<script>` 里；2 空格缩进、语句带分号，JS 字符串用单引号（双引号留给 HTML 属性）。
- 命名：函数与变量 `camelCase`（`scoreRestaurant`、`pickAnchors`），常量与数据表 `SCREAMING_SNAKE_CASE`（`DISHES`、`AGENT_TOOLS`、`CITIES`）。
- 注释和界面文案一律中文，注释解释「为什么」（例：`/* 产品里的离线店库已经清空…… */`）。
- 不引入新的外部资源（CDN、字体、JS 库），会破坏离线能力。

## Testing Guidelines

- 脚本命名即用途：`check-*.mjs` 静态体检，`test-*.mjs` 断言回归，`e2e-*.mjs` 真连高德/DeepSeek（慢、受网络影响），`debug-*`/`probe-*` 为一次性排查工具。
- 断言失败请用 `console.error` + `process.exit(1)`，成功打印明确结论。
- `smoke-ui.mjs` 里固定 `state.settings.agent='off'` 是刻意的：否则默认 Agent 会真连大模型，测试变成随机结果，不要改回去。
- 新增规则时同时更新对应的 `test-*.mjs` 场景，不要只改主程序。

## Commit & Pull Request Guidelines

- 提交信息为**单行中文**，无 `feat:`/`fix:` 前缀；多个改动用 `；` 分隔，并说明修掉了什么（例：`默认改为 Agent 模式……；修掉需求里预算上限与闸门口径不一致导致 agent 空烧步数的 bug`）。
- 提交前至少跑 `check-syntax` + 受影响的 `test-*`。
- 本项目以直接推送 `main` 为主；若开 PR，请写清改动范围、跑过哪些脚本、UI 改动附手机截图，并注明是否重新生成了 `备用-不含密钥版\`。

## Security & Configuration Tips

`DEFAULT_AMAP_KEY`（高德 Web 服务 Key）与 `DEFAULT_KEY`（DeepSeek）明文写在 `index.html` 里，是仓库主的明确选择——公开链接共用同一份额度。不要在日志、截图或 issue 里再贴别的 Key；对外分享用「备用-不含密钥版」。菜单照片留在本机，`解析结果\` 的 JSON 要提交，保证可追溯。
