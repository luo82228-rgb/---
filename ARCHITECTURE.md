# 逸品看板 · 基本架构参考

本文档面向**想搭一个类似看板**的同事，描述整体设计思路、技术选型、数据流和落地步骤。看板本身的业务字段（品牌、广告、审查等）可以替换成自己的业务。

---

## 一、整体定位

一个**纯只读的多源数据汇聚看板**：把分散在多张 Google Sheets 的业务数据，通过一层 Cloudflare Worker 拉取 / 解析 / 缓存，再用单页 HTML 展示。

**没有数据库、没有用户系统、没有写操作。**

```
[Google Sheets × N]  →  [Cloudflare Worker / TS]  →  [单页 HTML / 浏览器]
   数据源（编辑端）      抓取·解析·缓存·聚合 API       前端筛选·渲染·交互
```

数据编辑仍然在 Google Sheets 里完成（多人协作天然解决），看板只负责"汇总展示"。

---

## 二、技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 数据源 | Google Sheets「发布到网络」CSV | 不依赖 Sheets API，无需鉴权 |
| 后端 | Cloudflare Workers + TypeScript | 仅 2 个文件：`src/index.ts`（路由）、`src/sheets.ts`（抓取 / 解析 / 映射） |
| 静态资源 | 单文件 HTML（含全部 CSS / JS） | 部署在 Worker 的 `[assets]` 目录 |
| 部署 | `npx wrangler deploy` | 域名 `*.workers.dev` 自动分配，免费额度足够 |
| 缓存 | Worker `caches.default`，TTL 60 秒 | `/api/refresh` 手动清缓存 |

`wrangler.toml` 极简：

```toml
name = "yp"
main = "src/index.ts"
compatibility_date = "2024-09-09"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./public"
```

`package.json` 只需要两个 devDependencies：`@cloudflare/workers-types`、`typescript`。

---

## 三、数据流

```
浏览器
  │  GET /api/all
  ▼
Worker /api/all ──── 命中 60s 缓存？─── 是 → 直接返回
                          │否
                          ▼
                   fetchAllData()           （并行）
                   ├─ fetchGidMap()  从 pubhtml 抓 sheet 名 ↔ gid 映射
                   ├─ 主表多 sheet 并行 fetch CSV  → parseCsv → mapAds / mapReviews / mapKeywords
                   ├─ 任务表独立 CSV               → mapTasks
                   └─ AI 成效表独立 CSV             → mapAi
                          ▼
                   汇总 JSON { ads, reviews, keywords, tasks, ai_items, updated_at }
                          ▼
                   写入缓存 + 返回
```

前端拿到 JSON 后，**所有筛选 / 分页 / 统计都在浏览器内存里完成**，不再发请求。

### Worker 路由（共 3 个）

- `GET /api/all` — 主数据接口，60 秒缓存
- `GET /api/refresh` — 手动清缓存并重建
- `GET /api/debug?sheet=XXX` — 单独调试某张 sheet 的表头和样本数据
- 其他路径 → 落到静态资源（`env.ASSETS.fetch`）

---

## 四、关键设计模式

### 1. 数据源识别：靠 sheet 名约定

主表 sheet 名前缀 `YP-` / `YPFH-` 识别品牌，名字含「广告明细」/「审查台帐」/「关键词」识别模块。同事的业务不同，直接改 `getBrand()` 和 `getModule()` 两个函数即可。

### 2. CSV 解析自己写

`parseCsv()` 是 RFC 4180 风格的逐字符解析器，支持：
- 引号字段内的换行（多行单元格）
- 双行合并表头（主表头空位用第二行填）
- 表头去掉括号说明，如「发现问题（有、无）」→「发现问题」

不引第三方库——Worker 体积小，且 npm 上的 CSV 解析器对中文合并单元格不友好。

### 3. 列名映射层（`mapAds` / `mapReviews` 等）

每个模块一个 mapper，把上游中文列名 → 前端固定英文字段：

```ts
function mapAds(rows, brand) {
  return rows.map(r => ({
    ad_no:    r['广告编号'] ?? '',
    brand,
    group:    r['广告对接群'] || r['新广告对接群'] || '',  // fallback 链
    amount:   r['广告金额'] ?? '',
    // ...
  })).filter(r => r.ad_no !== '');
}
```

**`r['新名'] || r['旧名']` 的 fallback 链非常有用**——上游改列名 / 发布快照过渡期，前端不会立刻挂掉。

这是同事最需要改的部分，决定了自己看板的字段长什么样。

### 4. 容错策略

- 任何单张 sheet 抓取失败：吞掉异常、不中断其他 sheet（`try/catch` 包在 promise 内）
- 整体失败才返回 500
- 单 sheet 失败的代价：前端少几条数据，而不是白屏

### 5. 前端单文件

一个 HTML 装下 7 个页面（总览 / 广告 / 审查 / 关键词 / 今日关注 / 任务 / AI），用 `data-page` 切换显隐，**不引框架**。

- 好处：部署简单、改一处立刻生效、首屏快、没构建步骤
- 坏处：1000+ 行后难维护，按团队取舍

如果同事的看板会长期演进、模块多，可以早期就上 Vue / React + Vite。但只是几页静态展示，单文件 HTML 反而最省事。

---

## 五、建议同事按这个顺序开工

1. **先理数据源**：列清楚有几张 Sheets、每张有哪些列、按什么维度分。这一步决定 `sheets.ts` 的结构。
2. **写后端 mapper**：每个数据源写一个 `mapXxx()`，先 `console.log` 出来确认字段对齐。
3. **本地跑 `wrangler dev`**：访问 `/api/all` 看 JSON 是否符合预期；用 `/api/debug?sheet=xxx` 单独调试某张表。
4. **再写前端**：可以从复制 `public/index.html` 起步，删掉用不到的页面、改列定义。
5. **部署**：`npx wrangler deploy`。Cloudflare 免费额度对内部看板完全够用。

---

## 六、可直接复用的"骨架"清单

如果只想要架构、不想抄业务，下面 4 个文件作为模板就够了：

- `wrangler.toml`（5 行）
- `package.json`（仅两个 devDependencies）
- `src/index.ts` 的路由 + 缓存框架（约 50 行）
- `src/sheets.ts` 里的 `parseCsv()` 函数和 `fetchAllData()` 的并行抓取骨架

业务部分（`getBrand` / `getModule` / 各种 `mapXxx`）让同事按他的 Sheets 自己改写。

---

## 七、踩过的坑 / 注意点

- **Google Sheets「已发布」快照约 5 分钟刷新一次**——同事点保存后看板马上看不到新数据是正常的，不是 worker 的 bug。
- **改前端必须 `npx wrangler deploy` 才会生效**，浏览器还要 Cmd + Shift + R 绕过缓存。
- **「发布到网络」一次发布会同步所有 sheet**，不要担心漏发布某张。但**删除 sheet 后取消发布有延迟**，前端会看到旧表"幽灵数据"，必要时重新发布。
- **CSV 里的合并单元格**：Google Sheets 导出时，合并单元格只有左上角有值、其他位置是空字符串。在 mapper 里需要手动"向下填充"（参考 `mapReviews` 中的 `lastDate`）。
