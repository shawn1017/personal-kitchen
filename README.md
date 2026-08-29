# 私人厨房 V1

一个仅供个人使用的微信菜谱管理小程序：把公开的小红书 / 下厨房菜谱链接整理成可编辑草稿，保存到本地菜谱库，再完成“厨房点菜 → 生成订单 → 标记完成 → 再来一单”的闭环。

本项目基于 MIT License 的 [HeartMeal](https://github.com/Sky-Sheepfold/HeartMeal) 二次开发，保留原项目 `LICENSE` 和署名。产品已经移除多用户、价格、支付、用餐人数及社交语义，业务数据全部 local-first；唯一后端是无业务数据库的公开链接 Import Service。

## 已实现

- 厨房：左侧分类、菜名搜索、上架过滤、菜谱详情、数量增减和本次菜单。
- 订单：待做 / 已完成筛选、日期筛选、备注、完成订单、再来一单；订单保存菜名和图片快照。
- 菜谱管理：新增、编辑、删除、上下架、搜索、分类筛选、排序、批量上下架。
- 分类管理：新增、重命名、显示 / 隐藏、排序、删除时迁移已有菜谱。
- 菜谱编辑器：持久化封面、导入图库、原始文案、用料、步骤图片、步骤排序、可选计时、tips、来源信息。
- 链接导入：小红书、`xhslink.com`、下厨房识别；自动解析、部分成功、粘贴原文和详细录入降级。
- 安全边界：来源 host 白名单、DNS / 内网地址拦截、超时、响应体与重定向限制、短期令牌图片中转，不能用作任意 URL 代理。
- 容错存储：统一 `personal_kitchen_*` 键、Schema 初始化、异常数据过滤，单条坏数据不应导致页面白屏。

## 环境要求

- Node.js 20 或更高版本（Import Service 使用原生 `fetch`）。
- npm 10 或兼容版本。
- 微信开发者工具。

## 安装

```bash
npm install
npm install --prefix import-service
cp .env.example .env.development
```

`.env.development` 默认可以填写：

```dotenv
TARO_APP_IMPORT_API_BASE=http://127.0.0.1:3210
```

不要把 `127.0.0.1` 固定写入业务代码。真机调试时需改成手机能访问的 HTTPS 地址，并在微信小程序后台加入 request 合法域名。

## 本地启动

终端一，启动链接导入服务：

```bash
npm run dev:import
```

终端二，启动微信小程序监听构建：

```bash
npm run dev:weapp
```

需要在浏览器快速核对首版页面时，可以生成独立的 H5 预览，不会覆盖微信构建目录：

```bash
npm run build:h5
python3 -m http.server 4173 --directory dist-h5
```

浏览器打开 `http://127.0.0.1:4173/`。H5 仅用于布局和主交互预览，最终仍以微信开发者工具和真机行为为准。

Import Service 默认监听 `http://127.0.0.1:3210`，健康检查为 `GET /health`。

## 在线网页

本仓库通过 GitHub Actions 自动构建并发布 H5 到 GitHub Pages。网页使用 Hash 路由，分类、菜谱、菜单和订单数据保存在当前浏览器的 Local Storage 中；刷新页面后仍会保留，但不会自动跨浏览器或跨设备同步。

- 在线预览：<https://shawn1017.github.io/personal-kitchen/>
- GitHub 仓库：<https://github.com/shawn1017/personal-kitchen>
- 推送到 `main` 分支后会自动部署。
- Pages 构建会根据 GitHub 仓库名自动设置静态资源子路径，本地构建仍使用 `/`。
- 纯静态 Pages 不运行 Import Service；链接自动解析会提示服务未配置，仍可用“粘贴原文”或“详细录入”创建菜谱。

部署工作流：`.github/workflows/deploy-pages.yml`。

## 检查与构建

```bash
npm run typecheck
npm run test:import
npm run build:weapp
npm run build:h5
npm run build:import
```

也可以执行完整检查：

```bash
npm run check
```

## 微信开发者工具

1. 先运行 `npm run build:weapp`，确认生成 `dist/`。
2. 用微信开发者工具导入本仓库根目录；`project.config.json` 已配置 `miniprogramRoot: dist/`。
3. 示例配置使用 `touristappid`，正式调试时在私有配置或开发者工具中换成你自己的 AppID。
4. 本机调试 Import Service 时，可在开发者工具里临时关闭合法域名校验；真机必须使用微信允许访问的 HTTPS 域名。

## 本地数据

小程序数据保存在微信本地 Storage：

- `personal_kitchen_categories`
- `personal_kitchen_recipes`
- `personal_kitchen_cart`
- `personal_kitchen_orders`
- `personal_kitchen_settings`
- `personal_kitchen_schema_version`

在微信开发者工具的 Storage 面板删除这些键即可重置；重新启动会重新生成默认分类和演示菜谱。用户选择的本地图片会通过 `Taro.saveFile` 保存到小程序文件沙箱。

## Import Service

服务只接收用户主动提供的公开链接，不使用 Cookie、登录状态、验证码或平台签名。目录位于 `import-service/`：

- `XiachufangProvider` 优先读取公开的 schema.org Recipe JSON-LD。
- `XiaohongshuProvider` 保留公开标题、原文和图片，再按明确编号尝试拆分步骤。
- 图片中转只接受本次解析时登记的短期 token，不接受调用方提供任意图片 URL。
- 没有账号系统、业务数据库、多租户或云端同步。

生产启动：

```bash
npm run build:import
PORT=3210 npm start --prefix import-service
```

部署到公网时应在反向代理层增加 HTTPS、请求频率限制和访问日志保留策略；日志中不要记录 Cookie、token 或用户粘贴的正文。

## 已知限制

- 小红书 / 下厨房页面结构和公开访问策略会变化，解析不能保证 100%；被登录、验证码、反爬或访问控制阻断时只能走原文 / 图片手工降级。
- Import Service 进程重启后，内存中的图片中转 token 会失效；重新导入即可生成新 token。
- 本地数据不会自动跨设备同步，清理微信小程序数据会删除业务数据。
- 示例菜谱使用项目内原创菜品图片，不依赖第三方版权素材。
- 真机链接导入必须部署 HTTPS 服务并配置微信合法域名；本仓库不包含远程部署与业务验收。

## 主要目录

```text
src/pages/index/             厨房
src/pages/cart/              本次菜单与下单
src/pages/orders/            待做 / 已完成订单
src/pages/recipe-manage/     菜谱管理
src/pages/category-manage/   分类管理
src/pages/recipe-edit/       完整菜谱编辑器
src/pages/recipe-detail/     菜谱详情
src/pages/recipe-import/     链接导入与降级
src/utils/                   local-first 数据与迁移
import-service/              公开页面解析和受控图片中转
```
