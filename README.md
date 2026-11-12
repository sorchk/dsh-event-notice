# dsh-event-notice

DSH 事件通知插件。当任务完成、子任务完成、任务中断、需要审批、需要回答问题时，把通知发到你配置的 **Ntfy** 、**Gotify**、或通用 **Webhook** 。

通知正文只包含会话标题、子代理标签、事件细节与工作区名称，**不包含会话正文**。发送失败只写日志，不会打断会话或工具执行。

---

## 功能

| 通知事件 | 触发来源 | 说明 |
| --- | --- | --- |
| 任务完成 `task-complete` | 会话事件 `turn/end`，结束原因 `completed` | 主会话的一轮任务正常跑完 |
| 子任务完成 `subtask-complete` | 子代理会话事件 `turn/end`，结束原因 `completed` | 子代理（子任务）正常跑完。**默认不勾选**，需要时在配置页打开 |
| 任务中断 `task-interrupted` | 会话事件 `turn/end`，结束原因为中止 / 阻塞 / 报错 / 达到 token 上限 | 附上具体原因，例如「任务被中止（用户中止）」。子任务中断也算这一类 |
| 需要审批 `approval-required` | 会话事件 `approval/asked` | 附上工具名与审批原因 |
| 需要回答问题 `question-required` | 会话事件 `tool/call`，工具名为 `ask_user_question` | 助手正在等你回答 |

「任务完成」只管主会话，「子任务完成」只管子代理会话（子任务 = 子代理会话），两者互斥：一条完成事件只归其中一类，不会重复通知。

三个通道可以同时启用：Gotify 走 `POST <服务器地址>/message?token=<应用令牌>`，Webhook 走自定义方法与自定义请求体，Ntfy 走 JSON 发布接口（主题放在请求体里，所以标题里的中文不会坏掉请求头）。

Ntfy 与 Gotify 的通知默认按**卡片样式**发送：标题前带一个按事件类型区分的彩色圆点作为卡片头，正文用 Markdown 引用块排版，客户端里渲染成一张带底色的卡片。可以在配置页关掉「卡片样式」，退回纯文本通知。

## 安装

插件是一个 Cordis bundle，同时包含宿主端（`index.js`）与浏览器端（`client.js`）。

### 从 GitHub 仓库安装

不想等 npm 发布，或者想直接用主分支的最新改动时，用 `dsh plugin` 命令装。
这条命令把参数原样转给 pnpm，实际是在 `~/.dsh/profiles/<profile>/` 里执行 `pnpm add`：

```bash
# 默认分支（main）的最新提交
dsh plugin --profile web add github:sorchk/dsh-event-notice

# 固定到某个 tag
dsh plugin --profile web add github:sorchk/dsh-event-notice#v0.5.10

# 固定到某个 commit
dsh plugin --profile web add github:sorchk/dsh-event-notice#c30f562
```

| 事项 | 说明 |
| --- | --- |
| `--profile web` | 装到哪个 profile。`web` 是网页版，其它取值见 `dsh --help`（如 `tui`、`headless`）；各 profile 的插件互不相通 |
| 安装位置 | `~/.dsh/profiles/<profile>/`，装完后插件会写进该 profile 的 `package.json` 依赖里 |
| 自动启用 | 安装成功后 DSH 会自动把插件追加到同一份 `package.json` 的 `dsh.profile.bundles` 列表，不用手动加 |
| 生效时机 | 需要**重启**该 profile 的 DSH 进程（网页界面）才会加载新插件 |
| 依赖 | `@deepseek-ai/schemastery` 由 pnpm 一并装进 profile 的 `node_modules/`，宿主端可以直接解析到 |
| 卸载 | `dsh plugin --profile web remove dsh-event-notice` |
| 更新 | `dsh plugin --profile web update dsh-event-notice` |

`owner/repo`、`owner/repo#tag`、`owner/repo#commit` 是 pnpm 的 GitHub 简写，`dsh plugin` 原样透传；
也接受完整地址：

```bash
dsh plugin --profile web add https://github.com/sorchk/dsh-event-notice.git
dsh plugin --profile web add git+ssh://git@github.com/sorchk/dsh-event-notice.git
```

> **构建脚本**：pnpm 默认不执行依赖的构建脚本。本插件自身没有构建脚本，正常不会触发拦截；
> 如果 pnpm 提示构建被阻止，按提示在 `~/.dsh/profiles/<profile>/pnpm-workspace.yaml` 的
> `allowBuilds` 下加上对应的键（例如 `dsh-event-notice: true`），然后重跑同一条命令。


安装后：

- 宿主端会注册一行插件（行 id 与设置命名空间都是 `dsh-event-notice`）；
- 浏览器端会在「插件 → 事件通知」里出现一张配置页，同时在插件详情页挂一个概览区块；
- 浏览器端还会在 **设置弹窗左侧导航**（排在「侧边卡片」之后）加一个「事件通知」入口，点开就是同一张配置页；这个入口可以用配置页里的「在设置页显示」关掉，关掉后导航里就没有这一项了；
- 浏览器端会在 **会话输入框**（模型选择器左边）加一个铃铛按钮，用来单独开关当前会话的通知。

本地链接安装时，插件自带的 `node_modules/@deepseek-ai/schemastery` 会被一起链接；从 GitHub 或 npm 安装时，该依赖由包管理器装进 profile 的 `node_modules/`。无论哪种方式，宿主的 ESM 解析器都能正常找到依赖。

## 配置页

在 Web GUI 的「设置 → 事件通知」或「插件 → 事件通知」里配置，所有字段都是即改即生效的。

配置页沿用 DSH「通用设置」的排版：每一项是「左边标题加说明、右边控件」的一行，行间一条细线；三个通道用标签页组织，标签依次是 **Ntfy、Gotify、Webhook**。

### 通用

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 启用通知 | 开 | 总开关。关闭后不发任何通知 |
| 所有会话默认通知 | **关** | 所有会话的默认行为。会话级覆盖优先于它 |
| 默认通知方式 | Gotify + Webhook + Ntfy | 勾选实际使用的通道 |
| 在设置页显示 | **开** | 关掉后设置弹窗左侧导航不再出现「事件通知」，只能从「插件 → 事件通知 → 配置」进入 |
| 默认通知的事件 | 除「子任务完成」外四项全开 | 勾选需要通知的事件。「子任务完成」默认不勾选 |
| 卡片样式 | **开** | Ntfy 与 Gotify 的通知按卡片发送：标题带彩色圆点，正文用 Markdown 排版。关掉后退回纯文本 |
| 通知标题前缀 | `DSH` | 通知标题形如 `DSH · 任务完成` |
| 请求超时（毫秒） | `10000` | 单次请求超时 |

### Ntfy / Gotify / Webhook

三个通道各占一个标签页，标签顺序是 Ntfy、Gotify、Webhook。下面三节分别说明各通道的配置项。

### Gotify

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 服务器地址 | 空 | 例如 `https://gotify.example.com` |
| 凭据引用名 | `DSH_EVENT_NOTICE_GOTIFY_TOKEN` | 应用令牌在凭据存储里的键名 |
| 应用令牌 | 空 | 写入凭据存储，不随设置明文落盘；留空表示保持原值 |
| 按事件设置优先级 | 五项都是 `5` | 每种事件单独设 Gotify 优先级（0–10），没写的用缺省值 5 |

令牌也可以用环境变量提供：凭据存储解析不到时不会回退到环境变量，需要环境变量时请把引用名设成同名变量并自行写入凭据存储。

### Ntfy

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 服务器地址 | 空 | 例如 `https://ntfy.example.com`；插件向根路径发布，主题放在请求体里，所以地址可以带路径前缀 |
| 主题 | `dsh` | 通知发布到哪个主题 |
| 凭据引用名 | `DSH_EVENT_NOTICE_NTFY_TOKEN` | 访问令牌在凭据存储里的键名 |
| 访问令牌 | 空 | 写入凭据存储，不随设置明文落盘；留空表示保持原值。留空且服务器允许匿名发布时可以匿名发 |
| 按事件设置优先级 | 见下表 | 每种事件单独设 Ntfy 优先级（1–5） |

Ntfy 用 JSON 发布接口，请求体形如：

```json
{
  "topic": "dsh",
  "title": "DSH · 任务完成",
  "message": "会话标题：收到\n任务正常完成",
  "priority": 3
}
```

### 按事件设置优先级

Gotify 与 Ntfy 都支持「每种事件一个优先级」，互不影响。

Ntfy 的五档优先级：

| 值 | 档位 | 效果 |
| --- | --- | --- |
| 1 | min | 不震动不响铃，折叠在「其它通知」里 |
| 2 | low | 不震动不响铃，拉下通知抽屉才看到 |
| 3 | default | 短震动 + 默认提示音 |
| 4 | high | 长震动 + 提示音，弹出通知 |
| 5 | max | 很长的震动 + 弹出通知（urgent） |

配置页里 Ntfy 用下拉框给这五档命名，Gotify 用 0–10 的数字。某一事件没单独设置时，用通道缺省值（Ntfy 为 3，Gotify 为 5）。

一个常见搭配：

| 事件 | Ntfy | Gotify |
| --- | --- | --- |
| 任务完成 | 3 default | 5 |
| 子任务完成 | 3 default | 5 |
| 任务中断 | 4 high | 8 |
| 需要审批 | 5 max | 9 |
| 需要回答问题 | 5 max | 9 |

### Webhook

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 地址 | 空 | 完整的 Webhook 地址 |
| 请求方法 | `POST` | `POST` 或 `PUT` |
| 额外请求头 | 空 | 每行一个 `名称: 值`，`#` 开头为注释 |
| 请求体模板 | JSON 模板 | 占位符 `{{event}}` `{{title}}` `{{message}}` `{{cardTitle}}` `{{cardMessage}}` `{{sessionId}}` `{{sessionTitle}}` `{{parentTitle}}` `{{workspace}}` `{{cwd}}` `{{detail}}` `{{timestamp}}` |
| 请求体类型 | `application/json` | `Content-Type` |

请求体模板里的字符串值按 JSON 字面量转义后再填入，带引号或换行的正文也不会破坏请求体。

### 会话级覆盖

有三种方式改单个会话的通知行为：

1. **输入框里的铃铛按钮**（模型选择器左边）——最快。按钮显示的是这个会话**实际生效**的状态：
   - 没有小圆点：跟随「所有会话默认通知」；
   - 有小圆点：这个会话被单独改过。
   - 铃铛按钮是输入框里的圆形图标按钮（和「＋」按钮同款外形），悬停时弹出外壳统一的提示气泡；
   - 铃铛图标的颜色也跟着状态走：通知关闭时是浅蓝色，开启时是蓝色（与发送按钮、停止按钮同一个色系）。

   点一下就切换；点回与全局默认一致时，会把覆盖记录删掉、重新跟随默认（所以是「跟随默认 → 关 → 跟随默认 → 关」这样循环）。覆盖写在设置里的 `sessionOverrides` 字典，键是会话 ID。
2. **配置页的「会话级覆盖」卡片**——列出已经设过覆盖的会话，每一项显示**会话名**（会话标题），可以直接开关或删除。开关旁边的文字是「通知」/「不通知」，只描述这一个会话的状态。
3. 直接改配置文件里的 `sessionOverrides`。

会话级覆盖只影响那一个会话，其它会话仍按「所有会话默认通知」走。

### 测试通知

「发送测试通知」会对每个已启用且配置完整的通道各发一条测试消息，结果直接显示在按钮下方。

这个按钮走的是插件挂在 DSH Web 上的本地路由 `POST /dsh-event-notice/test`，路由只接受同源请求：
浏览器发来的 `Origin` 与 `Host` 必须完全一致，否则返回 403 `cross-origin request refused`。
通过 `127.0.0.1`、局域网 IP、主机名、Tailscale 地址或反向代理域名访问 DSH Web 都不受影响。

通知正文（`message`）依次是「会话标题」「事件细节」「工作区」三行，会话标题取自会话自己的标题，拿不到时退回会话 ID。

「工作区」这一行写的是工作区的名称，不是工作目录的路径：名字取自 DSH 的工作区注册表，
也就是侧边栏里那个工作区的显示名（默认是目录名，用户可以改名）。注册表里还没有这条会话时，
退回会话工作目录的最后一段。

会话标题直接向 DSH 的标题服务查——那是会话状态的权威视图，插件重启、
会话在插件加载之前就已经建好，都还能取到真正的标题，不会退化成 `session-…`
这样的会话 ID。事件流只作兜底：标题事件只在标题生成时出现一次，错过就没了。

子代理会话另走一条：它的会话标题是从提示词里截出来的兜底标题（等于提示词片段），
不能当标题用，因此正文第一行写成「子代理：<子代理标签>」，第二行写「主会话：<主会话标题>」：

子代理标签取自任务管理面板上那张卡片的名字；主会话标题沿父会话链往上找，
只认标题生成服务或用户改名给出的正式标题，没有正式标题时就不写「主会话」这一行。

## 通知载荷

Webhook 默认请求体：

```json
{
  "event": "task-complete",
  "title": "DSH · 任务完成",
  "message": "会话标题：收到\n任务正常完成\n工作区：dsh-event-notice",
  "sessionId": "session-…",
  "sessionTitle": "收到",
  "parentTitle": "",
  "timestamp": "2026-11-08T06:12:25.603Z"
}
```

子代理会话的载荷里 `sessionTitle` 是「子代理：<子代理标签>」，`parentTitle` 是主会话标题；
勾上「子任务完成」后，子代理正常完成时 `event` 为 `subtask-complete`、`title` 为 `DSH · 子任务完成`。

载荷里还带 `workspace`（工作区名称）与 `cwd`（工作目录路径），两者都只进自定义模板的占位符，
默认请求体里不带；正文里出现的是工作区名称，工作目录路径不出现在通知里。

Gotify 请求体（卡片样式）：

```json
{
  "title": "🟢 DSH · 任务完成",
  "message": "> **会话标题**：收到\n>\n> **细节**：任务正常完成\n>\n> **工作区**：dsh-event-notice",
  "priority": 5,
  "extras": {
    "client::display": {
      "contentType": "text/markdown"
    }
  }
}
```

Ntfy 请求体（卡片样式）：

```json
{
  "topic": "dsh",
  "title": "🟢 DSH · 任务完成",
  "message": "> **会话标题**：收到\n>\n> **细节**：任务正常完成\n>\n> **工作区**：dsh-event-notice",
  "priority": 3,
  "markdown": true
}
```

### 卡片样式

Ntfy 与 Gotify 的推送协议里都没有颜色字段，所以卡片头的颜色用一个彩色圆点表示，
按事件类型区分：

| 事件 | 卡片头 |
| --- | --- |
| 任务完成 | 🟢 绿 |
| 子任务完成 | 🔵 蓝 |
| 任务中断 | 🔴 红 |
| 需要审批 | 🟠 橙 |
| 需要回答问题 | 🟣 紫 |

圆点写进通知标题（标题是纯文本，客户端原样显示），正文用 Markdown 的引用块排版，
客户端把引用块渲染成一张带底色的卡片，因此整体看起来是一张「有颜色卡头」的卡片。

Gotify 靠 `extras.client::display.contentType = text/markdown` 让客户端按 Markdown 渲染；
Ntfy 靠请求体里的 `markdown: true`。两者都不支持 HTML，因此卡片里不写 HTML 标签。

关掉配置页的「卡片样式」后，两个通道的请求体回到纯文本形式（不带 `markdown` 与 `extras`）。
Webhook 不受影响，永远发纯文本正文；自定义模板里可以用 `{{cardTitle}}` 与 `{{cardMessage}}`
占位符取到卡片标题与卡片正文。

## 权限与隐私

- 只监听会话事件，不读取会话正文；
- 只向用户在配置页填写的 Gotify 服务器、Webhook 地址与 Ntfy 服务器发起请求；
- Gotify 应用令牌与 Ntfy 访问令牌都存在凭据存储（`~/.dsh/.credentials.yaml`），不写进设置文件。

## 开发

```bash
npm test          # node --test（自动发现 test/ 下的 *.test.js，兼容 Node 20）
node --check index.js
node --check client.js
```

目录结构：

```
index.js        宿主端：配置、事件监听、通道分发
lib/notify.js   纯逻辑：事件分类、通知决策、载荷构造、通道发送
lib/http.js     「发送测试通知」用的本地路由
client.js       浏览器端：配置页
locale/         en / zh 文案
test/           单元测试（notify.test.js 纯逻辑，plugin.test.js 宿主端接线，http.test.js 同源判定与路由）
```

## GitHub Actions

仓库内置两个工作流：

| 工作流 | 触发方式 | 做什么 |
| --- | --- | --- |
| [.github/workflows/ci.yml](./.github/workflows/ci.yml) | 每次 push、每个 PR | 语法检查 + 单元测试（`npm ci` → `node --check` → `npm test`） |
| [.github/workflows/publish.yml](./.github/workflows/publish.yml) | **推送 `v*` tag 时自动触发**，也可手动触发 | 构建后直接发布到 npm 官方仓库 |

## 发布到 npm（推送 tag 自动发布）

发布工作流在**推送 `v*` tag 时自动执行**，把该 tag 的代码构建后发布到 npm 官方仓库
（`registry.npmjs.org`）。工作流**不保留任何产物**：不上传 artifact、不创建 GitHub Release、
也不把打包结果推回 GitHub 仓库，构建结果只流向 npm。

### 前置配置（一次性）

1. 在 npm 上确认包名 `dsh-event-notice` 可用（未被占用）。
2. 二选一地配置发布凭据：

   | 方式 | 配置 | 说明 |
   | --- | --- | --- |
   | npm token | 仓库 **Settings → Secrets and variables → Actions** 新建 secret `NPM_TOKEN`，值为 npm 的 Automation Token（Classic Token 勾选 publish） | 优先使用；没有配置时才回退到 OIDC |
   | OIDC 受信任发布 | 在 npmjs.com 上为该仓库开启 **Trusted Publishing**（仓库名 `sorchk/dsh-event-notice`） | 不需要 token，工作流自动换取短期凭据；依赖 npm ≥ 11.5.1（工作流会自动升级 npm） |

3. npm 账号需要开通 **Two-factor authentication**（npm 现在强制要求）。

### 执行方式

提升版本号、打上同名 tag 并推送，发布就自动发生：

```bash
npm version patch --no-git-tag-version   # 或手工改 package.json 的 version
git commit -am "版本：升级到 0.5.11"
git tag v0.5.11
git push origin main --tags
```

也可以在 GitHub 仓库页 → **Actions** → 左侧选择「构建并发布到 npm」→ 右侧 **Run workflow**
手动跑一次，输入项：

| 输入项 | 默认 | 说明 |
| --- | --- | --- |
| `dry_run` | `true` | 发布演练：`npm publish --dry-run`，不真正上传；演练模式不会回查 npm 上的版本，因为演练不会真的发布 |
| `provenance` | `true` | 启用 npm provenance 签名（需仓库为公开仓库，工作流已申请 `id-token: write`） |

### 工作流做了什么

| 阶段 | 步骤 |
| --- | --- |
| 构建 | 检出代码 → Node.js 20 → 固定 npm 官方仓库 → `npm ci` → `node --check` 语法检查 → `npm test` 单元测试 → 校验 `package.json`（无 `private`、有 `version`、包名为 `dsh-event-notice`、协议为 MIT）与 `LICENSE` → 校验 tag 与 `package.json` 版本一致 → 检查该版本是否已发布（已发布则报错退出）→ `npm pack --dry-run` 预览打包内容（不落地产物） |
| 发布 | 确定认证方式（有 `NPM_TOKEN` 用 token，没有则用 OIDC）→ `npm publish --access public --registry=https://registry.npmjs.org` → 回查 npm 上的版本与 tarball 地址（最多重试 20 次 × 15 秒；`dry_run` 模式跳过回查） |

> 版本号来自 `package.json`，且必须与 tag 一致（`v0.5.11` ↔ `0.5.11`），否则工作流直接失败。
> 重复发布同一版本会被 npm 拒绝，工作流也会提前拦截，因此每次发布前请先提升 `package.json` 的版本号。

发布后即可通过 `plugin_manager install_bundle dsh-event-notice` 安装；
不等发布的话，直接从 GitHub 仓库装：`dsh plugin --profile web add github:sorchk/dsh-event-notice`。

## 许可证

本项目采用 [MIT 许可证](./LICENSE)，版权所有者：sorchk。

```text
MIT License

Copyright (c) 2026 sorchk
```

完整协议文本见仓库根目录的 [`LICENSE`](./LICENSE) 文件（随 npm 包一同分发）。
