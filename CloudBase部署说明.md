# 用腾讯云 CloudBase（云开发）静态托管放「饭饭AI」前端

> **背景与结论（2026-10-04 实测后更新）**
>
> - GitHub Pages 国内经常打不开（要挂代理），**微信的抓取服务器也抓不到** → 微信里发链接没有卡片
> - 阿里云 FC / OSS 的**默认域名**：响应强制带 `Content-Disposition: attachment`（浏览器里 HTML 直接变下载）
> - 腾讯云 CloudBase 的**测试域名**：网页能打开（**国内直达**，首次会有一个「风险提醒」页，点「确定访问」即可，之后不再出现），
>   但响应同样带 `Content-Disposition: attachment`；**微信仍然不会生成链接卡片**（微信把它当下载文件）
>
> **所以这个方案的价值是「国内能直接打开」**（评委/同学不用翻墙），不是「微信卡片」。
> 想要微信链接卡片，只能绑定**自己的已备案域名**（绑境外节点可不备案）。不买域名的替代做法：分享时直接发一张
> 「图片 + 二维码」，不依赖微信抓取。
>
> 本文件记录的是**已经实际部署过**的那套流程（环境 ID `fanfan-web-d5gfiwvuoa71f8518`，
> 访问地址 `…tcloudbaseapp.com/fanfanweb1/`），需要更新内容时照下面操作即可。

---

## 第 0 步：先做 5 分钟验证（最重要，别跳过）

1. 打开 https://console.cloud.tencent.com/tcb → 用微信/QQ 登录并**实名**
2. **新建环境**：名称随便（比如 `fanfan-web`），计费方式选**按量计费**（有免费额度，我们这个体量基本花不到钱，具体以控制台为准）
3. 进入环境 → 左侧找到「**静态网站托管**」→ 首次进入点「**开通**」
4. 随便传一个 `test.html`，内容写 `<h1>测试</h1>`
5. 用控制台给的**默认域名**访问 `https://<默认域名>/test.html`

**结果判断**：

- ✅ **直接显示出「测试」两个字** → 这条路通了，继续第 1 步
- ❌ **弹出下载** → 说明它也有域名限制，停下告诉我，我们换方案

---

## 第 1 步：上传前端文件

用我给你的 `饭饭web-CloudBase静态包-20261004.zip`，**解压后把里面的东西直接传上去**（注意：不是把整个文件夹传上去，而是让 `index.html` 位于网站根目录）：

```
index.html          ← 必须在根目录
manifest.json
data/db.js
data/shops.json
assets/share-card.jpg
assets/share-square.jpg
assets/icon-192.png
assets/icon-512.png
assets/icon-180.png
assets/favicon.png
```

传法二选一：

- **控制台**：静态网站托管页 → 上传文件 → 支持一次拖多个文件和文件夹（拖 `data`、`assets` 两个文件夹 + 根目录那几个文件）
- **命令行**（文件多的时候更省事）：
  ```bash
  npm i -g @cloudbase/cli
  tcb login
  tcb hosting deploy ./你的解压目录 -e <你的环境ID>
  ```

> 索引文档保持默认的 `index.html` 即可；**不要**开 SPA 的 404 回退（我们的 `/data/*`、`/assets/*` 都是真实路径）。

---

## 第 2 步：验收（4 条）

1. 打开默认域名根地址 → 显示「饭饭AI 智能体」首页，底部有 4 个 Tab
2. `<域名>/data/db.js` → 返回 JS 内容（不是 404、不是下载）
3. `<域名>/assets/icon-192.png` → 能看到饭饭的图标
4. 页面里点几下（换档位、发现美食）→ 正常

---

## 第 3 步：把域名发我（我来改 3 行）

前端里有 3 个**绝对地址**目前还指着旧的阿里云域名，必须改成你的 CloudBase 域名，微信才抓得到分享图：

```html
<link rel="canonical" href="…">
<meta property="og:image" content="…/assets/share-card.jpg">
<meta property="og:url" content="…">
```

你把默认域名发我，我改完给你一个新的 `index.html`，**你只需要在控制台重新上传这一个文件**（覆盖）。改完在微信里发一次链接，卡片就有标题 + 缩略图了。

---

## 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 打开根地址是 404 或文件列表 | `index.html` 没放在根目录（可能多套了一层文件夹） |
| `/data/db.js` 404 | `data` 文件夹没传，或结构变成了 `data/data/db.js` |
| 页面打开是白屏、控制台报 db.js 语法错误 | `data/db.js` 被当成网页返回了，检查是不是传成了别的文件 |
| 首页显示"数据没加载" | 同上：`data/db.js` 没找到 |
| 微信卡片还是没有图 | 微信对链接有缓存，换个参数再发一次；确认第 3 步改完了 |

---

## 和现有东西的关系

- **GitHub Pages 继续留着**：`https://zhemgcm-maker.github.io/fanfan-web/` 当镜像，两边同一份文件，互不影响
- **后端不动**：登录、AI、高德代理仍在队友那个阿里云 FC 上（`fetch` 调接口不受"强制下载"影响，一直是好的）
- **前端也不用改**：页面里的后端地址是绝对地址，从 CloudBase 域名跨域调用照样通
